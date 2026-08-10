import { NextRequest, NextResponse } from 'next/server';

const PUBLIC_PATHS = ['/login', '/api/login'];

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

  const isAuthenticated =
    request.cookies.get('atlas_auth')?.value === '1';

  if (!isAuthenticated) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
