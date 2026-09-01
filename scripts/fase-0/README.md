# Fase 0 — medição de ingestão

Instrumento da **Fase 0** do [PLANEJAMENTO.md](../../PLANEJAMENTO.md) §11.1. Ele existe para
transformar uma hipótese em fato barato: **quantos arquivos reais de contas a receber o Atlas
consegue importar hoje sem intervenção humana, e o que ele erra quando consegue.**

Não é código de produção, não é parte do build, e nada aqui é importado por `src/`.

---

## Arquivos

| Arquivo | Papel |
|---|---|
| `medir-ingestao.mjs` | Orquestra a leitura, roda os portões e imprime o relatório |
| `matcher-b2.mjs` | Os dois baselines de reconhecimento de coluna (B1 e B2) e a categorização de ambiguidade |
| `classificadores.mjs` | Rotuladores de forma: valor, data, telefone, estrutura do arquivo |
| `amostras/` | Onde você põe os arquivos. Ignorada pelo git — ver **Privacidade** |

---

## O que ele responde

### 1. Portão de mapeamento — três desfechos, não dois

"Mapeou os 4 campos" **não é sucesso**. Um arquivo com as colunas `Data` e `Data de Vencimento`
mapeia os quatro campos e escreve a data de **emissão** no vencimento, sem um aviso. Por isso o
desfecho tem três valores, e o número do §5.1 é o primeiro deles:

- `mapeou_sem_ambiguidade` — um único candidato por campo;
- `mapeou_com_ambiguidade` — dois ou mais candidatos disputam o mesmo campo, ou os dois baselines
  escolhem colunas diferentes. Precisa de confirmação humana;
- `nao_mapeou` — HTTP 400, a porta do §5.1.

**Por que a ambiguidade é medida na união B1 ∪ B2, e não só no B1.** Medido nesta sessão: com os
cabeçalhos `["Data", "Data de Vencimento"]`, o B1 sozinho responde `mapeou_sem_ambiguidade` e
escolhe `Data`. Não é falha do detector — sob `normalizarHeader`, `"Data de Vencimento"` vira
`"data_de_vencimento"`, que não é alias de nada, então existe **um** candidato de fato. A coluna
certa é invisível para o B1, e o sucesso falso não é detectável de dentro do próprio B1. A
discordância entre dois reconhecedores razoáveis é a definição operacional de "isto precisa de
confirmação". Os números estritos do B1 continuam sendo reportados ao lado.

### 2. Segundo baseline (B2)

B2 usa a **mesma lista `COLUMN_ALIASES`**, sem acrescentar um único alias. Só a normalização muda:

- remove acento (`Número` deixa de falhar contra o alias `numero`);
- remove separador terminal (`Tel.` vira `tel`, não `tel_`);
- descarta unidade entre parênteses (`Valor (R$)` vira `valor`);
- casa por conjunto de tokens, ignorando `de/do/da/dos/das/e/em/no/na`;
- alias mais específico vence o genérico; empate vira ambiguidade.

A diferença B1 → B2 é o resultado que decide a Fase 1: **diferença grande** significa que a lista
de aliases já cobria o mundo e quem falha é `normalizarHeader`; **diferença pequena** significa que
a lista não converge, e a tela de mapeamento passa a ser o centro da Fase 1 em vez de um fallback.

O casamento aceita só três formas — igualdade exata, igualdade de conjunto de tokens, e **alias
contido no header**. A direção contrária (header contido no alias) é recusada de propósito: ela faz
`VL` casar com `vl_titulo` e `DT` com `dt_vencimento`, inflando o B2 com falso positivo. A
contenção também é por **token**, não por substring de texto, porque substring crua ainda casaria o
alias `vl` dentro do header `vlr_desconto`.

### 3. Formatos de valor, e o defeito do §5.3

Conta as formas que aparecem de verdade e quantifica o `"1.500"` **em reais** — mas só onde a
leitura correta é conhecida: dois ou mais pontos (`1.234.567`, impossível ser decimal), ou um ponto
ambíguo numa coluna que já provou ser milhar. Fora disso a célula é contada como ocorrência e o
prejuízo fica indeterminado. Não se inventa número, nem para o lado ruim.

