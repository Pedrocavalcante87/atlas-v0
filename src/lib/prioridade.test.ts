import { describe, it, expect } from 'vitest';
import {
  calcularDiasAtraso,
  categorizarTitulo,
  priorizarTitulos,
  agruparPorCliente,
} from './prioridade';
import type { Titulo, Cliente, TituloComPrioridade } from '@/types';

// Datas relativas a hoje, no formato ISO (YYYY-MM-DD) — evita testes que
// quebram sozinhos daqui a um mês por causa de data hardcoded.
function isoOffset(dias: number): string {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + dias);
  return d.toISOString().split('T')[0];
}

describe('calcularDiasAtraso', () => {
  it('retorna positivo para data vencida', () => {
    expect(calcularDiasAtraso(isoOffset(-10))).toBe(10);
  });

  it('retorna negativo para data futura', () => {
    expect(calcularDiasAtraso(isoOffset(5))).toBe(-5);
  });

  it('retorna zero para vencimento hoje', () => {
    expect(calcularDiasAtraso(isoOffset(0))).toBe(0);
  });
});

describe('categorizarTitulo', () => {
  it('classifica mais de 7 dias de atraso como atraso_longo', () => {
    expect(categorizarTitulo(8)).toBe('atraso_longo');
    expect(categorizarTitulo(365)).toBe('atraso_longo');
  });

  it('classifica exatamente 7 dias como atraso_leve (limite inclusivo)', () => {
    expect(categorizarTitulo(7)).toBe('atraso_leve');
  });

  it('classifica 1 a 7 dias como atraso_leve', () => {
    expect(categorizarTitulo(1)).toBe('atraso_leve');
    expect(categorizarTitulo(4)).toBe('atraso_leve');
  });

  it('classifica hoje até 3 dias no futuro como preventivo', () => {
    expect(categorizarTitulo(0)).toBe('preventivo');
    expect(categorizarTitulo(-1)).toBe('preventivo');
    expect(categorizarTitulo(-3)).toBe('preventivo');
  });

  it('não classifica (retorna null) vencimento a mais de 3 dias no futuro', () => {
    expect(categorizarTitulo(-4)).toBeNull();
    expect(categorizarTitulo(-100)).toBeNull();
  });
});

const cliente: Cliente = { id: 'c1', nome: 'João Silva', telefone: '5511999990000', criado_em: '' };

function titulo(overrides: Partial<Titulo> = {}): Titulo & { clientes: Cliente } {
  return {
    id: overrides.id ?? 'default-id',
    cliente_id: cliente.id,
    valor: 100,
    data_vencimento: isoOffset(-1),
    status: 'aberto',
    data_promessa: null,
    criado_em: '',
    clientes: cliente,
    ...overrides,
  };
}

describe('priorizarTitulos', () => {
  it('ignora títulos que não estão abertos', () => {
    const resultado = priorizarTitulos([titulo({ id: 't1', status: 'pago' })]);
    expect(resultado).toHaveLength(0);
  });

  it('ignora títulos vencendo a mais de 3 dias no futuro (não urgentes)', () => {
    const resultado = priorizarTitulos([titulo({ id: 't1', data_vencimento: isoOffset(10) })]);
    expect(resultado).toHaveLength(0);
  });

  it('calcula score = dias_em_atraso × valor só para vencidos', () => {
    const resultado = priorizarTitulos([
      titulo({ id: 't1', data_vencimento: isoOffset(-10), valor: 200 }),
    ]);
    expect(resultado[0].score).toBe(2000);
  });

  it('score é zero para preventivos (ainda não vencidos)', () => {
    const resultado = priorizarTitulos([titulo({ id: 't1', data_vencimento: isoOffset(0), valor: 200 })]);
    expect(resultado[0].score).toBe(0);
  });

  it('ordena vencidos por score decrescente, à frente dos preventivos', () => {
    const menorScore = titulo({ id: 'baixo', data_vencimento: isoOffset(-5), valor: 100 }); // 500
    const maiorScore = titulo({ id: 'alto', data_vencimento: isoOffset(-10), valor: 500 }); // 5000
    const preventivo = titulo({ id: 'prev', data_vencimento: isoOffset(1) });

    const resultado = priorizarTitulos([menorScore, preventivo, maiorScore]);

    expect(resultado.map((t) => t.id)).toEqual(['alto', 'baixo', 'prev']);
  });

  it('ordena preventivos por vencimento mais próximo primeiro', () => {
    const longe = titulo({ id: 'longe', data_vencimento: isoOffset(3) });
    const perto = titulo({ id: 'perto', data_vencimento: isoOffset(0) });

    const resultado = priorizarTitulos([longe, perto]);

    expect(resultado.map((t) => t.id)).toEqual(['perto', 'longe']);
  });

  it('exemplo do README: R$200 com 10 dias perde para R$500 com 5 dias', () => {
    const a = titulo({ id: 'a', valor: 200, data_vencimento: isoOffset(-10) }); // score 2000
    const b = titulo({ id: 'b', valor: 500, data_vencimento: isoOffset(-5) }); // score 2500

    const resultado = priorizarTitulos([a, b]);

    expect(resultado.map((t) => t.id)).toEqual(['b', 'a']);
  });
});

describe('agruparPorCliente', () => {
  function comPrioridade(overrides: Partial<TituloComPrioridade>): TituloComPrioridade {
    const diasAtraso = overrides.diasAtraso ?? 5;
    const valor = overrides.valor ?? 100;
    return {
      id: overrides.id ?? 'id',
      cliente_id: cliente.id,
      valor,
      data_vencimento: isoOffset(-diasAtraso),
      status: 'aberto',
      data_promessa: null,
      criado_em: '',
      cliente,
      score: diasAtraso > 0 ? diasAtraso * valor : 0,
      categoria: overrides.categoria ?? 'atraso_leve',
      diasAtraso,
      mensagem: 'msg',
      ...overrides,
    };
  }

  it('agrupa múltiplos títulos do mesmo cliente em um único grupo', () => {
    const grupos = agruparPorCliente([
      comPrioridade({ id: 't1', valor: 100 }),
      comPrioridade({ id: 't2', valor: 200 }),
    ]);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].titulos).toHaveLength(2);
    expect(grupos[0].valorTotal).toBe(300);
  });

  it('categoriaMaisUrgente reflete o pior caso entre os títulos do cliente', () => {
    const grupos = agruparPorCliente([
      comPrioridade({ id: 't1', categoria: 'preventivo', diasAtraso: -1 }),
      comPrioridade({ id: 't2', categoria: 'atraso_longo', diasAtraso: 10 }),
    ]);
    expect(grupos[0].categoriaMaisUrgente).toBe('atraso_longo');
  });

  it('diasAtrasoMax é o maior valor entre os títulos do cliente', () => {
    const grupos = agruparPorCliente([
      comPrioridade({ id: 't1', diasAtraso: 3 }),
      comPrioridade({ id: 't2', diasAtraso: 15 }),
    ]);
    expect(grupos[0].diasAtrasoMax).toBe(15);
  });

  it('clientes distintos geram grupos distintos', () => {
    const outroCliente: Cliente = { id: 'c2', nome: 'Maria', telefone: '5511988880000', criado_em: '' };
    const grupos = agruparPorCliente([
      comPrioridade({ id: 't1' }),
      { ...comPrioridade({ id: 't2' }), cliente_id: outroCliente.id, cliente: outroCliente },
    ]);
    expect(grupos).toHaveLength(2);
  });
});
