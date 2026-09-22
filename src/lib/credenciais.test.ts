import { describe, it, expect } from 'vitest';
import { normalizarEmail, segredoDeSessao } from './credenciais';
import { criarValorDeSessao, sessaoValida } from './sessao';

const T0 = new Date('2026-09-19T12:00:00-03:00').getTime();

describe('normalizarEmail', () => {
  it('ignora caixa e espaços — não é por isso que alguém deve falhar no login', () => {
    expect(normalizarEmail('  Contato@Empresa.COM.BR ')).toBe('contato@empresa.com.br');
  });

  it('não altera um e-mail já normalizado', () => {
    expect(normalizarEmail('a@b.com')).toBe('a@b.com');
  });
});

describe('segredoDeSessao', () => {
  it('muda quando a senha muda', () => {
    const a = segredoDeSessao({ email: 'a@b.com', senha: 'senha1' });
    const b = segredoDeSessao({ email: 'a@b.com', senha: 'senha2' });
    expect(a).not.toBe(b);
  });

  it('muda quando o e-mail muda', () => {
    const a = segredoDeSessao({ email: 'a@b.com', senha: 'x' });
    const b = segredoDeSessao({ email: 'c@d.com', senha: 'x' });
    expect(a).not.toBe(b);
  });

  // Sem separador, ("a@b.c", "xy") e ("a@b.cx", "y") concatenariam no mesmo
  // texto e duas credenciais diferentes assinariam sessões intercambiáveis.
  it('não confunde credenciais que concatenariam igual', () => {
    const a = segredoDeSessao({ email: 'a@b.c', senha: 'xy' });
    const b = segredoDeSessao({ email: 'a@b.cx', senha: 'y' });
    expect(a).not.toBe(b);
  });
});

describe('integração com a sessão', () => {
  it('sessão emitida com uma credencial vale para ela', () => {
    const cred = { email: 'contato@empresa.com', senha: 'senha-forte' };
    const valor = criarValorDeSessao(segredoDeSessao(cred), T0);
    expect(sessaoValida(segredoDeSessao(cred), valor, T0)).toBe(true);
  });

  it('trocar a SENHA invalida as sessões abertas', () => {
    const antes = { email: 'contato@empresa.com', senha: 'antiga' };
    const depois = { email: 'contato@empresa.com', senha: 'nova' };
    const valor = criarValorDeSessao(segredoDeSessao(antes), T0);
    expect(sessaoValida(segredoDeSessao(depois), valor, T0)).toBe(false);
  });

  it('trocar o E-MAIL invalida as sessões abertas', () => {
    const antes = { email: 'antigo@empresa.com', senha: 'mesma' };
    const depois = { email: 'novo@empresa.com', senha: 'mesma' };
    const valor = criarValorDeSessao(segredoDeSessao(antes), T0);
    expect(sessaoValida(segredoDeSessao(depois), valor, T0)).toBe(false);
  });

  it('caixa diferente no e-mail configurado não invalida a sessão', () => {
    const a = { email: normalizarEmail('Contato@Empresa.com'), senha: 'x' };
    const b = { email: normalizarEmail('contato@empresa.COM'), senha: 'x' };
    const valor = criarValorDeSessao(segredoDeSessao(a), T0);
    expect(sessaoValida(segredoDeSessao(b), valor, T0)).toBe(true);
  });
});
