# Atlas — Arquitetura

> ⚠️ **Escopo deste documento**: ele descreve o estado da branch de trabalho atual, que pode estar
> à frente da `main`. Confira `git log --oneline main..HEAD` antes de assumir que o que está aqui
> já está mergeado. Uma auditoria encontrou afirmações deste arquivo que haviam ficado falsas —
> tratar documentação desatualizada como bug, não como tarefa cosmética.
>
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
| **Autenticação** | `src/proxy.ts`, `src/app/api/login/route.ts`, `src/app/login/page.tsx` | Gate por senha única (env var) + cookie httpOnly de 30 dias + rate limiting em memória |
| **Ingestão de CSV** | `src/app/api/upload-csv/route.ts`, `src/app/api/upload-csv/confirmar/route.ts`, `src/lib/csv-import.ts`, `src/app/upload/page.tsx` | Parse, normalização, validação (prévia e confirmação), dedup e gravação de títulos importados |
| **Domínio de priorização** | `src/lib/prioridade.ts`, `src/lib/templates.ts`, `src/types/index.ts` | Cálculo de urgência/score, agrupamento por cliente, geração de mensagens |
| **Formatação de exibição** | `src/lib/format.ts` | `formatarMoeda`, reaproveitado por todas as telas |
| **Lista do dia (apresentação)** | `src/app/page.tsx`, `src/components/ClienteCard.tsx`, `src/components/TituloCard.tsx` | Renderiza a fila priorizada agrupada por cliente e captura ações do usuário |
| **Histórico do cliente** | `src/app/clientes/[id]/page.tsx` | Leitura de títulos + interações de um cliente |
| **Mutação de estado** | `src/actions/index.ts` | Server Actions: registrar envio, atualizar status de título |
| **Administração** | `src/app/dados/page.tsx`, `src/app/api/dados/route.ts` | Estatísticas agregadas + limpeza destrutiva de dados (protegida por frase de confirmação) |
| **Acesso a dados** | `src/lib/supabase.ts` | Client Supabase único (service_role), lazy-init via Proxy |
| **Política de I/O** | `src/lib/supabase-io.ts` | Prazo (8s leitura / 15s escrita), classificação infra × banco, paginação por cursor, e leitura que lança em vez de devolver vazio |
| **Gravação da importação** | `src/lib/importacao.ts` | Máquina de estados que grava um lote convivendo com o índice único: conflito vira duplicata, e a conciliação final diz o que de fato ficou no banco. Recebe as operações de banco como parâmetro (`Portas`), então é testável com dublês |
| **Layout / navegação** | `src/app/layout.tsx`, `src/components/Navbar.tsx`, `src/components/NavbarWrapper.tsx` | Casca visual, esconde navbar no login |

Os módulos com limite de domínio bem definido e sem acesso direto ao banco são **priorização**
(`lib/prioridade.ts` + `lib/templates.ts`), **ingestão de CSV** (`lib/csv-import.ts`) e
**formatação** (`lib/format.ts`): recebem dados já carregados e devolvem dados derivados, sem I/O.
`lib/recuperacao.ts` é misto de propósito — a apuração (`somarRecuperado`,
`inicioJanelaRecuperacao`) é pura e testada; só `totalRecuperado` toca o banco, e é fino.

`lib/supabase-io.ts` é a única exceção deliberada ao "não existe camada de acesso a dados" (§12):
ele **não** conhece tabela, coluna nem regra de negócio, e quem chama continua montando a query com
`lib/supabase.ts` diretamente. O que ele centraliza é política — prazo, o que conta como "o banco
está fora", e paginação. Existe porque a alternativa (repetir `if (error)` em cada chamada) é
justamente o que falhou: `?? 0` espalhado por `/api/dados` transformava apagão em R$ 0,00.

**Onde há teste automatizado**: `prioridade.test.ts`, `csv-import.test.ts`, `recuperacao.test.ts`,
`supabase-io.test.ts`, `importacao.test.ts`. `lib/templates.ts` e `lib/format.ts` **não têm** testes. Nenhuma rota,
Server Action ou componente React tem cobertura — a verificação deles é manual (`npm run dev`) ou
via E2E ad-hoc.

