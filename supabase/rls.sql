-- Atlas v0 — Habilitar Row Level Security
-- Execute este arquivo no SQL Editor do seu projeto Supabase, depois do schema.sql

-- O app não usa Supabase Auth (o login é uma senha compartilhada via cookie),
-- então não criamos políticas baseadas em auth.uid(). Em vez disso:
--
--   1. Habilitamos RLS nas 3 tabelas SEM nenhuma política — isso bloqueia
--      completamente qualquer acesso via chave anônima (a que fica visível
--      no navegador). Por padrão, RLS habilitado + zero políticas = acesso
--      negado para as roles "anon" e "authenticated".
--
--   2. Todo o backend (rotas de API, Server Actions, Server Components) passa
--      a usar a service_role key (ver src/lib/supabase.ts), que ignora RLS
--      por definição e só existe no servidor — nunca é exposta ao navegador.
--
-- Resultado prático: mesmo que alguém descubra a URL do projeto e a chave
-- anônima (ambas aparecem no navegador, isso é normal no Supabase), não
-- consegue mais ler nem escrever nada nas tabelas. O app continua
-- funcionando normalmente porque passa a falar com o banco pelo servidor.

alter table clientes   enable row level security;
alter table titulos    enable row level security;
alter table interacoes enable row level security;
