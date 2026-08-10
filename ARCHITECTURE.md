# Atlas — Arquitetura

> Este documento descreve a arquitetura **real e atual** do projeto, como implementada no código.
> Não é uma arquitetura alvo/idealizada — onde o sistema tem inconsistências, duplicações ou
> soluções ad-hoc, isso está registrado aqui de propósito, para que qualquer pessoa que mexer
> no código saiba o que vai encontrar antes de encontrar.
>
> Para o que o produto faz e como usar, ver [README.md](README.md).

---

## 1. Visão geral

Atlas é uma aplicação Next.js (App Router) monolítica, sem backend separado: as "rotas de API"
do próprio Next.js fazem o papel de backend, falando diretamente com um banco Postgres gerenciado
(Supabase). Não há fila, worker, cache ou serviço externo além do banco.

```
Browser ──▶ Next.js (App Router)
              ├─ Server Components  ──┐
              ├─ Server Actions      ─┼──▶ Supabase (service_role) ──▶ Postgres
              ├─ API Routes         ──┘
              └─ Middleware (proxy.ts) — gate de autenticação por senha
```

Não existe camada de repositório/DAO. Toda leitura e escrita ao banco é feita chamando o client
Supabase diretamente do lugar que precisa do dado — Server Component, Server Action ou API Route.
Isso é uma escolha real do projeto, não um detalhe de implementação escondido: qualquer mudança de
schema exige localizar todos os pontos de chamada manualmente (ver §7).

---

## 2. Módulos / domínios

| Módulo | Arquivos | Responsabilidade |
|---|---|---|
| **Autenticação** | `src/proxy.ts`, `src/app/api/login/route.ts`, `src/app/login/page.tsx` | Gate por senha única (env var) + cookie httpOnly de 30 dias |
| **Ingestão de CSV** | `src/app/api/upload-csv/route.ts`, `src/app/api/upload-csv/confirmar/route.ts`, `src/app/upload/page.tsx` | Parse, normalização, dedup e gravação de títulos importados |
| **Domínio de priorização** | `src/lib/prioridade.ts`, `src/lib/templates.ts`, `src/types/index.ts` | Cálculo de urgência/score, agrupamento por cliente, geração de mensagens |
| **Lista do dia (apresentação)** | `src/app/page.tsx`, `src/components/ClienteCard.tsx`, `src/components/TituloCard.tsx` | Renderiza a fila priorizada e captura ações do usuário |
| **Histórico do cliente** | `src/app/clientes/[id]/page.tsx` | Leitura de títulos + interações de um cliente |
| **Mutação de estado** | `src/actions/index.ts` | Server Actions: registrar envio, atualizar status de título |
| **Administração** | `src/app/dados/page.tsx`, `src/app/api/dados/route.ts` | Estatísticas agregadas + limpeza destrutiva de dados |
| **Acesso a dados** | `src/lib/supabase.ts` | Client Supabase único (service_role), lazy-init via Proxy |
| **Layout / navegação** | `src/app/layout.tsx`, `src/components/Navbar.tsx`, `src/components/NavbarWrapper.tsx` | Casca visual, esconde navbar no login |

O único módulo com um limite de domínio bem definido e sem acesso direto ao banco é o de
**priorização** (`lib/prioridade.ts` + `lib/templates.ts`): recebe dados já carregados e devolve
dados derivados (score, categoria, mensagem), sem I/O. Todos os outros módulos misturam
apresentação, orquestração e acesso a dados no mesmo arquivo.

---

## 3. Dependências entre módulos

```
app/page.tsx ──▶ lib/prioridade.ts ──▶ lib/templates.ts ──▶ types/index.ts
     │                                                            ▲
     └──▶ lib/supabase.ts                                         │
                                                                    │
ClienteCard.tsx ──▶ actions/index.ts ──▶ lib/supabase.ts ──────────┘
     └──▶ TituloCard.tsx ──▶ actions/index.ts

upload/page.tsx ──▶ api/upload-csv (fetch) ──▶ lib/supabase.ts
                 └─▶ api/upload-csv/confirmar (fetch) ──▶ lib/supabase.ts
                       (os dois NÃO compartilham módulo de validação entre si)

dados/page.tsx ──▶ api/dados (fetch) ──▶ lib/supabase.ts
                       (não usa lib/prioridade.ts — recalcula métricas por conta própria)

clientes/[id]/page.tsx ──▶ lib/supabase.ts
                       (não usa lib/prioridade.ts)

proxy.ts — isolado, não depende de nenhum módulo de domínio
```

Pontos a notar:

