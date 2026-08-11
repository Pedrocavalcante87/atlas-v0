@AGENTS.md

# Atlas — Contexto para Claude Code

Painel de priorização de cobrança para pequenos negócios (CSV de títulos em aberto → lista
priorizada → mensagem pronta → WhatsApp manual → registro de resultado). Para o que o produto
faz, ver [README.md](README.md). Para arquitetura, módulos, fluxos de dados, duplicações e
inconsistências detalhadas, ver [ARCHITECTURE.md](ARCHITECTURE.md) — **não repita esse conteúdo
aqui, leia o documento**.

Este arquivo é sobre como atuar neste projeto especificamente, mais os fatos que uma sessão nova
precisa antes de tocar em qualquer coisa.

---

## Regras permanentes de atuação

1. **Entenda antes de alterar.** Antes de mexer em código relevante, identifique onde ele vive,
   quem o chama, quais dependências e contratos ele carrega, e que efeitos colaterais uma mudança
   pode ter. Não altere código só para descobrir como ele funciona — leia.
2. **Preserve o sistema existente.** O Atlas já existe e está em uso. Prefira mudanças
   incrementais e localizadas. Não refatore nem reorganize partes não relacionadas à tarefa pedida.
3. **Autonomia técnica.** Decisões pequenas e reversíveis não precisam de aprovação prévia —
   escolha com base em simplicidade, consistência com o que já existe, manutenibilidade, segurança
   e impacto, e prossiga.
4. **Mudanças arquiteturais exigem análise antes de código.** Se for estrutural, de alto impacto
   ou puder alterar um contrato (schema, formato de resposta de API, regra financeira), explique
   problema, evidência, alternativas, decisão e trade-offs antes de implementar.
5. **Separe fato de hipótese.** Fato = confirmado no código/config/teste/documentação. Hipótese =
   interpretação ainda não validada. Nunca apresente hipótese como se fosse fato.
6. **Não invente contexto.** Regra de negócio, requisito, comportamento de API ou intenção de
   design que não estiver no código ou na documentação não deve ser assumido — investigue ou
   sinalize a incerteza.
7. **Evite overengineering.** Sem abstrações prematuras, camadas ou dependências novas sem
   benefício concreto e imediato para a tarefa em mãos.
8. **Regras de negócio são contrato.** Antes de alterar cálculo de prioridade, categorização,
   templates de mensagem ou regra de deduplicação, veja quem consome (ver `lib/prioridade.ts` e
   `lib/templates.ts` em ARCHITECTURE.md §5). Mudança com efeito financeiro/operacional pede
   cautela extra.
9. **Segurança é requisito**, não opcional, em tudo que toca autenticação, o cookie de sessão,
   Supabase (service_role vs anon), dados de cliente/telefone, ou as rotas de importação/exclusão
   de dados. Nunca exponha secrets (ver `.env.local`, nunca commitado — está no `.gitignore`).
10. **Teste o que alterar.** Existe suíte automatizada, mas ela cobre só o domínio sem I/O (ver
    §Comandos) — rode `npm run test`, `npm run lint` e `npx tsc --noEmit`, e valide o fluxo
    manualmente via `npm run dev` quando a mudança afetar UI, rota ou dado, que não têm cobertura.
11. **Revise criticamente depois de implementar.** Procure bug, regressão, edge case, duplicação
    nova, complexidade desnecessária e problema de segurança antes de considerar concluído.
12. **Respeite o escopo.** Implemente o que foi pedido. Se achar problema não relacionado,
    registre e explique o impacto em vez de consertar por conta própria dentro da mesma tarefa.
13. **Git com rastreabilidade e branches.** Nunca comece funcionalidade, correção ou refatoração
    commitando direto na `main` — crie uma branch dedicada primeiro. Política completa de branches,
    commits, merge e o que exige autorização explícita em §Workflow Git.
14. **Documentação no lugar certo.** Fato arquitetural novo vai para `ARCHITECTURE.md`; este
    arquivo (`CLAUDE.md`) é para regra de comportamento, contexto essencial e comandos — não para
    documentação extensa de sistema.

