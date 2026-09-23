import { describe, it, expect, vi, afterEach } from 'vitest';
import { lerResposta, chamarApi, mensagemDeFalha, type RespostaHttp } from './resposta-http';

// Resposta mínima. `redirected` e `url` não podem ser ajustados num `Response`
// construído à mão, e são justamente eles que denunciam o desvio para o login.
function resposta(over: Partial<RespostaHttp> & { corpo?: string }): RespostaHttp {
  const { corpo = '', ...resto } = over;
  const status = resto.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    redirected: false,
    url: 'http://localhost:3000/api/dados',
    text: async () => corpo,
    ...resto,
  };
}

describe('lerResposta', () => {
  it('2xx com JSON é sucesso, com o corpo lido', async () => {
    const r = await lerResposta<{ clientes: number }>(resposta({ corpo: '{"clientes":11}' }));
    expect(r).toEqual({ tipo: 'ok', status: 200, dados: { clientes: 11 } });
  });

  it('4xx com JSON é erro, preservando o corpo para quem chama', async () => {
    const r = await lerResposta(resposta({ status: 400, corpo: '{"error":"O arquivo CSV está vazio."}' }));
    expect(r).toEqual({ tipo: 'erro', status: 400, dados: { error: 'O arquivo CSV está vazio.' } });
  });

  it('503 com relatório continua sendo erro, com os campos do relatório', async () => {
    const r = await lerResposta(
      resposta({ status: 503, corpo: '{"resultado":"indisponivel","count":3,"error":"banco fora"}' }),
    );
    expect(r.tipo).toBe('erro');
    expect(r.tipo === 'erro' && r.dados?.resultado).toBe('indisponivel');
  });

  it('redirecionada ao login com 200 é sessão expirada, não sucesso', async () => {
    // O caso medido: GET /api/dados sem sessão termina no HTML do login com 200.
    const r = await lerResposta(
      resposta({ redirected: true, url: 'http://localhost:3000/login', corpo: '<!DOCTYPE html>' }),
    );
    expect(r).toEqual({ tipo: 'sessao_expirada' });
  });

  it('redirecionada ao login com 404 em texto também é sessão expirada', async () => {
    // O caso medido: POST sem sessão vira POST em /login, e o Next responde
    // "Server action not found." em texto puro.
    const r = await lerResposta(
      resposta({
        status: 404,
        redirected: true,
        url: 'http://localhost:3000/login',
        corpo: 'Server action not found.',
      }),
    );
    expect(r).toEqual({ tipo: 'sessao_expirada' });
  });

  it('redirecionamento para outro lugar não é confundido com o login', async () => {
    const r = await lerResposta(
      resposta({ redirected: true, url: 'http://localhost:3000/api/dados/v2', corpo: '{"ok":true}' }),
    );
    expect(r.tipo).toBe('ok');
  });

  it('login com query string ainda é o login', async () => {
    const r = await lerResposta(
      resposta({ redirected: true, url: 'http://localhost:3000/login?de=/dados', corpo: '' }),
    );
    expect(r.tipo).toBe('sessao_expirada');
  });

  it('corpo que não é JSON vira resposta inválida, com o status', async () => {
    const r = await lerResposta(resposta({ status: 500, corpo: '<html>Internal Server Error</html>' }));
    expect(r).toEqual({ tipo: 'invalida', status: 500 });
  });

  it('corpo vazio também é inválido — as rotas do Atlas sempre respondem JSON', async () => {
    const r = await lerResposta(resposta({ status: 200, corpo: '' }));
    expect(r).toEqual({ tipo: 'invalida', status: 200 });
  });

  it('erro com corpo JSON que não é objeto guarda dados nulos', async () => {
    const r = await lerResposta(resposta({ status: 500, corpo: '"falhou"' }));
    expect(r).toEqual({ tipo: 'erro', status: 500, dados: null });
  });

  it('conexão que cai no meio do corpo é falta de conexão', async () => {
    const r = await lerResposta(
      resposta({
        text: async () => {
          throw new TypeError('network error');
        },
      }),
    );
    expect(r).toEqual({ tipo: 'sem_conexao' });
  });
});

describe('chamarApi', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetch que rejeita vira falta de conexão, em vez de lançar', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(chamarApi('/api/dados')).resolves.toEqual({ tipo: 'sem_conexao' });
  });

  it('repassa url e opções ao fetch e lê a resposta', async () => {
    const fetchFalso = vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', fetchFalso);
    const init = { method: 'POST', body: '{}' };
    const r = await chamarApi('/api/login', init);
    expect(fetchFalso).toHaveBeenCalledWith('/api/login', init);
    expect(r).toEqual({ tipo: 'ok', status: 200, dados: { ok: true } });
  });
});

describe('mensagemDeFalha', () => {
  it('usa o erro que a rota mandou', () => {
    expect(mensagemDeFalha({ tipo: 'erro', status: 400, dados: { error: 'Modo inválido.' } }, 'padrão')).toBe(
      'Modo inválido.',
    );
  });

  it('cai no texto padrão quando a rota não explicou', () => {
    expect(mensagemDeFalha({ tipo: 'erro', status: 500, dados: null }, 'Não foi possível.')).toBe(
      'Não foi possível.',
    );
    expect(mensagemDeFalha({ tipo: 'erro', status: 500, dados: { error: '  ' } }, 'Não foi possível.')).toBe(
      'Não foi possível.',
    );
    expect(mensagemDeFalha({ tipo: 'erro', status: 500, dados: { error: 42 } }, 'Não foi possível.')).toBe(
      'Não foi possível.',
    );
  });

  it('dá uma frase própria para sessão, conexão e resposta inválida', () => {
    expect(mensagemDeFalha({ tipo: 'sessao_expirada' }, 'x')).toMatch(/sessão expirou/);
    expect(mensagemDeFalha({ tipo: 'sem_conexao' }, 'x')).toMatch(/falar com o servidor/);
    expect(mensagemDeFalha({ tipo: 'invalida', status: 502 }, 'x')).toMatch(/HTTP 502/);
  });
});
