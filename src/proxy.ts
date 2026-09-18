import { NextRequest, NextResponse } from 'next/server';
import { sessaoValida } from '@/lib/sessao';

const PUBLIC_PATHS = ['/login', '/api/login'];

// O Proxy do Next 16 roda no runtime Node.js por padrão (e definir `runtime`
// aqui lança erro), então `node:crypto` — usado por lib/sessao.ts — está
// disponível. Confirmado em node_modules/next/dist/docs/01-app/03-api-reference/
// 03-file-conventions/proxy.md §Runtime.

export function proxy(request: NextRequest) {
  const appPassword = process.env.APP_PASSWORD;

  if (!appPassword) {
    // Em desenvolvimento, rodar sem senha é conveniente e o risco é local.
    // Em produção isso deixaria TODAS as rotas abertas — incluindo as que
    // apagam dados e as que expõem nome/telefone/valores de clientes. Falhar
    // fechado e alto é melhor do que servir os dados de graça por descuido de
    // configuração.
    if (process.env.NODE_ENV === 'production') {
      return new NextResponse(
        'Atlas não está configurado: defina APP_PASSWORD nas variáveis de ambiente.',
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
  const isAuthenticated = sessaoValida(appPassword, request.cookies.get('atlas_auth')?.value);

  if (!isAuthenticated) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