---

## Workflow Git

Repositório real é `atlas/` (a pasta um nível acima não é um repo git). Remote `origin` →
`github.com/Pedrocavalcante87/atlas-v0`. Só existe a branch `main` (local e remota) — não há
`develop`. Não há CI/GitHub Actions nem branch protection configurados neste repositório (nada em
`.github/workflows/`; proteção de branch no GitHub não pôde ser verificada por falta de acesso à
API/gh CLI neste ambiente — não assuma que existe nem que não existe, confirme se for relevante
para uma decisão). A política abaixo é de **processo**, não depende de proteção técnica do GitHub
para valer.

O histórico anterior a esta política foi construído direto na `main` e **não deve ser reescrito,
reorganizado ou "corrigido"** por causa disso — a política vale a partir de agora, para trabalho
novo.

### Regras obrigatórias

- **Nunca inicie trabalho novo (feature, fix, refactor) commitando direto na `main`.** Sempre crie
  uma branch dedicada antes do primeiro commit da tarefa.
- **Antes de iniciar qualquer trabalho**, rode `git status` e `git branch --show-current` para
  confirmar em que branch está, se o working tree está limpo, e a relação com `origin` (ahead/behind
  — `git fetch` primeiro se precisar confirmar). Não assuma o estado a partir de memória de uma
  sessão anterior.
- **Antes de criar uma branch nova**, confirme que a branch-base (normalmente `main`) está limpa e
  atualizada com `origin` (`git checkout main && git pull` antes de `git checkout -b ...`). Se
  houver alterações locais não commitadas que não pertencem à tarefa nova, **não as descarte** —
  avise o usuário e pergunte como proceder (stash, commit separado, etc.) antes de ramificar.
- **Nomenclatura de branch por tipo de trabalho**, a partir da `main`:
  - `feature/<slug>` — nova funcionalidade
  - `fix/<slug>` — correção de bug
  - `refactor/<slug>` — refatoração sem mudança de comportamento
  - `hotfix/<slug>` — correção urgente (bug ativo afetando uso real), só quando a urgência for real;
    caso contrário use `fix/*`
- **Commits pequenos, coerentes e semanticamente relacionados a uma única mudança lógica.** Não
  misture feature + fix + refactor não relacionados no mesmo commit. Se a tarefa naturalmente gerar
  mudanças de tipos diferentes, separe em commits (ou branches) distintos e explique por quê.
- **Antes de cada commit**, revise `git status`/`git diff` (staged e unstaged) e confirme que só
  entram mudanças relacionadas à tarefa. Não use `git add -A`/`git add .` sem olhar o que está
  sendo incluído.
- **Nunca faça commit sem pedido explícito do usuário** (regra já existente, mantida).
- **Antes de sugerir ou abrir um merge para `main`**, rode as verificações que existem hoje no
  projeto — `npm run lint`, `npx tsc --noEmit` — e valide manualmente via `npm run dev` quando a
  mudança afeta UI ou dado (a suíte cobre só o domínio, ver §Comandos). Reporte o resultado dessas
  checagens ao usuário antes do merge, não depois.
- **Nunca faça merge para `main`, nem push de nenhuma branch para `origin` (incluindo branches de
  feature/fix/refactor/hotfix), sem autorização explícita do usuário para aquela ação específica** —
  merge local (`git merge`) ou via Pull Request no GitHub, o que o usuário preferir no momento.
- **Nunca use `git reset --hard`, `git push --force`/`--force-with-lease`, rebase que reescreve
  commits já publicados, `git branch -D`, `git push origin --delete`, ou qualquer operação que
  apague/reescreva histórico** sem autorização explícita do usuário para aquela operação específica.
- **Mantenha rastreabilidade tarefa → branch → commit**: nome da branch deve refletir a tarefa,
  mensagens de commit devem descrever o quê (e o porquê quando não for óbvio). Ao final de uma
  tarefa, informe ao usuário qual branch e quais commits foram gerados.

### Comportamentos recomendados (aplicar quando fizer sentido)

