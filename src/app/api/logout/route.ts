import { NextRequest, NextResponse } from 'next/server';
import { COOKIE_SESSAO } from '@/lib/sessao';

/**
 * Encerra a sessão NESTE navegador: apaga o cookie e volta para o login.
 *
 * É POST, nunca GET: um link de saída seria disparado pelo prefetch do `Link`
 * do Next e por qualquer imagem ou aba que apontasse para ele. E é pública no
 * proxy (ver `PUBLIC_PATHS` em src/proxy.ts), porque só apaga o cookie de quem
 * chama — com a sessão já vencida, protegê-la faria o clique em "Sair" cair
 * numa página de erro.
 *
 * O que ela NÃO faz: derrubar a sessão em outros aparelhos. O cookie é
 * assinado e não existe lista de sessões no servidor (lib/sessao.ts); para
 * encerrar todas, troque APP_EMAIL ou APP_PASSWORD.
 */
export async function POST(request: NextRequest) {
  // 303: o navegador segue com GET, que é o que a página de login responde.
  const resposta = NextResponse.redirect(new URL('/login', request.url), 303);
  // Mesmos atributos do login (api/login/route.ts): o navegador só substitui
  // o cookie certo se nome e caminho baterem.
  resposta.cookies.set(COOKIE_SESSAO, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 0,
    path: '/',
  });
  return resposta;
}
