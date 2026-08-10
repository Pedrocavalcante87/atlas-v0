import { createClient, SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient | null = null;

// ---------------------------------------------------------------------------
// Este client SÓ deve ser importado de código que roda no servidor (Server
// Components, Server Actions, API Routes) — nunca de um Client Component.
// Ele usa a service_role key porque as tabelas têm RLS habilitado sem
// nenhuma política (ver supabase/rls.sql): a chave anônima, nessas
// condições, não tem acesso a nada. A service_role ignora RLS por definição
// e nunca deve ser exposta ao navegador — por isso não tem prefixo
// NEXT_PUBLIC_. Se você trocar isso pela chave anônima "pra simplificar",
// toda leitura/escrita do app passa a falhar silenciosamente sob RLS.
// ---------------------------------------------------------------------------
function getClient(): SupabaseClient {
  if (!_client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !serviceRoleKey) {
      throw new Error(
        'Supabase não configurado: defina NEXT_PUBLIC_SUPABASE_URL e ' +
        'SUPABASE_SERVICE_ROLE_KEY em .env.local (Settings > API > service_role ' +
        'no painel do Supabase). A chave anônima não é suficiente — as tabelas ' +
        'têm RLS habilitado sem políticas (ver supabase/rls.sql).',
      );
    }

    _client = createClient(url, serviceRoleKey, {
      auth: { persistSession: false },
    });
  }
  return _client;
}

// Proxy para lazy initialization — evita erros de env vars ausentes no momento
// em que o módulo é importado (ex: durante o build do Next.js)
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const client = getClient();
    const value = (client as unknown as Record<string | symbol, unknown>)[prop];
    return typeof value === 'function'
      ? (value as (...args: unknown[]) => unknown).bind(client)
      : value;
  },
});