- Branches curtas — mergeie ou descarte rápido para não divergir muito da `main`.
- Depois de um merge confirmado pelo usuário, sugerir apagar a branch local correspondente (sem
  forçar, e só depois da confirmação de que o merge foi feito).
- Para mudança trivial e de risco desprezível (ex.: typo em comentário, ajuste de string), pode
  perguntar ao usuário se prefere pular a branch dedicada — mas o padrão é sempre criar branch.
- Ao avaliar se algo é `hotfix/*`, checar se é de fato um bug ativo afetando uso real antes de usar
  esse prefixo em vez de `fix/*`.

### Exige autorização explícita do usuário (parar e perguntar)

- Merge para `main`, por qualquer método (fast-forward, merge commit, squash) — local ou via PR.
- Push para `main`, ou push de qualquer branch para `origin`.
- `git reset --hard`, `git push --force`/`--force-with-lease`, rebase de commits já publicados,
  `git branch -D`, `git push origin --delete`, ou remoção de branch/tag.
- Descartar alterações não commitadas fora do escopo estrito da tarefa (`git checkout -- .`,
  `git restore`, `git clean -f`).

---

## Stack (confirmado em `package.json`)

| Camada | Tecnologia | Versão |
|---|---|---|
| Framework | Next.js — **App Router** | 16.2.12 |
| UI | React | 19.2.4 |
| Estilo | Tailwind CSS | v4 (via `@tailwindcss/postcss`, `@import "tailwindcss"` em `globals.css`) |
| Linguagem | TypeScript | ^5, `strict: true` |
| Banco | Supabase (Postgres gerenciado) | `@supabase/supabase-js` ^2.110.9 |
| Parse de CSV | PapaParse | ^5.5.4 |
| Lint | ESLint | ^9, `eslint-config-next` |
| Testes | Vitest | ^4 — só `lib/prioridade.ts` e `lib/csv-import.ts` têm cobertura |

### ⚠️ Next.js 16 tem breaking changes reais neste projeto — não confie no seu treino

O `AGENTS.md` (importado no topo deste arquivo) avisa que esta versão do Next.js difere do que
está no seu conhecimento de treino. Isso **já se manifestou no código real**: o middleware de
autenticação está em `src/proxy.ts`, não `src/middleware.ts` — no Next 16 o antigo "Middleware"
foi renomeado para "Proxy" (confirmado em
`node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md`). Antes de escrever qualquer
código que dependa de uma convenção do Next.js, confira `node_modules/next/dist/docs/`.

---

## Comandos

```bash
npm run dev     # servidor de desenvolvimento (localhost:3000)
npm run build   # build de produção
npm run start   # serve o build de produção
npm run lint    # ESLint
npm run test    # vitest — só lib/prioridade.ts e lib/csv-import.ts têm testes
```

Cobertura de teste é parcial, não total: só o domínio sem I/O (`lib/prioridade.ts`,
`lib/csv-import.ts`) tem testes automatizados — são as duas áreas de maior risco financeiro/dado
do sistema (score, categorização de urgência, parsing de valor/data/telefone de CSV). Server
Actions, rotas de API e componentes React continuam sem teste automatizado — a verificação para
essas partes é lint + type-check (`npx tsc --noEmit`, não tem script próprio) + execução manual
via `npm run dev`.

---

## Estrutura (visão rápida — detalhes em ARCHITECTURE.md)

```
src/
├── app/            # rotas (App Router) + API routes em app/api/*/route.ts
├── components/      # componentes de UI ('use client' onde há interação)
├── lib/              # domínio sem I/O (prioridade, templates, csv-import, format) + client Supabase
│   └── *.test.ts       # testes vitest de prioridade.ts e csv-import.ts (npm run test)
├── actions/           # Server Actions ('use server')
├── types/              # tipos TS compartilhados
├── proxy.ts             # middleware de autenticação (ver aviso acima sobre Next 16)
supabase/
├── schema.sql            # DDL — rodar primeiro no SQL Editor do Supabase
└── rls.sql                # habilita RLS sem políticas — rodar depois do schema
```

