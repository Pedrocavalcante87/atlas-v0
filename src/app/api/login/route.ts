import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { COOKIE_SESSAO, criarValorDeSessao, DURACAO_SESSAO_MS } from '@/lib/sessao';
import { criarLimitador } from '@/lib/rate-limit';
import { credenciaisDoAmbiente, normalizarEmail, segredoDeSessao } from '@/lib/credenciais';

// ---------------------------------------------------------------------------
// Rate limiting em memória por IP — suficiente para dificultar força bruta
// online contra a credencial única do app num deploy de instância única (o
// caso real do Atlas hoje). Não sobrevive a restart do processo nem é
// compartilhado entre múltiplas instâncias — se o Atlas passar a rodar em
// múltiplas instâncias/serverless com cold starts frequentes, isso precisa
// virar um store compartilhado (ex: tabela no próprio Supabase).
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
 *  do valor acertaram. Se os tamanhos diferem, ainda compara contra um buffer
 *  do mesmo tamanho do input pra não retornar instantaneamente. */
function confere(informado: string, esperado: string): boolean {
  const bufEsperado = Buffer.from(esperado, 'utf8');
  const bufInformado = Buffer.from(informado, 'utf8');

  if (bufInformado.length !== bufEsperado.length) {
    timingSafeEqual(bufInformado, Buffer.alloc(bufInformado.length));
    return false;
  }

  return timingSafeEqual(bufInformado, bufEsperado);
}

export async function POST(request: NextRequest) {
  const credenciais = credenciaisDoAmbiente();
  if (!credenciais) {
    // Sem credencial completa no ambiente não existe login possível. A resposta
    // é a mesma de credencial errada de propósito: quem está tentando entrar
    // não precisa saber se o problema é configuração do servidor.
    return NextResponse.json({ error: 'E-mail ou senha incorretos.' }, { status: 401 });
  }

  const ip = ipDoRequest(request);
  if (limitador.excedeu(ip)) {
    return NextResponse.json(
      { error: 'Muitas tentativas. Aguarde alguns minutos antes de tentar de novo.' },
      { status: 429 },
    );
  }

  const body = await request.json().catch(() => null);
  const emailInformado = typeof body?.email === 'string' ? normalizarEmail(body.email) : '';
  const senhaInformada = typeof body?.password === 'string' ? body.password : '';

  // As duas comparações SEMPRE rodam, mesmo que a primeira já tenha falhado:
  // encerrar cedo faria o tempo de resposta revelar que o e-mail está certo e
  // só a senha está errada, entregando metade da credencial.
  const emailOk = confere(emailInformado, credenciais.email);
  const senhaOk = confere(senhaInformada, credenciais.senha);

  if (!emailOk || !senhaOk) {
    // Mensagem única para os dois casos — dizer "senha incorreta" confirmaria
    // que o e-mail existe.
    return NextResponse.json({ error: 'E-mail ou senha incorretos.' }, { status: 401 });
  }

  // Valor assinado, não uma string constante: `maxAge` é só uma instrução ao
  // navegador, então a validade real viaja dentro do valor e é verificada em
  // src/proxy.ts (ver lib/sessao.ts). Os dois prazos saem da mesma constante
  // para não divergirem. O segredo deriva do e-mail E da senha, então trocar
  // qualquer um dos dois encerra as sessões abertas.
  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE_SESSAO, criarValorDeSessao(segredoDeSessao(credenciais)), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: DURACAO_SESSAO_MS / 1000,
    path: '/',
  });
  return response;
}
