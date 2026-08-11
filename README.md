# Atlas v0 — Painel de Cobrança

> Guia completo do projeto: o que é, como funciona e como usar.  
> Este documento é destinado tanto ao **desenvolvedor** quanto ao **testador**.

---

## O que é o Atlas?

O Atlas é um painel web de cobrança pensado para pequenos negócios — prestadores de serviço, lojas, clínicas ou qualquer empresa que precise cobrar clientes com títulos em aberto (boletos, parcelas, mensalidades).

O problema que ele resolve é simples e comum: **quem ligar primeiro hoje?** Sem uma ferramenta, o cobrador precisa varrer planilhas, calcular manualmente quem está mais atrasado, escrever mensagens individualmente e torcer para não esquecer ninguém.

O Atlas faz tudo isso automaticamente:

1. Você sobe uma planilha CSV, revisa uma prévia (nada é gravado ainda) e confirma a importação.
2. O sistema calcula quem tem prioridade (baseado em dias de atraso e valor em risco).
3. Exibe uma lista ordenada com a mensagem de cobrança já escrita para cada cliente.
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

Tela de entrada protegida por senha. A senha é configurada pelo desenvolvedor via variável de ambiente (`APP_PASSWORD`). Após o login, um cookie seguro é salvo por 30 dias — o usuário não precisa digitar a senha novamente nesse período.

> **Para testadores:** em desenvolvimento local sem senha configurada, o login é ignorado e você entra direto. Em produção sem senha configurada o app responde 503 em vez de liberar o acesso.

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

**Seções da lista:**

- 🔴 **Vencidos — cobrar hoje**: Títulos já passados do vencimento, ordenados por prioridade (quem está há mais tempo com valor maior aparece primeiro).
- 🟡 **A vencer — enviar lembrete**: Títulos que vencem hoje ou em até 3 dias, ordenados pelo mais próximo do vencimento.

> Títulos que vencem em mais de 3 dias **não aparecem** — o sistema só mostra o que é urgente.

**Os cards são agrupados por cliente, não por título.** Se um cliente tem 3 títulos em aberto, ele aparece uma única vez na lista — cobrar a pessoa, não cada título isolado, evita mandar várias mensagens separadas pra mesma pessoa no mesmo dia.

**Dentro de cada card de cliente:**

- Nome do cliente (clicável → abre o histórico) e telefone
- Valor total em aberto e quantidade de títulos
- A **mensagem de cobrança consolidada**, gerada automaticamente (texto pronto para copiar ou enviar)
- Botão **"Enviar via WhatsApp"** — abre o WhatsApp com a mensagem consolidada preenchida e registra o envio em todos os títulos em aberto daquele cliente
- Uma lista compacta com cada título individual do cliente: valor, badge de dias em atraso/a vencer, e seus próprios botões de resultado — **Pago**, **Prometeu pagar**, **Sem resposta** — porque o cliente pode pagar um título e não outro

Ao registrar um resultado, aquele título some da lista do dia. O card do cliente continua aparecendo enquanto ele tiver outros títulos pendentes.

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

**O sistema é inteligente no reconhecimento de colunas.** Ele aceita muitos nomes diferentes para cada campo — útil para planilhas exportadas de diferentes ERPs ou sistemas:

| Campo esperado | Exemplos de nomes aceitos |
|---|---|
| `nome` | nome, cliente, razao_social, devedor, sacado, pagador... |
| `telefone` | telefone, celular, whatsapp, fone, tel, mobile... |
| `valor` | valor, montante, vl_titulo, saldo, total, amount... |
| `data_vencimento` | vencimento, due_date, dt_vencimento, prazo, venc... |

**Formatos aceitos para o valor:**

| Formato | Exemplo |
|---|---|
| Real sem separador | `1500` |
| Real com vírgula decimal | `1500,00` |
| Real com ponto decimal | `1500.00` |
| Formato BR com milhar | `1.500,00` |
| Formato US com milhar | `1,500.00` |
| Com símbolo de moeda | `R$ 1.500,00` |

**Formatos aceitos para a data:**

| Formato | Exemplo |
|---|---|
| DD/MM/AAAA | `15/08/2025` |
| AAAA-MM-DD | `2025-08-15` |
| DD-MM-AAAA | `15-08-2025` |
| DD.MM.AAAA | `15.08.2025` |
| AAAA/MM/DD | `2025/08/15` |
| AAAAMMDD (compacto) | `20250815` |

**Separadores aceitos:** vírgula (`,`), ponto e vírgula (`;`), tabulação (`tab`) e pipe (`|`).

**Deduplicação:** se um título com o mesmo cliente, valor e data de vencimento já estiver no sistema como "em aberto", ele é ignorado — não duplica.

**Exemplo mínimo de CSV:**

