# Atlas — Planejamento de Evolução (pós-v0)

> **Escopo deste documento**: o planejamento da evolução do Atlas para além do v0 — direção de
> produto, arquitetura pretendida, papel da IA, fases e decisões pendentes.
>
> **O que ele NÃO é**: não é descrição do sistema atual. Para isso existe
> [ARCHITECTURE.md](ARCHITECTURE.md), que descreve deliberadamente só a arquitetura **real e
> implementada** e recusa arquitetura-alvo. Para o que o produto faz hoje, ver
> [README.md](README.md). Para como atuar no projeto, ver [CLAUDE.md](CLAUDE.md).
>
> **Nada aqui é contrato de implementação.** Uma decisão registrada aqui autoriza a _próxima etapa
> de planejamento_, não a escrita de código. O que está autorizado a acontecer em seguida está na
> §14, e só ali.

---

## 0. Estado do planejamento

| Item                                                  | Estado                                | Data       |
| ----------------------------------------------------- | ------------------------------------- | ---------- |
| **Etapa 1 — análise e direção**                       | ✅ **CONCLUÍDA**                      | 2026-08-12 |
| **Fase 0 — medição**                                  | ⬜ autorizada, não iniciada           | —          |
| **Etapa 2 — planejamento de implementação da Fase 1** | ⬜ **não iniciada, não autorizada**   | —          |
| **Fase 1 — implementação**                            | ⬜ não planejada                      | —          |
| Fases 2 e 3                                           | ⬜ direção esboçada, sem planejamento | —          |

**Próxima ação autorizada: exclusivamente a Fase 0 (§11.1).** Nenhuma alteração de código de
produção, schema ou UI está autorizada por este documento. O plano de implementação da Fase 1
**não deve ser escrito** antes de a Fase 0 produzir resultado e das decisões da §12 serem
respondidas.

---

## 1. Como ler este documento

Este projeto já tem uma regra sobre não misturar tipos de afirmação
([CLAUDE.md](CLAUDE.md) §Manutenção da documentação). Aqui ela é aplicada com marcador explícito
em cada afirmação relevante:

| Marcador           | Significa                                                                                               | Como foi obtido                        |
| ------------------ | ------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| **[FATO]**         | Verificado no código, no schema ou por execução nesta etapa                                             | A verificação está dita junto          |
| **[FATO-HERDADO]** | Medido em ciclo anterior e registrado na documentação do repositório; **não** re-verificado nesta etapa | Fonte citada                           |
| **[DECISÃO]**      | Escolhido entre alternativas e **em vigor** a partir desta etapa                                        | O porquê está dito junto               |
| **[HIPÓTESE]**     | Achamos, **não medimos**                                                                                | Vem com "como testar"                  |
| **[ABERTO]**       | Decisão pendente do usuário — bloqueia ou altera etapa futura                                           | Consequência de cada caminho está dita |
| **[INVARIANTE]**   | Contrato que não pode cair sem o sistema passar a mentir                                                | Mecanismo que o garante está dito      |

Regra de precedência, herdada do [CLAUDE.md](CLAUDE.md): **código, schema e comportamento medido
vencem este documento.** Divergiu? Este documento está errado até prova em contrário.

---

## 2. A pergunta da Etapa 1

O v0 está completo e em estado saudável: importa CSV de contas a receber, prioriza por urgência,
gera mensagem, registra resultado e apura receita recuperada. Os últimos ciclos foram inteiramente
sobre confiabilidade e integridade financeira.

A direção considerada pelo usuário: **deixar de ser preso a um formato de CSV de cobrança e virar
uma plataforma capaz de receber arquivos financeiros diversos, entender semanticamente o que há
neles e decidir como o produto pode usá-los** — possivelmente com IA nessa interpretação.

A Etapa 1 avaliou essa direção criticamente contra o estado real do código.

### 2.1 Contexto de produto confirmado pelo usuário — [FATO]

Obtido por pergunta direta em 2026-08-12. Não é derivável do repositório e muda o peso de todas
as decisões:

| Pergunta                            | Resposta                                                                   |
| ----------------------------------- | -------------------------------------------------------------------------- |
| O Atlas está em uso real?           | **Não.** Nenhuma empresa usando, nenhum arquivo real de cliente disponível |
| Qual o próximo domínio pretendido?  | **Receitas/despesas e categorias** (movimentação financeira)               |
| A IA é requisito de posicionamento? | **Não — é meio.** Descartável se o caminho determinístico vencer           |

**Consequência da primeira resposta**: nenhum requisito novo é medido. Toda arquitetura desenhada
agora é desenhada contra requisito imaginado. Isso não impede decidir — obriga a preferir decisões
que sejam corretas nos dois futuros possíveis, e a medir barato antes de construir caro.

---

## 3. Onde o Atlas está hoje — [FATO]

Tudo nesta seção foi lido no código durante a Etapa 1.