Também classifica cada **coluna** de valor em `milhar` / `decimal` / `conflito` / `sem_sinal`,
testando a tese que o §5.3 usa para justificar a correção estrutural. `conflito` e `sem_sinal` são
os casos em que decidir por coluna **também não basta** — se aparecerem nos arquivos reais, mudam o
desenho da Fase 1.

### 4. Ordem dia/mês

Classifica cada coluna de data em `DD/MM_provado`, `MM/DD_provado`, `inconsistente` ou
`ambiguo_sem_sinal`. Só o dado prova a convenção: primeiro campo > 12 prova DD/MM, segundo > 12
prova MM/DD.

**O que acontece com um arquivo MM/DD** — verificado executando as funções da produção:

| Linha | `normalizarData` | Destino |
|---|---|---|
| `10/25/2026` | `"2026-25-10"` (mês 25) | Passa o regex de `validarLinhaRecebida`; barrada só por `dataEmFaixaRazoavel`, porque `new Date` devolve `Invalid Date`. Recusada com **"mais de 5 anos no passado ou no futuro"** — diagnóstico errado |
| `03/04/2026` | `"2026-04-03"` | Passa e entra **trocada** (3 de abril em vez de 4 de março) |

O arquivo perde as linhas que provam a convenção com um erro enganoso e corrompe em silêncio as que
não provam. `ambiguo_sem_sinal` é o caso pior: vencimento de PME concentra em dia 5 e 10, então um
arquivo inteiro pode ficar abaixo de 12 nos dois campos, ter 100% das datas invertidas e **zero
rejeições**. Ausência de sinal não é evidência de que está certo.

### 5. Forma do telefone

Distribuição de quantidade de dígitos, quantos ganham o prefixo `55`, e quantos arquivos **não têm
coluna de telefone** — o caso do §5.2, em que uma planilha de contas a receber íntegra é recusada
inteira porque o campo existe para o WhatsApp e não para a contabilidade.

Marca também uma suspeita: número que **começa** com 55 e tem 10 ou 11 dígitos. O DDD 55 existe
(Santa Maria/RS); `limparTelefone` lê esse 55 como DDI e não prefixa, e o número fica sem país.
Suspeita, não defeito provado.

### 6. Estrutura do arquivo

Conta arquivos cujo cabeçalho provavelmente **não está na linha 1** (2+ campos vazios ou `_N`, ou
campo com mais de 40 caracteres — assinatura de título de relatório de ERP) e arquivos cuja última
linha parece **rodapé de totais**. Os dois viram defeito silencioso: o primeiro faz o produto
recusar por "não identifiquei as colunas" um arquivo perfeitamente importável; o segundo entra como
uma cobrança fantasma no valor da soma do arquivo inteiro.

---

## Como rodar

```bash
node --experimental-strip-types scripts/fase-0/medir-ingestao.mjs
```

Lê `scripts/fase-0/amostras/` por padrão. Para apontar para outro lugar — recomendado para
arquivos reais, ver **Privacidade**:

```bash
node --experimental-strip-types scripts/fase-0/medir-ingestao.mjs "C:/caminho/para/amostras"
```

Para guardar o resultado bruto além do relatório de tela:

```bash
node --experimental-strip-types scripts/fase-0/medir-ingestao.mjs ./amostras --json resultado.json
```

A flag `--experimental-strip-types` é obrigatória: é ela que deixa o Node 22 importar
`src/lib/csv-import.ts` **diretamente, sem transpilar e sem dependência nova**. O aviso
`ExperimentalWarning` na saída é esperado e inofensivo.

Formatos lidos: `.csv`, `.txt`, `.tsv`. **`.xlsx` não é lido de propósito** — o produto também não
lê, e XLSX está explicitamente fora do recorte da Fase 1 (§11.2).

### Por que `.mjs` e não `.ts`

