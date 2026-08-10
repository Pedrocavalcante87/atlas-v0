-- Atlas v0 — Schema Supabase
-- Execute este arquivo no SQL Editor do seu projeto Supabase

create table if not exists clientes (
  id        uuid primary key default gen_random_uuid(),
  nome      text not null,
  telefone  text not null unique,  -- unique para upsert no upload CSV
  criado_em timestamp default now()
);

-- Ciclo de vida do título: só 'pago' é terminal. 'promessa' e 'sem_resposta'
-- tiram o título da fila TEMPORARIAMENTE — ele volta quando a promessa vence
-- (data_promessa) ou quando o silêncio expira (silenciado_ate). Quem decide
-- isso é lib/prioridade.ts::estaNaFilaHoje, na leitura — não há job/cron.
create table if not exists titulos (
  id              uuid primary key default gen_random_uuid(),
  cliente_id      uuid references clientes(id) on delete cascade,
  valor           numeric not null,
  data_vencimento date not null,
  status          text not null default 'aberto'
                    check (status in ('aberto', 'pago', 'promessa', 'sem_resposta')),
  data_promessa   date,
  silenciado_ate  date,         -- 'sem_resposta': fora da fila até esta data
  resolvido_em    timestamptz,  -- preenchido só quando status vira 'pago'
  criado_em       timestamp default now()
);

create table if not exists interacoes (
  id               uuid primary key default gen_random_uuid(),
  titulo_id        uuid references titulos(id) on delete cascade,
  mensagem_enviada text,
  data_envio       timestamp default now(),
  resultado        text
);

-- Índices para as queries principais
create index if not exists idx_titulos_status       on titulos(status);
create index if not exists idx_titulos_cliente_id   on titulos(cliente_id);
create index if not exists idx_interacoes_titulo_id on interacoes(titulo_id);

-- Apuração de receita recuperada (soma de 'pago' numa janela de tempo)
create index if not exists idx_titulos_resolvido_em on titulos(resolvido_em)
  where resolvido_em is not null;


