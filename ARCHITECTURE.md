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
| **Layout / navegação** | `src/app/layout.tsx`, `src/components/Navbar.tsx`, `src/components/NavbarWrapper.tsx` | Casca visual, esconde navbar no login |

Os módulos com limite de domínio bem definido e sem acesso direto ao banco são **priorização**
(`lib/prioridade.ts` + `lib/templates.ts`), **ingestão de CSV** (`lib/csv-import.ts`) e
**formatação** (`lib/format.ts`): recebem dados já carregados e devolvem dados derivados, sem I/O.
`lib/recuperacao.ts` é misto de propósito — a apuração (`somarRecuperado`,
`inicioJanelaRecuperacao`) é pura e testada; só `totalRecuperado` toca o banco, e é fino.

**Onde há teste automatizado**: `prioridade.test.ts`, `csv-import.test.ts`, `recuperacao.test.ts`.
`lib/templates.ts` e `lib/format.ts` **não têm** testes. Nenhuma rota, Server Action ou componente
React tem cobertura — a verificação deles é manual (`npm run dev`) ou via E2E ad-hoc.

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

Passo 2 — confirmação (grava no banco):
  upload/page.tsx --POST--> /api/upload-csv/confirmar
    body: { linhas: linhasValidas }   ← as MESMAS linhas devolvidas no passo 1, reenviadas
    → para cada linha: upsert em `clientes` (chave: telefone) → checa duplicata de novo → insert em `titulos`
    → responde JSON com relatório final
```

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
   --fetch GET--> /api/dados        → agregações (count/sum) direto no Supabase
   --fetch DELETE--> /api/dados?modo=tudo|concluidos → apaga linhas em cascata manual
```
Único fluxo do sistema em que a UI é Client Component chamando uma API Route via `fetch` em vez
de Server Component + Server Action.

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
  parsing de valor/data/telefone) agora têm suíte de testes (`vitest`, `npm run test`, 52 casos).
  Ainda sem cobertura: Server Actions (`actions/index.ts`), as rotas de API como integração
  (só testadas manualmente), e nenhum componente React. Mudar o corte de "7 dias" hoje quebraria
  um teste se divergisse entre os módulos que o usam — antes não haveria nenhum sinal.
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
- Se a mudança é sobre **exibir a lista do dia**, ela é composta por clientes (`ClienteCard`), não
  títulos soltos — um `TituloComPrioridade` sempre chega à tela dentro de um `ClienteAgrupado`.
  `TituloCard` tem um modo `compact` (usado dentro de `ClienteCard`) que esconde o botão de
  WhatsApp e a caixa de mensagem, porque o card do cliente já tem os dele, consolidados.
- Novas telas de leitura: o precedente majoritário é Server Component com query direta
  (`/dados` é a exceção histórica, não o padrão a seguir).
- **Antes de assumir que algo documentado aqui está de fato acontecendo em produção, confira se o
  componente/módulo é realmente importado por uma página** — este projeto já teve um caso real
  (`ClienteCard.tsx`) de uma funcionalidade inteira, bem construída e documentada no README, que
  nunca rodava porque nada a importava. `grep` pelo nome do componente/função antes de confiar.