- **`lib/supabase.ts` é o único nó compartilhado por quase todo o sistema** — 7 arquivos o
  importam diretamente. Não existe indireção entre eles.
- **`lib/prioridade.ts` só é usado pela Lista do Dia.** O histórico do cliente e a página de
  dados administrativos recalculam urgência/valores por conta própria, cada um com sua própria
  lógica (ver §6).
- **As duas rotas de upload (`route.ts` e `confirmar/route.ts`) são irmãs, não uma composição
  de módulos**: a lógica de normalização/validação existe só em `route.ts`; `confirmar/route.ts`
  recebe dados já processados e confia neles (ver §8).

---

## 4. Fluxos de dados principais

### 4.1 Lista do dia (leitura + mutação)

```
Supabase: titulos JOIN clientes (status = aberto)
   → priorizarTitulos()      [lib/prioridade.ts — calcula score, categoria, dias, mensagem]
   → agruparPorCliente()     [lib/prioridade.ts — agrupa por cliente_id, mensagem consolidada]
   → HomePage (Server Component)
   → ClienteCard / TituloCard (Client Components)
   → usuário clica "Enviar WhatsApp" ou marca status
   → Server Action (actions/index.ts)
   → grava em `interacoes` (sempre) e `titulos.status` (ao marcar resultado)
   → revalidatePath('/') + revalidatePath('/clientes', 'layout')
   → próxima navegação refaz o fetch do zero
```

Não há cache de aplicação — cada carregamento da home é uma query nova ao Supabase
(`revalidate = 0`, `dynamic = 'force-dynamic'`).

### 4.2 Importação de CSV (dois passos, com o browser como intermediário)

```
Passo 1 — prévia (somente leitura, nada é gravado):
  upload/page.tsx --POST--> /api/upload-csv
    → parse (PapaParse) → mapeia colunas por alias → normaliza valor/data/telefone
    → valida linha a linha → checa duplicata (query só de leitura)
    → responde JSON com `linhasValidas` + relatório (breakdown, colunas detectadas, erros)
  upload/page.tsx guarda `linhasValidas` em estado do componente (useState, no browser)

Passo 2 — confirmação (grava no banco):
  upload/page.tsx --POST--> /api/upload-csv/confirmar
    body: { linhas: linhasValidas }   ← as MESMAS linhas devolvidas no passo 1, reenviadas
    → para cada linha: upsert em `clientes` (chave: telefone) → checa duplicata de novo → insert em `titulos`
    → responde JSON com relatório final
```

O dado que será persistido sai do servidor (passo 1), passa pelo browser, e volta ao servidor
(passo 2) sem revalidação de formato/negócio no passo 2 além de "é um array não vazio" — ver §8.

### 4.3 Histórico do cliente (somente leitura)

```
Supabase: clientes (by id) + titulos JOIN interacoes (by cliente_id)
   → clientes/[id]/page.tsx (Server Component, renderização direta)
```
Não passa por `lib/prioridade.ts`; a ordenação por urgência/status não existe aqui — a ordenação
é por `data_vencimento` (mais recente primeiro).

### 4.4 Administração de dados (`/dados`)

```
dados/page.tsx (Client Component)
   --fetch GET--> /api/dados        → agregações (count/sum) direto no Supabase
   --fetch DELETE--> /api/dados?modo=tudo|concluidos → apaga linhas em cascata manual
```
Único fluxo do sistema em que a UI é Client Component chamando uma API Route via `fetch` em vez
de Server Component + Server Action.

---

## 5. Onde estão as regras de negócio

| Regra | Onde vive | Observação |
|---|---|---|
| Categorização por urgência (>7d atraso / 1-7d / vence em ≤3d) | `lib/prioridade.ts::categorizarTitulo` | Fonte "oficial" do domínio |
| Score de priorização (`dias × valor`) | `lib/prioridade.ts::priorizarTitulos` | Único lugar que calcula score |
| Agrupamento por cliente + mensagem consolidada | `lib/prioridade.ts::agruparPorCliente`, `lib/templates.ts::gerarMensagemConsolidada` | Centralizado |
| Templates de mensagem | `lib/templates.ts` | Centralizado |
| Reconhecimento de colunas do CSV (aliases) | `api/upload-csv/route.ts::COLUMN_ALIASES` | Só existe aqui, não é reaproveitado em lugar nenhum |
| Normalização de valor/data/telefone do CSV | `api/upload-csv/route.ts` (funções privadas do arquivo) | Não é módulo de domínio — é lógica de rota |
| Regra de duplicata na importação | `api/upload-csv/route.ts` (em memória) **e** `api/upload-csv/confirmar/route.ts` (query) | Implementada duas vezes, independentemente |
| Corte de urgência para o breakdown financeiro da prévia | `api/upload-csv/route.ts` (loop próprio) | Reimplementa o mesmo corte de `categorizarTitulo`, sem chamá-lo |
| "Valor vencido" nas estatísticas administrativas | `api/dados/route.ts` (comparação de string ISO) | Reimplementa de novo, com abordagem **diferente** das outras (ver §6) |
| Autenticação | `proxy.ts` + `api/login/route.ts` | Centralizado, simples |

