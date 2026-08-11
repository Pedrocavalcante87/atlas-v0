// ---------------------------------------------------------------------------
// Política de I/O com o Supabase: prazo máximo, classificação de falha e um
// jeito de ler que torna IMPOSSÍVEL ignorar o erro em silêncio.
//
// Por que este módulo existe (e por que não é uma camada de repositório):
// ele não conhece tabela, coluna nem regra de negócio — quem quiser falar com
// o banco continua montando a query com `lib/supabase.ts` diretamente, como
// sempre (ver ARCHITECTURE.md §12). O que ele centraliza é só a POLÍTICA:
// quanto tempo esperar, o que conta como "o banco está fora" e o que fazer
// quando não sabemos o estado real.
//
// O bug que motivou isto: `/api/dados` fazia `count ?? 0` em cada agregação.
// Com o Supabase inalcançável, as 7 consultas falhavam e a rota respondia
// HTTP 200 com "0 clientes, R$ 0,00" — um apagão de rede virava uma afirmação
// falsa sobre dinheiro. A regra do produto é a oposta: se o sistema não sabe o
// estado do banco, ele não pode inventar um que pareça válido.
// ---------------------------------------------------------------------------

/**
 * Prazo total de uma LEITURA, incluindo os retries internos do postgrest-js.
 *
 * Leituras são idempotentes, então o retry da biblioteca (3 tentativas, backoff
 * 1s/2s/4s, só para GET/HEAD/OPTIONS) é seguro e útil contra blip de rede — mas
 * é ilimitado em tempo de parede: medimos 62s numa única chamada durante uma
 * falha de DNS. O prazo abaixo é o teto que faltava. 8s dá folga larga sobre o
 * p95 medido de ida-e-volta (~620ms) e ainda cabe na paciência de quem está
 * olhando para um spinner.
 */
export const DEADLINE_LEITURA_MS = 8_000;

/**
 * Prazo total de uma ESCRITA.
 *
 * Mais generoso que o de leitura de propósito, por dois motivos: uma gravação
 * em lote de centenas de linhas legitimamente demora mais que um `select`, e
 * abortar uma escrita deixa o resultado AMBÍGUO — não dá para saber se o
 * Postgres chegou a efetivar. Queremos que este prazo dispare só em problema
 * real, não em lentidão passageira.
 *
 * O postgrest-js NÃO faz retry de POST/PATCH/DELETE (RETRYABLE_METHODS é só
 * GET/HEAD/OPTIONS) e isso está CERTO: reenviar um `insert` cuja resposta se
 * perdeu duplicaria um título — dado financeiro duplicado é pior que um erro
 * visível. Não reintroduza retry de escrita aqui.
 */
export const DEADLINE_ESCRITA_MS = 15_000;

/** Tamanho de página na leitura de listas sem teto conhecido. Ver `lerPaginado`. */
export const PAGINA_LEITURA = 1_000;

/** O formato de erro que o postgrest-js devolve (não é uma instância de Error). */
export interface ErroSupabase {
  message: string;
  code?: string | null;
  details?: string | null;
  hint?: string | null;
}

export interface RespostaSupabase<T> {
  data: T | null;
  error: ErroSupabase | null;
  count?: number | null;
}

/** Monta a consulta já com o sinal de cancelamento aplicado (`.abortSignal(sinal)`). */
export type MontarConsulta<T> = (sinal: AbortSignal) => PromiseLike<RespostaSupabase<T>>;

export type Resultado<T> =
  | { ok: true; data: T; count: number | null }
  | { ok: false; indisponivel: boolean; mensagem: string; detalhe: string };

/** Lançada quando uma leitura não pôde ser respondida. Nunca vire um zero. */
export class SupabaseIndisponivelError extends Error {
  /** true = rede/timeout; false = o banco respondeu, mas com erro. */
  readonly indisponivel: boolean;
  /** Texto técnico para log do servidor — NÃO envie ao navegador. */
  readonly detalhe: string;

  constructor(mensagem: string, indisponivel: boolean, detalhe: string) {
    super(mensagem);
    this.name = 'SupabaseIndisponivelError';
    this.indisponivel = indisponivel;
    this.detalhe = detalhe;
  }
}

