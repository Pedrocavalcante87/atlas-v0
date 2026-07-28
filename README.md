# Atlas v0 — Painel de Cobrança

> Guia completo do projeto: o que é, como funciona e como usar.  
> Este documento é destinado tanto ao **desenvolvedor** quanto ao **testador**.

---

## O que é o Atlas?

O Atlas é um painel web de cobrança pensado para pequenos negócios — prestadores de serviço, lojas, clínicas ou qualquer empresa que precise cobrar clientes com títulos em aberto (boletos, parcelas, mensalidades).

O problema que ele resolve é simples e comum: **quem ligar primeiro hoje?** Sem uma ferramenta, o cobrador precisa varrer planilhas, calcular manualmente quem está mais atrasado, escrever mensagens individualmente e torcer para não esquecer ninguém.

O Atlas faz tudo isso automaticamente:

1. Você sobe uma planilha CSV com os títulos do dia.
2. O sistema calcula quem tem prioridade (baseado em dias de atraso e valor em risco).
3. Exibe uma lista ordenada com a mensagem de cobrança já escrita para cada cliente.
4. Com um clique você abre o WhatsApp com a mensagem pronta.
5. Você registra o resultado (pago, prometeu, sem resposta) e o título sai da lista.

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

> **Para testadores:** se o ambiente não tiver senha configurada (desenvolvimento local), o login é ignorado e você entra direto.

---

### 2. Lista do Dia (`/` — página inicial)

É a tela central do sistema. Ao abrir, ela já mostra **somente os títulos urgentes do dia**, sem precisar filtrar nada.

**Cards de resumo no topo:**

| Card | O que mostra |
|---|---|
| **Vencidos** | Quantidade de títulos já em atraso |
| **A vencer** | Títulos que vencem hoje ou nos próximos 3 dias |
| **Em risco** | Soma em reais de todos os títulos vencidos |

**Seções da lista:**

- 🔴 **Vencidos — cobrar hoje**: Títulos já passados do vencimento, ordenados por prioridade (quem está há mais tempo com valor maior aparece primeiro).
- 🟡 **A vencer — enviar lembrete**: Títulos que vencem hoje ou em até 3 dias, ordenados pelo mais próximo do vencimento.

> Títulos que vencem em mais de 3 dias **não aparecem** — o sistema só mostra o que é urgente.

**Dentro de cada card de título:**

- Nome do cliente (clicável → abre o histórico)
- Valor em destaque
- Badge indicando quantos dias em atraso ou quantos dias faltam
- A **mensagem de cobrança gerada automaticamente** (texto pronto para copiar ou enviar)
- Botão **"Enviar via WhatsApp"** — abre o WhatsApp já com a mensagem preenchida
- Botões de resultado: **Pago**, **Prometeu pagar**, **Sem resposta**

Ao registrar um resultado, o título desaparece da lista imediatamente.

---

### 3. Importar Planilha (`/upload`)

Tela para subir um arquivo CSV com os títulos de cobrança.

**Como funciona o upload:**

1. Você seleciona o arquivo `.csv`.
2. O sistema mostra um preview local (quantas linhas e qual separador foi detectado).
3. Ao clicar em "Importar títulos", o arquivo é processado no servidor.
4. O resultado mostra quantos títulos foram importados, duplicatas ignoradas e eventuais avisos por linha.

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
- Total de títulos em aberto
- Total de títulos concluídos
- Total geral de títulos
- Total de interações registradas
- Valor total em risco (soma dos títulos em aberto)

**Ações de limpeza:**

| Ação | O que remove |
|---|---|
| Limpar títulos concluídos | Títulos com status pago, prometeu ou sem resposta. Clientes e títulos em aberto são preservados. |
| Limpar tudo | Remove absolutamente todos os dados (clientes, títulos, interações). O sistema volta ao estado inicial. |

> ⚠️ Ambas as ações são **irreversíveis**. Há uma etapa de confirmação antes de executar.

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
- **A vencer:** ordenados pelo **vencimento mais próximo**.

Exemplo: um título de R$ 200 com 10 dias de atraso (score = 2.000) perde prioridade para um de R$ 500 com 5 dias (score = 2.500).

---

## Mensagens geradas automaticamente

O sistema usa três templates, um para cada categoria:

| Categoria | Mensagem |
|---|---|
| Preventivo | *"Oi [nome]! Passando pra lembrar que seu pagamento de R$ [valor] vence em [X] dias. Qualquer dúvida, só chamar!"* |
| Atraso leve | *"Oi [nome], tudo bem? Notei que o pagamento de R$ [valor], que venceu dia [data], ainda tá em aberto. Consegue regularizar ou prefere combinar uma nova data?"* |
| Atraso longo | *"Oi [nome], o pagamento de R$ [valor] está em atraso há [X] dias. Preciso resolver isso com você — pode me passar uma data certa pra pagamento?"* |