O `tsconfig.json` inclui `**/*.ts`, então um arnês em TypeScript entraria no `npx tsc --noEmit`, e
importar `../src/lib/csv-import.ts` com extensão explícita falha com `TS5097` a menos que
`allowImportingTsExtensions` seja ligado — o que exigiria editar `tsconfig.json`, mudança de
configuração que o §14 não autoriza. `.mjs` não é coberto pelo `include` e o problema não existe.
O ESLint, esse sim, cobre `scripts/**/*.mjs` (verificado).

---

## Privacidade — leia antes de copiar arquivo real para cá

Export real de contas a receber contém **nome, telefone e CPF/CNPJ de pessoas**. Este repositório
tem remote no GitHub.

- `amostras/` tem um `.gitignore` que ignora tudo dentro dela. É proposital.
- **Melhor ainda: mantenha os arquivos fora do repositório** e passe o caminho como argumento.
- O relatório **nunca imprime nome nem telefone** — do telefone sai só a contagem de dígitos. Ele
  imprime texto cru de células de _valor_ e _data_ recusadas, porque é impossível entender o formato
  sem ver o texto, e imprime **cabeçalhos**, que podem conter nome de empresa. Confira antes de
  colar a saída em qualquer lugar.

---

## O que ele deliberadamente NÃO faz

- Não fala com o banco. Não importa `src/lib/supabase.ts` nem nada que o alcance.
- Não grava nada, em lugar nenhum, exceto o JSON que você pedir com `--json`.
- Não altera arquivo de `src/`, de `supabase/` ou de configuração.
- **Não corrige nenhum dos defeitos que mede** — nem o §5.3, nem a ordem dia/mês, nem o prefixo de
  telefone. O §14 proíbe, e a correção certa do §5.3 é estrutural (decisão por coluna, com
  confirmação). O B2 mede o que *aconteceria*; ele não muda o que acontece.

---

## O limite honesto desta medição

O laço de validação por linha em `medir-ingestao.mjs` é um **espelho** de
`src/app/api/upload-csv/route.ts`, não a rota em si — a rota importa `next/server` e o Supabase e
não roda offline.

As funções de domínio (`normalizarValor`, `normalizarData`, `limparTelefone`,
`dataEmFaixaRazoavel`, `validarLinhaRecebida`, `normalizarHeader`, `COLUMN_ALIASES`) são
**importadas de verdade**, não reimplementadas. O que é espelhado é a **ordem dos portões** e as
duas checagens que vivem na própria rota (nome em branco; telefone com menos de 8 dígitos crus).
Se a rota mudar, este espelho envelhece calado. É a única divergência possível entre o que isto
mede e o que o produto faz, e está marcada com comentário no código.

O B1 daqui reproduz a escolha de `detectarMapeamentoColunas` literalmente (mesma ordem de alias,
mesmo `findIndex`); o que ele acrescenta é só o **registro dos candidatos descartados**, que a
função de produção não devolve.

Duas diferenças menores, deliberadas e anotadas no código: o mapeamento usa
`Object.keys(rows[0])` como a produção, mas a análise de estrutura usa `meta.fields`, que preserva
colunas vazias e repetidas que o primeiro perde; e o perfil de conteúdo (formatos, telefone) usa a
coluna do B2 quando o B1 não a reconhece, porque um arquivo recusado no portão continua tendo
formatos a medir. A simulação de aceitação/rejeição usa **só** o B1.

---

## Estado da medição

⬜ **Não executada contra arquivos reais.** O instrumento está pronto e cada detector foi validado
contra fixture construída para dispará-lo. Faltam os insumos: o §11.1 pede **10–20 layouts reais**
de export de contas a receber (Omie, Bling, Conta Azul, Tiny, Granatum, modelos do Sebrae,
planilhas de conhecidos).

Rodar contra `teste.csv`/`teste_varejo.csv` do repositório **não** cumpre a Fase 0: são arquivos
sintéticos, escritos para o próprio Atlas, e o resultado mediria a fixture, não o mundo.

O resultado, quando existir, vai para `CLAUDE.md` §Descobertas empíricas — é onde o repositório
guarda medição que muda decisão.
