-- Atlas — Migration 02: um título em aberto por (cliente, valor, vencimento)
--
-- Rode este arquivo no SQL Editor do Supabase. Seguro de rodar mais de uma vez.
--
-- ⚠️ ESTA MIGRATION APAGA LINHAS DE `titulos`. Leia antes de executar.
--
-- POR QUÊ
-- A importação de CSV sempre tratou (cliente_id, valor, data_vencimento) com
-- status 'aberto' como identidade de um título: se já existe, a linha do CSV é
-- contada como duplicata em vez de virar uma segunda cobrança. Só que essa
-- regra vivia apenas na aplicação, entre uma consulta e um insert — e entre as
-- duas há uma janela.
--
-- Reproduzido: duas confirmações simultâneas do mesmo arquivo de 40 linhas
-- gravaram 80 títulos, e as duas responderam "40 importados, 0 duplicatas".
-- Ninguém foi avisado de nada. Cobrança em duplicidade, silenciosa.
--
-- Verificação entre consulta e escrita não é atômica em lugar nenhum a não ser
-- dentro do banco. Este índice move a garantia para onde ela pode existir de
-- verdade; a aplicação passa a reagir ao conflito em vez de tentar preveni-lo
-- sozinha.
--
-- O RECORTE É `status = 'aberto'`, DE PROPÓSITO
-- É exatamente a regra que a aplicação já aplica (ver ARCHITECTURE.md §4.2).
-- Um título PAGO com os mesmos valores não bloqueia uma cobrança nova — um
-- índice sem esse recorte mudaria a regra de negócio em silêncio, e regra de
-- deduplicação é contrato (CLAUDE.md). Nenhum ponto do código volta um título
-- para 'aberto' (só o insert da importação escreve esse status), então
-- transição de status não colide com este índice.

-- ---------------------------------------------------------------------------
-- PASSO 0 — DIAGNÓSTICO (opcional, só leitura)
-- Rode sozinho antes se quiser ver o que o passo 2 vai remover.
-- ---------------------------------------------------------------------------
-- select cliente_id, valor, data_vencimento, count(*) as copias
--   from titulos where status = 'aberto'
--  group by cliente_id, valor, data_vencimento
-- having count(*) > 1
--  order by copias desc;

-- ---------------------------------------------------------------------------
-- PASSO 1 — Preservar o histórico dos títulos que serão removidos
--
-- `interacoes` tem ON DELETE CASCADE, então apagar um título duplicado levaria
-- junto o registro de que uma cobrança foi enviada. Antes de apagar, as
-- interações são reapontadas para o título que fica. Nenhum histórico se perde.
-- ---------------------------------------------------------------------------
with duplicados as (
  select
    id,
    first_value(id) over (
      partition by cliente_id, valor, data_vencimento
      order by criado_em asc nulls last, id asc
    ) as manter
  from titulos
  where status = 'aberto'
)
update interacoes i
   set titulo_id = d.manter
  from duplicados d
 where i.titulo_id = d.id
   and d.id <> d.manter;

-- ---------------------------------------------------------------------------
-- PASSO 2 — Remover as cópias excedentes
--
-- Mantém a MAIS ANTIGA de cada grupo (criado_em, desempate por id) e apaga as
-- demais. Não é perda de dado financeiro: são linhas que a própria aplicação
-- sempre considerou a mesma cobrança e se recusa a importar duas vezes. O que
-- havia de histórico nelas já foi preservado no passo 1.
-- ---------------------------------------------------------------------------
with duplicados as (
  select
    id,
    first_value(id) over (
      partition by cliente_id, valor, data_vencimento
      order by criado_em asc nulls last, id asc
    ) as manter
  from titulos
  where status = 'aberto'
)
delete from titulos t
 using duplicados d
 where t.id = d.id
   and d.id <> d.manter;

-- ---------------------------------------------------------------------------
-- PASSO 3 — A garantia
--
-- A partir daqui o banco recusa um segundo título em aberto idêntico, venha de
-- onde vier: duas abas, duas requisições simultâneas, ou um POST montado à mão.
-- A aplicação trata o 23505 resultante como duplicata (não como erro), então o
-- usuário continua vendo "N duplicata(s) ignorada(s)" — agora com a contagem
-- correta mesmo sob concorrência.
--
-- `cliente_id` é anulável no schema; NULLs não conflitam entre si em índice
-- único, o que é irrelevante aqui porque a importação sempre preenche o campo.
-- ---------------------------------------------------------------------------
create unique index if not exists idx_titulos_aberto_unico
  on titulos (cliente_id, valor, data_vencimento)
  where status = 'aberto';

comment on index idx_titulos_aberto_unico is
  'Impede dois títulos em aberto idênticos para o mesmo cliente. A checagem de duplicata da importação depende desta garantia sob concorrência.';
