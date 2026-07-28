import { NextRequest, NextResponse } from 'next/server';

const PUBLIC_PATHS = ['/login', '/api/login'];

export function proxy(request: NextRequest) {
  const appPassword = process.env.APP_PASSWORD;

  // Sem senha configurada → acesso livre (desenvolvimento local)
  if (!appPassword) return NextResponse.next();

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