A regra de negócio mais importante do sistema (o que é "urgente") está definida oficialmente em
um só lugar, mas é **reimplementada de forma independente em mais dois lugares** em vez de
reaproveitada.

---

## 6. Duplicações confirmadas

- **Cálculo de "dias de atraso/adiantamento" existe em 4 versões**:
  1. `lib/prioridade.ts::calcularDiasAtraso` — usa `Date` com `T12:00:00`, `Math.round`. Fonte oficial.
  2. `lib/templates.ts::gerarMensagemConsolidada` (ramo de título único) — copia a mesma lógica em vez de chamar (1).
  3. `api/upload-csv/route.ts` (loop do breakdown financeiro da prévia) — copia a lógica de novo.
  4. `api/dados/route.ts` (`valorVencido`) — **abordagem diferente**: compara strings ISO
     (`data_vencimento < hoje`) em vez de objetos `Date` com meio-dia fixo. Pode divergir de (1)-(3)
     em casos de borda de fuso horário.
- **Formatação de moeda (`toLocaleString('pt-BR', {style:'currency', currency:'BRL'})`) reimplementada
  6 vezes**: `page.tsx`, `dados/page.tsx`, `clientes/[id]/page.tsx`, `ClienteCard.tsx`, `TituloCard.tsx`,
  `upload/page.tsx`. Nenhuma versão centralizada em `lib/`.
- **Detecção de separador de CSV em duas implementações**: uma ingênua no browser
  (`upload/page.tsx::analisarCSVLocal`, só olha se a primeira linha contém `;`/tab/vírgula) e outra
  via PapaParse no servidor. Podem divergir em arquivos com campos entre aspas.
- **Regra de duplicata de título** implementada uma vez em memória (prévia) e de novo via query
  (confirmação) — mesma intenção, dois códigos.

---

## 7. Pontos de acoplamento

- **Acoplamento direto ao Supabase em 7+ arquivos** — nomes de tabela e coluna como strings soltas
  espalhadas pelo código (`.from('titulos')`, `.eq('status', 'aberto')`, etc.), sem abstração
  intermediária.
- **UI acoplada ao shape das respostas de API por convenção, não por tipo compartilhado** —
  `upload/page.tsx` declara `PreviewResult`/`ConfirmResult`/`LinhaValida` manualmente, duplicando
  (sem importar) o formato que as rotas de API realmente retornam. Uma mudança no backend não
  quebra a compilação do front — só quebra em runtime.
- **`revalidatePath('/')` / `revalidatePath('/clientes', 'layout')` hardcoded** em
  `actions/index.ts` — a Server Action conhece explicitamente as rotas da aplicação.
- **Casts manuais de tipo** (`as (Titulo & { clientes: Cliente })[]` em `page.tsx`) e tipos
  redefinidos inline em vez de importados (`clientes/[id]/page.tsx` redefine o shape de título
  localmente em vez de usar `types/index.ts`) — o compilador não pega divergência de schema.

---

## 8. Inconsistências arquiteturais

- **Padrão de leitura de dados não é único**: a maioria das páginas é Server Component com query
  direta ao Supabase (`page.tsx`, `clientes/[id]/page.tsx`); `dados/page.tsx` é a exceção — Client
  Component que busca via `fetch` numa API Route. Não há critério registrado em código para quando
  usar um ou outro.
- **Padrão de mutação não é único**: parte do sistema usa Server Actions
  (`actions/index.ts`, chamado pelos cards da lista do dia); parte usa API Routes chamadas via
  `fetch` no client (`/api/dados` DELETE, `/api/upload-csv*` POST). Os dois padrões coexistem.
- **Fonte de verdade da urgência dividida**: `lib/prioridade.ts` parece ter sido pensado como a
  autoridade do domínio, mas `api/upload-csv/route.ts` e `api/dados/route.ts` não passam por ele —
  cada um decide por conta própria o que é "vencido".
