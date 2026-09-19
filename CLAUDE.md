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
10. **Teste o que alterar.** A suíte cobre o domínio e a política de I/O, **não** rotas, Server
    Actions nem componentes (ver §Comandos) — rode `npm run test`, `npm run lint` e
    `npx tsc --noEmit`, e valide o fluxo manualmente via `npm run dev` quando a mudança afetar UI,
    rota ou dado. Para concorrência, indisponibilidade ou qualquer coisa que envolva o banco de
    verdade, teste unitário **não é evidência suficiente** — este projeto já produziu defeitos que
    só apareceram na reprodução real (ver §Descobertas empíricas).
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
15. **Documentação faz parte do trabalho, não vem depois dele.** Após qualquer alteração
    importante no sistema, ou ao concluir um ciclo, a documentação operacional deve ser revisada e
    atualizada **antes de considerar o ciclo encerrado**. Ver §Manutenção da documentação.

---

## Manutenção da documentação (regra permanente de processo)

> **Uma alteração importante não está encerrada enquanto a documentação afetada estiver
> desatualizada.** Documentação errada não é dívida cosmética: ela é ativamente perigosa, porque a
> próxima sessão vai confiar nela e decidir errado. Trate afirmação falsa em documento como bug.

### Quando revisar

Ao concluir um ciclo, ou após qualquer mudança que altere comportamento, contrato, schema,
garantia ou invariante. Não é preciso revisar tudo a cada commit — é preciso revisar **antes de
declarar concluído**.

### O que revisar (quando aplicável à mudança)

| Documento | Revisar quando mudou |
|---|---|
| `CLAUDE.md` | Regra de atuação, invariante, decisão em vigor, comando, descoberta empírica, o que está fora de escopo |
| `ARCHITECTURE.md` | Módulo, dependência, fluxo de dado, contrato de API, acoplamento, ponto frágil, limitação |
| `README.md` | O que o produto faz, telas, formato de CSV, **estrutura do banco**, setup, roteiro de teste, limitação do v0 |
| `PLANEJAMENTO.md` | Direção de evolução pós-v0: fase concluída/autorizada, decisão de arquitetura pretendida, hipótese que virou fato, decisão aberta que foi respondida. **Não** é descrição do sistema atual — isso é `ARCHITECTURE.md` |
| `supabase/*.sql` | Qualquer mudança de schema. Um banco NOVO só roda `schema.sql` — toda garantia criada por migration precisa existir lá também, senão instalação limpa nasce sem ela |
| Cobertura de teste | Contagem de casos e **quais áreas seguem sem cobertura** — declarar cobertura que não existe é pior do que não declarar nada |

### Precedência

**Código, schema, testes e comportamento validado têm precedência sobre documentação antiga.**
Divergiu? O documento está errado até prova em contrário — corrija o documento, não force o código
a caber nele. Se o código é que está errado, isso é um bug, e vira tarefa própria.

### O que preservar ao atualizar

- **Decisões deliberadas fora de escopo.** Elas existem para não serem reabertas a cada ciclo por
  preferência. Só saem de lá com evidência nova — e o registro deve dizer qual evidência.
- **Descobertas empíricas** que mudaram uma decisão de implementação. Custaram medição; sem
  registro, o próximo ciclo repete o experimento ou, pior, toma o caminho já descartado.
