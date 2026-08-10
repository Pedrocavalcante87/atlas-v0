import { describe, it, expect } from 'vitest';
import {
  somarRecuperado,
  inicioJanelaRecuperacao,
  JANELA_RECUPERACAO_DIAS,
  type TituloRecuperavel,
} from './recuperacao';

/** Data/hora fixa como "agora" — a janela é relativa, então os testes precisam
 *  de um ponto de referência estável para não dependerem do dia em que rodam. */
const AGORA = new Date('2026-08-10T15:00:00-03:00');

function diasAtras(dias: number): string {
  const d = new Date(AGORA);
  d.setDate(d.getDate() - dias);
  return d.toISOString();
}

describe('inicioJanelaRecuperacao', () => {
  it('começa no início do dia, N dias atrás', () => {
    const inicio = inicioJanelaRecuperacao(30, AGORA);
    expect(inicio.getHours()).toBe(0);
    expect(inicio.getMinutes()).toBe(0);
    expect(inicio.getSeconds()).toBe(0);
  });

  it('usa 30 dias por padrão', () => {
    expect(inicioJanelaRecuperacao(undefined, AGORA).getTime()).toBe(
      inicioJanelaRecuperacao(JANELA_RECUPERACAO_DIAS, AGORA).getTime(),
    );
  });
});

describe('somarRecuperado', () => {
  it('soma títulos pagos dentro da janela', () => {
    const titulos: TituloRecuperavel[] = [
      { valor: 1500, resolvido_em: diasAtras(1) },
      { valor: 500.5, resolvido_em: diasAtras(10) },
    ];
    expect(somarRecuperado(titulos, 30, AGORA)).toBe(2000.5);
  });

  it('ignora títulos pagos fora da janela', () => {
    const titulos: TituloRecuperavel[] = [
      { valor: 1000, resolvido_em: diasAtras(5) },
      { valor: 9999, resolvido_em: diasAtras(45) },
    ];
    expect(somarRecuperado(titulos, 30, AGORA)).toBe(1000);
  });

  it('ignora títulos sem resolvido_em (pagos antes desta funcionalidade existir)', () => {
    const titulos: TituloRecuperavel[] = [
      { valor: 1000, resolvido_em: diasAtras(2) },
      { valor: 7777, resolvido_em: null },
    ];
    expect(somarRecuperado(titulos, 30, AGORA)).toBe(1000);
  });

  it('ignora timestamp inválido em vez de virar NaN', () => {
    const titulos: TituloRecuperavel[] = [
      { valor: 100, resolvido_em: 'não é uma data' },
      { valor: 250, resolvido_em: diasAtras(1) },
    ];
    expect(somarRecuperado(titulos, 30, AGORA)).toBe(250);
  });

  it('devolve zero quando não há nada recuperado', () => {
    expect(somarRecuperado([], 30, AGORA)).toBe(0);
  });

  it('respeita uma janela customizada', () => {
    const titulos: TituloRecuperavel[] = [
      { valor: 300, resolvido_em: diasAtras(2) },
      { valor: 400, resolvido_em: diasAtras(20) },
    ];
    expect(somarRecuperado(titulos, 7, AGORA)).toBe(300);
    expect(somarRecuperado(titulos, 30, AGORA)).toBe(700);
  });

  it('aceita valor vindo do banco como string (numeric do Postgres)', () => {
    const titulos = [
      { valor: '1500.50' as unknown as number, resolvido_em: diasAtras(1) },
    ];
    expect(somarRecuperado(titulos, 30, AGORA)).toBe(1500.5);
  });

  it('compara instantes, não strings — formato do Postgres (+00:00) vs JS (Z)', () => {
    const dentro = new Date(AGORA);
    dentro.setDate(dentro.getDate() - 1);
    const comOffsetPostgres = dentro.toISOString().replace('Z', '+00:00');
    expect(somarRecuperado([{ valor: 42, resolvido_em: comOffsetPostgres }], 30, AGORA)).toBe(42);
  });
});