**Forma**: monólito Next.js 16 (App Router), React 19, Tailwind v4, TypeScript strict. Sem backend
separado, fila, worker ou cache. Supabase (Postgres) acessado por `service_role` só no servidor;
RLS habilitado sem políticas. Autenticação por credencial única (e-mail + senha) em variáveis de ambiente + cookie
httpOnly.

**Modelo de dados**: três tabelas — `clientes` (`telefone` unique), `titulos`, `interacoes`
(`supabase/schema.sql`). Uma regra de negócio vive como índice parcial:
`idx_titulos_aberto_unico` sobre `(cliente_id, valor, data_vencimento) where status = 'aberto'`.

**Domínio**: `src/lib/prioridade.ts` é fonte única de urgência, score, agrupamento e ciclo de vida.
Só `pago` é terminal; `promessa` e `sem_resposta` são pausas avaliadas na leitura
(`estaNaFilaHoje`), sem cron nem worker.

**Ingestão**: `src/lib/csv-import.ts` — quatro campos canônicos fixos (`nome`, `telefone`, `valor`,
`data_vencimento`), reconhecidos por lista de aliases; normalização de valor/data/telefone;
`validarLinhaRecebida` como portão único; `planejarImportacao` decidindo duplicata em memória.
Puro, sem I/O, coberto por teste.

**Fluxo de importação**: dois passos com o browser no meio. `/api/upload-csv` faz prévia (nada é
gravado) e devolve `linhasValidas`; o browser guarda em `useState` e reenvia para
`/api/upload-csv/confirmar`, que revalida cada linha antes de gravar em lote.

**Política de I/O**: `src/lib/supabase-io.ts` — prazo (8s leitura / 15s escrita), classificação
infraestrutura × banco por SQLSTATE, paginação por cursor. Não é repositório: não conhece tabela
nem coluna.

**Gravação sob conflito**: `src/lib/importacao.ts` — máquina de estados com I/O injetado
(`Portas`), traduz SQLSTATE 23505 como duplicata e concilia contra o banco antes de reportar perda.

**Testes**: 202 casos, todos em `src/lib/` (eram ~143 quando esta seção foi escrita, em
2026-08-12). Rotas, Server Actions e componentes seguem sem cobertura; a verificação deles é
manual.

---

## 4. Invariantes e ativos a preservar

Isto é o ativo real do repositório. Qualquer evolução se encaixa **em volta** disto, nunca por cima.

### 4.1 Invariantes financeiros — [INVARIANTE]

Já em vigor, garantidos por mecanismo e não por disciplina. Continuam valendo integralmente em
qualquer arquitetura futura:

| Invariante                                                                  | Garantido por                                                |
| --------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Falha de infraestrutura nunca vira R$ 0,00, lista vazia ou sucesso aparente | `ler`/`lerPaginado` lançam; rotas devolvem 503; nunca `?? 0` |
| Falha de infraestrutura nunca é apresentada como erro do dado do usuário    | `ehFalhaDeInfraestrutura` + `resultado: 'indisponivel'`      |
| Número de dinheiro nunca é inventado (`null` → "—", jamais zero)            | `totalRecuperado` devolve `null`; a UI mostra traço          |
| Leitura de lista é completa ou é erro — nunca truncada em silêncio          | `lerPaginado` por cursor, `T extends { id: string }`         |
| No máximo um título `aberto` por (cliente, valor, vencimento)               | `idx_titulos_aberto_unico` no Postgres                       |
| Reimportar o mesmo arquivo não duplica cobrança                             | Índice único + tratamento de 23505 como duplicata            |
| Prévia nunca aprova linha que a gravação vá recusar                         | `validarLinhaRecebida` chamada nas duas pontas               |
| Nenhuma requisição fica pendurada indefinidamente                           | Prazos de 8s/15s em `supabase-io.ts`                         |
| `service_role` nunca chega ao navegador                                     | Só `lib/supabase.ts` a lê; nenhum Client Component a importa |

### 4.2 Padrões estruturais a preservar — [DECISÃO]

1. **Domínio puro e separado de I/O** (`prioridade`, `csv-import`, `templates`, `format`).
2. **I/O injetado para lógica só observável com banco real** (`importacao.ts` recebe `Portas`).
   Esse padrão nasceu de dois defeitos que nenhum teste pegou enquanto a lógica morava na rota —
   não é purismo.
3. **A garantia de duplicidade é do banco**, não da aplicação. A checagem em memória serve para
   relatar e evitar ida desnecessária.
4. **O princípio dos dois passos com revisão humana antes de gravar.** O _mecanismo_ atual
   (round-trip pelo browser) deve mudar (§5.4); o _princípio_ — nada entra no banco sem alguém
   confirmar o que entendemos do arquivo — deve ser **reforçado**, porque é exatamente ele que
   torna interpretação probabilística aceitável.
5. **As descobertas empíricas registradas** em [CLAUDE.md](CLAUDE.md). Custaram medição.
6. **A tese do produto**: ação diária + medida do dinheiro que voltou. É o que separa o Atlas de um
   relatório (§6.4).

---