Não existe camada de repositório/DAO: toda leitura/escrita ao banco é feita chamando
`lib/supabase.ts` diretamente de Server Components, Server Actions ou API routes. Isso é o padrão
real do projeto — seguir o mesmo padrão em código novo é consistente com o resto, não é atalho.

---

## Convenções observadas no código existente

- **Nomenclatura de domínio em português** (`cliente`, `titulo`, `interacao`, `dias_atraso`,
  `vencimento`) mesmo com identificadores de código em `camelCase`. Preserve — é o vocabulário do
  domínio, não uma inconsistência a "corrigir".
- **Comentários explicam o porquê, não o quê** (ver `lib/prioridade.ts`, `lib/templates.ts`,
  `actions/index.ts`). Ex.: por que a mensagem é consolidada por cliente, por que a checagem de
  duplicata é refeita na confirmação do CSV. Siga esse estilo — comentário só quando há uma razão
  não óbvia por trás da linha.
- **Server Components fazem query direta ao Supabase** é o padrão majoritário para leitura
  (`app/page.tsx`, `app/clientes/[id]/page.tsx`). `app/dados/page.tsx` é a única exceção (Client
  Component + `fetch` para API route) — não é o padrão a copiar sem motivo.
- **Mutação mistura Server Actions e API routes** sem critério documentado: ações da lista do dia
  usam Server Actions (`actions/index.ts`); importação de CSV e limpeza de dados usam API routes
  chamadas via `fetch` no client. Registrado como inconsistência real em ARCHITECTURE.md §8 — não
  tente unificar sem que a tarefa peça isso.
- **Tailwind inline, sem CSS modules/styled-components.** Paleta: `slate` (neutro), `red`
  (vencido/urgente), `amber` (atenção/preventivo), `blue` (informativo/preventivo), `emerald`
  (sucesso/pago). Cards em `rounded-xl`/`rounded-2xl`, `shadow-sm`, `border-slate-200`.
- **`'use client'` só onde há estado/interação** (formulários, botões com handler). Páginas que só
  leem e renderizam são Server Components por padrão.

---

## Particularidades de domínio que já são "regra", não sugestão

- **Ciclo de vida do título — só `pago` é terminal.** `promessa` e `sem_resposta` tiram o título
  da fila **temporariamente**: ele volta quando `data_promessa` chega ou quando `silenciado_ate`
  expira (`DIAS_SILENCIO_SEM_RESPOSTA`, constante em `lib/prioridade.ts`). Quem decide é
  `lib/prioridade.ts::estaNaFilaHoje`, na **leitura** — não há cron/worker. Consequência que já
  causou bug: "concluído" **não** é `status != 'aberto'`; qualquer query que precise de "ainda
  devido" usa `status != 'pago'`. Nunca reintroduza `.neq('status','aberto')` numa exclusão.
- **Categorização de urgência**: `> 7 dias` de atraso = `atraso_longo`; `1–7 dias` =
  `atraso_leve`; vence hoje até `+3 dias` = `preventivo`; vencimento `> 3 dias` no futuro **não
  aparece** na lista do dia. Fonte oficial e única: `lib/prioridade.ts::categorizarTitulo`,
  reaproveitada por `api/upload-csv/route.ts`, `api/dados/route.ts` e `TituloCard.tsx` (que usa
  `titulo.categoria`, não recalcula). Coberto por teste.
- **Exceção deliberada ao corte de urgência**: um título que reentra por promessa vencida ou fim
  do silêncio entra na fila **mesmo com vencimento distante** — o compromisso com o cliente vence
  o "ainda não é urgente".
- **Score de priorização** = `dias_em_atraso × valor`, maior primeiro. Só se aplica a vencidos;
  preventivos ordenam por vencimento mais próximo.
- **Cobrança é por cliente, não por título**: um cliente com vários títulos em aberto recebe uma
  mensagem e um envio de WhatsApp consolidados (`lib/prioridade.ts::agruparPorCliente`,
  `ClienteCard.tsx`). Cada título individual mantém seu próprio controle de status.