```csv
nome,telefone,valor,data_vencimento
João Silva,11999990000,1500.00,15/08/2025
Maria Souza,21988880000,320,2025-08-20
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

---

## Como o sistema prioriza os títulos

O algoritmo de prioridade funciona em duas etapas:

**1. Categorização por urgência:**

| Categoria | Condição | Cor no card |
|---|---|---|
| `atraso_longo` | Mais de 7 dias em atraso | Borda vermelha |
| `atraso_leve` | 1 a 7 dias em atraso | Borda amarela |
| `preventivo` | Vence hoje ou em até 3 dias | Borda azul |
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
  cliente_id       UUID (FK → clientes)
  valor            NUMERIC
  data_vencimento  DATE
  status           TEXT  [aberto | pago | promessa | sem_resposta]
  data_promessa    DATE (nullable)
  criado_em        TIMESTAMP

interacoes
  id               UUID (PK)
  titulo_id        UUID (FK → titulos)
  mensagem_enviada TEXT
  data_envio       TIMESTAMP
  resultado        TEXT
```

---

## Stack técnica

| Camada | Tecnologia |
|---|---|
| Framework | Next.js 16 (App Router) |
| UI | React 19 + Tailwind CSS v4 |
| Linguagem | TypeScript |
| Banco de dados | Supabase (PostgreSQL) |
| Parse de CSV | PapaParse |
| Autenticação | Cookie HTTP-only + middleware |

---

## Configuração para desenvolvedores

### 1. Pré-requisitos

