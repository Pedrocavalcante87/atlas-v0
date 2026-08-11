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
  /** Banco falso paginável por cursor, com teto de linhas configurável. */
  function bancoFalso(totalLinhas: number, tetoDoServidor: number) {
    const linhas = Array.from({ length: totalLinhas }, (_, i) => ({
      id: String(i + 1).padStart(6, '0'),
    }));
    const chamadas: (string | null)[] = [];

    const montar = async (_s: AbortSignal, apos: string | null, limite: number) => {
      chamadas.push(apos);
      const restantes = apos ? linhas.filter((l) => l.id > apos) : linhas;
      // O servidor devolve no máximo o SEU teto, ignorando um limite maior.
      const data = restantes.slice(0, Math.min(limite, tetoDoServidor));
      return { data, error: null, count: totalLinhas } as RespostaSupabase<{ id: string }[]>;
    };

    return { montar, chamadas };
  }

  it('uma requisição só quando tudo cabe numa página', async () => {
    const { montar, chamadas } = bancoFalso(3, PAGINA_LEITURA);
    const tudo = await lerPaginado(montar, 'teste');
    expect(tudo).toHaveLength(3);
    expect(chamadas).toEqual([null]);
  });

  it('avança pelo último id recebido, não por offset', async () => {
    const { montar, chamadas } = bancoFalso(2500, PAGINA_LEITURA);
    const tudo = await lerPaginado(montar, 'teste');
    expect(tudo).toHaveLength(2500);
    expect(chamadas[0]).toBeNull();
    expect(chamadas[1]).toBe('001000');
    expect(chamadas[2]).toBe('002000');
  });

  it('REGRESSÃO: lê tudo mesmo se o teto do servidor for MENOR que a página pedida', async () => {
    // A versão anterior parava quando a página vinha "incompleta", o que só
    // funcionava porque o tamanho da página era igual ao teto do PostgREST.
    // Medido contra o banco real: pedindo 1500 com teto de 1000, ela devolvia
    // 1000 de 1269 linhas e subnotificava a soma em R$ 137 mil, calada.
    const { montar } = bancoFalso(1269, 400);
    const tudo = await lerPaginado(montar, 'teste');
    expect(tudo).toHaveLength(1269);
    expect(new Set(tudo.map((l) => l.id)).size).toBe(1269);
  });

  it('não repete nem pula linha entre páginas', async () => {
    const { montar } = bancoFalso(2000, 512);
    const tudo = await lerPaginado(montar, 'teste');
    const ids = tudo.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([...ids].sort());
  });

  it('para numa página vazia mesmo sem count (rede de segurança)', async () => {
    const semCount = vi
      .fn<(s: AbortSignal, apos: string | null, limite: number) => Promise<RespostaSupabase<{ id: string }[]>>>()
      .mockResolvedValueOnce({ data: [{ id: 'a' }], error: null, count: null })
      .mockResolvedValueOnce({ data: [], error: null, count: null });

    const tudo = await lerPaginado(semCount, 'teste');
    expect(tudo).toEqual([{ id: 'a' }]);
    expect(semCount).toHaveBeenCalledTimes(2);
  });

  it('propaga a indisponibilidade em vez de devolver lista parcial', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      lerPaginado(responde<{ id: string }[]>({ error: erroDeRede }), 'teste'),
    ).rejects.toBeInstanceOf(SupabaseIndisponivelError);
  });
});