- **`telefone` é a chave de upsert de cliente** (`onConflict: 'telefone'` em
  `upload-csv/confirmar/route.ts`). Dois clientes reais com o mesmo número se fundem
  silenciosamente sob o mesmo registro — comportamento atual, não validado contra esse caso.
- **Importação de CSV é sempre em duas chamadas**: `POST /api/upload-csv` só valida e retorna
  prévia (nada é gravado); `POST /api/upload-csv/confirmar` recebe de volta as linhas que o
  próprio browser guardou da prévia e só então grava. As duas passam pela **mesma**
  `lib/csv-import.ts::validarLinhaRecebida` — paridade por construção. Se mudar a regra de uma
  linha válida, mude só lá.
- **Status de título**: `aberto | pago | promessa | sem_resposta` (CHECK constraint no banco,
  `supabase/schema.sql`). Toda mudança de status gera/atualiza uma linha em `interacoes` e
  reescreve `data_promessa`/`silenciado_ate`/`resolvido_em` juntos (`actions/index.ts`), para não
  sobrar estado de uma marcação anterior.
- **`resolvido_em` é a fonte de verdade da receita recuperada** (`lib/recuperacao.ts`). Não usar
  `interacoes.data_envio` para isso: ela marca o envio da mensagem, não a confirmação do
  pagamento.

---

## Decisões arquiteturais em vigor (não reabrir sem motivo novo)

Decidido e implementado; mudar qualquer uma exige justificativa explícita, não preferência.

- **Reentrada na fila é predicado de leitura, não job.** A home busca `.neq('status','pago')` e
  `estaNaFilaHoje` decide quem aparece. Não introduza cron, worker, fila ou tabela de agendamento
  para isso — a regra é uma função pura e testável, e o sistema não precisa de infraestrutura nova.
- **`DIAS_SILENCIO_SEM_RESPOSTA` não é persistido.** É recalculado no momento da marcação, então
  mudar a constante muda o comportamento sem migration.
- **Datas de controle nulas contam como "já chegou"** — na dúvida o título volta para a fila.
  Perder uma cobrança é pior do que mostrá-la cedo demais.
- **Números de dinheiro nunca são inventados.** Quando a apuração de recuperado falha,
  `totalRecuperado` devolve `null` e a UI mostra "—"; zero seria uma afirmação falsa. Mesma lógica
  vale para qualquer métrica financeira nova.
- **Uma validação de linha de CSV, chamada nas duas pontas** (prévia e confirmação). Paridade por
  construção — não confie em manter duas listas de regras sincronizadas na mão.
- **`lib/supabase.ts` é servidor-only e usa `service_role`.** Não criar política de RLS nem usar a
  chave anônima no client — isso quebraria o modelo de segurança atual (ver §Banco de dados).

## Fora de escopo por decisão (não implementar sem pedido explícito)

Não são esquecimentos — foram avaliados e adiados por não serem o gargalo atual:

- Multi-tenancy, contas de usuário individuais, isolamento por empresa. O Atlas é mono-empresa por
  instância. Isso muda o modelo de segurança inteiro, não é ajuste incremental.
- Envio automático de WhatsApp via API oficial. O `wa.me` manual resolve com fricção aceitável.
- IA para priorização ou geração de mensagem. Não há volume de dado para aprender nada, e a
  fórmula atual não foi provada insuficiente.
- Notificações/lembretes agendados, exportação de relatórios, edição de cliente/título pela UI,
  integrações com ERP, paginação da lista do dia.
- Testes de componente React e E2E em CI.
- Batching/transação na importação de CSV e limite explícito na query da home — conhecidos e
  aceitos no volume atual (ver ARCHITECTURE.md §10).

## Banco de dados / Supabase

- Ordem de execução obrigatória no SQL Editor do Supabase: `supabase/schema.sql` **depois**
  `supabase/rls.sql`. Em banco que **já existe**, rodar também
  `supabase/migration-01-ciclo-operacional.sql` (as colunas `silenciado_ate`/`resolvido_em` não
  chegam por `schema.sql`, que usa `create table if not exists`). Sem essa migration a apuração
  de recuperado devolve `null` (a UI mostra "—") e registrar resultado de título falha com erro
  explícito — por design, nada de número falso.