- **Validação de negócio existe só no passo de prévia da importação, não no de gravação**
  (ver §9) — arquiteturalmente, a rota que grava (`confirmar/route.ts`) deveria ser a borda de
  confiança, mas hoje quem valida é a rota anterior (`route.ts`), cujo resultado é confiado sem
  checagem.

---

## 9. Observações de segurança

- **`POST /api/upload-csv/confirmar` recebe os dados a gravar direto do corpo da requisição**,
  reenviados pelo browser a partir da resposta da prévia — a rota só checa se `linhas` é um array
  não vazio, sem revalidar telefone/valor/data. Um request autenticado (cookie válido) montado
  manualmente pode gravar dados que nunca passariam pela validação de `/api/upload-csv`.
- **Comparação de senha não é constant-time** (`body.password !== appPassword` em
  `api/login/route.ts`) — comparação de string direta.
- **Sem rate limiting perceptível no login** — nada no código limita tentativas repetidas de senha.
- **`DELETE /api/dados?modo=tudo`** (apaga todos os dados) tem como única proteção a mesma senha
  global do app — a confirmação "tem certeza?" existe apenas na UI (client-side); um request DELETE
  autenticado feito fora da UI executa a exclusão irreversível direto.
- **`telefone` é a chave única de upsert de cliente** (`onConflict: 'telefone'`) — dois clientes
  reais com o mesmo número (erro de digitação, número corporativo compartilhado) se fundem
  silenciosamente sob o mesmo registro.
- RLS está habilitado nas 3 tabelas sem nenhuma política (`supabase/rls.sql`), e todo acesso passa
  pela `service_role` key usada só no servidor (`lib/supabase.ts`) — esse ponto específico está
  bem resolvido e é a principal defesa contra acesso direto via chave anônima exposta no browser.

---

## 10. Pontos frágeis / difíceis de manter

- Sem camada de repositório: mudar um nome de coluna ou tabela exige busca manual em todos os
  arquivos que chamam `lib/supabase.ts`.
- As duplicações do §6 tornam fácil esquecer de atualizar um dos lugares ao mudar uma regra (ex.:
  mudar o corte de "7 dias" para outro valor exige lembrar de mexer em pelo menos 3 arquivos).
- Nenhum teste automatizado no projeto — `lib/prioridade.ts`, que concentra a lógica de data e
  ordenação mais sensível do domínio, depende inteiramente de verificação manual.
- `upload/page.tsx` tem ~500 linhas, misturando estado de formulário, chamadas de rede e três
  componentes de apresentação (`PreviewReport`, `ConfirmedReport`, `BreakdownRow`) no mesmo arquivo.

---

## 11. Partes incompletas ou com uso residual

**Documentadas como limitação de escopo do v0** (ver README): sem envio automático de mensagens,
sem agendamento/lembretes, sem exportação de relatórios, sem paginação na lista do dia,
autenticação de senha única sem usuários individuais.

**Notadas na leitura do código, não documentadas:**

- `api/upload-csv/confirmar/route.ts` não tem validação de negócio própria — depende inteiramente
  de que os dados já chegaram validados (relacionado ao ponto de segurança do §9).
- A categoria "futuro" (vencimento em mais de 3 dias), calculada no breakdown da prévia de CSV, não
  é usada em nenhum outro lugar do sistema depois da importação — existe só para informar na tela
  de prévia.
- Não há forma de editar um cliente ou título já importado (nome/telefone errado) pela aplicação —
  a única saída é apagar tudo em `/dados` ou alterar direto no banco.
- `categoriaMaisUrgente`, calculado em `agruparPorCliente()` (`lib/prioridade.ts`) e exposto no tipo
  `ClienteAgrupado` (`types/index.ts`), não é lido em nenhum ponto da UI — `ClienteCard` recalcula
  urgência localmente a partir de `diasAtrasoMax` em vez de usar esse campo. Parece campo morto.

---

## 12. Resumo para quem for mexer no código

- Se a mudança é sobre **regra de priorização ou mensagem**, o lugar certo é `lib/prioridade.ts` /
  `lib/templates.ts` — mas lembre que `api/upload-csv/route.ts` e `api/dados/route.ts` têm cópias
  próprias que não vão atualizar sozinhas.
- Se a mudança é sobre **importação de CSV**, ela provavelmente precisa tocar em dois arquivos
  (`route.ts` e `confirmar/route.ts`), porque não há módulo compartilhado entre prévia e gravação.
- Se a mudança é sobre **acesso a dados**, não existe abstração para estender — é chamar
  `lib/supabase.ts` diretamente, como todo o resto do código já faz.
- Novas telas de leitura: o precedente majoritário é Server Component com query direta
  (`/dados` é a exceção histórica, não o padrão a seguir).
