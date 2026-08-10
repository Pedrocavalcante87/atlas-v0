-- Atlas v0 — Schema Supabase
-- Execute este arquivo no SQL Editor do seu projeto Supabase

create table if not exists clientes (
  id        uuid primary key default gen_random_uuid(),
  nome      text not null,
  telefone  text not null unique,  -- unique para upsert no upload CSV
  criado_em timestamp default now()
);

create table if not exists titulos (
  id              uuid primary key default gen_random_uuid(),
  cliente_id      uuid references clientes(id) on delete cascade,
  valor           numeric not null,
  data_vencimento date not null,
  status          text not null default 'aberto'
                    check (status in ('aberto', 'pago', 'promessa', 'sem_resposta')),
  data_promessa   date,
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