## 5. Limitações do v0 que bloqueiam a evolução

### 5.1 A porta fecha, e fecha sem saída — [FATO]

Verificado em `src/app/api/upload-csv/route.ts` (linhas 81–94): se qualquer um dos quatro campos
canônicos não for reconhecido, a rota devolve **HTTP 400** com a lista de aliases aceitos.
**Não existe caminho manual de mapeamento em nenhum lugar do produto** — verificado por varredura:
nenhuma rota, tela ou parâmetro permite ao usuário dizer qual coluna é qual.

A lista de aliases é um palpite fixo (~18 nomes por campo) que não converge por construção: sempre
haverá `Vlr. Doc.`, `Nome do Sacado (Razão Social)`, `Data Vcto.`.

### 5.2 O esquema canônico é fixo, e um dos campos é da _ação_, não do dado — [FATO]

`validarLinhaRecebida` exige telefone de 10–15 dígitos. Uma planilha de contas a receber válida
**sem coluna de telefone é integralmente rejeitada** — porque o campo existe para o WhatsApp, não
para a contabilidade. Não há noção de _tipo de conjunto de dados_: há um formato, e ele é o produto.

### 5.3 Adivinhação de formato numérico por célula — defeito financeiro presente — [FATO]

`normalizarValor` (`src/lib/csv-import.ts`) decide a convenção de milhar/decimal olhando **cada
célula isoladamente**. Verificado nesta etapa executando a função com Node:

**Estado em 2026-09-19, depois da correção descrita abaixo** — [FATO], verificado executando a
função e coberto por teste:

| Entrada       | Antes     | Agora       |                                                             |
| ------------- | --------- | ----------- | ----------------------------------------------------------- |
| `"1,500"`     | `1500`    | `1500`      | ✅ inalterado (vírgula com 3+ dígitos = milhar)             |
| `"1.234.567"` | `1.234`   | `1234567`   | ✅ **corrigido** — dois pontos só podem ser milhar          |
| `"1.500"`     | `1.5`     | **recusa**  | ✅ **não grava mais valor errado** — ver abaixo             |
| `"R$ 1.500"`  | `1.5`     | **recusa**  | ✅ idem                                                     |
| `"2.850"`     | `2.85`    | **recusa**  | ✅ idem                                                     |
| `"1.500.00"`  | `150000`  | **recusa**  | ✅ não é milhar nem decimal em convenção nenhuma            |
| `"1500.00"`   | `1500`    | `1500`      | ✅ inalterado (um ponto, 2 dígitos = decimal)               |

