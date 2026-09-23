# Atlas — Painel de Cobrança

> Uma planilha de títulos em aberto entra. A resposta de **quem cobrar hoje, e o que mandar** sai.

`Next.js 16 (App Router)` · `React 19` · `TypeScript` · `Tailwind CSS v4` · `Supabase/PostgreSQL` · `Vitest — 218 casos`

---

## Sobre este repositório

Atlas é um produto **v0 completo de ponta a ponta**: login, importação de planilha com prévia e
confirmação, fila priorizada, mensagem pronta, envio pelo WhatsApp, registro de resultado,
histórico por cliente e painel de dados. Não é um protótipo de tela — as regras de negócio vivem
em módulos testados, e as decisões difíceis estão documentadas junto do código que as aplica.

O que este repositório tenta demonstrar, além de "funciona":

- **Domínio separado de I/O.** Priorização, ciclo de vida do título, parsing de CSV e apuração de
  receita são funções puras — por isso 218 testes rodam em ~2s sem banco, sem browser e sem mock
  de framework.
- **Modos de falha tratados como funcionalidade.** Banco fora do ar não vira "lista vazia"; valor
  ambíguo na planilha não vira cobrança errada; ausência de senha em produção não vira app aberto.
- **Decisões registradas, não só implementadas.** Cada escolha não-óbvia tem o porquê escrito no
  arquivo onde ela mora, e o desenho geral está em [ARCHITECTURE.md](ARCHITECTURE.md) e
  [PLANEJAMENTO.md](PLANEJAMENTO.md).