- Node.js 18+
- Uma conta no [Supabase](https://supabase.com) (plano gratuito funciona)

### 2. Criar o banco de dados

No painel do Supabase, vá em **SQL Editor** e execute, nesta ordem:

```
supabase/schema.sql
supabase/rls.sql
```

Se o banco **já existia** antes desta versão, rode também:

```
supabase/migration-01-ciclo-operacional.sql
```

Ele adiciona `silenciado_ate` e `resolvido_em` em `titulos` — colunas que o `schema.sql` não cria
em bancos existentes (ele usa `create table if not exists`). Sem elas, o card "Recuperado" mostra
"—" e registrar o resultado de um título falha com erro explícito.

O `schema.sql` cria as três tabelas (`clientes`, `titulos`, `interacoes`) e os índices necessários. O `rls.sql` habilita Row Level Security nelas — **passo obrigatório**: sem ele, qualquer pessoa que obtenha a URL do projeto e a chave anônima do Supabase consegue ler e escrever nas tabelas. Com RLS habilitado e nenhuma política criada, esse acesso fica bloqueado e o app continua funcionando porque fala com o banco pelo servidor, usando a `service_role`.

### 3. Variáveis de ambiente

Copie o arquivo de exemplo e preencha com os dados do seu projeto Supabase:

```bash
cp .env.local.example .env.local
```

São três variáveis, todas obrigatórias:

```env
# Supabase → Settings > API > Project URL
NEXT_PUBLIC_SUPABASE_URL=

# Supabase → Settings > API > Project API keys > service_role
# NUNCA prefixar com NEXT_PUBLIC_. É a única forma do app acessar o banco
# depois que RLS está habilitado (passo 2), porque ela ignora RLS por
# definição e só é usada no servidor — nunca é enviada ao navegador.
SUPABASE_SERVICE_ROLE_KEY=

# Senha de acesso ao painel — defina uma senha real antes de rodar.
APP_PASSWORD=
```

> A chave anônima (`NEXT_PUBLIC_SUPABASE_ANON_KEY`) **não é mais necessária** — nenhum código a
> lê desde que o acesso ao banco passou a ser exclusivamente pela `service_role` no servidor.

> **`APP_PASSWORD` em branco:** em desenvolvimento, o app roda sem pedir login (conveniente, e o
> risco é local). Em produção (`NODE_ENV=production`) o app **se recusa a servir** e responde 503
> até a variável ser definida — deixar dados de clientes acessíveis sem autenticação por descuido
> de configuração não é um modo de falha aceitável.

### 4. Instalar e rodar

```bash
npm install
npm run dev
```

Acesse [http://localhost:3000](http://localhost:3000).

### 5. Outros comandos

```bash
npm run build   # gera build de produção
npm run start   # serve o build de produção
npm run lint    # verifica o código com ESLint
npm run test    # roda os testes automatizados (vitest)
```

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
│   └── api/
│       ├── login/route.ts                # Autenticação
│       ├── upload-csv/route.ts           # Prévia do CSV (só leitura, não grava nada)
│       ├── upload-csv/confirmar/route.ts # Confirmação — grava clientes e títulos no banco
│       └── dados/route.ts                # Estatísticas e limpeza
├── components/
│   ├── ClienteCard.tsx        # Card do cliente — agrupa títulos, mensagem e envio de WhatsApp consolidados
│   ├── TituloCard.tsx         # Linha de um título individual, dentro do ClienteCard
│   ├── Navbar.tsx             # Barra de navegação
│   └── NavbarWrapper.tsx      # Oculta navbar na tela de login
├── lib/
│   ├── supabase.ts            # Cliente do banco de dados (service_role, só no servidor)
│   ├── prioridade.ts          # Priorização, agrupamento e ciclo de vida do título (estaNaFilaHoje)
│   ├── recuperacao.ts         # Apuração da receita recuperada
│   ├── csv-import.ts          # Aliases de coluna, normalização e validação do CSV
│   ├── format.ts              # Formatação de moeda compartilhada
│   ├── templates.ts           # Templates das mensagens de cobrança (individuais e consolidadas)
│   └── *.test.ts              # Testes do domínio (prioridade, recuperacao, csv-import)
├── actions/
│   └── index.ts               # Server actions para registrar envio e atualizar status
├── types/
│   └── index.ts               # Tipos TypeScript compartilhados
└── proxy.ts                   # Middleware de autenticação

supabase/
├── schema.sql                            # DDL — banco novo
├── rls.sql                               # Habilita RLS (rodar depois do schema)
└── migration-01-ciclo-operacional.sql    # Colunas do ciclo — bancos já existentes
```

---

## Roteiro de teste (para testadores)

Siga estes passos para validar o funcionamento completo do sistema:

### Cenário 1 — Fluxo completo

1. Acesse o sistema e faça login com a senha fornecida.
2. Vá em **"+ Importar CSV"** e suba um arquivo `.csv` (modelo na seção de upload acima).
3. Clique em **"Analisar planilha"** e confira a prévia: número de títulos prontos, duplicatas, colunas identificadas e a análise financeira. Nada foi gravado no banco ainda nesse ponto.
4. Clique em **"Confirmar importação"** e confirme que o relatório final mostra o número correto de títulos importados.
5. Clique em **"Ver lista do dia"** e verifique se os clientes aparecem nas seções corretas (vencidos vs. a vencer).
6. Em um cliente vencido, clique em **"Enviar via WhatsApp"** e confirme que o WhatsApp abre com a mensagem consolidada pré-preenchida (se o cliente tiver mais de um título em aberto, a mensagem deve citar todos).
7. Volte ao Atlas e, num dos títulos daquele cliente, registre o resultado como **"Pago"**. Aquele título deve desaparecer da lista — o card do cliente continua visível se ele ainda tiver outros títulos em aberto.
8. Repita com **"Prometeu pagar"** — deve pedir uma data antes de confirmar.
9. Repita com **"Sem resposta"** — deve desaparecer sem pedir data.

### Cenário 2 — Histórico do cliente

1. Na lista do dia, clique no nome de um cliente.
2. Verifique se o histórico mostra todos os títulos e as interações registradas com data/hora.

### Cenário 3 — Deduplicação no CSV

1. Suba o mesmo arquivo CSV duas vezes (analisando e confirmando a primeira).
2. Na segunda vez, já na etapa de prévia (antes de confirmar), o sistema deve informar que X título(s) seriam ignorados por duplicação.

### Cenário 4 — CSV com colunas diferentes

1. Crie um CSV onde as colunas se chamam `sacado`, `celular`, `vl_titulo`, `vencimento` (em vez dos nomes padrão).
2. Importe e verifique se o sistema detecta as colunas corretamente e importa sem erros.

### Cenário 5 — Ciclo de vida: nada some sem ser pago

1. Num título da lista, registre **"Prometeu pagar"** com a data de **ontem**.
2. Recarregue a lista do dia: o título deve **reaparecer**, com a marca "prometeu e não pagou".
3. Registre **"Sem resposta"**: o título sai da lista. Ele volta sozinho após 3 dias, marcado com
   "sem resposta antes" (para conferir sem esperar, dá para ajustar `silenciado_ate` no banco).
4. Registre **"Pago"**: o título sai da lista e **não volta mais**.
5. Confirme que o card **Recuperado** subiu exatamente o valor daquele título.

### Cenário 6 — Limpeza de dados

1. Acesse **"Dados"** na barra de navegação.
2. Confirme os números exibidos.
3. Use **"Limpar títulos pagos"** e verifique que os títulos em promessa/sem resposta **permanecem**
   — só os pagos devem sumir.
4. Use **"Limpar tudo"** para resetar o sistema ao estado inicial.

---

## Limitações conhecidas do v0

- A autenticação é por senha única (não há usuários individuais nem separação por empresa).
- Não há envio automático de mensagens — o WhatsApp é aberto manualmente.
- Não há notificações ou lembretes agendados: a reentrada de um título acontece quando você abre
  a lista do dia, não por aviso ativo.
- A exportação de relatórios não está implementada.
- Não há paginação na lista do dia (todos os títulos urgentes são exibidos de uma vez).

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
