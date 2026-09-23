// ---------------------------------------------------------------------------
// Leitura, no navegador, das respostas das rotas de API do próprio Atlas.
//
// Existe porque as telas que chamam API por `fetch` (login, importação, dados)
// faziam `await res.json()` e decidiam só por `res.ok`, e três situações reais
// escapavam disso:
//
//  - SESSÃO EXPIRADA. O proxy (src/proxy.ts) responde a qualquer rota sem
//    sessão válida redirecionando para /login, inclusive as de API. O `fetch`
//    segue o redirecionamento sozinho, então a tela recebia o HTML do login
//    com status 200 (num GET) ou um 404 em texto puro (num POST, porque o Next
//    trata POST em /login como Server Action inexistente). Medido em
//    2026-09-23. Com o 200, a tela de dados tratava HTML como "estatística
//    nula"; com o 404 em texto, `res.json()` lançava e a análise da importação
//    ficava em "Analisando…" para sempre.
//  - QUEDA DE REDE. `fetch` rejeita, e ninguém capturava.
//  - CORPO FORA DO FORMATO. Uma falha que não passou pelo tratamento da rota
//    devolve HTML ou texto, e ler isso como JSON lança.
//
// A resposta vira um de cinco desfechos. O texto que o usuário lê continua
// sendo decisão de quem chama, porque só ele sabe o que a operação já pode ter
// feito ("nada foi gravado" é verdade numa prévia, não numa confirmação).
// ---------------------------------------------------------------------------

/** Corpo de erro das rotas do Atlas. Algumas mandam mais campos junto. */
export type CorpoDeErro = { error?: unknown } & Record<string, unknown>;

export type LeituraResposta<T> =
  /** 2xx com corpo JSON. */
  | { tipo: 'ok'; status: number; dados: T }
  /** Não-2xx com corpo JSON — a rota respondeu e explicou (ou não) o motivo. */
  | { tipo: 'erro'; status: number; dados: CorpoDeErro | null }
  /** O proxy devolveu a requisição para o login: nada chegou à rota. */
  | { tipo: 'sessao_expirada' }
  /** A requisição não chegou a ter resposta. Não há como saber se a rota rodou. */
  | { tipo: 'sem_conexao' }
  /** Houve resposta, mas o corpo não é JSON. A rota pode ter rodado. */
  | { tipo: 'invalida'; status: number };

export type FalhaDeResposta = Exclude<LeituraResposta<unknown>, { tipo: 'ok' }>;

/** O mínimo de `Response` que a leitura usa — permite testar sem servidor. */
export type RespostaHttp = Pick<Response, 'ok' | 'status' | 'redirected' | 'url' | 'text'>;

function foiDevolvidaAoLogin(res: RespostaHttp): boolean {
  if (!res.redirected) return false;
  try {
    return new URL(res.url).pathname === '/login';
  } catch {
    return false;
  }
}

export async function lerResposta<T>(res: RespostaHttp): Promise<LeituraResposta<T>> {
  // Antes de olhar status ou corpo: o login responde 200, e um 200 aqui seria
  // lido como sucesso da rota que nunca rodou.
  if (foiDevolvidaAoLogin(res)) return { tipo: 'sessao_expirada' };

  let texto: string;
  try {
    texto = await res.text();
  } catch {
    // A conexão caiu no meio do corpo.
    return { tipo: 'sem_conexao' };
  }

  let dados: unknown;
  try {
    dados = JSON.parse(texto);
  } catch {
    return { tipo: 'invalida', status: res.status };
  }

  if (res.ok) return { tipo: 'ok', status: res.status, dados: dados as T };

  const corpo =
    dados !== null && typeof dados === 'object' && !Array.isArray(dados)
      ? (dados as CorpoDeErro)
      : null;
  return { tipo: 'erro', status: res.status, dados: corpo };
}

/** `fetch` que nunca rejeita: a queda de rede também vira um desfecho. */
export async function chamarApi<T>(url: string, init?: RequestInit): Promise<LeituraResposta<T>> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    return { tipo: 'sem_conexao' };
  }
  return lerResposta<T>(res);
}

/**
 * Frase base para uma falha. Quem chama acrescenta o que a falha significa
 * para a operação dele — se algo pode ter sido gravado ou apagado.
 */
export function mensagemDeFalha(falha: FalhaDeResposta, padrao: string): string {
  switch (falha.tipo) {
    case 'sessao_expirada':
      return 'Sua sessão expirou. Entre de novo para continuar.';
    case 'sem_conexao':
      return 'Não foi possível falar com o servidor. Verifique a conexão e tente de novo.';
    case 'invalida':
      return `O servidor respondeu de forma inesperada (HTTP ${falha.status}).`;
    case 'erro': {
      const erro = falha.dados?.error;
      return typeof erro === 'string' && erro.trim() ? erro : padrao;
    }
  }
}