- **A separação entre os cinco tipos de afirmação**, que não podem se misturar:

  | Tipo | Significa | Como escrever |
  |---|---|---|
  | Regra de negócio | Contrato do domínio | "só `pago` é terminal" |
  | Decisão arquitetural | Escolhido entre alternativas | "decidido: X, porque Y" |
  | Implementação atual | Como está hoje, podia ser outra | "hoje a confirmação grava em lotes de 500" |
  | Limitação conhecida | Sabemos, aceitamos, por ora | "não faz W — fora de escopo por N" |
  | Hipótese não validada | Achamos, não medimos | "**hipótese**: … Como testar: …" |

  Nunca promova hipótese a fato sem medição, e diga o que foi medido quando promover.

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
| Testes | Vitest | ^4 — 168 casos em `lib/`; rotas, Server Actions e componentes sem cobertura |

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
npm run test    # vitest — 168 casos, todos em src/lib/
```

**O que tem cobertura** (`src/lib/*.test.ts`, 168 casos): `prioridade.ts` (score, categorização,
reentrada), `csv-import.ts` (parsing, validação, planejamento do lote, deduplicação),
`recuperacao.ts` (apuração), `supabase-io.ts` (classificação de falha, paginação por cursor),
`importacao.ts` (máquina de estados de conflito) e `sessao.ts` (assinatura, expiração e recusa de
cookie forjado).

**O que NÃO tem cobertura, e precisa de verificação manual**: rotas de API, Server Actions,
componentes React, o encadeamento HTTP entre UI e backend, comportamento sob dependência
indisponível, e concorrência real contra o Postgres. Para essas partes a verificação é
`npm run lint` + `npx tsc --noEmit` (sem script próprio) + `npm run dev`.

Não declare cobertura que não existe: afirmar que algo está testado quando não está é pior do que
admitir a lacuna.

---

## Estrutura (visão rápida — detalhes em ARCHITECTURE.md)

```
src/
├── app/             # rotas (App Router) + API routes em app/api/*/route.ts
├── components/       # componentes de UI ('use client' onde há interação)
├── lib/
│   ├── prioridade.ts   # domínio puro: urgência, score, fila do dia, agrupamento
│   ├── templates.ts    # domínio puro: texto das mensagens
│   ├── csv-import.ts   # domínio puro: parsing, validação, planejamento do lote
│   ├── format.ts       # domínio puro: formatarMoeda
│   ├── importacao.ts   # gravação do lote (conflito/conciliação) — I/O injetado, sem importar supabase
│   ├── recuperacao.ts  # misto: apuração pura + uma leitura
│   ├── supabase-io.ts  # POLÍTICA de I/O: prazo, classificação de falha, paginação
│   ├── supabase.ts     # client Supabase (service_role, servidor-only)
│   ├── sessao.ts       # domínio puro: assina/valida o cookie de sessão (HMAC + expiração)
│   └── *.test.ts       # vitest (npm run test)
├── actions/          # Server Actions ('use server')
├── types/            # tipos TS compartilhados
├── proxy.ts          # middleware de autenticação (ver aviso acima sobre Next 16)
supabase/
├── schema.sql                            # DDL de banco NOVO — rodar primeiro
├── rls.sql                               # habilita RLS sem políticas — rodar depois do schema
├── migration-01-ciclo-operacional.sql    # silenciado_ate / resolvido_em (banco existente)
└── migration-02-titulo-aberto-unico.sql  # índice único de título em aberto (banco existente)
```

Não existe camada de repositório/DAO: quem precisa de dado monta a query com `lib/supabase.ts`
direto, de Server Component, Server Action ou API route. **Mas a chamada passa por
`lib/supabase-io.ts`** (`ler`/`lerPaginado`/`gravar`), que carrega a política de prazo, falha e
paginação. Os dois juntos são o padrão real do projeto — não introduza repositório/DAO.

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
  próprio browser guardou da prévia e só então grava. As duas pontas compartilham **duas** funções
  de `lib/csv-import.ts`, e é isso que garante que a prévia nunca prometa o que a gravação recusa:
  `validarLinhaRecebida` (o que é uma linha válida) e `planejarImportacao` (o que conta como
  duplicata, inclusive duplicata **dentro do próprio arquivo**). Mudou a regra? Mude só lá.
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
- **Todo acesso ao banco passa por `lib/supabase-io.ts`** (`ler` / `lerPaginado` / `gravar`). Não é
  camada de repositório — não conhece tabela nem regra, e a query continua sendo montada com
  `lib/supabase.ts` direto. Ele só carrega a política: prazo, classificação de falha e paginação.
  Ver §Leitura de listas e §Falha de dependência.
- **Lógica que só é observável com banco real mora em `lib/`, com I/O injetado.**
  `lib/importacao.ts` recebe as operações de banco como parâmetro (`Portas`) em vez de importar
  `lib/supabase.ts`. Não é purismo: enquanto essa máquina de estados morava dentro da rota, ela
  produziu dois defeitos que nenhum teste pegou. Se uma lógica nova só puder ser exercitada subindo
  servidor, ela está no lugar errado.

## Invariantes garantidos (o sistema deixa de funcionar corretamente se algum cair)

Cada um está garantido por mecanismo, não por disciplina de quem escreve o código:

| Invariante | Garantido por |
|---|---|
| Nenhum estado inventado quando o banco não responde | `ler`/`lerPaginado` lançam; rotas devolvem 503; nunca `?? 0` |
| Leitura de lista é completa ou é erro — nunca truncada em silêncio | `lerPaginado` por cursor, `T extends { id: string }` |
| No máximo um título `aberto` por (cliente, valor, vencimento) | `idx_titulos_aberto_unico` no Postgres |
| Reimportar o mesmo arquivo não duplica cobrança | Índice único + tratamento de 23505 como duplicata |
| Prévia nunca aprova linha que a gravação vá recusar | `validarLinhaRecebida` chamada nas duas pontas |
| Prévia e confirmação contam duplicata igual | `planejarImportacao` chamada nas duas pontas |
| Falha de infraestrutura nunca é apresentada como erro do dado do usuário | `ehFalhaDeInfraestrutura` + `resultado: 'indisponivel'` |
| Nenhuma requisição fica pendurada indefinidamente | Prazos de 8s/15s em `supabase-io.ts` |
| `service_role` nunca chega ao navegador | Só `lib/supabase.ts` a lê; nenhum Client Component o importa |
| Sessão só vale se este servidor a emitiu, e só até expirar | `lib/sessao.ts`: HMAC-SHA256 com chave derivada de `APP_PASSWORD`, expiração dentro da carga assinada |

## Leitura de listas — o PostgREST corta em 1000 linhas

Fato medido neste projeto (1149 títulos não pagos): um `select` sem paginar devolveu **1000**
linhas e a soma de "valor em aberto" saiu **R$ 137.287,50 menor** que a real, com HTTP 200 e
nenhum aviso. Resposta truncada é indistinguível de resposta completa.

**Toda leitura que alimenta soma de dinheiro, checagem de duplicata ou a lista do dia usa
`lerPaginado`.** Não é otimização, é correção: sem isso o sistema subnotifica dívida e insere
título repetido conforme o negócio cresce. `ler` (sem paginar) só serve para `count`/`head` e para
buscar UMA linha.

`lerPaginado` pagina **por cursor**, não por offset — quem chama precisa selecionar `id`,
ordenar por `id` e aplicar `.gt('id', apos)`; o tipo `T extends { id: string }` obriga. Duas
razões, as duas com cicatriz:

- **Nunca infira "acabou" do tamanho da página.** A versão anterior parava quando a página vinha
  incompleta, o que só funcionava porque o tamanho da página era igual ao teto. Com página de
  1500 contra teto de 1000, ela lia 1000 de 1269 linhas e subnotificava R$ 243 mil, calada.
- **Offset sem ordenação não particiona.** Sem `order by`, duas requisições podem devolver as
  linhas em ordens diferentes e uma linha some ou é contada duas vezes numa soma de dinheiro.

Se precisar de outra ordem para EXIBIR, ordene em memória depois de ler tudo (é o que
`clientes/[id]` faz) — a chave de paginação precisa ser única e estável, e `data_vencimento` não é.

## Falha de dependência — o que não pode acontecer

Invariante do produto, não preferência de estilo:

> Se o sistema não sabe o estado real do banco, ele não pode inventar um estado que pareça válido.

Na prática, uma falha de infraestrutura **nunca** pode virar zero cliente, zero título, R$ 0,00,
lista vazia ou sucesso aparente — e **nunca** pode ser apresentada ao usuário como problema no
dado que ele enviou. Foi exatamente isso que aconteceu: `/api/dados` respondia 200 com o banco
vazio enquanto havia dados, e a importação culpava linhas do CSV por uma queda de rede.

- Leitura que falha ⇒ exceção ⇒ 503 (API) ou tela de indisponibilidade (página). Nunca `?? 0`.
- `ehFalhaDeInfraestrutura` distingue "não falei com o banco" de "o banco recusou" pelo `code`
  (SQLSTATE presente = erro do banco; vazio = infraestrutura). Sem código conta como
  infraestrutura — direção conservadora de propósito.
- **Escrita não tem retry, e isso é decisão.** O `postgrest-js` só repete GET/HEAD/OPTIONS;
  reenviar um `insert` cuja resposta se perdeu duplicaria um título. Não reintroduza retry de
  escrita. A recuperação é reimportar — a checagem de duplicata torna isso idempotente.
  (Exceção controlada: `lib/importacao.ts::gravarLoteDeTitulos` reenvia após um **conflito de
  unicidade**, que é outra coisa — ali o banco já garantiu que nada foi gravado em duplicidade, e o
  reenvio leva só o que ainda não existe.)
- **Prazos em `lib/supabase-io.ts`: 8s leitura, 15s escrita.** Sem eles o padrão do undici é 300s —
  medido: um fetch sem prazo contra uma dependência que aceita a conexão e não responde continuava
  pendurado depois de 20s.

## Duplicidade de título é garantida pelo BANCO, não pela aplicação

`idx_titulos_aberto_unico` (migration 02, **já aplicada no banco de desenvolvimento**) é a fonte de
verdade: no máximo um título `aberto` por (cliente, valor, vencimento). A checagem em memória
(`planejarImportacao`) continua existindo para **relatar** duplicatas e evitar ida desnecessária ao
banco — mas ela não é garantia, porque verificar-e-depois-escrever não é atômico fora do banco.

Consequência prática para quem mexer aqui: **um `insert` em `titulos` pode falhar com 23505 e isso
não é erro** — é "alguém já gravou". Trate como duplicata (ver
`lib/importacao.ts::gravarLoteDeTitulos`), nunca como falha para o usuário.

O recorte `where status = 'aberto'` do índice é a regra de negócio, não detalhe: um título **pago**
com os mesmos valores não bloqueia cobrança nova. Um índice sem esse recorte funcionaria melhor com
o PostgREST (ver §Descobertas empíricas) mas mudaria a regra em silêncio — não faça essa troca.

## Descobertas empíricas (medidas neste projeto — não redescubra)

Cada item abaixo foi **verificado contra o Supabase real deste projeto** e mudou uma decisão de
implementação. Não são hipóteses. Se alguma parecer errada, meça de novo antes de agir — mas meça.

| Descoberta | Consequência no código |
|---|---|
| O PostgREST corta a resposta em **1000 linhas**. Com 1149 títulos não pagos, um `select` sem paginar devolveu 1000 e a soma saiu **R$ 137.287,50 menor**, com HTTP 200 | Toda leitura de lista usa `lerPaginado` |
| Paginar por offset e parar quando "a página veio incompleta" só funciona se a página for ≤ o teto. Página 1500 contra teto 1000 leu 1000 de 1269 linhas | `lerPaginado` avança por **cursor** (`id`), nunca infere fim pelo tamanho |
| `ignoreDuplicates` **sem** `onConflict` estoura 23505 — o PostgREST mira a PK, não emite `ON CONFLICT` nu | Não dá para pedir "ignore duplicatas" genericamente |
| `onConflict` só aceita **nomes de coluna**, e o Postgres exige o predicado para inferir índice **parcial** | Por isso a aplicação trata o 23505 em vez de pedir `DO NOTHING`. Caminho alternativo seria RPC |
| Erro do Postgres traz o SQLSTATE em `error.code`; a **mensagem não contém o número** | Discrimine erro específico por `Resultado.codigo`, nunca por `.includes()` na mensagem — isso já deixou um caminho inteiro morto |
| Telefone repetido no mesmo `upsert` derruba o comando inteiro (SQLSTATE **21000**) | Deduplicar por telefone antes do lote é obrigatório |
| `.select()` num upsert devolve **só as linhas realmente inseridas** | É daí que sai a contagem honesta de gravados |
| Sem `AbortSignal`, o padrão do undici deixa um fetch pendurado (>20s medido; documentado 300s) | Prazos explícitos em `supabase-io.ts` |
| `postgrest-js` repete só GET/HEAD/OPTIONS, 3× com backoff 1s/2s/4s | Leitura ganha teto de tempo; escrita não ganha retry |

## Fora de escopo por decisão (não implementar sem pedido explícito)

Não são esquecimentos — foram avaliados e adiados por não serem o gargalo atual:

- Multi-tenancy, contas de usuário individuais, isolamento por empresa. O Atlas é mono-empresa por
  instância. Isso muda o modelo de segurança inteiro, não é ajuste incremental.
- Envio automático de WhatsApp via API oficial. O `wa.me` manual resolve com fricção aceitável.
- IA para priorização ou geração de mensagem. Não há volume de dado para aprender nada, e a
  fórmula atual não foi provada insuficiente.
- Notificações/lembretes agendados, exportação de relatórios, edição de cliente/título pela UI,
  integrações com ERP, paginação **de UI** da lista do dia (quantos cards mostrar por vez — não
  confundir com paginar a *leitura*, que passou a ser obrigatória, ver §Leitura de listas).
- Testes de componente React e E2E em CI.
- ~~Batching na importação de CSV~~ — **feito**: a confirmação grava em lote (ver ARCHITECTURE.md
  §4.2). Transação de verdade continua fora: o PostgREST não expõe transação multi-requisição, e a
  recuperação hoje é por reimportação idempotente, não por rollback.

## Banco de dados / Supabase

- Ordem de execução obrigatória no SQL Editor do Supabase: `supabase/schema.sql` **depois**
  `supabase/rls.sql`. Em banco que **já existe**, rodar também, nesta ordem:
  1. `supabase/migration-01-ciclo-operacional.sql` — as colunas `silenciado_ate`/`resolvido_em`
     não chegam por `schema.sql`, que usa `create table if not exists`. Sem ela a apuração de
     recuperado devolve `null` (a UI mostra "—") e registrar resultado de título falha com erro
     explícito — por design, nada de número falso.
  2. `supabase/migration-02-titulo-aberto-unico.sql` — índice único de título em aberto. **Apaga
     duplicatas pré-existentes** (preservando as interações delas); leia o cabeçalho antes de
     rodar. Sem ela, duas importações simultâneas do mesmo arquivo gravam a mesma cobrança duas
     vezes, sem aviso — reproduzido: 40 linhas viraram 80 títulos com as duas respostas dizendo
     "0 duplicatas". A aplicação funciona sem o índice, só não tem a garantia.
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

> Os itens abaixo refletem o estado **corrigido** do código (histórico completo em
> ARCHITECTURE.md §9). Confira o código antes de assumir que continuam assim.

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
- **O cookie de sessão é assinado (`lib/sessao.ts`) — não reintroduza um valor constante.** Ele já
  foi a string literal `'1'`, e o gate aceitava qualquer requisição que a trouxesse: `curl -H
  'Cookie: atlas_auth=1'` entrava sem ver a senha, em toda rota, inclusive na exclusão total. Hoje o
  valor é `v1.<expiraEm>.<HMAC>`, com chave derivada de `APP_PASSWORD` e expiração **dentro da carga
  assinada** — `maxAge` é instrução ao navegador, não garantia. Quem valida é `sessaoValida` em
  `src/proxy.ts`. Consequência operacional: trocar `APP_PASSWORD` desloga todo mundo (desejável).
- **O Proxy do Next 16 roda em runtime Node.js** e definir `runtime` nele lança erro (confirmado em
  `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md` §Runtime). Por
  isso `lib/sessao.ts` pode usar `node:crypto` direto. Se algum dia o Proxy voltar ao Edge, essa
  importação quebra e o caminho é Web Crypto (`crypto.subtle`, assíncrono).
- **Server Actions não checam autenticação sozinhas** — dependem do matcher do Proxy, e a doc do
  Next 16 avisa que mudar o matcher ou mover a ação de rota remove a proteção em silêncio (ver
  ARCHITECTURE.md §9). Ao tocar `actions/index.ts`, considere validar a sessão no topo da ação.
- Comparação de senha em `api/login/route.ts` usa `crypto.timingSafeEqual` (constant-time).
- Login tem rate limiting em memória (10 tentativas / 5 min / IP) — não sobrevive a restart nem é
  compartilhado entre instâncias; ok para o deploy de instância única atual, revisar se isso mudar.

---

## Estado do git

**Não existe snapshot confiável de estado de git em documento.** Rode `git status`,
`git branch --show-current` e `git log --oneline main..HEAD` no início de qualquer trabalho — a
política está em §Workflow Git. Uma versão anterior deste arquivo mantinha um snapshot com número
de commit; ele envelheceu em dias e só servia para induzir erro.

Único fato histórico que vale guardar: se um `src/middleware.ts` vazio reaparecer, ele conflita com
`src/proxy.ts` (o arquivo real e funcional no Next 16) e deve ser removido — já aconteceu antes.

---

## Referências

- [README.md](README.md) — o que o produto faz, telas, formatos de CSV aceitos, roteiro de teste.
- [ARCHITECTURE.md](ARCHITECTURE.md) — módulos, dependências, fluxos de dados completos,
  duplicações, inconsistências arquiteturais e recomendações detalhadas.
- [PLANEJAMENTO.md](PLANEJAMENTO.md) — planejamento da evolução pós-v0: onde o produto vai, o que
  está autorizado a acontecer em seguida e o que ainda não está decidido. **Leia antes de propor
  mudança estrutural em ingestão, schema ou domínio** — a Etapa 1 já avaliou várias direções e
  registrou por que umas foram escolhidas e outras adiadas. Cada afirmação lá é marcada como fato,
  decisão, hipótese ou decisão aberta; não trate hipótese como requisito.
- [AGENTS.md](AGENTS.md) — aviso sobre breaking changes do Next.js 16 (importado no topo deste
  arquivo).
