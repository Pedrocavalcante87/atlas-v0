import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { criarValorDeSessao, DURACAO_SESSAO_MS } from '@/lib/sessao';
import { criarLimitador } from '@/lib/rate-limit';

// ---------------------------------------------------------------------------
// Rate limiting em memória por IP — suficiente para dificultar força bruta
// online contra a senha única do app num deploy de instância única (o caso
// real do Atlas hoje). Não sobrevive a restart do processo nem é compartilhado
// entre múltiplas instâncias — se o Atlas passar a rodar em múltiplas
// instâncias/serverless com cold starts frequentes, isso precisa virar um
// store compartilhado (ex: tabela no próprio Supabase). Não é o caso agora.
//
// A mecânica (janela, contagem e o expurgo das entradas velhas) vive em
// `lib/rate-limit.ts` porque só é observável ao longo do tempo: lá o "agora" é
// parâmetro e o teste acerta o relógio. Aqui ficam apenas os números em vigor.
// ---------------------------------------------------------------------------
const JANELA_MS = 5 * 60 * 1000; // 5 minutos
const MAX_TENTATIVAS = 10;

const limitador = criarLimitador({ janelaMs: JANELA_MS, maxTentativas: MAX_TENTATIVAS });

function ipDoRequest(request: NextRequest): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown';
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
  if (limitador.excedeu(ip)) {
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

  // Valor assinado, não a string '1': `maxAge` é só uma instrução ao navegador,
  // então a validade real viaja dentro do valor e é verificada em src/proxy.ts
  // (ver lib/sessao.ts). Os dois prazos saem da mesma constante para não
  // divergirem — um cookie que o navegador guarda além da validade da sessão
  // vira um "logado" que o servidor recusa, sem explicação para o usuário.
  const response = NextResponse.json({ ok: true });
  response.cookies.set('atlas_auth', criarValorDeSessao(appPassword), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: DURACAO_SESSAO_MS / 1000,
    path: '/',
  });
  return response;
}