**Estado atual:** funcional e rodável localmente. Não há instância pública no ar — para ver o
sistema funcionando, siga [Rodando localmente](#rodando-localmente) com um projeto Supabase seu
(o plano gratuito basta). Para avaliar sem banco nenhum, veja
[Como testar a aplicação](#como-testar-a-aplicação): a suíte automatizada, o lint, o typecheck e o
build rodam sem nenhuma credencial.

### Sumário

| Se você quer… | Vá para |
|---|---|
| Entender o produto | [O que é o Atlas](#o-que-é-o-atlas) · [Telas e funcionalidades](#telas-e-funcionalidades) |
| Entender as regras | [Priorização](#como-o-sistema-prioriza-os-títulos) · [Status dos títulos](#status-dos-títulos) |
| Rodar na sua máquina | [Rodando localmente](#rodando-localmente) |
| **Testar a aplicação** | [Como testar a aplicação](#como-testar-a-aplicação) |
| Ver as decisões técnicas | [Decisões de engenharia](#decisões-de-engenharia) · [Estrutura de pastas](#estrutura-de-pastas) |

---

## O que é o Atlas?

O Atlas é um painel web de cobrança pensado para pequenos negócios — prestadores de serviço, lojas, clínicas ou qualquer empresa que precise cobrar clientes com títulos em aberto (boletos, parcelas, mensalidades).

O problema que ele resolve é simples e comum: **quem ligar primeiro hoje?** Sem uma ferramenta, o cobrador precisa varrer planilhas, calcular manualmente quem está mais atrasado, escrever mensagens individualmente e torcer para não esquecer ninguém.

O Atlas faz tudo isso automaticamente:

1. Você sobe uma planilha CSV, revisa uma prévia (nada é gravado ainda) e confirma a importação.
2. O sistema calcula quem tem prioridade (baseado em dias de atraso e valor em risco).
3. Exibe uma fila ordenada com a mensagem de cobrança já escrita para cada cliente.
4. Com um clique você abre o WhatsApp com a mensagem pronta.
5. Você registra o resultado (pago, prometeu, sem resposta). O título sai da lista — mas só sai
   **para sempre** se foi pago: promessa e sem resposta voltam sozinhas depois (ver
   [Status dos títulos](#status-dos-títulos)).

---

## Fluxo principal

```
Login → Importar CSV → Ver Lista do Dia → Enviar WhatsApp → Registrar resultado
```

```
┌─────────┐     ┌──────────────┐     ┌─────────────────┐
│  Login  │────▶│ Importar CSV │────▶│  Lista do Dia   │
└─────────┘     └──────────────┘     └────────┬────────┘
                                               │
                          ┌────────────────────┼────────────────────┐
                          ▼                    ▼                    ▼
                   ┌─────────────┐    ┌──────────────┐    ┌──────────────┐
                   │  WhatsApp   │    │  Reg. status │    │  Histórico   │
                   │  (externo)  │    │ (pago/prom.) │    │  do cliente  │
                   └─────────────┘    └──────────────┘    └──────────────┘
```

---

## Telas e funcionalidades

### 1. Login (`/login`)

Tela de entrada com **e-mail e senha**, configurados pelo desenvolvedor nas variáveis de ambiente `APP_EMAIL` e `APP_PASSWORD`. Após o login, um cookie de sessão **assinado pelo servidor** é salvo por 30 dias — não é preciso digitar de novo nesse período. O e-mail ignora maiúsculas e espaços; a senha não.

> **Importante:** isso é **uma credencial da empresa**, não contas de usuário. Não há cadastro, não há uma conta por pessoa, e o sistema não registra *quem* fez cada ação — só que foi feita. Todo mundo do negócio usa o mesmo e-mail e a mesma senha. Contas individuais exigiriam mudança estrutural (ver [PLANEJAMENTO.md](PLANEJAMENTO.md) §5.7).

O cookie não guarda a senha: ele carrega uma data de validade e uma assinatura que só o servidor consegue produzir (a chave deriva do e-mail **e** da senha). Um cookie inventado, alterado ou com a validade esticada é recusado e cai no login. Trocar o e-mail ou a senha encerra todas as sessões abertas.

O login tem limite de **10 tentativas por IP a cada 5 minutos**; passando disso, a resposta é 429 até a janela expirar. A comparação de e-mail e senha é feita em tempo constante, e as duas sempre rodam — encerrar na primeira falha faria o tempo de resposta revelar que o e-mail estava certo.

> **Para testadores:** em desenvolvimento local sem credencial configurada, o login é ignorado e você entra direto. Em produção sem credencial o app responde 503 em vez de liberar o acesso.

---

### 2. Lista do Dia (`/` — página inicial)

É a tela central do sistema. Ao abrir, ela já mostra **somente os títulos urgentes do dia**, sem precisar filtrar nada.

**Cards de resumo no topo:**

| Card | O que mostra |
|---|---|
| **Vencidos** | Quantidade de títulos já em atraso |
| **A vencer** | Títulos que vencem hoje ou nos próximos 3 dias |
| **Em risco** | Soma em reais de todos os títulos vencidos |
| **Recuperado** | Quanto foi efetivamente pago nos últimos 30 dias |

> O card **Recuperado** é a métrica que mais importa: é o dinheiro que voltou para o caixa. Se
> aparecer "—", a apuração não pôde ser feita (normalmente falta rodar a migration do banco) —
> o Atlas mostra um traço em vez de R$ 0,00 de propósito, porque zero seria uma afirmação falsa.

**Seções da fila:**

- **Vencidos — cobrar hoje**: títulos já passados do vencimento, ordenados por prioridade (quem está há mais tempo com valor maior aparece primeiro).
- **A vencer — enviar lembrete**: títulos que vencem hoje ou em até 3 dias, ordenados pelo mais próximo do vencimento.

> Títulos que vencem em mais de 3 dias **não aparecem** — o sistema só mostra o que é urgente.

**A fila é uma tabela, com uma linha por cliente — não por título.** Se um cliente tem 3 títulos em aberto, ele aparece uma única vez na lista — cobrar a pessoa, não cada título isolado, evita mandar várias mensagens separadas pra mesma pessoa no mesmo dia.

**Cada linha mostra:** nome do cliente (clicável → histórico), telefone, valor total em aberto, maior atraso e quantidade de títulos. À direita ficam três ações padronizadas em ícone: **enviar pelo WhatsApp** (abre a conversa com a mensagem pronta e registra o envio), **ligar** (abre o discador) e **marcar como pago**.

**Ao expandir a linha** (seta à esquerda) aparecem:

- A **mensagem de cobrança consolidada**, gerada automaticamente (texto pronto para copiar ou enviar)
- Botão **"Enviar via WhatsApp"** — abre o WhatsApp com a mensagem consolidada preenchida e registra o envio em todos os títulos em aberto daquele cliente
- Uma lista compacta com cada título individual do cliente: valor, badge de dias em atraso/a vencer, e seus próprios botões de resultado — **Pago**, **Prometeu pagar**, **Sem resposta** — porque o cliente pode pagar um título e não outro

Ao registrar um resultado, aquele título some da lista do dia. A linha do cliente continua aparecendo enquanto ele tiver outros títulos pendentes.

Se o resultado foi **prometeu pagar** ou **sem resposta**, o título não foi encerrado — ele volta à lista depois (na data prometida, ou passados alguns dias de silêncio) marcado com o motivo do retorno, para você saber que já falou com essa pessoa. Só **pago** encerra um título de vez.

---

### 3. Importar Planilha (`/upload`)

Tela para subir um arquivo CSV com os títulos de cobrança.

**Como funciona o upload (duas etapas — prévia e confirmação):**

1. Você seleciona o arquivo `.csv`. O sistema mostra um preview local instantâneo (linhas detectadas e separador).
2. Ao clicar em **"Analisar planilha"**, o arquivo é processado no servidor — mas **nada é gravado no banco ainda**. Essa etapa é só leitura: valida cada linha, detecta duplicatas contra o que já existe no sistema e monta uma prévia.
3. A prévia mostra: quantos títulos estão prontos pra importar, quantas duplicatas e linhas ignoradas, quais colunas foram identificadas, o separador detectado, e uma **análise financeira** do que seria importado (quanto já está vencido, quanto vence em até 3 dias, quanto é vencimento futuro).
4. Você revisa e só então clica em **"Confirmar importação"** — é nesse momento que clientes e títulos são de fato gravados no banco. A checagem de duplicata é refeita nesse passo por segurança.
5. O relatório final mostra quantos títulos foram importados, duplicatas ignoradas e eventuais erros de gravação.

> Essa separação em duas etapas existe para evitar subir uma planilha errada (coluna mapeada errado, data trocada) direto pro banco sem chance de revisão.

**O relatório final tem três desfechos, e a cor acompanha o que aconteceu:**

| Desfecho | Cor | Significa |
|---|---|---|
| Importação concluída | verde | Tudo que devia entrar entrou |
| Concluída em parte | âmbar | Alguma linha foi recusada — o motivo aparece na lista de erros |
| Interrompida — banco indisponível | vermelho | Problema de conexão, **não** com a sua planilha |

No caso vermelho a tela informa quantos títulos chegaram a ser gravados antes da queda e avisa que
**reimportar o mesmo arquivo é seguro**: o que já entrou é reconhecido como duplicata e não entra
duas vezes.

Se a confirmação falhar antes de gerar relatório, o aviso aparece **na própria prévia**, logo acima
do botão, e diz o que se sabe sobre o banco. Sessão expirada garante que nada foi gravado, e a tela
oferece entrar de novo. Queda de conexão não garante nada, e o texto manda conferir a lista do dia
antes de reimportar.

**O sistema é flexível no reconhecimento de colunas.** Ele aceita muitos nomes diferentes para cada campo — útil para planilhas exportadas de diferentes ERPs ou sistemas. Colunas que ele não conhece (CPF, endereço, vendedor, observações) são simplesmente ignoradas.

| Campo esperado | Exemplos de nomes aceitos |
|---|---|
| `nome` | nome, cliente, razao_social, devedor, sacado, pagador... |
| `telefone` | telefone, celular, whatsapp, fone, tel, mobile... |
| `valor` | valor, montante, vl_titulo, vl_total, saldo, total, amount... |
| `data_vencimento` | vencimento, vencto, due_date, dt_vencimento, prazo, venc... |

**Formatos aceitos para o valor:**

| Formato | Exemplo |
|---|---|
| Real sem separador | `1500` |
| Real com vírgula decimal | `1500,00` |
| Real com ponto decimal | `1500.00` |
| Formato BR com milhar | `1.500,00` |
| Formato US com milhar | `1,500.00` |
| Com símbolo de moeda | `R$ 1.500,00` |
| Milhar com vários pontos | `1.234.567` |

> ⚠️ **Valor ambíguo é recusado, não adivinhado.** Um número com **um ponto e exatamente três
> dígitos depois, sem centavos** — `1.500`, `2.850` — pode significar mil e quinhentos (ponto como
> milhar, BR) ou um e cinquenta (ponto como decimal, US). Como as duas leituras são legítimas, o
> Atlas **não escolhe**: a linha aparece na prévia como ignorada, com a explicação e as duas
> formas de resolver — escrever com centavos (`1.500,00`) ou sem separador (`1500`).
>
> Isso é deliberado. Antes o sistema assumia decimal e gravava **R$ 1,50 no lugar de R$ 1.500**,
> sem avisar. Uma cobrança recusada e visível é melhor que uma cobrança errada e silenciosa.
> Decidir o formato automaticamente, olhando a coluna inteira, está planejado
> ([PLANEJAMENTO.md](PLANEJAMENTO.md) §5.3).

**Formatos aceitos para a data:**

| Formato | Exemplo |
|---|---|
| DD/MM/AAAA | `15/08/2026` |
| AAAA-MM-DD | `2026-08-15` |
| DD-MM-AAAA | `15-08-2026` |
| DD.MM.AAAA | `15.08.2026` |
| AAAA/MM/DD | `2026/08/15` |
| AAAAMMDD (compacto) | `20260815` |

> ⚠️ **Data no formato americano (MM/DD/AAAA) não é aceita.** O dia vem primeiro. Uma linha como
> `10/25/2026` é recusada com "data inválida", porque não existe mês 25. Mas atenção ao caso que o
> sistema **não** consegue detectar: quando dia e mês são ambos 12 ou menos — `03/04/2026` — a
> data entra como **3 de abril**, não 4 de março, sem nenhum aviso. Se a planilha veio de um
> sistema em inglês, converta as datas antes de importar.

**Outras regras de validação de linha:** nome não pode estar em branco; telefone precisa ter de 10
a 15 dígitos depois de limpo (o DDI brasileiro é acrescentado quando falta); valor precisa ser
positivo; e a data precisa cair dentro de uma faixa de 5 anos para trás ou para frente — data fora
disso costuma ser coluna mapeada errada, não cobrança real.

**Separadores aceitos:** vírgula (`,`), ponto e vírgula (`;`), tabulação (`tab`) e pipe (`|`).

**Deduplicação:** se um título com o mesmo cliente, valor e data de vencimento já estiver no sistema como "em aberto", ele é ignorado — não duplica.

**Exemplo mínimo de CSV:**

```csv
nome,telefone,valor,data_vencimento
João Silva,11999990000,1500.00,15/08/2026
Maria Souza,21988880000,320,2026-08-20
```

---

### 4. Histórico do Cliente (`/clientes/[id]`)

Tela acessada ao clicar no nome de um cliente na lista do dia. Mostra:

- Nome, telefone e totais (quanto está em aberto e quanto já foi pago).
- Todos os títulos do cliente, do mais recente para o mais antigo.
- Para cada título: valor, data de vencimento, status atual e (se houver) data de promessa de pagamento.
- **Linha do tempo de interações** de cada título: data/hora, mensagem enviada e resultado registrado.

---

### 5. Gerenciar Dados (`/dados`)

Painel administrativo com visão geral do banco de dados e opções de limpeza. Útil principalmente durante testes.

**Estatísticas exibidas:**

- Total de clientes cadastrados
- Títulos em aberto — tudo que ainda não foi pago, incluindo os que aguardam follow-up
- Títulos pagos — o único estado que encerra um título
- Total geral de títulos
- Valor vencido (mesma conta da lista do dia) e Total em aberto (inclui o que ainda vai vencer)
- Recuperado — soma dos títulos pagos nos últimos 30 dias

**Ações de limpeza:**

| Ação | O que remove |
|---|---|
| Limpar títulos pagos | **Apenas** títulos já pagos, com o histórico de interações deles. Títulos aguardando follow-up (promessa ou sem resposta) são preservados — continuam sendo dívida em aberto. |
| Limpar tudo | Remove absolutamente todos os dados (clientes, títulos, interações). O sistema volta ao estado inicial. |

> ⚠️ Ambas as ações são **irreversíveis**. Há uma etapa de confirmação antes de executar.
>
> Atenção ao "Limpar títulos pagos": apagar um título pago também apaga o registro de que ele foi
> recuperado, então o valor sai da apuração dos últimos 30 dias. Use com parcimônia se quiser
> preservar o histórico da métrica.

**Se o banco não responder, esta tela não mostra número nenhum.** Em vez de exibir zeros, aparece
um aviso de dados indisponíveis com um botão para tentar de novo — e as ações de limpeza **somem**
enquanto o estado real for desconhecido. É deliberado: já foi possível ver "0 títulos" por falha de
leitura e clicar em "Limpar tudo" logo abaixo achando que não havia nada a perder.

Se uma exclusão falhar no meio, a mensagem é vermelha e avisa que parte dos dados pode ter sido
removida — nunca verde de sucesso.

Se a sessão tiver expirado, a tela diz isso e oferece entrar de novo, sem mostrar número nem ação
de limpeza.

---

## Como o sistema prioriza os títulos

O algoritmo de prioridade funciona em duas etapas:

**1. Categorização por urgência:**

| Categoria | Condição | Cor |
|---|---|---|
| `atraso_longo` | Mais de 7 dias em atraso | Vermelho (risco) |
| `atraso_leve` | 1 a 7 dias em atraso | Âmbar (atenção) |
| `preventivo` | Vence hoje ou em até 3 dias | Neutro |
| *(não exibido)* | Vence em mais de 3 dias | — |

**2. Ordenação dentro de cada grupo:**

- **Vencidos:** ordenados pelo **score** = `dias_em_atraso × valor`. Quem tem maior combinação de tempo e valor aparece primeiro.
- **A vencer:** ordenados pelo **vencimento mais próximo** — quem vence hoje aparece acima de quem vence em 3 dias.

Exemplo: um título de R$ 200 com 10 dias de atraso (score = 2.000) perde prioridade para um de R$ 500 com 5 dias (score = 2.500).

**Exceção:** um título que **volta** à lista por promessa vencida ou fim do silêncio entra mesmo que o vencimento ainda esteja distante. O compromisso assumido com o cliente vale mais que o corte de "ainda não é urgente".

---

## Mensagens geradas automaticamente

O sistema usa três templates, um para cada categoria:

| Categoria | Mensagem |
|---|---|
| Preventivo | *"Oi [nome]! Passando pra lembrar que seu pagamento de R$ [valor] vence em [X] dias. Qualquer dúvida, só chamar!"* |
| Atraso leve | *"Oi [nome], tudo bem? Notei que o pagamento de R$ [valor], que venceu dia [data], ainda tá em aberto. Consegue regularizar ou prefere combinar uma nova data?"* |
| Atraso longo | *"Oi [nome], o pagamento de R$ [valor] está em atraso há [X] dias. Preciso resolver isso com você — pode me passar uma data certa pra pagamento?"* |

O template preenche automaticamente: primeiro nome do cliente, valor formatado em R$, data de vencimento e quantidade de dias.

Quando um cliente tem mais de um título em aberto, o sistema não manda uma mensagem por título — ele gera **uma mensagem consolidada**, listando todos os valores e vencimentos, com abertura e fechamento adaptados a se há título vencido entre eles ou não.

---

## Status dos títulos

| Status | Significado |
|---|---|
| `aberto` | Pendente — aparece na lista do dia quando fica urgente |
| `pago` | Confirmado como pago — **único status que encerra o título de vez** |
| `promessa` | Cliente prometeu pagar numa data — sai da lista e **volta nessa data** |
| `sem_resposta` | Contato feito, sem retorno — sai da lista e **volta em 3 dias** |

> **Cobrança é um processo, não um evento.** Nenhuma dívida some da operação permanentemente sem
> ter sido paga. Se o cliente prometeu pagar dia 20, o título reaparece na lista no dia 20; se não
> respondeu, reaparece depois de alguns dias para uma nova tentativa. Quando um título volta, ele
> vem marcado com o motivo ("prometeu e não pagou" / "sem resposta antes") para você saber que já
> falou com essa pessoa.

Toda mudança de status é registrada como uma **interação**, que fica salva no histórico do cliente.

---

## Banco de dados (estrutura)

O sistema usa [Supabase](https://supabase.com) (PostgreSQL gerenciado).

```
clientes
  id           UUID (PK)
  nome         TEXT
  telefone     TEXT (único — chave de upsert no CSV)
  criado_em    TIMESTAMP

titulos
  id               UUID (PK)
  cliente_id       UUID (FK → clientes, ON DELETE CASCADE)
  valor            NUMERIC
  data_vencimento  DATE
  status           TEXT  [aberto | pago | promessa | sem_resposta]
  data_promessa    DATE        (nullable — status 'promessa': volta à fila nessa data)
  silenciado_ate   DATE        (nullable — status 'sem_resposta': fora da fila até aqui)
  resolvido_em     TIMESTAMPTZ (nullable — preenchido só ao virar 'pago';
                                é a fonte da métrica de receita recuperada)
  criado_em        TIMESTAMP

interacoes
  id               UUID (PK)
  titulo_id        UUID (FK → titulos, ON DELETE CASCADE)
  mensagem_enviada TEXT
  data_envio       TIMESTAMP
  resultado        TEXT
```

**Índice que carrega uma regra de negócio:**

```sql
idx_titulos_aberto_unico
  UNIQUE (cliente_id, valor, data_vencimento) WHERE status = 'aberto'
```

No máximo um título **em aberto** por cliente/valor/vencimento. É isso que impede que importar o
mesmo arquivo em duas abas ao mesmo tempo gere cobrança em duplicidade. O recorte
`WHERE status = 'aberto'` é intencional: um título já **pago** com os mesmos valores não bloqueia
uma cobrança nova.

---

## Stack técnica

| Camada | Tecnologia |
|---|---|
| Framework | Next.js 16 (App Router, Server Components e Server Actions) |
| UI | React 19 + Tailwind CSS v4 |
| Sistema visual | Tokens semânticos em `globals.css` (`superficie`, `risco`, `atencao`, `marca`) + primitivas próprias em `components/ui` |
| Linguagem | TypeScript (modo estrito) |
| Banco de dados | Supabase (PostgreSQL) com RLS habilitado, acessado só pelo servidor |
| Parse de CSV | PapaParse |
| Autenticação | E-mail + senha (credencial única) · cookie HTTP-only assinado (HMAC-SHA256), verificado no Proxy |
| Testes | Vitest — 218 casos em 9 arquivos: domínio, política de I/O, sessão e leitura de resposta no navegador |

---

## Rodando localmente

### 1. Pré-requisitos

- **Node.js 20.9+** (exigência do Next.js 16)
- Uma conta no [Supabase](https://supabase.com) — o plano gratuito é suficiente

### 2. Criar o banco de dados

No painel do Supabase, vá em **SQL Editor** e execute, nesta ordem:

```
supabase/schema.sql
supabase/rls.sql
```

Se o banco **já existia** antes desta versão, rode também, nesta ordem:

```
supabase/migration-01-ciclo-operacional.sql
supabase/migration-02-titulo-aberto-unico.sql
```

A **01** adiciona `silenciado_ate` e `resolvido_em` em `titulos` — colunas que o `schema.sql` não
cria em bancos existentes (ele usa `create table if not exists`). Sem elas, o card "Recuperado"
mostra "—" e registrar o resultado de um título falha com erro explícito.

A **02** cria o índice que impede dois títulos em aberto idênticos para o mesmo cliente. Sem ele,
duas importações simultâneas do mesmo arquivo (duas abas, por exemplo) gravam a mesma cobrança
duas vezes sem avisar. **Ela apaga duplicatas que já existam** no banco, preservando o histórico
de interações delas — leia o cabeçalho do arquivo antes de rodar.

O `schema.sql` cria as três tabelas (`clientes`, `titulos`, `interacoes`) e os índices necessários. O `rls.sql` habilita Row Level Security nelas — **passo obrigatório**: sem ele, qualquer pessoa que obtenha a URL do projeto e a chave anônima do Supabase consegue ler e escrever nas tabelas. Com RLS habilitado e nenhuma política criada, esse acesso fica bloqueado e o app continua funcionando porque fala com o banco pelo servidor, usando a `service_role`.

### 3. Variáveis de ambiente

Copie o arquivo de exemplo e preencha com os dados do seu projeto Supabase:

```bash
cp .env.local.example .env.local
```

São quatro variáveis, todas obrigatórias:

```env
# Supabase → Settings > API > Project URL
NEXT_PUBLIC_SUPABASE_URL=

# Supabase → Settings > API > Project API keys > service_role
# NUNCA prefixar com NEXT_PUBLIC_. É a única forma do app acessar o banco
# depois que RLS está habilitado (passo 2), porque ela ignora RLS por
# definição e só é usada no servidor — nunca é enviada ao navegador.
SUPABASE_SERVICE_ROLE_KEY=

# Credencial de acesso ao painel — e-mail E senha, as duas obrigatórias.
# Não são contas de usuário: é uma credencial única da empresa, com duas
# partes. Trocar qualquer uma encerra as sessões abertas.
APP_EMAIL=
APP_PASSWORD=
```

> A chave anônima (`NEXT_PUBLIC_SUPABASE_ANON_KEY`) **não é mais necessária** — nenhum código a
> lê desde que o acesso ao banco passou a ser exclusivamente pela `service_role` no servidor.

> **`APP_EMAIL` ou `APP_PASSWORD` em branco:** em desenvolvimento, o app roda sem pedir login (conveniente, e o
> risco é local). Em produção (`NODE_ENV=production`) o app **se recusa a servir** e responde 503
> até as variáveis serem definidas — deixar dados de clientes acessíveis sem autenticação por
> descuido de configuração não é um modo de falha aceitável.

### 4. Instalar e rodar

```bash
npm install
npm run dev
```

Acesse [http://localhost:3000](http://localhost:3000).

### 5. Comandos disponíveis

| Comando | O que faz | Precisa de banco? |
|---|---|---|
| `npm run dev` | Sobe o servidor de desenvolvimento | Sim |
| `npm run build` | Gera o build de produção | Não |
| `npm run start` | Serve o build de produção | Sim |
| `npm run lint` | ESLint (config do Next) | Não |
| `npm run test` | Suíte automatizada (Vitest) | Não |
| `npx tsc --noEmit` | Checagem de tipos | Não |

---

## Como testar a aplicação

Esta seção é o roteiro completo de verificação: o que a máquina checa sozinha, o que precisa de um
par de olhos, e como provocar de propósito os erros que o sistema promete tratar bem.

### Caminho rápido (sem banco, ~2 minutos)

Tudo abaixo roda em repositório recém-clonado, **sem `.env.local` e sem Supabase**:

```bash
npm install
npm run test        # 9 arquivos, 218 casos — deve passar em ~2s
npm run lint        # sem saída = sem problema
npx tsc --noEmit    # sem saída = sem erro de tipo
npm run build       # build de produção completo
```

Saída esperada do `npm run test`:

```
 Test Files  9 passed (9)
      Tests  218 passed (218)
```

### 1. Testes automatizados

A suíte é **de domínio**: roda no ambiente `node`, sem jsdom, sem servidor e sem mock de
framework. Isso é possível porque as regras de negócio não estão dentro de componentes ou rotas —
estão em funções puras em `src/lib`, e as rotas apenas as chamam.

| Arquivo | Casos | O que garante |
|---|---|---|
| `src/lib/csv-import.test.ts` | 77 | Normalização de valor, data e telefone; reconhecimento de colunas por alias; recusa de valor ambíguo; validação de linha; **paridade entre prévia e confirmação** (nada aprovado na prévia pode ser recusado na gravação); deduplicação e plano de importação |
| `src/lib/prioridade.test.ts` | 38 | Dias de atraso, categorização, score, agrupamento por cliente e o ciclo de vida (`estaNaFilaHoje`): quando promessa e silêncio devolvem o título à fila |
| `src/lib/sessao.test.ts` | 25 | Cookie de sessão: assinatura válida, recusa de valor forjado ou adulterado, expiração verificada no servidor, vínculo com o segredo |
| `src/lib/supabase-io.test.ts` | 20 | Política de acesso ao banco: prazo (timeout), classificação de falha de infraestrutura, paginação que busca **todas** as páginas |
| `src/lib/importacao.test.ts` | 14 | Gravação do lote: caminho normal, conflito de unicidade (duas importações simultâneas) e falhas que não são conflito |
| `src/lib/recuperacao.test.ts` | 10 | Janela de 30 dias e soma da receita recuperada |
| `src/lib/credenciais.test.ts` | 9 | Normalização de e-mail e derivação do segredo de sessão a partir das duas partes |
| `src/lib/rate-limit.test.ts` | 9 | Contagem dentro da janela, expiração e expurgo de entradas velhas (o "agora" é parâmetro, então o teste acerta o relógio) |

Rodar um arquivo só, ou em modo watch:

```bash
npx vitest run src/lib/prioridade.test.ts
npx vitest            # watch
```

**O que a suíte não cobre, de propósito:** componentes React, route handlers e a integração real
com o Supabase. Essa parte é verificada pelo roteiro manual abaixo — o que significa que uma
mudança em tela ou rota **precisa** ser testada à mão antes de ser considerada pronta.

### 2. Dados de exemplo inclusos

O repositório traz dois CSVs prontos para exercitar a importação:

**`teste.csv`** — o caso fácil: separador vírgula, cabeçalho canônico, 6 linhas.

| Esperado na prévia | |
|---|---|
| Títulos prontos | **6** |
| Linhas ignoradas | **0** |
| Separador detectado | `,` |

**`teste_varejo.csv`** — o caso real: exportação estilo ERP, separador `;`, cabeçalho em caixa alta
(`CLIENTE`, `CELULAR`, `VL_TOTAL`, `VENCTO`), colunas extras que o Atlas ignora (`CPF/CNPJ`,
`ENDEREÇO`, `OBS`, `VENDEDOR`), telefones em cinco formatos diferentes, valores como `R$ 3.200,00`,
`450.50`, `1.850,00` e `200`, datas em `DD/MM/AAAA`, `AAAA-MM-DD`, `DD-MM-AAAA` e `DD.MM.AAAA`.

| Esperado na prévia | |
|---|---|
| Títulos prontos | **11** |
| Linhas ignoradas | **2** |
| Linha 10 (`JOSE CARLOS BARBOSA NETO`) | recusada — `Valor inválido — "VALOR ZERADO"` |
| Linha 11 (`Luciana Aparecida Rodrigues`) | recusada — `Data inválida — "VENCE EM AGOSTO"` |
| Separador detectado | `;` |
| Colunas identificadas | CLIENTE → nome, CELULAR → telefone, VL_TOTAL → valor, VENCTO → data_vencimento |

> Os vencimentos desses arquivos estão em julho e agosto de 2026. Dependendo de quando você
> testar, eles caem todos em **Vencidos** e a seção **A vencer** fica vazia — o que é o
> comportamento correto, não um defeito. Para exercitar a seção preventiva, edite algumas datas
> para hoje, amanhã e daqui a 3 dias.

Para testar a **recusa de valor ambíguo**, acrescente esta linha ao `teste_varejo.csv`:

```
CLIENTE AMBIGUO;;11999990099;Rua Teste 1;1.500;10/12/2026;;João
```

Ela deve aparecer como **ignorada**, com a explicação de que `1.500` pode ser mil e quinhentos ou
um e cinquenta, e as duas formas de resolver.

### 3. Roteiro manual

Precisa de banco configurado e `npm run dev` rodando. A ordem importa: os cenários constroem
estado uns para os outros.

#### Cenário 0 — Login e sessão

1. Acesse `http://localhost:3000` deslogado → deve **redirecionar para `/login`**.
2. Erre a senha → mensagem genérica *"E-mail ou senha incorretos"* (nunca "senha incorreta", que
   confirmaria que o e-mail existe).
3. Acerte e-mail e senha → entra na lista do dia.
4. Recarregue a página → continua logado (cookie de 30 dias).

✅ **Passou se:** nenhuma rota do app abre sem login, e o erro não diferencia e-mail de senha.

#### Cenário 1 — Fluxo completo

1. Vá em **"+ Importar CSV"** e selecione `teste_varejo.csv`.
2. Clique em **"Analisar planilha"**. Confira a prévia contra a tabela da seção anterior:
   11 prontos, 2 ignorados, separador `;`, colunas identificadas. **Nada foi gravado ainda.**
3. Clique em **"Confirmar importação"** → o relatório deve informar 11 títulos importados.
4. Vá para a **Lista do dia** e confira que os clientes aparecem na seção correta e ordenados por
   prioridade (maior `dias × valor` no topo, entre os vencidos).
5. Expanda uma linha → a mensagem deve citar o primeiro nome, o valor formatado em R$ e os dias de
   atraso. Cliente com mais de um título deve ter **uma** mensagem consolidada citando todos.
6. Clique em **enviar pelo WhatsApp** → abre o WhatsApp Web/app com o texto preenchido.
7. Volte ao Atlas e registre **"Pago"** num título → aquele título some; a linha do cliente
   continua se ele ainda tiver outros.
8. Registre **"Prometeu pagar"** → deve pedir uma data antes de confirmar.
9. Registre **"Sem resposta"** → some sem pedir data.

✅ **Passou se:** os números do relatório batem com a prévia, a ordenação respeita a prioridade e
cada resultado registrado remove só o título certo.

#### Cenário 2 — Histórico do cliente

1. Na lista do dia, clique no nome de um cliente que você acabou de cobrar.
2. O histórico deve listar todos os títulos dele e, em cada um, as interações com data/hora e a
   mensagem que foi enviada.

✅ **Passou se:** o envio e o resultado registrados no cenário 1 aparecem aqui.

#### Cenário 3 — Deduplicação

1. Importe `teste.csv` (analisar + confirmar).
2. Importe o **mesmo arquivo** de novo: já na prévia, antes de confirmar, deve informar que
   6 títulos seriam ignorados por duplicação.
3. Duplique uma linha **dentro do próprio arquivo** e importe: a prévia conta uma como duplicata e
   a gravação grava só uma.
4. Abra `/upload` em **duas abas**, analise o mesmo arquivo nas duas e confirme quase ao mesmo
   tempo. As duas telas terminam sem erro e o total no banco é o do arquivo — não o dobro. Uma aba
   reporta os títulos como gravados, a outra como duplicatas.

✅ **Passou se:** em nenhum dos quatro caminhos o mesmo título entra duas vezes.

#### Cenário 4 — Colunas com nomes de ERP

1. Importe `teste_varejo.csv` (ou crie um CSV com `sacado`, `celular`, `vl_titulo`, `vencimento`).
2. O sistema deve identificar as quatro colunas sozinho e ignorar as demais.
3. Agora renomeie a coluna do valor para algo que ele não conhece (`xpto`) e analise de novo:
   deve **falhar com uma mensagem útil**, listando as colunas encontradas e os nomes aceitos.

✅ **Passou se:** o reconhecimento funciona sem configuração, e a falha explica como resolver.

#### Cenário 5 — Ciclo de vida: nada some sem ser pago

1. Registre **"Prometeu pagar"** num título com a data de **ontem**.
2. Recarregue a lista do dia → o título **reaparece**, marcado com "prometeu e não pagou".
3. Registre **"Sem resposta"** → sai da lista. Ele volta sozinho em 3 dias (para conferir sem
   esperar, ajuste `silenciado_ate` direto no banco).
4. Registre **"Pago"** → sai da lista e **não volta mais**.
5. Confirme que o card **Recuperado** subiu exatamente o valor daquele título.

✅ **Passou se:** só "Pago" encerra o título, e a métrica de recuperação reflete o valor exato.

#### Cenário 6 — Limpeza de dados

1. Acesse **"Dados"** e confira os números contra o que você importou.
2. **"Limpar títulos pagos"** → só os pagos somem; promessa e sem resposta permanecem.
3. **"Limpar tudo"** → o sistema volta ao estado inicial.

✅ **Passou se:** a limpeza parcial preserva o que ainda é dívida em aberto.

### 4. Testando os modos de falha

Esta é a parte que diferencia o Atlas de um CRUD: **o sistema promete se comportar bem quando algo
dá errado.** Vale verificar.

#### Cookie de sessão forjado

Com o servidor rodando e credencial configurada:

```bash
curl -i -H "Cookie: atlas_auth=1" http://localhost:3000/api/dados
```

**Esperado:** redirecionamento para `/login` — nunca os dados. O mesmo vale para um valor inventado,
para um valor com a data de validade esticada na mão e para um cookie assinado com outra senha.
(Esse caminho também é coberto pelos 25 casos de `sessao.test.ts`.)

#### Limite de tentativas de login

```bash
for i in $(seq 1 11); do
  curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/login \
    -H 'content-type: application/json' \
    -d '{"email":"errado@exemplo.com","password":"errada"}'
done
```

**Esperado:** `401` nas primeiras tentativas e `429` a partir da 11ª dentro da janela de 5 minutos.

#### Banco indisponível

Aponte o app para um host que não existe e suba de novo:

```env
NEXT_PUBLIC_SUPABASE_URL=https://host-que-nao-existe.supabase.co
```

**Esperado:**

- **Lista do dia:** aviso de erro em vermelho — **nunca** uma lista vazia, que significaria "não há
  o que cobrar hoje".
- **`/dados`:** aviso de dados indisponíveis, com botão de tentar de novo, e **sem** os botões de
  limpeza (não se apaga o que não se consegue ler).
- **Upload:** se a queda acontecer no meio da gravação, o relatório fica vermelho, informa quantos
  títulos entraram antes da falha e avisa que reimportar o arquivo é seguro.

#### Produção sem credencial

```bash
npm run build
# suba o servidor com APP_EMAIL e APP_PASSWORD vazios e NODE_ENV=production
npm run start
```

**Esperado:** HTTP **503** com a mensagem de configuração ausente — o app se recusa a servir em vez
de abrir todas as rotas.

#### Banco sem as migrations

Se você criou o banco só com `schema.sql` num projeto que já existia, o card **Recuperado** mostra
`—` em vez de `R$ 0,00`, e registrar um resultado falha com erro explícito. Isso é o comportamento
correto: zero seria uma afirmação falsa sobre dinheiro.

### 5. Checklist de aceitação

| # | Verificação | Como |
|---|---|---|
| 1 | Suíte automatizada verde | `npm run test` → 218/218 |
| 2 | Lint e tipos limpos | `npm run lint` · `npx tsc --noEmit` |
| 3 | Build de produção | `npm run build` |
| 4 | Login exigido em toda rota | Cenário 0 |
| 5 | Prévia não grava nada | Cenário 1, passo 2 |
| 6 | Números da prévia = números do relatório | Cenário 1, passos 2–3 |
| 7 | Prioridade correta na fila | Cenário 1, passo 4 |
| 8 | Importar duas vezes não duplica | Cenário 3 |
| 9 | Colunas de ERP reconhecidas | Cenário 4 |
| 10 | Só "Pago" encerra um título | Cenário 5 |
| 11 | Limpeza parcial preserva dívida aberta | Cenário 6 |
| 12 | Cookie forjado não entra | Modos de falha |
| 13 | Banco fora do ar não vira lista vazia | Modos de falha |

---

## Estrutura de pastas

```
src/
├── app/
│   ├── page.tsx               # Lista do dia (home) — clientes agrupados por prioridade
│   ├── login/page.tsx         # Tela de login
│   ├── upload/page.tsx        # Importar CSV (prévia + confirmação)
│   ├── dados/page.tsx         # Gerenciar dados
│   ├── clientes/[id]/page.tsx # Histórico do cliente
│   ├── globals.css            # Sistema visual: tokens de cor, tipografia e superfície
│   └── api/
│       ├── login/route.ts                # Autenticação (rate limit + comparação constant-time)
│       ├── upload-csv/route.ts           # Prévia do CSV (só leitura, não grava nada)
│       ├── upload-csv/confirmar/route.ts # Confirmação — grava clientes e títulos no banco
│       └── dados/route.ts                # Estatísticas e limpeza
├── components/
│   ├── FilaCobranca.tsx       # A fila como <table> — uma seção (vencidos / a vencer)
│   ├── ClienteLinha.tsx       # Linha do cliente: totais, ações e expansão com os títulos
│   ├── Navbar.tsx             # Barra de navegação
│   ├── NavbarWrapper.tsx      # Oculta a navbar na tela de login
│   ├── Marca.tsx              # Símbolo e logotipo do Atlas
│   └── ui/                    # Primitivas visuais: Botao, BotaoIcone, Badge, Icone, KpiCard
├── lib/
│   ├── supabase.ts            # Cliente do banco (service_role, lazy, só no servidor)
│   ├── supabase-io.ts         # Política de acesso: prazo, falha de dependência, paginação
│   ├── prioridade.ts          # Priorização, agrupamento e ciclo de vida (estaNaFilaHoje)
│   ├── recuperacao.ts         # Apuração da receita recuperada
│   ├── csv-import.ts          # Aliases de coluna, normalização, validação e plano de importação
│   ├── importacao.ts          # Gravação do lote de títulos (trata conflito de duplicidade)
│   ├── credenciais.ts         # Credencial do ambiente e derivação do segredo de sessão
│   ├── sessao.ts              # Valor de cookie assinado (HMAC) com expiração verificada
│   ├── rate-limit.ts          # Limitador de tentativas por chave, com "agora" injetável
│   ├── templates.ts           # Mensagens de cobrança (individuais e consolidadas)
│   ├── format.ts              # Formatação de moeda compartilhada
│   └── *.test.ts              # Os 8 arquivos de teste, ao lado do código que testam
├── actions/
│   └── index.ts               # Server Actions: registrar envio e atualizar status
├── types/
│   └── index.ts               # Tipos TypeScript compartilhados
└── proxy.ts                   # Gate de autenticação (middleware do Next 16)

supabase/
├── schema.sql                            # DDL — banco novo
├── rls.sql                               # Habilita RLS (rodar depois do schema)
├── migration-01-ciclo-operacional.sql    # Colunas do ciclo — bancos já existentes
└── migration-02-titulo-aberto-unico.sql  # Índice único de título em aberto

teste.csv          # Planilha de exemplo — caso simples
teste_varejo.csv   # Planilha de exemplo — caso realista (ERP, formatos misturados, linhas ruins)
```

---

## Decisões de engenharia

As escolhas que explicam o código, cada uma com o arquivo onde ela vive. O raciocínio completo
está nos comentários de cabeçalho desses arquivos e em [ARCHITECTURE.md](ARCHITECTURE.md).

| Decisão | Por quê | Onde |
|---|---|---|
| **Cookie de sessão assinado (HMAC-SHA256), com a expiração dentro do valor assinado** | O gate antes comparava o cookie com a string `1`: `curl -H 'Cookie: atlas_auth=1'` entrava sem ver a senha, inclusive nas rotas que expõem dados de clientes e apagam tudo. `maxAge` é só instrução ao navegador — quem monta a requisição à mão não obedece. | `lib/sessao.ts`, `proxy.ts` |
| **Chave de sessão derivada de e-mail + senha** | Não introduz uma env var nova e obrigatória (cujo modo de falha seria "ninguém loga"), e dá o efeito desejável de **trocar a senha encerrar as sessões abertas**. | `lib/credenciais.ts` |
| **Falhar fechado em produção sem credencial** | Servir dados de clientes sem autenticação por descuido de configuração não é modo de falha aceitável: 503 em vez de liberar. Em desenvolvimento, libera — o risco é local. | `proxy.ts` |
| **Toda leitura do banco é paginada e tem prazo** | O PostgREST corta a resposta em 1000 linhas — medido neste projeto: com 1149 títulos não pagos, um `select` sem paginar devolveu 1000, e a fila perdia o resto em silêncio. E sem prazo, uma queda de DNS deixava a home carregando por mais de um minuto. | `lib/supabase-io.ts` |
| **Lista vazia nunca pode significar "a consulta falhou"** | Falha de leitura vira exceção e aviso em vermelho; `/dados` esconde os botões de limpeza enquanto o estado real for desconhecido — já foi possível ver "0 títulos" por erro de leitura e clicar em "Limpar tudo" logo abaixo. | `app/page.tsx`, `app/dados/page.tsx` |
| **Valor ambíguo é recusado, não adivinhado** | `1.500` é mil e quinhentos em BR e um e cinquenta em US. O sistema gravava **R$ 1,50 no lugar de R$ 1.500** sem avisar. Uma cobrança recusada e visível é melhor que uma errada e silenciosa. | `lib/csv-import.ts` |
| **Unicidade garantida por índice parcial no banco, não por checagem no app** | Duas abas confirmando a mesma importação passavam pelas duas checagens antes de qualquer gravação. Só o banco resolve corrida; o app trata o conflito e reporta como duplicata. | `supabase/migration-02…`, `lib/importacao.ts` |
| **Prévia e confirmação compartilham a mesma validação** | Sem isso, uma linha aprovada na prévia podia ser recusada na gravação — e há um teste de paridade só para travar essa divergência. | `lib/csv-import.ts` + `csv-import.test.ts` |
| **"—" em vez de "R$ 0,00" quando a apuração não pôde ser feita** | Zero é uma afirmação sobre dinheiro. Se o dado não existe, o certo é dizer que não existe. | `lib/recuperacao.ts` |
| **A fila é uma `<table>` de verdade** | São dados tabulares, e o leitor de tela depende da associação célula-cabeçalho para anunciar "Valor em aberto: R$ 5.600,00" em vez de ler números soltos. | `components/FilaCobranca.tsx` |
| **Rate limit extraído para uma lib com "agora" injetável** | O comportamento que interessa é temporal (janela expira, contagem reinicia). Dentro da rota, só seria observável subindo servidor e esperando cinco minutos. | `lib/rate-limit.ts` |
| **Cores e tipografia em tokens semânticos** | `bg-superficie`/`text-risco` em vez de `bg-white`/`text-red-600` permite mudar identidade, adicionar tema escuro ou um segundo domínio sem caçar classe por classe. | `app/globals.css` |

---

## Limitações conhecidas do v0

- A autenticação é por uma credencial única da empresa (e-mail + senha). **Não há usuários individuais**, nem separação por empresa, nem registro de quem fez cada ação.
- O rate limit do login é em memória do processo: não sobrevive a restart nem é compartilhado entre instâncias. Serve ao deploy de instância única de hoje.
- Não há envio automático de mensagens — o WhatsApp é aberto manualmente.
- Não há notificações ou lembretes agendados: a reentrada de um título acontece quando você abre
  a lista do dia, não por aviso ativo.
- A exportação de relatórios não está implementada.
- Não há paginação **de tela** na lista do dia: todos os clientes da fila são exibidos de uma vez.
  Com muitos títulos a página fica lenta para montar — em base de teste, ~6,6s para 915 linhas. O
  custo é de renderização, não de banco (a leitura em si responde em menos de 1s no mesmo cenário).
  A *leitura* é paginada internamente e sempre completa; o que não existe é limitar quantas linhas
  aparecem por vez.
- Não é possível editar um cliente ou título já importado pela interface (nome ou telefone errado).
  A saída é corrigir na origem e reimportar, ou alterar direto no banco.
- Data ambígua entre DD/MM e MM/DD (`03/04/2026`) entra sem aviso como DD/MM. Decidir olhando a
  coluna inteira está planejado ([PLANEJAMENTO.md](PLANEJAMENTO.md) §5.3).

**Sobre a métrica de receita recuperada:**

- Conta apenas títulos marcados como **pago dentro do Atlas**, com a data em que foram marcados.
  Pagamentos registrados fora do sistema não aparecem.
- Títulos que já estavam pagos **antes** desta funcionalidade existir ficam de fora, porque não
  têm data de pagamento registrada. A apuração vale a partir da adoção — datar retroativamente
  produziria um número inventado.
- A janela é fixa em 30 dias e não é configurável pela interface.
- Apagar títulos pagos (em "Dados") remove esses valores da apuração.
- A mensagem gerada não se adapta a uma promessa quebrada: um título que volta usa o texto da
  categoria de urgência dele. Para o caso comum (título vencido) o texto funciona; para uma
  promessa sobre título ainda a vencer, a mensagem fala de vencimento e ignora o combinado.

---

## Documentação do projeto

| Documento | Para quê |
|---|---|
| **README.md** (este arquivo) | O produto, como rodar e como testar |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Módulos, dependências, fluxos de dados, onde vivem as regras, pontos frágeis e observações de segurança |
| [PLANEJAMENTO.md](PLANEJAMENTO.md) | Evolução pós-v0: limitações que bloqueiam o crescimento, arquitetura proposta, papel da IA, fases |
| [CLAUDE.md](CLAUDE.md) | Contexto e regras de atuação para assistentes de código neste repositório |