> **Correção aplicada em 2026-09-19** — [DECISÃO]. Duas mudanças, de naturezas diferentes:
>
> 1. **O inequívoco foi corrigido.** Dois ou mais pontos não têm leitura alternativa (não existe
>    número com duas partes decimais), então tratá-los como milhar não é escolher — é a única
>    leitura possível. `parseFloat('1.234.567')` parava no segundo ponto e devolvia `1.234`.
> 2. **O ambíguo passou a ser recusado, não adivinhado.** `"1.500"` é mil e quinhentos em BR e um e
>    meio em US; a célula sozinha não decide. O sistema agora **rejeita a linha com um motivo que
>    diz como resolver** (`motivoValorRecusado`), em vez de gravar R$ 1,50 em silêncio.
>
> **Por que recusar e não escolher a leitura BR**: assumir milhar consertaria o arquivo brasileiro
> e passaria a cobrar **1000x a mais** de quem exporta em US — trocaria um erro silencioso por
> outro, na direção pior. Recusar honra o invariante do [CLAUDE.md](CLAUDE.md) ("números de
> dinheiro nunca são inventados") e a barreira #5 do §9 deste documento ("célula que não parseia
> vira linha rejeitada com motivo, nunca valor adivinhado"), que estava declarada em vigor mas não
> era cumprida justamente aqui.
>
> **Isto não antecipa nem bloqueia a Fase 1.** Nenhuma convenção foi escolhida por célula — ao
> contrário, o código passou a decidir *menos*. Quando o formato for decidido por coluna (§11.2),
> estas linhas voltam a ser aceitas, com o valor certo, e `normalizarValor` deixa de ser o último
> a opinar.
>
> **Custo aceito, não medido**: arquivos que hoje importam (com valor errado) passam a ter linhas
> recusadas. Quantos arquivos reais caem nesse caso segue sendo [HIPÓTESE] — é o que a Fase 0
> responde.

**Como re-verificar**: extrair `normalizarValor` para um script e rodar contra a tabela acima, ou
ler `src/lib/csv-import.test.ts` (blocos `normalizarValor` e `motivoValorRecusado`).

**Por que isto importa além do bug**: `"1.500"` é genuinamente ambíguo _em uma célula_ e trivial
_na coluna inteira_ (se qualquer valor da coluna tem vírgula decimal, ou se todos os grupos após
ponto têm exatamente três dígitos, é milhar). A correção correta e a arquitetura proposta são a
mesma coisa: **decidir o formato uma vez por coluna, com confirmação, em vez de adivinhar linha a
linha.**

**Frequência real em arquivos de ERP: [HIPÓTESE].** O defeito é fato; quantos arquivos reais o
disparam não foi medido. A Fase 0 responde.

### 5.4 Não existe registro de importação — e sem ele não existe desfazer — [FATO]

`titulos` não tem coluna de origem, lote ou versão de mapeamento (verificado em
`supabase/schema.sql`). Consequências:

- **Não há como desfazer uma importação.** O único "desfazer" do produto é
  `DELETE /api/dados?modo=tudo`.
- Não há como responder "de onde veio este número".
- As linhas validadas trafegam pelo browser (`src/app/upload/page.tsx` → `useState` → POST), então
  o payload cresce com o arquivo (teto de 20.000 linhas) e a fronteira de confiança precisa ser
  redefendida linha a linha a cada confirmação.

**Este é o bloqueio estrutural mais importante para a direção pretendida.** No momento em que o
mapeamento deixa de ser fixo — por escolha humana **ou** por sugestão de modelo — reverter uma
interpretação deixa de ser conveniência e vira pré-requisito.

### 5.5 Identidade de cliente é o telefone — [FATO]

`onConflict: 'telefone'` em `src/app/api/upload-csv/confirmar/route.ts`. Dois clientes reais com o
mesmo número se fundem em silêncio. Para um segundo domínio (fornecedor, categoria, conta) o
telefone frequentemente nem existe.

### 5.6 BRL / pt-BR / +55 estão embutidos por construção — [FATO]

`formatarMoeda` fixa `pt-BR`/`BRL`; `limparTelefone` prefixa `55` incondicionalmente;
`normalizarValor`/`normalizarData` assumem convenções BR/US; `titulos.valor` é `numeric` sem moeda.
Multi-moeda não é uma coluna — é revisão de todo parse e toda exibição.

### 5.7 Mono-empresa por construção — [FATO]

Uma credencial compartilhada — desde 2026-09-19 com **e-mail + senha**, o que **não muda nada
deste parágrafo**: continua sendo uma credencial da empresa, não contas. Sem usuários
individuais, sem `empresa_id`, sem trilha de auditoria, RLS
sem políticas + `service_role`. Multi-tenancy é reescrita do modelo de segurança, não incremento.

### 5.8 Custos que crescem com a ambição

- **[FATO]** Sem camada de repositório: nomes de tabela/coluna como strings em 7 arquivos. Decisão
  consciente e adequada a três tabelas; passa a doer conforme o schema cresce.
- **[FATO]** Zero cobertura em rotas, Server Actions e componentes. Um passo de mapeamento
  multiplica os estados a verificar manualmente.
- **[FATO-HERDADO]** A lista do dia renderiza tudo de uma vez: ~6,6s para 915 cards, custo de
  render e não de banco (medido em ciclo anterior, registrado em [ARCHITECTURE.md](ARCHITECTURE.md)
  §10; **não re-verificado nesta etapa**).

---

## 6. Avaliação crítica da direção proposta

### 6.1 A proposta junta dois problemas diferentes; só um é gargalo — [DECISÃO]

- **Problema A — "meu arquivo não entra"**: é mapeamento/parsing. Existe hoje, bloqueia, e se
  resolve **sem IA** (§5.1, §5.3).
- **Problema B — "o Atlas deveria entender receitas, despesas, categorias, saldos"**: não é
  problema de ingestão. É **produto novo**. A ingestão só entrega linhas; o valor está no que se faz
  com elas depois.

A formulação "o Atlas analisa um arquivo desconhecido e decide como o produto pode usá-lo" só tem
sentido se o produto tiver mais de uma coisa a fazer com dado. Hoje tem exatamente uma. Uma camada
universal de entendimento construída agora teria **um único destino**, e seria projetada contra
requisito imaginado e não validado.

### 6.2 IA que interpreta e decide põe não-determinismo no caminho de escrita financeira — [DECISÃO]

Todo o histórico recente do repositório é uma guerra contra número financeiro silenciosamente
errado. Um modelo que mapeia `SALDO` → `valor` quando a coluna significa "saldo devedor após
pagamento parcial" produz cobrança errada com confiança total e nenhum erro. É **pior** que a
truncagem de 1000 linhas: aquela era sistemática e detectável por contagem.

**Restrição decorrente, em vigor: IA pode propor, nunca decidir — e nunca toca em valor.**

### 6.3 O caso repetido não precisa de IA — [HIPÓTESE]

Raciocínio: uma PME importa o mesmo export do mesmo ERP toda semana. Se o mapeamento confirmado uma
vez for memorizado por assinatura de cabeçalho, o custo vai a zero a partir da segunda importação,
deterministicamente. A IA só ajudaria no **primeiro encontro com cada formato** — cerca de uma vez
por empresa por arquivo.

**Por que é hipótese e não fato**: a premissa ("o mesmo arquivo se repete") é plausível e não
medida, porque não há usuários. **Como testar**: perguntar a três empresas com que frequência e de
qual sistema exportam; ou observar na primeira adoção real.

### 6.4 Ressalva estratégica sobre o segundo domínio escolhido — [HIPÓTESE]

Receitas/despesas/categorias/DRE é um produto de **relatório**. A tese atual do Atlas é **ação +
dinheiro recuperado**. Relatório financeiro para PME é categoria disputada (todo ERP faz, o Excel
faz, o contador entrega), e compete com o contador do próprio cliente.

**Isto é julgamento de mercado, não medição** — está marcado como hipótese de propósito.
**Não é motivo para não fazer**: o substrato de movimentação/categoria é legítimo e a escolha do
domínio é do usuário. É motivo para **enquadrar diferente na entrega**: com os mesmos dados,
responder _"o que entra e o que sai nos próximos 30 dias, e o que fazer"_ em vez de _"qual foi o
resultado do mês passado"_. Mesma ingestão, mesma categorização, mas continua sendo produto de ação.

Registrado como recomendação a validar (§12.3), não como decisão tomada.

### 6.5 "Tudo é lançamento" destruiria o domínio atual — [DECISÃO]

`titulos` não é lançamento genérico: é **compromisso com ciclo de vida** (promessa, silêncio,
reentrada). Uma movimentação realizada é um **fato**, sem ciclo. Fundir os dois numa tabela única
quebra `estaNaFilaHoje` e o índice único. O modelo correto tem dois conceitos:

| Conceito        | O que é                                                              | Hoje                                                            |
| --------------- | -------------------------------------------------------------------- | --------------------------------------------------------------- |
| **Compromisso** | Vencimento, contraparte, status, ciclo. Direção: a receber / a pagar | `titulos` (direção "a receber" implícita)                       |
| **Movimento**   | Data, valor, direção, categoria, conta. Já aconteceu                 | Não existe — mas `titulos.resolvido_em` já é um proto-movimento |

Continuidade: `resolvido_em` já é evento de pagamento datado, e "Recuperado (30 dias)" já é métrica
proto-caixa. O segundo domínio **estende**, não substitui.

---

## 7. Arquitetura proposta — [DECISÃO]

Princípio único: **interpretação produz metadado; domínio produz efeito.** A camada do meio nunca
escreve em tabela de domínio.

```
┌─ INGESTÃO (transporte) ───────────────────────────────────────────┐
│  arquivo → { colunas[], linhas[], meta }                          │
│  Não sabe nada de finanças. CSV hoje; XLSX/OFX depois.            │
└───────────────────────────────────────────────────────────────────┘
                              ↓ linhas cruas
┌─ INTERPRETAÇÃO (entendimento) ────────────────────────────────────┐
│  perfilar()  → forma de cada coluna (%data, %moeda, convenção,    │
│                cardinalidade, vazios) — determinístico, puro      │
│  sugerir()   → PROPOSTA de mapeamento (+ confiança + evidência)   │
│                ├─ heurística (aliases + perfil)                   │
│                ├─ memória de formato (assinatura de cabeçalho)    │
│                └─ IA                              ← opcional      │
│  verificar() → a proposta bate com o perfil? senão, descarta      │
│  SAÍDA: METADADO. Nunca valor. Nunca escrita em tabela de domínio.│
└───────────────────────────────────────────────────────────────────┘
                              ↓ proposta + amostra real
                     ══ CONFIRMAÇÃO HUMANA ══
                              ↓ mapeamento confirmado + lote persistido
┌─ DOMÍNIO (cobrança hoje; movimentação depois) ────────────────────┐
│  validarLinhaRecebida / planejarImportacao / gravarLoteDeTitulos  │
│  Inalterados. Continuam sendo o último portão antes do banco.     │
└───────────────────────────────────────────────────────────────────┘
```

**A costura que torna erro de interpretação sobrevivível**: a interpretação escreve num _lote_
(staging), não em `titulos`. O domínio lê um lote confirmado e aplica as próprias regras. Todo
título nasce com referência ao lote, então toda interpretação é reversível.

**[DECISÃO] Não reorganizar arquivos agora.** [CLAUDE.md](CLAUDE.md) §2 manda preferir mudanças
localizadas. O diagrama acima descreve o alvo; `csv-import.ts` **não se move**. O perfilador e o
mapeamento são código novo e nascem já na fronteira certa. O resto se move quando um segundo
domínio existir e pagar pela mudança.

---

## 8. Papel da IA — [DECISÃO]

**Regra única, em vigor: a IA rotula texto livre em categorias revisáveis. Nunca produz,
transforma ou decide valor, data ou identidade.**

### 8.1 Onde a IA ganha, em ordem de valor

**(a) Classificação de categoria de lançamento** (`"POSTO SHELL 234"` → Combustível), quando o
segundo domínio existir. É o **melhor primeiro uso de IA neste produto**: difícil
deterministicamente, alto volume e **raio de dano baixo** — categoria errada é visível, corrigível
e não altera nenhum valor. É exatamente o domínio escolhido pelo usuário.

**(b) Sugestão de mapeamento no primeiro encontro com um formato** — opcional, e **só se** a Fase 0
mostrar que heurística + memória de formato não bastam. Contrato obrigatório se acontecer:

- entrada: cabeçalhos + **perfil estatístico** das colunas (+ amostras mascaradas, se necessário);
- saída: proposta estruturada com confiança e justificativa — **nunca valores**;
- **a proposta é verificada pelo perfilador determinístico antes de ser exibida**. Se o modelo diz
  que `VENCTO` é data e só 40% da coluna parseia como data, a sugestão é descartada, não mostrada;
- confirmação humana sempre. **Sem auto-confirmação por confiança alta em escrita financeira**;
- versão do modelo e do prompt gravadas no lote de importação.

### 8.2 Onde a IA não entra — [INVARIANTE]

Parse de valor ou data; decisão de duplicata; cálculo de prioridade; geração de qualquer número
exibido ao usuário.

### 8.3 Privacidade (LGPD) — [FATO] + [ABERTO]

**[FATO]**: as planilhas contêm nome, telefone e CPF/CNPJ — `teste_varejo.csv`, no próprio
repositório, tem CPF e CNPJ literais. Enviar linhas de amostra a um provedor externo é tratamento
de dado pessoal por terceiro.

**Mitigação natural**: um bom perfilador permite que a chamada leve **cabeçalhos + descritores de
forma** (`"valores no formato ###.###.###-##"`) em vez de valores reais. É mais um motivo para o
perfilador vir antes da IA. A postura definitiva é decisão aberta (§12.6).

---

## 9. Barreiras contra contaminação de dado financeiro — [DECISÃO]

Sete mecanismos em camadas. Cada um pega o que o anterior deixou passar. Valem para sugestão
heurística e de modelo indistintamente.

| #   | Mecanismo                                                                                          | Impede                                       |
| --- | -------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| 1   | Interpretação produz **metadado**; quem converte célula em número é sempre o parser determinístico | Modelo inventar valor                        |
| 2   | Toda proposta é **verificada contra o perfil real do arquivo** antes de ser exibida                | Sugestão plausível e falsa chegar ao usuário |
| 3   | **Confirmação humana explícita**, com amostra real ao lado de cada escolha                         | Mapeamento errado entrar sem ninguém ver     |
| 4   | Formato numérico e de data decidido **por coluna, uma vez** — nunca por célula                     | A classe de defeito do §5.3                  |
| 5   | Célula que não parseia vira **linha rejeitada com motivo**, nunca valor adivinhado                 | Coerção silenciosa (já é a regra hoje)       |
| 6   | **Proveniência por linha**: lote de importação + versão do mapeamento em cada título               | Impossibilidade de auditar e de desfazer     |
| 7   | **Desfazer por lote**, preservando o que a operação já tocou                                       | Interpretação errada virar dano permanente   |

**Sobre o #7, uma regra de domínio que decorre dos invariantes do §4.1** — [INVARIANTE proposto]:
desfazer uma importação **não pode apagar um título que alguém já marcou como pago**, porque isso
destruiria dado financeiro real para corrigir um erro de importação. Desfazer remove só o que
continua no estado em que foi importado, e o relatório diz explicitamente o que preservou e por quê.

---

## 10. Extensibilidade — [DECISÃO]

Regra: **moeda e idioma são dados; tenancy é arquitetura.** Os dois primeiros se acomodam
incrementalmente; o terceiro não — e meia-implementação dele é pior que nenhuma, porque cria a
aparência de isolamento sem o isolamento.

| Eixo                           | Como estende                                                                                                        | Custo                                       | Quando                     |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | -------------------------- |
| **Formatos de arquivo**        | Camada de ingestão com um parser por formato, contrato único de saída                                               | Baixo (XLSX ≈ uma dependência)              | Sob demanda                |
| **Layouts de planilha**        | Perfilador + mapeamento confirmável + memória por assinatura de cabeçalho                                           | Baixo                                       | Fase 1                     |
| **Tipos de conjunto de dados** | Descritor por tipo (campos canônicos + validadores + domínio destino). **Registro só quando houver dois**           | Médio                                       | Fase 3                     |
| **Idioma do arquivo**          | Quase de graça: o perfilador olha _forma_, não nome. Aliases viram lista por idioma                                 | Baixo                                       | Junto da Fase 1            |
| **Moeda**                      | `moeda` como dado no registro + `formatarMoeda(valor, moeda)`. A convenção numérica já vem do mapeamento por coluna | Médio (toda exibição)                       | Sob demanda real           |
| **Multi-empresa**              | Projeto próprio: `empresa_id` em tudo, autenticação real, RLS ou filtro obrigatório, auditoria                      | **Alto — reescrita do modelo de segurança** | Decisão de negócio (§12.5) |

---

## 11. Fases

### 11.1 Fase 0 — Medir antes de arquitetar ✅ **AUTORIZADA — única próxima ação**

Não há usuários, então a taxa de rejeição de arquivos é **[HIPÓTESE]**. Ela vira fato barato:

1. Reunir **10–20 layouts reais** de export de contas a receber (Omie, Bling, Conta Azul, Tiny,
   Granatum, modelos do Sebrae, planilhas de conhecidos).
2. Rodar `detectarMapeamentoColunas` + os normalizadores contra eles, **offline**, usando as
   funções puras que já existem.
3. Registrar: % de arquivos que mapeiam sozinhos; qual campo falha mais; quais formatos de valor e
   data aparecem de verdade; se o caso `"1.500"` (§5.3) ocorre.

**Restrições**: script isolado, nenhuma mudança em código de produção, schema ou UI. Nada é gravado
no banco.

**Saída**: descoberta empírica registrada em [CLAUDE.md](CLAUDE.md) §Descobertas empíricas — o
repositório já tem o lugar e o formato para isso.

**O que a Fase 0 decide sozinha**: se a IA de mapeamento (§8.1b) tem razão de existir, e se a tela
de mapeamento é o centro da Fase 1 ou apenas um fallback.

### 11.2 Fase 1 — "A porta nunca fecha" + proveniência ⬜ _não planejada_

> **Esboço de escopo, não plano de implementação.** O plano da Fase 1 é a Etapa 2 e **não deve ser
> escrito antes da Fase 0 e das respostas da §12.**

Um ciclo, inteiramente dentro do domínio de cobrança que já existe:

1. **Perfilador de colunas** — módulo puro e testável.
2. **Formato decidido por coluna, não por célula** — corrige o §5.3 pela raiz.
3. **Tela de mapeamento** — o 400 deixa de existir como desfecho de arquivo válido.
4. **Memória de formato** — assinatura de cabeçalho → mapeamento confirmado.
5. **Lote de importação persistido** — confirmação por id do lote, não pelo reenvio das linhas.
6. **Desfazer importação**, com a regra de preservação do §9/#7.

**Fora deste recorte, de propósito**: IA, segundo domínio, multi-tenant, multi-moeda, XLSX,
paginação de UI.

**Por que este recorte** — [DECISÃO]: é o único conjunto **certamente necessário nos dois futuros
possíveis** (Atlas só-cobrança ou Atlas plataforma); corrige um defeito financeiro presente e
demonstrável (§5.3); e cria a proveniência sem a qual nenhuma interpretação probabilística — humana
ou de modelo — é aceitável. Nada aqui vira desperdício se a direção mudar.

### 11.3 Fase 2 — Segundo domínio ⬜ _direção esboçada_

Modelar **Movimento** ao lado de **Compromisso** (§6.5), sem tocar em `titulos`. Entregar primeiro
na moldura de ação (§6.4, pendente de §12.3). A IA entra aqui, e só aqui, para **classificar
categoria**.

### 11.4 Fase 3 — Plataforma ⬜ _direção esboçada_

Registro de tipos de conjunto de dados, generalização da contraparte (telefone deixa de ser
identidade), eventual repositório. **Generalizar o que dois domínios provaram compartilhar**, não o
que um domínio e a imaginação sugerem.

---

## 12. Decisões ainda abertas — [ABERTO]

Cada uma altera ou bloqueia uma fase. Nenhuma foi tomada nesta etapa.

1. **A porta realmente fecha na prática?** A Fase 0 responde. Se a maioria dos layouts reais mapear
   sozinha, a Fase 1 encolhe (perfil + proveniência + desfazer) e a IA de mapeamento sai de cena.
2. **Categorias do usuário verbatim, ou taxonomia canônica do Atlas?** Verbatim = sempre correto,
   sem comparabilidade. Taxonomia = insight e benchmark, mas todo mapeamento é interpretação que
   pode errar. **É a decisão mais importante da Fase 2.**
3. **Ação ou relatório** como moldura do segundo domínio (§6.4). Recomendação: ação. Decisão do
   usuário.
4. **Telefone como identidade de cliente** continua aceitável? Bloqueia contraparte genérica e
   funde clientes distintos hoje (§5.5).
5. **Mono-empresa continua sendo a aposta?** Se uma segunda empresa já é esperada, isso muda a
   ordem de tudo e precisa entrar antes, não depois.
6. **Postura sobre enviar dado a provedor de modelo** (§8.3): mascarar, só descritores de forma, ou
   não enviar. Só bloqueia se a §8.1b acontecer.
7. **Guardar o arquivo original** (Supabase Storage) permite reinterpretar sem novo upload, mas é
   PII em repouso e dependência nova. Sugestão para a Fase 1: guardar as **linhas encenadas** em
   Postgres — suficiente, sem dependência nova.

---

## 13. Recomendação final da Etapa 1 — [DECISÃO]

**Não construir a camada de entendimento universal agora. Construir a porta e a proveniência.**

Três razões, todas ancoradas no estado real do repositório:

1. **Sem usuários, uma camada semântica genérica é projetada contra requisito imaginado.** Com um
   único domínio consumidor, teria um destino só — abstração prematura, contra a regra 7 do próprio
   [CLAUDE.md](CLAUDE.md). Duas implementações reais são o mínimo para projetar uma boa abstração.
2. **O gargalo demonstrável não é semântico, é operacional**: a porta fecha com 400 sem saída
   (§5.1), o valor BR com milhar é lido dividido por 1000 (§5.3), e não há como desfazer nada
   (§5.4). Nenhum dos três precisa de IA.
3. **O caso repetido — o caso de uso real de uma PME — se resolve deterministicamente** (§6.3), e a
   IA é meio e não requisito por decisão do usuário (§2.1).

**Sobre a IA**, a recomendação é específica e não um adiamento: o lugar certo dela é **dentro do
domínio que o usuário escolheu** — classificar categoria de lançamento, onde o rótulo é revisável e
nenhum número passa pelo modelo. Mapeamento de esquema é o uso _pior_: raio de dano máximo (erra o
valor da cobrança), frequência mínima (uma vez por formato) e com alternativa determinística que já
resolve.

Caminho: **medir (Fase 0) → abrir a porta com proveniência (Fase 1) → segundo domínio com IA
classificando categoria (Fase 2) → plataforma só quando dois domínios existirem (Fase 3).** Cada
fase é útil sozinha, nenhuma vira desperdício se a seguinte mudar de rumo, e a Fase 1 corrige um
erro de dinheiro que existe no código hoje.

---

## 14. Registro de conclusão e autorização

**A Etapa 1 está CONCLUÍDA em 2026-08-12.** Ela produziu direção, não código: nenhum arquivo de
`src/`, `supabase/` ou de configuração foi alterado durante ela.

### Autorizado a partir daqui

✅ **Exclusivamente a Fase 0 (§11.1)** — medição offline com as funções puras existentes, sem
alterar código de produção, schema ou UI.

### Explicitamente NÃO autorizado por este documento

❌ Escrever o plano de implementação da Fase 1 (isso é a Etapa 2, e depende da Fase 0 + §12).
❌ Qualquer alteração em `src/`, `supabase/` ou na UI.
❌ Corrigir o defeito do §5.3 fora do planejamento da Fase 1 — a correção correta é estrutural
(decisão por coluna), e um remendo por célula agora fecharia a porta para ela.
❌ Introduzir dependência de IA ou chamada a provedor de modelo.

### Exceções abertas pelo usuário depois desta etapa

Este documento restringe **planejamento**, não emergência nem defeito presente. As exceções abaixo
foram pedidas explicitamente pelo usuário e ficam registradas para que a restrição geral continue
valendo para tudo o mais:

| Data       | O que                                                                 | Por quê                                                                                                                      |
| ---------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-18 | Cookie de sessão assinado (`src/lib/sessao.ts`, `proxy.ts`, `api/login`) | O cookie era o literal `'1'` e autenticava qualquer requisição. Defeito de segurança presente, sem relação com a Fase 1       |
| 2026-09-19 | Parsing determinístico (`src/lib/csv-import.ts`): telefone, data, valor com 2+ pontos | Três defeitos onde **só existe uma leitura possível**. Nenhum decide entre alternativas, então nenhum fecha porta da Fase 1 |
| 2026-09-19 | Valor ambíguo (`"1.500"`) passa a ser **recusado com motivo**, não adivinhado | Decisão do usuário. Não escolhe convenção — faz o código decidir *menos*. Ver §5.3 |
| 2026-09-19 | Identidade visual própria (`globals.css`, `components/ui/`, `Marca.tsx`) | Trabalho desbloqueado sem usuários, e a tela faz parte da conversa que vai buscar os arquivos da Fase 0. O fluxo de `/upload` foi só repaginado, não redesenhado — a tela de mapeamento é o centro da Fase 1 |
| 2026-09-19 | Login com **e-mail + senha** (`APP_EMAIL`) | Credencial de duas partes, não contas de usuário. **Não altera o §5.7**: segue mono-empresa, sem cadastro e sem auditoria |

**A restrição do §5.3 continua de pé onde importa**: nenhuma convenção de milhar/decimal foi
escolhida por célula. A correção estrutural (decidir por coluna, com confirmação) segue sendo da
Fase 1 e segue inteiramente possível — o que mudou é que, até lá, o sistema recusa em vez de
gravar um número que pode estar errado.

### Critério de entrada da Etapa 2

1. Fase 0 executada e resultado registrado como descoberta empírica em [CLAUDE.md](CLAUDE.md).
2. Decisões §12.1, §12.2 e §12.3 respondidas — são as que mudam o recorte.
3. Só então o plano de implementação da Fase 1 pode ser escrito.

### Manutenção deste documento

Segue a regra de [CLAUDE.md](CLAUDE.md) §Manutenção da documentação: quando uma fase for concluída,
o quadro do §0 e os marcadores afetados são atualizados **antes** de a fase ser declarada encerrada.
Hipótese só vira fato com medição, e a medição precisa ser dita.
