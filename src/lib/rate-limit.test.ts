import { describe, it, expect } from 'vitest';
import { criarLimitador } from './rate-limit';

const JANELA = 5 * 60 * 1000; // 5 min, como no login
const MAX = 10;
const T0 = new Date('2026-09-19T12:00:00-03:00').getTime();

const novo = (over: Partial<Parameters<typeof criarLimitador>[0]> = {}) =>
  criarLimitador({ janelaMs: JANELA, maxTentativas: MAX, ...over });

describe('contagem dentro da janela', () => {
  it('libera as primeiras tentativas e barra a partir da que excede', () => {
    const lim = novo();
    for (let i = 1; i <= MAX; i++) {
      expect(lim.excedeu('ip-a', T0)).toBe(false);
    }
    expect(lim.excedeu('ip-a', T0)).toBe(true);
  });

  it('continua barrando enquanto a janela não vira', () => {
    const lim = novo();
    for (let i = 0; i <= MAX; i++) lim.excedeu('ip-a', T0);
    expect(lim.excedeu('ip-a', T0 + JANELA - 1)).toBe(true);
  });

  it('conta cada chave separadamente', () => {
    const lim = novo();
    for (let i = 0; i <= MAX; i++) lim.excedeu('ip-a', T0);
    expect(lim.excedeu('ip-a', T0)).toBe(true);
    expect(lim.excedeu('ip-b', T0)).toBe(false);
  });
});

describe('expiração da janela', () => {
  it('reinicia a contagem depois da janela', () => {
    const lim = novo();
    for (let i = 0; i <= MAX; i++) lim.excedeu('ip-a', T0);
    expect(lim.excedeu('ip-a', T0)).toBe(true);
    expect(lim.excedeu('ip-a', T0 + JANELA + 1)).toBe(false);
  });

  it('a janela nova permite o mesmo número de tentativas', () => {
    const lim = novo();
    for (let i = 0; i <= MAX; i++) lim.excedeu('ip-a', T0);
    const depois = T0 + JANELA + 1;
    for (let i = 1; i <= MAX; i++) {
      expect(lim.excedeu('ip-a', depois)).toBe(false);
    }
    expect(lim.excedeu('ip-a', depois)).toBe(true);
  });
});

// O defeito que motivou extrair este módulo: entradas de chaves que nunca
// voltam ficavam no mapa para sempre. Num processo de longa duração exposto à
// internet, crescimento sem teto.
describe('expurgo de entradas velhas', () => {
  it('não deixa o mapa crescer sem limite com chaves que não voltam', () => {
    const lim = novo({ maxChavesRastreadas: 50 });

    // 200 IPs distintos que aparecem uma vez e somem.
    for (let i = 0; i < 200; i++) lim.excedeu(`ip-${i}`, T0);

    // Passada a janela, um acesso novo dispara o expurgo dos expirados.
    lim.excedeu('ip-novo', T0 + JANELA + 1);

    expect(lim.tamanho()).toBeLessThanOrEqual(51);
  });

  it('não expurga quem ainda está dentro da janela', () => {
    const lim = novo({ maxChavesRastreadas: 5 });
    for (let i = 0; i < 20; i++) lim.excedeu(`ip-${i}`, T0);

    // Todos ainda vivos: o expurgo por expiração não tem o que remover, então
    // o limitador escolhe zerar em vez de crescer sem fim (ver rate-limit.ts).
    lim.excedeu('ip-novo', T0 + 1);
    expect(lim.tamanho()).toBeLessThanOrEqual(6);
  });

  it('preserva a contagem de quem está ativo quando há espaço', () => {
    const lim = novo({ maxChavesRastreadas: 1000 });
    for (let i = 0; i <= MAX; i++) lim.excedeu('ip-ativo', T0);
    for (let i = 0; i < 100; i++) lim.excedeu(`ip-${i}`, T0);

    // Ninguém passou do teto, então nada foi expurgado e o bloqueio continua.
    expect(lim.excedeu('ip-ativo', T0)).toBe(true);
  });
});

describe('isolamento entre limitadores', () => {
  it('cada limitador tem o próprio estado', () => {
    const a = novo();
    const b = novo();
    for (let i = 0; i <= MAX; i++) a.excedeu('mesmo-ip', T0);
    expect(a.excedeu('mesmo-ip', T0)).toBe(true);
    expect(b.excedeu('mesmo-ip', T0)).toBe(false);
  });
});
