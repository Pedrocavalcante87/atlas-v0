import { NextRequest, NextResponse } from 'next/server';
import { COOKIE_SESSAO, sessaoValida } from '@/lib/sessao';
import { credenciaisDoAmbiente, segredoDeSessao } from '@/lib/credenciais';

// `/api/logout` é pública porque só APAGA o cookie de quem chama — não lê nem
// grava dado. Protegida, ela falharia justamente com a sessão já expirada: o
// proxy devolveria o POST para /login, e o navegador mostraria o 404 em texto
// que o Next responde a POST numa página.
const PUBLIC_PATHS = ['/login', '/api/login', '/api/logout'];

// O Proxy do Next 16 roda no runtime Node.js por padrão (e definir `runtime`
// aqui lança erro), então `node:crypto` — usado por lib/sessao.ts — está
// disponível. Confirmado em node_modules/next/dist/docs/01-app/03-api-reference/
// 03-file-conventions/proxy.md §Runtime.

export function proxy(request: NextRequest) {
  const credenciais = credenciaisDoAmbiente();

  if (!credenciais) {
    // Em desenvolvimento, rodar sem credencial é conveniente e o risco é
    // local. Em produção isso deixaria TODAS as rotas abertas — incluindo as
    // que apagam dados e as que expõem nome/telefone/valores de clientes.
    // Falhar fechado e alto é melhor do que servir os dados de graça por
    // descuido de configuração.
    if (process.env.NODE_ENV === 'production') {
      return new NextResponse(
        'Atlas não está configurado: defina APP_EMAIL e APP_PASSWORD nas variáveis de ambiente.',
        { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } },
      );
    }
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // O valor do cookie é assinado por lib/sessao.ts e a expiração é verificada
  // aqui, no servidor. Antes esta linha comparava com a string literal '1':
  // qualquer requisição com `Cookie: atlas_auth=1` entrava sem nunca ver a
  // senha — inclusive nas rotas que expõem dados de clientes e apagam tudo.
  // Cookie é dado do cliente; só vale o que o servidor consegue provar que
  // emitiu.
  const isAuthenticated = sessaoValida(
    segredoDeSessao(credenciais),
    request.cookies.get(COOKIE_SESSAO)?.value,
  );

  if (!isAuthenticated) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  // O ícone da aba (app/icon.svg) fica fora do gate como o favicon ficava:
  // é arte estática, e atrás do login a própria tela de login ficava sem ele.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg).*)'],
};