---

## 3. Dependências entre módulos

```
app/page.tsx ──▶ lib/prioridade.ts ──▶ lib/templates.ts ──▶ types/index.ts
     │                │                                          ▲
     │                └──▶ ClienteCard.tsx ──▶ actions/index.ts ──┘
     │                          └──▶ TituloCard.tsx ──▶ actions/index.ts
     └──▶ lib/supabase.ts

upload/page.tsx ──▶ api/upload-csv (fetch) ──▶ lib/csv-import.ts + lib/prioridade.ts ──▶ lib/supabase.ts
                 └─▶ api/upload-csv/confirmar (fetch) ──▶ lib/csv-import.ts ──▶ lib/supabase.ts
                       (agora compartilham lib/csv-import.ts — confirmar revalida
                       estruturalmente cada linha antes de gravar, não confia no payload)

dados/page.tsx ──▶ api/dados (fetch) ──▶ lib/prioridade.ts (calcularDiasAtraso) + lib/supabase.ts

clientes/[id]/page.tsx ──▶ lib/format.ts + lib/supabase.ts
                       (não usa lib/prioridade.ts — ordena por data_vencimento, não por urgência,
                       o que faz sentido pra uma tela de histórico, não é bug)

proxy.ts — isolado, não depende de nenhum módulo de domínio
```

Pontos a notar:

- **`lib/supabase.ts` é o único nó compartilhado por quase todo o sistema** — 6 arquivos o
  importam diretamente. Não existe indireção entre eles.