O template preenche automaticamente: primeiro nome do cliente, valor formatado em R$, data de vencimento e quantidade de dias.

---

## Status dos títulos

| Status | Significado |
|---|---|
| `aberto` | Pendente — aparece na lista do dia |
| `pago` | Confirmado como pago — sai da lista |
| `promessa` | Cliente prometeu pagar em uma data específica — sai da lista |
| `sem_resposta` | Contato feito, sem retorno — sai da lista |

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

No painel do Supabase, vá em **SQL Editor** e execute o conteúdo do arquivo:

```
supabase/schema.sql
```

Isso cria as três tabelas (`clientes`, `titulos`, `interacoes`) e os índices necessários.

### 3. Variáveis de ambiente

Copie o arquivo de exemplo e preencha com os dados do seu projeto Supabase:

```bash
cp .env.local.example .env.local
```

```env
# Supabase → Settings > API
NEXT_PUBLIC_SUPABASE_URL=https://seu-projeto.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sua-chave-anonima-aqui

# Senha de acesso ao painel (remova ou deixe vazio para desabilitar)
APP_PASSWORD=sua-senha-aqui
```

> Se `APP_PASSWORD` não for definida, o sistema funciona sem autenticação — ideal para desenvolvimento local.

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
```

---

## Estrutura de pastas

```
src/
├── app/
│   ├── page.tsx               # Lista do dia (home)
│   ├── login/page.tsx         # Tela de login
│   ├── upload/page.tsx        # Importar CSV
│   ├── dados/page.tsx         # Gerenciar dados
│   ├── clientes/[id]/page.tsx # Histórico do cliente
│   └── api/
│       ├── login/route.ts     # Autenticação
│       ├── upload-csv/route.ts # Processamento do CSV
│       └── dados/route.ts     # Estatísticas e limpeza
├── components/
│   ├── TituloCard.tsx         # Card de cada título na lista
│   ├── Navbar.tsx             # Barra de navegação
│   └── NavbarWrapper.tsx      # Oculta navbar na tela de login
├── lib/
│   ├── supabase.ts            # Cliente do banco de dados
│   ├── prioridade.ts          # Algoritmo de priorização
│   └── templates.ts           # Templates das mensagens de cobrança
├── actions/
│   └── index.ts               # Server action para atualizar status
├── types/
│   └── index.ts               # Tipos TypeScript compartilhados
└── proxy.ts                   # Middleware de autenticação
```

---

## Roteiro de teste (para testadores)

Siga estes passos para validar o funcionamento completo do sistema:

### Cenário 1 — Fluxo completo

1. Acesse o sistema e faça login com a senha fornecida.
2. Vá em **"+ Importar CSV"** e suba um arquivo `.csv` (modelo na seção de upload acima).
3. Confirme que a mensagem de sucesso mostra o número correto de títulos importados.
4. Clique em **"Ver lista do dia"** e verifique se os títulos aparecem nas seções corretas (vencidos vs. a vencer).
5. Em um título vencido, clique em **"Enviar via WhatsApp"** e confirme que o WhatsApp abre com a mensagem pré-preenchida.
6. Volte ao Atlas e registre o resultado como **"Pago"**. O card deve desaparecer da lista.
7. Repita com **"Prometeu pagar"** — deve pedir uma data antes de confirmar.
8. Repita com **"Sem resposta"** — deve desaparecer sem pedir data.

### Cenário 2 — Histórico do cliente

1. Na lista do dia, clique no nome de um cliente.
2. Verifique se o histórico mostra todos os títulos e as interações registradas com data/hora.

### Cenário 3 — Deduplicação no CSV

1. Suba o mesmo arquivo CSV duas vezes.
2. Na segunda importação, o sistema deve informar que X título(s) foram ignorados por duplicação.

### Cenário 4 — CSV com colunas diferentes

1. Crie um CSV onde as colunas se chamam `sacado`, `celular`, `vl_titulo`, `vencimento` (em vez dos nomes padrão).
2. Importe e verifique se o sistema detecta as colunas corretamente e importa sem erros.

### Cenário 5 — Limpeza de dados

1. Acesse **"Dados"** na barra de navegação.
2. Confirme os números exibidos.
3. Use **"Limpar títulos concluídos"** e verifique que apenas os em aberto permanecem.
4. Use **"Limpar tudo"** para resetar o sistema ao estado inicial.

---

## Limitações conhecidas do v0

- A autenticação é por senha única (não há usuários individuais).
- Não há envio automático de mensagens — o WhatsApp é aberto manualmente.
- Não há notificações ou lembretes agendados.
- A exportação de relatórios não está implementada.
- Não há paginação na lista do dia (todos os títulos urgentes são exibidos de uma vez).
