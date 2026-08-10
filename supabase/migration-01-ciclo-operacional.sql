-- Atlas — Migration 01: ciclo operacional e apuração de recuperação
--
-- Rode este arquivo no SQL Editor do Supabase em bancos que JÁ EXISTEM.
-- (schema.sql usa "create table if not exists", então ele não altera tabelas
-- já criadas — bancos novos já saem com estas colunas e não precisam disto.)
--
-- Contexto: até aqui, marcar um título como "prometeu pagar" ou "sem resposta"
-- o removia da operação para sempre — a dívida continuava existindo e sumia da
-- lista. A partir desta migration só 'pago' é terminal; os outros dois estados
-- tiram o título da fila temporariamente e ele volta sozinho.
--
-- Seguro de rodar mais de uma vez (idempotente).

alter table titulos add column if not exists silenciado_ate date;
alter table titulos add column if not exists resolvido_em   timestamptz;

comment on column titulos.silenciado_ate is
  'Status sem_resposta: título fica fora da fila até esta data (inclusive volta nela).';
comment on column titulos.resolvido_em is
  'Momento em que o título virou pago. Fonte de verdade da receita recuperada.';

create index if not exists idx_titulos_resolvido_em on titulos(resolvido_em)
  where resolvido_em is not null;

-- Títulos já pagos ANTES desta migration ficam com resolvido_em nulo e, por
-- isso, não entram na janela de "recuperado nos últimos N dias". É intencional:
-- inventar uma data de pagamento retroativa produziria um número falso. A
-- apuração passa a valer a partir de agora.
--
-- Títulos que estavam em 'sem_resposta' ficam com silenciado_ate nulo e voltam
-- para a fila na próxima leitura — correto: são dívidas em aberto que o modelo
-- antigo havia escondido permanentemente.