- **`lib/prioridade.ts` agora é usado pela Lista do Dia E por `/api/dados`** (para "valor
  vencido"). O histórico do cliente (`clientes/[id]/page.tsx`) continua sem usá-lo — por design,
  não por descuido: lá a ordenação é cronológica (mais recente primeiro), não por urgência.
- **`ClienteCard.tsx` agora é renderizado por `app/page.tsx`** — antes existia no código
  (bem construído, com sua própria lógica de agrupamento e mensagem consolidada) mas não era
  importado por nenhuma página; a lista do dia renderizava títulos individuais direto. Era o maior
  gap entre o que o README descreve como comportamento do produto e o que de fato rodava.
- **As duas rotas de upload (`route.ts` e `confirmar/route.ts`) agora compartilham
  `lib/csv-import.ts`**: reconhecimento de coluna, normalização de valor/data/telefone e validação
  estrutural (`validarLinhaRecebida`) vivem lá. `confirmar/route.ts` não confia mais cegamente no
  payload que o browser reenvia — revalida cada linha antes de gravar (ver §9).

---

## 4. Fluxos de dados principais

### 4.1 Lista do dia (leitura + mutação)

```
Supabase: titulos JOIN clientes (status != pago)   ← o domínio é quem filtra a fila
   → priorizarTitulos()      [lib/prioridade.ts — estaNaFilaHoje decide quem entra;
                              calcula score, categoria, dias, mensagem, motivoReentrada]
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

Passo 2 — confirmação (grava no banco, EM LOTE):
  upload/page.tsx --POST--> /api/upload-csv/confirmar
    body: { linhas: linhasValidas }   ← as MESMAS linhas devolvidas no passo 1, reenviadas
    → revalida cada linha (validarLinhaRecebida)
    → upsert de clientes em lotes de 500 (chave: telefone), deduplicados por telefone
    → lê títulos 'aberto' dos clientes envolvidos, em lotes de 100 ids, paginado
    → planejarImportacao decide EM MEMÓRIA quem inserir e quem é duplicata
    → insert de títulos em lotes de 500
    → responde { resultado, count, duplicatas, naoGravadas, errors, message }
```

**O número de requisições não depende mais de N.** Antes eram 3 idas ao banco por linha (upsert,
consulta de duplicata, insert): 90 linhas custavam 270 requisições e 67s, com crescimento linear,
num endpoint que aceita até 20.000 linhas. Medido depois: 30 linhas 1,2s · 90 linhas 0,8s ·
300 linhas 1,5s. A fórmula passou a ser `ceil(U/500) + ceil(U/100) + ceil(I/500)` requisições,
com U = clientes únicos e I = títulos a inserir.

A decisão de quem inserir vive em `lib/csv-import.ts::planejarImportacao` — domínio puro, coberto
por teste. Duas regras que a versão em lote precisa manter e que os testes protegem:

1. **Duplicata dentro do próprio arquivo.** O loop antigo acertava por acidente de ordem (a
   segunda linha igual consultava o banco depois de a primeira ter sido inserida). Agora a chave
   de cada título aceito entra num conjunto em memória.
2. **Telefone repetido no mesmo `upsert`** derruba o comando inteiro com SQLSTATE 21000
   ("ON CONFLICT DO UPDATE command cannot affect row a second time"). Deduplicar por telefone é
   obrigatório, não otimização.

**A garantia de não-duplicidade é do banco.** `idx_titulos_aberto_unico`
(`supabase/migration-02`) impede um segundo título `aberto` com o mesmo
(cliente, valor, vencimento). `planejarImportacao` continua decidindo em memória, mas como
otimização e para *relatar* duplicatas — não como garantia: entre a consulta e o insert existe uma
janela, e ela foi explorada sem malícia nenhuma (duas abas). Medido antes do índice: duas
confirmações simultâneas de 40 linhas gravaram 80 títulos, ambas relatando "0 duplicatas"; na
versão linha a linha da `main`, 75.

Com o índice, o insert conflitante falha com **23505**, e `inserirComRetentativa` traduz isso para
o que significa no domínio — "alguém já gravou isto" — reconsultando o que existe e reenviando só
o que falta. O campo `duplicatas` soma as duas origens (detectadas na leitura + detectadas na
gravação). A contagem de gravados vem de `.select('id')` no insert, ou seja, do que o banco
aceitou, não do que foi pedido.

**Contrato de resposta** — `resultado` é `completo` | `parcial` | `indisponivel`. HTTP 200 para os
dois primeiros (rejeição de linha por dado ruim é resposta legítima de import em lote); **503**
para `indisponivel`. Como a gravação não é transacional, um 503 pode vir com `count > 0`: parte
entrou antes da queda. A resposta diz quantos, e reimportar o mesmo arquivo é seguro — a checagem
de duplicata torna a operação idempotente. Verificado de ponta a ponta: 500 de 600 gravados numa
queda injetada, reimportação inseriu exatamente os 100 que faltavam e contou 500 duplicatas.

Sequela conhecida e benigna de uma importação interrompida: os clientes do lote são criados antes
dos títulos, então pode sobrar cliente sem título nenhum. Ele não aparece em lugar nenhum da UI
(tudo parte de `titulos`), só infla a contagem de clientes em `/dados`, e a reimportação o
reaproveita pelo telefone.

O dado que será persistido sai do servidor (passo 1), passa pelo browser e volta ao servidor
(passo 2) — por isso **não é confiável**. Os dois passos aplicam a mesma
`lib/csv-import.ts::validarLinhaRecebida`: o passo 1 como portão final antes de prometer ao
usuário "N títulos prontos", o passo 2 como borda de confiança antes de gravar. Chamar a mesma
função nos dois lugares garante por construção que a prévia nunca aprove uma linha que a gravação
recuse — antes cada lado tinha regras próprias (telefone `>= 8` dígitos vs. `10-15`) e a diferença
virava descarte silencioso na hora de gravar.

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
   --fetch GET--> /api/dados        → agregações (count/sum) + lib/recuperacao.ts::totalRecuperado
   --fetch DELETE--> /api/dados?modo=tudo|concluidos → apaga linhas em cascata manual
                     modo=concluidos apaga SOMENTE status='pago' (ver §5)
                     modo=tudo exige a frase "EXCLUIR TUDO" no corpo (ver §9)
```
Único fluxo do sistema em que a UI é Client Component chamando uma API Route via `fetch` em vez
de Server Component + Server Action.

**`GET /api/dados` responde 200 com as estatísticas ou 503 `{ error, indisponivel: true }`.** Não
existe resposta intermediária: se qualquer uma das leituras falhar, a rota inteira devolve 503. Sete
números certos e um errado, exibidos juntos como se todos fossem verdade, é pior do que dizer que a
tela está indisponível. A única exceção é `valorRecuperado`, que continua podendo vir `null` (UI
mostra "—") quando o banco responde que a coluna `resolvido_em` não existe — isso é limitação
conhecida de schema, não ausência de informação.

Enquanto o estado do banco é desconhecido, a tela esconde as estatísticas **e a zona de perigo**:
era possível ver "0 títulos" por falha de leitura e clicar em "Limpar tudo" logo abaixo.

---

## 5. Onde estão as regras de negócio

| Regra | Onde vive | Observação |
|---|---|---|
| Categorização por urgência (>7d atraso / 1-7d / vence em ≤3d) | `lib/prioridade.ts::categorizarTitulo` | Fonte oficial do domínio — reaproveitada em `api/upload-csv/route.ts` e `api/dados/route.ts` |
| Score de priorização (`dias × valor`) | `lib/prioridade.ts::priorizarTitulos` | Único lugar que calcula score |
| Agrupamento por cliente + mensagem consolidada | `lib/prioridade.ts::agruparPorCliente`, `lib/templates.ts::gerarMensagemConsolidada` | Centralizado **e renderizado** (`ClienteCard.tsx`, usado por `app/page.tsx`) |
| Templates de mensagem | `lib/templates.ts` | Centralizado |
| Reconhecimento de colunas do CSV (aliases) | `lib/csv-import.ts::COLUMN_ALIASES` | Compartilhado por prévia e confirmação |
| Normalização de valor/data/telefone do CSV | `lib/csv-import.ts` | Módulo de domínio sem I/O, testado (`csv-import.test.ts`) |
| Revalidação estrutural de linha recebida | `lib/csv-import.ts::validarLinhaRecebida` | Usada por `confirmar/route.ts` antes de gravar — não existia antes |
| Regra de duplicata na importação | `api/upload-csv/route.ts` (em memória) **e** `api/upload-csv/confirmar/route.ts` (query) | Implementada duas vezes **por design**: a segunda é uma checagem de segurança porque o estado pode ter mudado entre a prévia e a confirmação, não uma duplicação acidental |
| "Valor vencido" nas estatísticas administrativas | `api/dados/route.ts` (via `calcularDiasAtraso`) | Reaproveita a fonte oficial — antes comparava strings ISO com lógica própria |
| Formatação de moeda | `lib/format.ts::formatarMoeda` | Centralizado — antes reimplementado em 6 arquivos |
| Autenticação | `proxy.ts` + `api/login/route.ts` | Rate limiting em memória + comparação constant-time |

A regra de negócio mais importante do sistema (o que é "urgente") tem uma única implementação,
reaproveitada em todos os pontos que precisam dela — inclusive `TituloCard.tsx`, que usa
`titulo.categoria` em vez de re-derivar os cortes (durante um período ele reimplementava `> 7` /
`>= 1 && <= 7` por conta própria, apesar deste documento afirmar o contrário).

### Ciclo de vida do título (regra central, adicionada no ciclo "ciclo operacional")

**Só `pago` é terminal.** `promessa` e `sem_resposta` tiram o título da fila temporariamente:

| Status | Sai da fila? | Volta quando |
|---|---|---|
| `aberto` | não, se urgente | — |
| `promessa` | até `data_promessa` | a data prometida chega |
| `sem_resposta` | até `silenciado_ate` | o silêncio expira (`DIAS_SILENCIO_SEM_RESPOSTA`) |
| `pago` | permanentemente | nunca |

Quem decide é `lib/prioridade.ts::estaNaFilaHoje`, avaliado **na leitura** — não existe cron,
worker ou fila. A home busca `.neq('status','pago')` e o domínio filtra. Um título que reentra
entra mesmo com vencimento distante: o compromisso assumido vence o corte de "ainda não é urgente".

**Consequência que já quebrou código**: "concluído" deixou de ser `status != 'aberto'`. Toda query
que significa "ainda devido" usa `status != 'pago'`. O `DELETE ?modo=concluidos` apagava
`.neq('status','aberto')` — o que passaria a destruir títulos em follow-up junto com o histórico
deles.

---

## 6. Duplicações (resolvidas e restantes)

**Resolvidas nesta rodada:**

- Formatação de moeda — centralizada em `lib/format.ts::formatarMoeda`, reaproveitada pelos 6
  arquivos que antes reimplementavam `toLocaleString('pt-BR', {style:'currency', currency:'BRL'})`.
- Corte de urgência (categorização) — `api/upload-csv/route.ts` (breakdown da prévia) e
  `api/dados/route.ts` (`valorVencido`) agora chamam `lib/prioridade.ts::categorizarTitulo` /
  `calcularDiasAtraso` em vez de reimplementar o corte cada um à sua maneira.
- Reconhecimento de coluna e normalização de CSV — movidos de `api/upload-csv/route.ts` para
  `lib/csv-import.ts`, reaproveitado por `confirmar/route.ts` para revalidar (ver §9).
- `ClienteCard` recalculava a faixa de urgência a partir de `diasAtrasoMax` em vez de usar
  `categoriaMaisUrgente` (já calculado por `agruparPorCliente`) — agora reaproveita o campo.

**Ainda existem, por razão explícita:**

- **`lib/templates.ts::gerarMensagemConsolidada`** (ramo de título único) ainda recalcula dias de
  atraso com a mesma lógica de `calcularDiasAtraso` em vez de importá-la — `lib/templates.ts` é
  importado por `lib/prioridade.ts`, então importar na direção contrária criaria um ciclo entre os
  dois módulos. Resolver isso exigiria mover `calcularDiasAtraso` pra um terceiro módulo — trade-off
  não feito nesta rodada por afetar a localização de uma regra de domínio central sem ganho
  imediato (as duas implementações são idênticas, não há evidência de terem divergido).
- **Regra de duplicata de título** continua implementada duas vezes (em memória na prévia, via
  query na confirmação) — isso é intencional, não uma duplicação por descuido: a confirmação
  precisa reconferir porque o estado do banco pode ter mudado entre a prévia e a confirmação.
- **Detecção de separador de CSV em duas implementações**: uma ingênua no browser
  (`upload/page.tsx::analisarCSVLocal`, só olha se a primeira linha contém `;`/tab/vírgula, usada
  só pra um preview instantâneo antes do POST) e outra via PapaParse no servidor (autoritativa).
  Podem divergir em arquivos com campos entre aspas — impacto baixo porque o preview do browser é
  só informativo, o servidor decide de verdade.

---

## 7. Pontos de acoplamento

- **Acoplamento direto ao Supabase em 6 arquivos** — nomes de tabela e coluna como strings soltas
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
- ~~Fonte de verdade da urgência dividida~~ — **resolvido**: `api/upload-csv/route.ts` e
  `api/dados/route.ts` agora chamam `lib/prioridade.ts` em vez de decidir por conta própria.
- ~~Validação de negócio existe só no passo de prévia~~ — **resolvido**: `confirmar/route.ts`
  agora revalida estruturalmente cada linha (`lib/csv-import.ts::validarLinhaRecebida`) antes de
  gravar, em vez de confiar no payload que o browser reenvia (ver §9).

---

## 9. Observações de segurança

### Corrigido nesta rodada

- **`lib/supabase.ts` usava a chave ANÔNIMA (`NEXT_PUBLIC_SUPABASE_ANON_KEY`), não a
  `service_role`, desde o commit inicial do projeto** — apesar de `supabase/rls.sql` e o restante
  da documentação sempre terem descrito o modelo de segurança como "RLS habilitado sem políticas +
  service_role só no servidor". Isso nunca foi pego porque não havia teste nem checagem que
  comparasse código e doc. Duas consequências possíveis, dependendo se `rls.sql` chegou a ser
  aplicado no projeto Supabase real: (a) toda leitura/escrita ficaria bloqueada por RLS e o app
  pareceria "vazio" sem erro óbvio, ou (b) se RLS nunca foi aplicado, qualquer tabela ficaria
  acessível com a chave anônima — que é pública por design do Supabase — sem controle de acesso
  nenhum, expondo nome/telefone/valores de todos os clientes. **Corrigido em `lib/supabase.ts`**:
  agora usa `SUPABASE_SERVICE_ROLE_KEY` e falha alto e explicitamente se a variável não estiver
  definida, em vez de silenciosamente usar uma chave errada.
- **`POST /api/upload-csv/confirmar` agora revalida cada linha** (`lib/csv-import.ts::validarLinhaRecebida`)
  antes de gravar — formato de telefone, faixa de valor, formato e faixa de data. Um request
  autenticado montado manualmente com dados fora desse formato é rejeitado, em vez de gravado
  como estava antes.
- **Comparação de senha agora é constant-time** (`crypto.timingSafeEqual` em `api/login/route.ts`).
- **Rate limiting em memória no login** — 10 tentativas por IP a cada 5 minutos. Limitação
  conhecida: não sobrevive a restart do processo nem é compartilhado entre múltiplas instâncias;
  suficiente para o deploy de instância única do Atlas hoje, não para um deploy serverless/multi-
  instância (ver comentário no arquivo).
- **`DELETE /api/dados?modo=tudo` agora exige a frase `"EXCLUIR TUDO"` no corpo da requisição**,
  além da senha do app — eleva a barra de "só ter o cookie" pra "precisa conhecer o contrato exato
  da API", uma defesa em profundidade proporcional ao estágio do produto (não um fluxo de
  confirmação digitada pelo usuário, que seria mais fricção do que o risco justifica hoje).
- Cookie de sessão agora marcado `secure` em produção (`NODE_ENV === 'production'`).

### Ainda válidas / não endereçadas nesta rodada

- **`telefone` é a chave única de upsert de cliente** (`onConflict: 'telefone'`) — dois clientes
  reais com o mesmo número (erro de digitação, número corporativo compartilhado) se fundem
  silenciosamente sob o mesmo registro. Resolver isso é uma decisão de produto (permitir telefone
  duplicado? UI de merge de clientes?), não só técnica — não decidido silenciosamente aqui.
- Autenticação continua sendo uma senha única compartilhada (sem usuários individuais, sem
  trilha de auditoria de "quem fez o quê"). Aceitável para uma ferramenta de instância única e uso
  interno; se o Atlas evoluir para atender múltiplos clientes/tenants isolados, isso precisa virar
  autenticação de verdade com isolamento por tenant — mudança estrutural, não incremental (ver
  observação de produto no final deste documento).
- RLS está habilitado nas 3 tabelas sem nenhuma política (`supabase/rls.sql`), e todo acesso passa
  pela `service_role` key usada só no servidor (`lib/supabase.ts`, agora corrigido) — esse modelo
  é o correto para uma instância única sem Supabase Auth.

---

## 10. Pontos frágeis / difíceis de manter

- Sem camada de repositório: mudar um nome de coluna ou tabela exige busca manual em todos os
  arquivos que chamam `lib/supabase.ts`. Decisão consciente, não um descuido — ver §12.
- ~~Nenhum teste automatizado~~ — **parcialmente resolvido**: `lib/prioridade.ts` e
  `lib/csv-import.ts` (as duas áreas de maior risco financeiro/dado — score, categorização,
  parsing de valor/data/telefone) agora têm suíte de testes (`vitest`, `npm run test`, 127 casos,
  incluindo o planejamento da importação em lote, a reconciliação pós-conflito, a paginação por
  cursor e a classificação de falha de I/O).
  Ainda sem cobertura: Server Actions (`actions/index.ts`), as rotas de API como integração
  (só testadas manualmente), e nenhum componente React. Mudar o corte de "7 dias" hoje quebraria
  um teste se divergisse entre os módulos que o usam — antes não haveria nenhum sinal.
  **Lacuna parcialmente fechada**: a decisão de o que fazer diante de um conflito de concorrência
  saiu da rota para `lib/importacao.ts`, que recebe as operações de banco como parâmetro e por isso
  é testável com dublês (`importacao.test.ts`). Foi feito porque a versão anterior, embutida na
  rota, produziu dois defeitos que nenhum teste pegou — só a reprodução manual. **O que continua
  sem cobertura**: o encadeamento HTTP das rotas, o comportamento sob dependência fora, e a
  concorrência real contra o Postgres. Esses seguem provados apenas por reprodução manual.
- **A confirmação da importação não é transacional.** O PostgREST não expõe transação entre
  requisições, então uma queda no meio deixa parte dos títulos gravados. Isso é tolerável só porque
  a reimportação é idempotente (garantida pelo índice único, não só pela checagem em memória) e a
  resposta diz exatamente quantos entraram. Se algum dia isso precisar de rollback de verdade, o
  caminho é uma função RPC no Postgres, que é mudança de schema — não ajuste incremental.
- **`ON CONFLICT` do PostgREST não alcança índice parcial.** Verificado: `ignoreDuplicates` sem
  `onConflict` mira a PK e estoura 23505; e `onConflict` só aceita nomes de coluna, sem o predicado
  que o Postgres exige para inferir um índice parcial. Por isso a aplicação trata o 23505 em vez de
  pedir `DO NOTHING` — se um dia alguém quiser `DO NOTHING` de verdade aqui, o caminho é RPC.
- **A lista do dia renderiza todos os clientes da fila de uma vez.** Com 1149 títulos em base de
  teste, a home levou ~3,8s para montar 734 cards — o custo agora é render, não banco. Paginação de
  UI continua fora de escopo, mas passa a ser o próximo gargalo real de percepção.
- `upload/page.tsx` tem ~500 linhas, misturando estado de formulário, chamadas de rede e três
  componentes de apresentação (`PreviewReport`, `ConfirmedReport`, `BreakdownRow`) no mesmo arquivo.
  Não mexido nesta rodada — funcional, não é o gargalo atual.
- Rate limiting de login em memória (ver §9) não sobrevive a múltiplas instâncias — ok pra hoje,
  vira problema real se o deploy mudar de instância única pra serverless/múltiplas réplicas.

---

## 11. Partes incompletas ou com uso residual

**Documentadas como limitação de escopo do v0** (ver README): sem envio automático de mensagens,
sem agendamento/lembretes, sem exportação de relatórios, sem paginação na lista do dia,
autenticação de senha única sem usuários individuais.

**Notadas na leitura do código, não documentadas — status atual:**

- ~~`api/upload-csv/confirmar/route.ts` não tem validação de negócio própria~~ — **resolvido**,
  ver §9.
- ~~`categoriaMaisUrgente` não é lido em nenhum ponto da UI~~ — **resolvido**: `ClienteCard` agora
  usa `categoriaMaisUrgente` em vez de recalcular a partir de `diasAtrasoMax`.
- **`ClienteCard.tsx` existia desde o commit inicial mas nunca era renderizado por nenhuma
  página** — a lista do dia (`app/page.tsx`) sempre mostrou títulos individuais
  (`TituloCard`) direto, nunca agrupados por cliente, apesar do README descrever o agrupamento como
  o comportamento central do produto ("cobrar a PESSOA, não cada título"). **Resolvido**:
  `app/page.tsx` agora chama `agruparPorCliente()` e renderiza `ClienteCard`. Esse era o maior
  gap entre produto documentado e produto em execução — não estava registrado como bug nesta
  seção antes porque o diagrama de dependências (§3) já mostrava a desconexão, mas sem nomear o
  impacto de produto.
- A categoria "futuro" (vencimento em mais de 3 dias), calculada no breakdown da prévia de CSV, não
  é usada em nenhum outro lugar do sistema depois da importação — existe só para informar na tela
  de prévia. Continua assim — não é um problema, é intencional.
- Não há forma de editar um cliente ou título já importado (nome/telefone errado) pela aplicação —
  a única saída é apagar tudo em `/dados` ou alterar direto no banco. Não endereçado nesta rodada.
- **"Limpar títulos pagos" destrói o histórico da receita recuperada.** A ação apaga as linhas
  pagas, e com elas o `resolvido_em` que sustenta a apuração dos últimos 30 dias — o valor
  simplesmente sai do número. Não é bug (a ação é declaradamente irreversível e a UI avisa), mas
  passou a ter um custo que antes não existia. Se a apuração virar algo que a empresa acompanha
  ao longo do tempo, essa ação precisa ser repensada — decisão de produto, não tomada aqui.
- **Os templates de mensagem não sabem que houve promessa quebrada.** Um título que reentra usa o
  template da categoria de urgência dele. Para o caso comum (título vencido) o texto serve; para
  uma promessa sobre título ainda a vencer, a mensagem fala de vencimento e ignora o combinado.
  `motivoReentrada` existe no domínio e é exibido como badge, mas não influencia o texto gerado.

---

## 12. Resumo para quem for mexer no código

- Se a mudança é sobre **regra de priorização ou mensagem**, o lugar certo é `lib/prioridade.ts` /
  `lib/templates.ts` — agora é a única fonte, reaproveitada por `api/upload-csv/route.ts` e
  `api/dados/route.ts`. Rode `npm run test` depois de mexer: há cobertura pra isso.
- Se a mudança é sobre **importação de CSV**, o reconhecimento de coluna e a normalização vivem em
  `lib/csv-import.ts`, compartilhado por `route.ts` (prévia) e `confirmar/route.ts` (gravação, que
  revalida antes de escrever). Mudar a forma esperada de uma linha provavelmente exige atualizar
  `validarLinhaRecebida` também, senão a confirmação passa a rejeitar dados válidos.
- Se a mudança é sobre **acesso a dados**, não existe abstração para estender — é chamar
  `lib/supabase.ts` diretamente, como todo o resto do código já faz. Isso é decisão consciente
  de proporcionalidade pro estágio atual, não descuido — não introduza uma camada de repositório
  sem uma razão concreta (mais de uma implementação de storage, necessidade real de mock em teste
  de integração, etc.).
- Se a mudança é sobre **quem aparece na lista do dia**, a regra é `lib/prioridade.ts::estaNaFilaHoje`
  e o único estado terminal é `pago` (ver §5). Antes de escrever qualquer filtro por status,
  pergunte se ele significa "ainda devido" (`!= 'pago'`) ou "encerrado" (`== 'pago'`) — usar
  `'aberto'` como sinônimo de "ativo" já causou perda de dado neste projeto.
- Se a mudança é sobre **exibir a lista do dia**, ela é composta por clientes (`ClienteCard`), não
  títulos soltos — um `TituloComPrioridade` sempre chega à tela dentro de um `ClienteAgrupado`.
  `TituloCard` é sempre renderizado dentro de `ClienteCard` e por isso não tem botão de WhatsApp
  nem caixa de mensagem próprios: o card do cliente já tem os dele, consolidados.
- Novas telas de leitura: o precedente majoritário é Server Component com query direta
  (`/dados` é a exceção histórica, não o padrão a seguir).
- **Antes de assumir que algo documentado aqui está de fato acontecendo em produção, confira se o
  componente/módulo é realmente importado por uma página** — este projeto já teve um caso real
  (`ClienteCard.tsx`) de uma funcionalidade inteira, bem construída e documentada no README, que
  nunca rodava porque nada a importava. `grep` pelo nome do componente/função antes de confiar.