- RLS está habilitado nas 3 tabelas **sem nenhuma política** — isso bloqueia totalmente a chave
  anônima (exposta no browser por design do Supabase). Todo acesso do app passa pela
  `SUPABASE_SERVICE_ROLE_KEY`, usada só em `lib/supabase.ts`, só no servidor. **Não crie política
  de RLS nem use a chave anônima no client** — isso quebraria o modelo de segurança atual.
  Qualquer necessidade de acesso direto do browser ao banco exigiria repensar esse modelo, não
  ajustá-lo pontualmente.
- Client Supabase é um singleton lazy-init via `Proxy` (`lib/supabase.ts`) — existe assim
  especificamente para não quebrar o build do Next.js quando as env vars ainda não estão
  disponíveis nesse momento. Não trocar por instanciação direta no topo do módulo.

---

## Pontos de segurança a ter em mente ao mexer perto

> Atualizado após a rodada de hardening de segurança descrita em ARCHITECTURE.md §9
> (branch `feature/revenue-recovery-hardening`). Os itens abaixo refletem o estado corrigido —
> confira o código antes de assumir que continuam assim.

- `lib/supabase.ts` usa `SUPABASE_SERVICE_ROLE_KEY` (variável sem prefixo `NEXT_PUBLIC_`) — **antes
  usava a chave anônima por engano desde o commit inicial**, o que ou quebrava o app sob RLS ou
  expunha os dados sem controle de acesso, dependendo se `rls.sql` tinha sido aplicado. Se
  `SUPABASE_SERVICE_ROLE_KEY` não estiver em `.env.local`, toda rota que toca o banco lança um erro
  explícito em vez de falhar silenciosamente — normal em ambiente novo, preencha a variável.
- `POST /api/upload-csv/confirmar` agora revalida cada linha recebida
  (`lib/csv-import.ts::validarLinhaRecebida`) antes de gravar — não confia mais só em "é um array
  não vazio". Se mudar o formato de uma linha em `lib/csv-import.ts::LinhaImportacao`, atualize o
  validador junto, senão a confirmação passa a rejeitar dados legítimos.
- `DELETE /api/dados?modo=tudo` exige `{ confirmacao: "EXCLUIR TUDO" }` no corpo, além da senha do
  app — a UI já envia isso automaticamente no segundo clique de confirmação.
- Comparação de senha em `api/login/route.ts` usa `crypto.timingSafeEqual` (constant-time).
- Login tem rate limiting em memória (10 tentativas / 5 min / IP) — não sobrevive a restart nem é
  compartilhado entre instâncias; ok para o deploy de instância única atual, revisar se isso mudar.

---

## Estado do git (snapshot observado — pode já ter mudado, sempre reconfira)

Política de branches, commits e merge está em §Workflow Git — esta seção é só o snapshot factual
mais recente, não regra.

- No momento em que esta política foi escrita (commit `d354c90`), a `main` local estava sincronizada
  com `origin/main` e o working tree limpo (sem alterações pendentes). Isso já mudou algumas vezes no
  passado deste projeto — **não assuma o estado a partir deste texto**, rode `git status`/`git diff`
  e confira a branch atual antes de avaliar o que já existe (ver regra obrigatória correspondente em
  §Workflow Git).
- O `src/middleware.ts` vazio e não rastreado que existia em versões anteriores deste arquivo não
  está mais presente — resolvido. Fica como histórico: se reaparecer, é o mesmo problema que o
  commit `d5f364d` já corrigiu antes (conflito com `src/proxy.ts`, que é o arquivo real e funcional).

---

## Referências

- [README.md](README.md) — o que o produto faz, telas, formatos de CSV aceitos, roteiro de teste.
- [ARCHITECTURE.md](ARCHITECTURE.md) — módulos, dependências, fluxos de dados completos,
  duplicações, inconsistências arquiteturais e recomendações detalhadas.
- [AGENTS.md](AGENTS.md) — aviso sobre breaking changes do Next.js 16 (importado no topo deste
  arquivo).
