import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  ehFalhaDeInfraestrutura,
  consultar,
  ler,
  lerPaginado,
  SupabaseIndisponivelError,
  PAGINA_LEITURA,
  type RespostaSupabase,
} from './supabase-io';

// Estas funções não falam com o Supabase: recebem um construtor de consulta.
// Isso é o que as torna testáveis sem rede — o dublê abaixo devolve exatamente
// os formatos de erro observados contra o Supabase real.
const erroDeRede = { message: 'TypeError: fetch failed', code: '', details: 'getaddrinfo ENOTFOUND', hint: '' };
const erroDeTimeout = { message: 'TimeoutError: The operation was aborted due to timeout', code: '', details: '', hint: '' };
const erroDeColuna = { message: 'column titulos.resolvido_em does not exist', code: '42703', details: null, hint: null };

function responde<T>(r: Partial<RespostaSupabase<T>>) {
  return async () => ({ data: null, error: null, ...r }) as RespostaSupabase<T>;
}

afterEach(() => vi.restoreAllMocks());

describe('ehFalhaDeInfraestrutura', () => {
  it('erro de rede é infraestrutura — o banco não foi alcançado', () => {
    expect(ehFalhaDeInfraestrutura(erroDeRede)).toBe(true);
  });

  it('timeout é infraestrutura', () => {
    expect(ehFalhaDeInfraestrutura(erroDeTimeout)).toBe(true);
  });

  it('erro com SQLSTATE é do banco, não da rede', () => {
    expect(ehFalhaDeInfraestrutura(erroDeColuna)).toBe(false);
    expect(ehFalhaDeInfraestrutura({ message: 'check constraint', code: '23514' })).toBe(false);
    expect(ehFalhaDeInfraestrutura({ message: 'on conflict', code: '21000' })).toBe(false);
  });

  it('sem código classifica como infraestrutura — a direção conservadora', () => {
    // "Não sei o que aconteceu" tem que se comportar como "não sei o estado do
    // banco", nunca como "o dado do usuário está ruim".
    expect(ehFalhaDeInfraestrutura({ message: 'algo estranho' })).toBe(true);
    expect(ehFalhaDeInfraestrutura({ message: 'algo estranho', code: null })).toBe(true);
  });
});

describe('consultar', () => {
  it('devolve os dados no caminho feliz', async () => {
    const r = await consultar(responde({ data: [1, 2, 3], count: 3 }), 'teste');
    expect(r).toEqual({ ok: true, data: [1, 2, 3], count: 3 });
  });

  it('classifica falha de rede como indisponível', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await consultar(responde({ error: erroDeRede }), 'teste');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.indisponivel).toBe(true);
  });

  it('classifica erro do banco como NÃO indisponível', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await consultar(responde({ error: erroDeColuna }), 'teste');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.indisponivel).toBe(false);
  });

  it('não vaza host, stack nem detalhe interno na mensagem ao usuário', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await consultar(
      responde({ error: { ...erroDeRede, details: 'getaddrinfo ENOTFOUND abcxyz.supabase.co' } }),
      'teste',
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.mensagem).not.toContain('supabase.co');
      expect(r.mensagem).not.toContain('ENOTFOUND');
    }
  });

  it('aplica um AbortSignal à consulta', async () => {
    let recebido: AbortSignal | null = null;
    await consultar(async (sinal) => {
      recebido = sinal;
      return { data: null, error: null };
    }, 'teste');
    expect(recebido).toBeInstanceOf(AbortSignal);
  });
});

describe('ler', () => {
  it('devolve os dados quando dá certo', async () => {
    const { data, count } = await ler(responde({ data: 'ok', count: 1 }), 'teste');
    expect(data).toBe('ok');
    expect(count).toBe(1);
  });

  it('LANÇA em vez de devolver vazio — é o que impede o "?? 0" de voltar', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(ler(responde({ error: erroDeRede }), 'contagem')).rejects.toBeInstanceOf(
      SupabaseIndisponivelError,
    );
  });

  it('marca indisponivel=false quando o banco respondeu com erro', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(ler(responde({ error: erroDeColuna }), 'x')).rejects.toMatchObject({
      indisponivel: false,
    });
  });
});

describe('lerPaginado', () => {
  it('uma página só quando o resultado cabe nela', async () => {
    const paginas = vi.fn(async () => ({ data: [1, 2, 3], error: null }));
    const tudo = await lerPaginado<number>(paginas, 'teste');
    expect(tudo).toEqual([1, 2, 3]);
    expect(paginas).toHaveBeenCalledTimes(1);
  });

  it('continua paginando enquanto a página vier cheia', async () => {
    // Protege a soma de dinheiro: uma resposta truncada pelo teto de linhas do
    // PostgREST é indistinguível de uma resposta completa, e subnotificaria o
    // total em silêncio.
    const cheia = Array.from({ length: PAGINA_LEITURA }, (_, i) => i);
    const paginas = vi
      .fn<(s: AbortSignal, de: number, ate: number) => Promise<RespostaSupabase<number[]>>>()
      .mockResolvedValueOnce({ data: cheia, error: null })
      .mockResolvedValueOnce({ data: [999], error: null });

    const tudo = await lerPaginado<number>(paginas, 'teste');
    expect(tudo).toHaveLength(PAGINA_LEITURA + 1);
    expect(paginas).toHaveBeenCalledTimes(2);
    expect(paginas.mock.calls[1][1]).toBe(PAGINA_LEITURA);
  });

  it('propaga a indisponibilidade em vez de devolver lista parcial', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      lerPaginado<number>(responde<number[]>({ error: erroDeRede }), 'teste'),
    ).rejects.toBeInstanceOf(SupabaseIndisponivelError);
  });
});