/**
 * A falha é de infraestrutura (não conseguimos falar com o banco) ou do banco
 * (ele respondeu dizendo que a operação é inválida)?
 *
 * Discriminador: `code`. Verificado empiricamente contra o Supabase real —
 * Postgres/PostgREST sempre preenchem um SQLSTATE ou um código PGRST
 * ('42703' coluna inexistente, '23514' check constraint, '21000' ON CONFLICT
 * duplicado), enquanto falha de rede e timeout chegam com `code: ''`:
 *
 *   fetch failed        -> code: ''       message: "TypeError: fetch failed"
 *   AbortSignal.timeout -> code: ''       message: "TimeoutError: ..."
 *   coluna inexistente  -> code: '42703'  message: "column ... does not exist"
 *
 * Na dúvida (código ausente) classificamos como infraestrutura de propósito:
 * é a direção conservadora. "Não sei o que aconteceu" tem que se comportar
 * como "não sei o estado do banco", nunca como "o dado do usuário está ruim".
 */
export function ehFalhaDeInfraestrutura(erro: ErroSupabase): boolean {
  return !erro.code;
}

/** Mensagem segura para o usuário — sem host, sem stack, sem detalhe interno. */
function mensagemParaUsuario(indisponivel: boolean): string {
  return indisponivel
    ? 'Não foi possível falar com o banco de dados. Verifique a conexão e tente de novo.'
    : 'O banco de dados recusou a operação.';
}

/**
 * Executa uma consulta com prazo, sem lançar. Devolve o resultado já
 * classificado para quem precisa decidir o que fazer com a falha.
 */
export async function consultar<T>(
  montar: MontarConsulta<T>,
  oQue: string,
  deadlineMs: number = DEADLINE_LEITURA_MS,
): Promise<Resultado<T>> {
  const { data, error, count } = await montar(AbortSignal.timeout(deadlineMs));

  if (error) {
    const indisponivel = ehFalhaDeInfraestrutura(error);
    // O detalhe técnico traz host e stack — fica no log do servidor, não vai
    // para o navegador (ver mensagemParaUsuario).
    console.error(
      `[supabase] falha em ${oQue} — ${indisponivel ? 'INFRAESTRUTURA' : `banco (${error.code})`}: ` +
      `${error.message}${error.details ? ` | ${error.details}` : ''}`,
    );
    return {
      ok: false,
      indisponivel,
      mensagem: mensagemParaUsuario(indisponivel),
      detalhe: error.message,
    };
  }

  return { ok: true, data: data as T, count: count ?? null };
}

/**
 * Leitura que não admite silêncio: qualquer falha vira exceção.
 *
 * Use em todo lugar onde a alternativa seria um `?? 0` ou um `?? []` — ou
 * seja, onde não conseguir ler produziria um número/lista que o usuário leria
 * como verdade.
 */
export async function ler<T>(
  montar: MontarConsulta<T>,
  oQue: string,
  deadlineMs: number = DEADLINE_LEITURA_MS,
): Promise<{ data: T; count: number | null }> {
  const r = await consultar(montar, oQue, deadlineMs);
  if (!r.ok) {
    throw new SupabaseIndisponivelError(r.mensagem, r.indisponivel, `${oQue}: ${r.detalhe}`);
  }
  return { data: r.data, count: r.count };
}

/** Escrita: mesmo prazo generoso, sem retry, resultado classificado. */
export async function gravar<T>(montar: MontarConsulta<T>, oQue: string): Promise<Resultado<T>> {
  return consultar(montar, oQue, DEADLINE_ESCRITA_MS);
}

/**
 * Lê uma lista inteira, paginando até acabar.
 *
 * Existe porque o PostgREST aplica um teto de linhas por resposta
 * (`db-max-rows`, tipicamente 1000 no Supabase) e uma resposta truncada é
 * indistinguível de uma resposta completa: `data.length` simplesmente vem
 * menor. Num `select` que alimenta soma de dinheiro isso subnotifica o total
 * em silêncio; num `select` que alimenta checagem de duplicata, faz o sistema
 * inserir título repetido. Paginar torna a pergunta "qual é o teto?"
 * irrelevante — no caso normal (menos de uma página) é uma requisição só.
 */
export async function lerPaginado<T>(
  montarPagina: (sinal: AbortSignal, de: number, ate: number) => PromiseLike<RespostaSupabase<T[]>>,
  oQue: string,
): Promise<T[]> {
  const tudo: T[] = [];

  for (let pagina = 0; ; pagina++) {
    const de = pagina * PAGINA_LEITURA;
    const { data } = await ler<T[]>(
      (sinal) => montarPagina(sinal, de, de + PAGINA_LEITURA - 1),
      `${oQue} (página ${pagina + 1})`,
    );

    const linhas = data ?? [];
    tudo.push(...linhas);
    if (linhas.length < PAGINA_LEITURA) return tudo;
  }
}
