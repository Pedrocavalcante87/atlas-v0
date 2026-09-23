import { describe, it, expect } from 'vitest';
import {
  formatarMoeda,
  plural,
  formatarTelefone,
  formatarData,
  formatarDataCurta,
  dataLocalISO,
  instanteDoBanco,
  formatarHora,
  comMaiuscula,
  rotuloVencimento,
} from './format';

// `toLocaleString` separa "R$" do número com um espaço sem quebra.
const semNbsp = (s: string) => s.replace(/ /g, ' ');

describe('formatarMoeda', () => {
  it('formata em real com milhar e centavos', () => {
    expect(semNbsp(formatarMoeda(1234.5))).toBe('R$ 1.234,50');
    expect(semNbsp(formatarMoeda(0))).toBe('R$ 0,00');
  });
});

describe('plural', () => {
  it('usa o singular só para um', () => {
    expect(plural(1, 'dia', 'dias')).toBe('1 dia');
    expect(plural(0, 'dia', 'dias')).toBe('0 dias');
    expect(plural(12, 'título', 'títulos')).toBe('12 títulos');
  });

  it('trata menos um como um', () => {
    expect(plural(-1, 'dia', 'dias')).toBe('-1 dia');
  });
});

describe('formatarTelefone', () => {
  it('formata celular e fixo brasileiros com DDI', () => {
    expect(formatarTelefone('5511988887777')).toBe('+55 11 98888-7777');
    expect(formatarTelefone('551133334444')).toBe('+55 11 3333-4444');
  });

  it('devolve intacto o que não reconhece', () => {
    expect(formatarTelefone('12345')).toBe('12345');
  });
});

describe('datas de calendário', () => {
  it('formata YYYY-MM-DD sem passar por fuso', () => {
    expect(formatarData('2026-09-01')).toBe('01/09/2026');
    expect(formatarDataCurta('2026-09-01')).toBe('01/09');
  });

  it('aceita timestamp e usa só a parte da data', () => {
    expect(formatarData('2026-09-21T10:21:49.650311')).toBe('21/09/2026');
  });

  it('dataLocalISO usa o calendário local, não o UTC', () => {
    // 23h do dia 23 no fuso local continua sendo dia 23, em qualquer fuso.
    expect(dataLocalISO(new Date(2026, 8, 23, 23, 30))).toBe('2026-09-23');
    expect(dataLocalISO(new Date(2026, 0, 5, 0, 5))).toBe('2026-01-05');
  });
});

describe('instanteDoBanco', () => {
  it('lê timestamp sem fuso como UTC — o caso medido de data_envio', () => {
    expect(instanteDoBanco('2026-09-21T10:21:49.650311').toISOString()).toBe('2026-09-21T10:21:49.650Z');
  });

  it('respeita o fuso quando ele vem', () => {
    expect(instanteDoBanco('2026-09-21T10:21:49.218+00:00').toISOString()).toBe('2026-09-21T10:21:49.218Z');
    expect(instanteDoBanco('2026-09-21T07:21:49-03:00').toISOString()).toBe('2026-09-21T10:21:49.000Z');
    expect(instanteDoBanco('2026-09-21T10:21:49Z').toISOString()).toBe('2026-09-21T10:21:49.000Z');
  });

  it('aceita espaço no lugar do T', () => {
    expect(instanteDoBanco('2026-09-21 10:21:49').toISOString()).toBe('2026-09-21T10:21:49.000Z');
  });
});

describe('formatarHora', () => {
  it('mostra hora e minuto locais com dois dígitos', () => {
    expect(formatarHora(new Date(2026, 8, 23, 9, 5))).toBe('09:05');
  });
});

describe('comMaiuscula', () => {
  it('só a primeira letra — "de setembro" continua minúsculo', () => {
    expect(comMaiuscula('quarta-feira, 23 de setembro')).toBe('Quarta-feira, 23 de setembro');
    expect(comMaiuscula('')).toBe('');
  });
});

describe('rotuloVencimento', () => {
  it('forma longa, para a lista de títulos', () => {
    expect(rotuloVencimento(12)).toBe('12 dias em atraso');
    expect(rotuloVencimento(1)).toBe('1 dia em atraso');
    expect(rotuloVencimento(0)).toBe('vence hoje');
    expect(rotuloVencimento(-1)).toBe('vence amanhã');
    expect(rotuloVencimento(-3)).toBe('vence em 3 dias');
  });

  it('forma curta, para a coluna da tabela', () => {
    expect(rotuloVencimento(12, 'curto')).toBe('12 dias');
    expect(rotuloVencimento(1, 'curto')).toBe('1 dia');
    expect(rotuloVencimento(0, 'curto')).toBe('vence hoje');
    expect(rotuloVencimento(-1, 'curto')).toBe('vence amanhã');
    expect(rotuloVencimento(-2, 'curto')).toBe('em 2 dias');
  });
});
