import { describe, it, expect } from 'vitest';
import { ultimoContatoPorCliente, foiHoje, rotuloContato, rotuloReentrada } from './contato';

// Datas montadas no fuso LOCAL: o rótulo usa o relógio de quem renderiza, e
// assim o teste passa em qualquer fuso em que a suíte rodar.
const AGORA = new Date(2026, 8, 23, 15, 0); // 23/09/2026 15:00 local

describe('ultimoContatoPorCliente', () => {
  it('fica com o contato mais recente entre todos os títulos do cliente', () => {
    const mapa = ultimoContatoPorCliente([
      { cliente_id: 'a', interacoes: [{ data_envio: '2026-09-20T10:00:00' }] },
      { cliente_id: 'a', interacoes: [{ data_envio: '2026-09-22T09:00:00' }, { data_envio: '2026-09-21T09:00:00' }] },
      { cliente_id: 'b', interacoes: [{ data_envio: '2026-09-01T12:00:00' }] },
    ]);
    expect(mapa.get('a')?.toISOString()).toBe('2026-09-22T09:00:00.000Z');
    expect(mapa.get('b')?.toISOString()).toBe('2026-09-01T12:00:00.000Z');
  });

  it('lê data_envio sem fuso como UTC', () => {
    const mapa = ultimoContatoPorCliente([
      { cliente_id: 'a', interacoes: [{ data_envio: '2026-09-21T10:21:49.650311' }] },
    ]);
    expect(mapa.get('a')?.toISOString()).toBe('2026-09-21T10:21:49.650Z');
  });

  it('ignora título sem interação, data nula e data ilegível', () => {
    const mapa = ultimoContatoPorCliente([
      { cliente_id: 'a' },
      { cliente_id: 'a', interacoes: null },
      { cliente_id: 'a', interacoes: [{ data_envio: null }, { data_envio: 'não é data' }] },
    ]);
    expect(mapa.has('a')).toBe(false);
  });
});

describe('foiHoje', () => {
  it('compara o dia de calendário local', () => {
    expect(foiHoje(new Date(2026, 8, 23, 0, 1), AGORA)).toBe(true);
    expect(foiHoje(new Date(2026, 8, 22, 23, 59), AGORA)).toBe(false);
  });
});

describe('rotuloContato', () => {
  it('hoje e ontem trazem a hora', () => {
    expect(rotuloContato(new Date(2026, 8, 23, 10, 32), AGORA)).toBe('hoje às 10:32');
    expect(rotuloContato(new Date(2026, 8, 22, 16, 5), AGORA)).toBe('ontem às 16:05');
  });

  it('na mesma semana conta os dias', () => {
    expect(rotuloContato(new Date(2026, 8, 20, 9, 0), AGORA)).toBe('há 3 dias');
    expect(rotuloContato(new Date(2026, 8, 17, 9, 0), AGORA)).toBe('há 6 dias');
  });

  it('depois disso mostra a data, com ano só se for outro', () => {
    expect(rotuloContato(new Date(2026, 8, 2, 9, 0), AGORA)).toBe('em 02/09');
    expect(rotuloContato(new Date(2025, 11, 30, 9, 0), AGORA)).toBe('em 30/12/2025');
  });

  it('instante no futuro (relógios desencontrados) conta como hoje', () => {
    expect(rotuloContato(new Date(2026, 8, 23, 15, 5), AGORA)).toBe('hoje às 15:05');
  });

  it('a virada do dia vale mais que as horas: 23h de ontem é "ontem"', () => {
    expect(rotuloContato(new Date(2026, 8, 22, 23, 50), new Date(2026, 8, 23, 0, 10))).toBe('ontem às 23:50');
  });
});

describe('rotuloReentrada', () => {
  const HOJE = '2026-09-23';

  it('promessa de dia passado é vencida, com a data', () => {
    expect(rotuloReentrada({ motivoReentrada: 'promessa_vencida', data_promessa: '2026-09-20' }, HOJE)).toBe(
      'promessa de 20/09 vencida',
    );
  });

  it('promessa para hoje NÃO é vencida — voltou só para ser conferida', () => {
    expect(rotuloReentrada({ motivoReentrada: 'promessa_vencida', data_promessa: HOJE }, HOJE)).toBe(
      'promessa para hoje',
    );
  });

  it('promessa sem data e silêncio expirado têm rótulo próprio', () => {
    expect(rotuloReentrada({ motivoReentrada: 'promessa_vencida', data_promessa: null }, HOJE)).toBe(
      'promessa vencida',
    );
    expect(rotuloReentrada({ motivoReentrada: 'silencio_expirado', data_promessa: null }, HOJE)).toBe(
      'voltou após sem resposta',
    );
  });

  it('título na fila pela primeira vez não tem rótulo', () => {
    expect(rotuloReentrada({ motivoReentrada: null, data_promessa: null }, HOJE)).toBeNull();
  });
});
