import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';

// ---------------------------------------------------------------------------
// Rate limiting em memória por IP — suficiente para dificultar força bruta
// online contra a senha única do app num deploy de instância única (o caso
// real do Atlas hoje). Não sobrevive a restart do processo nem é compartilhado
// entre múltiplas instâncias — se o Atlas passar a rodar em múltiplas
// instâncias/serverless com cold starts frequentes, isso precisa virar um
// store compartilhado (ex: tabela no próprio Supabase). Não é o caso agora.
// ---------------------------------------------------------------------------
const JANELA_MS = 5 * 60 * 1000; // 5 minutos
const MAX_TENTATIVAS = 10;
const tentativasPorIp = new Map<string, { count: number; resetAt: number }>();

function ipDoRequest(request: NextRequest): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown';
}

function excedeuLimite(ip: string): boolean {
  const agora = Date.now();
  const registro = tentativasPorIp.get(ip);

  if (!registro || agora > registro.resetAt) {
    tentativasPorIp.set(ip, { count: 1, resetAt: agora + JANELA_MS });
    return false;
  }

  registro.count++;
  return registro.count > MAX_TENTATIVAS;
}

/** Comparação em tempo constante — evita vazar por timing quantos caracteres
 *  da senha acertaram. Se os tamanhos diferem, ainda compara contra um buffer
 *  do mesmo tamanho do input pra não retornar instantaneamente. */
function senhaConfere(informada: string, esperada: string): boolean {
  const bufEsperada = Buffer.from(esperada, 'utf8');
  const bufInformada = Buffer.from(informada, 'utf8');

  if (bufInformada.length !== bufEsperada.length) {
    timingSafeEqual(bufInformada, Buffer.alloc(bufInformada.length));
    return false;
  }

  return timingSafeEqual(bufInformada, bufEsperada);
}

export async function POST(request: NextRequest) {
  const appPassword = process.env.APP_PASSWORD;
  if (!appPassword) {
    return NextResponse.json({ error: 'Senha incorreta.' }, { status: 401 });
  }

  const ip = ipDoRequest(request);
  if (excedeuLimite(ip)) {
    return NextResponse.json(
      { error: 'Muitas tentativas. Aguarde alguns minutos antes de tentar de novo.' },
      { status: 429 },
    );
  }

  const body = await request.json().catch(() => null);
  const senhaInformada = typeof body?.password === 'string' ? body.password : '';

  if (!senhaConfere(senhaInformada, appPassword)) {
    return NextResponse.json({ error: 'Senha incorreta.' }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set('atlas_auth', '1', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 30, // 30 dias
    path: '/',
  });
  return response;
}
