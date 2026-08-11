import { describe, it, expect, vi } from 'vitest';
import { gravarLoteDeTitulos, CONFLITO_UNICIDADE, MAX_TENTATIVAS_CONFLITO, type Portas } from './importacao';
import type { TituloExistente, TituloParaInserir } from './csv-import';
import type { Resultado } from './supabase-io';

// ---------------------------------------------------------------------------
// Esta máquina de estados produziu dois defeitos reais no ciclo em que nasceu,
// e nenhum apareceu em teste — ela morava dentro da rota e só era alcançável
// subindo servidor e provocando concorrência à mão. Os dois estão cobertos aqui
// como regressão explícita.
// ---------------------------------------------------------------------------

const titulo = (n: number, cliente = 'cli-1', valor = 100): TituloParaInserir => ({
  linha: n,
  cliente_id: cliente,
  valor,
  data_vencimento: '2026-03-10',
});

const comoExistente = (t: TituloParaInserir): TituloExistente => ({
  cliente_id: t.cliente_id,
  valor: t.valor,
  data_vencimento: t.data_vencimento,
});

const ok = (linhas: TituloParaInserir[]): Resultado<{ id: string }[]> => ({
  ok: true,
  data: linhas.map((_, i) => ({ id: `novo-${i}` })),
  count: null,
});

const conflito = (): Resultado<{ id: string }[]> => ({
  ok: false,
  indisponivel: false,
  mensagem: 'O banco de dados recusou a operação.',
  // A mensagem do Postgres NÃO contém o número do SQLSTATE — é justamente
  // por isso que a discriminação precisa ser pelo campo `codigo`.
  detalhe: 'duplicate key value violates unique constraint "idx_titulos_aberto_unico"',
  codigo: CONFLITO_UNICIDADE,
});

const redeFora = (): Resultado<{ id: string }[]> => ({
  ok: false,
  indisponivel: true,
  mensagem: 'Não foi possível falar com o banco de dados. Verifique a conexão e tente de novo.',
  detalhe: 'TypeError: fetch failed',
  codigo: '',
});

const erroDeBanco = (): Resultado<{ id: string }[]> => ({
  ok: false,
  indisponivel: false,
  mensagem: 'O banco de dados recusou a operação.',
  detalhe: 'new row violates check constraint',
  codigo: '23514',
});

/** Dublê: um "banco" com um conjunto de títulos que outra importação já gravou. */
function portasFalsas(opcoes: {
  jaNoBanco?: TituloParaInserir[];
  respostas?: Resultado<{ id: string }[]>[];
  lerFalha?: boolean;
}): Portas & { inseridos: TituloParaInserir[][]; leituras: number } {
  const estado = { inseridos: [] as TituloParaInserir[][], leituras: 0 };
  const jaNoBanco = [...(opcoes.jaNoBanco ?? [])];
  const respostas = [...(opcoes.respostas ?? [])];

  return {
    ...estado,
    get inseridos() { return estado.inseridos; },
    get leituras() { return estado.leituras; },
    async inserir(lote) {
      estado.inseridos.push(lote);
      const proxima = respostas.shift();
      if (proxima) return proxima;
      jaNoBanco.push(...lote);
      return ok(lote);
    },
    async lerExistentes() {
      estado.leituras++;
      if (opcoes.lerFalha) throw new Error('leitura falhou');
      return jaNoBanco.map(comoExistente);
    },
  };
}

describe('gravarLoteDeTitulos — caminho sem concorrência', () => {
  it('grava o lote inteiro e não consulta nada', async () => {
    const lote = [titulo(2), titulo(3, 'cli-2')];
    const portas = portasFalsas({});
    const r = await gravarLoteDeTitulos(lote, portas);

    expect(r).toEqual({ gravados: 2, duplicatasDeCorrida: 0 });
    expect(portas.leituras).toBe(0);
  });

  it('conta o que o banco aceitou, não o que foi pedido', async () => {
    // Se algum dia o insert virar ON CONFLICT DO NOTHING, `lote.length` passa a
    // mentir. A contagem vem das linhas devolvidas.
    const lote = [titulo(2), titulo(3, 'cli-2'), titulo(4, 'cli-3')];
    const portas = portasFalsas({
      respostas: [{ ok: true, data: [{ id: 'a' }], count: null }],
    });
    const r = await gravarLoteDeTitulos(lote, portas);
    expect(r.gravados).toBe(1);
    expect(r.duplicatasDeCorrida).toBe(2);
  });

  it('lote vazio não toca no banco', async () => {
    const portas = portasFalsas({});
    const r = await gravarLoteDeTitulos([], portas);
    expect(r).toEqual({ gravados: 0, duplicatasDeCorrida: 0 });
    expect(portas.inseridos).toHaveLength(0);
  });
});

describe('gravarLoteDeTitulos — conflito de unicidade', () => {
  it('REGRESSÃO: reconhece o conflito pelo CÓDIGO, não pela mensagem', async () => {
    // A primeira versão procurava "23505" dentro da mensagem do Postgres, que é
    // texto humano e não contém o número. O tratamento de conflito inteiro
    // ficava morto e o usuário recebia "não gravado" para linhas que existiam.
    const lote = [titulo(2), titulo(3, 'cli-2')];
    const portas = portasFalsas({ jaNoBanco: [lote[0]], respostas: [conflito()] });

    const r = await gravarLoteDeTitulos(lote, portas);

    expect(r.falha).toBeUndefined();
    expect(r.gravados).toBe(1);
    expect(r.duplicatasDeCorrida).toBe(1);
  });

  it('reenvia só o que falta depois do conflito', async () => {
    const lote = [titulo(2), titulo(3, 'cli-2'), titulo(4, 'cli-3')];
    const portas = portasFalsas({ jaNoBanco: [lote[0]], respostas: [conflito()] });

    await gravarLoteDeTitulos(lote, portas);

    expect(portas.inseridos[0]).toHaveLength(3);
    expect(portas.inseridos[1]).toHaveLength(2);
    expect(portas.inseridos[1].map((t) => t.linha)).toEqual([3, 4]);
  });

  it('tudo já existe: nada a gravar, tudo duplicata, sem erro', async () => {
    const lote = [titulo(2), titulo(3, 'cli-2')];
    const portas = portasFalsas({ jaNoBanco: lote, respostas: [conflito()] });

    const r = await gravarLoteDeTitulos(lote, portas);

    expect(r).toEqual({ gravados: 0, duplicatasDeCorrida: 2 });
    expect(portas.inseridos).toHaveLength(1);
  });

  it('REGRESSÃO: tentativas esgotadas com tudo no banco NÃO viram perda', async () => {
    // Com 4 importações simultâneas de 120 linhas, as três perdedoras diziam
    // "0 importados, 20 duplicatas, 100 NÃO GRAVADAS" — com as 120 no banco.
    // Era o bug original invertido: em vez de esconder duplicata, inventava
    // perda, e o usuário reimportaria atrás de algo que já existe.
    const lote = [titulo(2), titulo(3, 'cli-2'), titulo(4, 'cli-3')];
    // Conflita sempre; o "banco" já tem tudo, mas só revela na conciliação.
    const respostas = Array.from({ length: MAX_TENTATIVAS_CONFLITO + 1 }, conflito);
    const portas = portasFalsas({ jaNoBanco: lote, respostas });

    const r = await gravarLoteDeTitulos(lote, portas);

    expect(r.falha).toBeUndefined();
    expect(r.gravados).toBe(0);
    expect(r.duplicatasDeCorrida).toBe(3);
  });

  it('tentativas esgotadas com algo faltando de verdade reporta falha honesta', async () => {
    const lote = [titulo(2), titulo(3, 'cli-2'), titulo(4, 'cli-3')];
    const respostas = Array.from({ length: MAX_TENTATIVAS_CONFLITO + 1 }, conflito);
    // Só duas das três existem — a terceira realmente não foi gravada.
    const portas = portasFalsas({ jaNoBanco: [lote[0], lote[1]], respostas });

    const r = await gravarLoteDeTitulos(lote, portas);

    expect(r.falha).toBeDefined();
    expect(r.falha?.indisponivel).toBe(false);
    expect(r.duplicatasDeCorrida).toBe(2);
    expect(r.gravados).toBe(0);
  });

  it('não repete a mesma requisição para sempre quando nada muda', async () => {
    // Conflita mas a releitura não mostra nada novo: insistir seria laço.
    const lote = [titulo(2)];
    const portas = portasFalsas({ jaNoBanco: [], respostas: Array.from({ length: 10 }, conflito) });

    const r = await gravarLoteDeTitulos(lote, portas);

    expect(r.falha).toBeDefined();
    expect(portas.inseridos.length).toBeLessThanOrEqual(MAX_TENTATIVAS_CONFLITO);
  });

  it('a contabilidade fecha em todos os desfechos de conflito', async () => {
    const lote = [titulo(2), titulo(3, 'cli-2'), titulo(4, 'cli-3'), titulo(5, 'cli-4')];
    for (const jaNoBanco of [[], [lote[0]], [lote[0], lote[1]], lote]) {
      const portas = portasFalsas({ jaNoBanco, respostas: [conflito()] });
      const r = await gravarLoteDeTitulos(lote, portas);
      const contabilizado = r.gravados + r.duplicatasDeCorrida;
      expect(contabilizado).toBeLessThanOrEqual(lote.length);
      if (!r.falha) expect(contabilizado).toBe(lote.length);
    }
  });
});

describe('gravarLoteDeTitulos — falhas que não são conflito', () => {
  it('rede fora é indisponibilidade, não duplicata', async () => {
    const lote = [titulo(2)];
    const portas = portasFalsas({ respostas: [redeFora()] });

    const r = await gravarLoteDeTitulos(lote, portas);

    expect(r.falha?.indisponivel).toBe(true);
    expect(r.duplicatasDeCorrida).toBe(0);
    expect(portas.leituras).toBe(0);
  });

  it('erro de banco que não é conflito para na hora, sem reconsultar', async () => {
    const lote = [titulo(2)];
    const portas = portasFalsas({ respostas: [erroDeBanco()] });

    const r = await gravarLoteDeTitulos(lote, portas);

    expect(r.falha?.indisponivel).toBe(false);
    expect(portas.inseridos).toHaveLength(1);
    expect(portas.leituras).toBe(0);
  });

  it('se a releitura falhar, reporta indisponibilidade em vez de adivinhar', async () => {
    const lote = [titulo(2)];
    const portas = portasFalsas({ respostas: [conflito()], lerFalha: true });

    const r = await gravarLoteDeTitulos(lote, portas);

    expect(r.falha?.indisponivel).toBe(true);
    expect(r.duplicatasDeCorrida).toBe(0);
  });

  it('nunca lança — quem chama precisa do relatório, não de exceção', async () => {
    const portas: Portas = {
      inserir: vi.fn().mockResolvedValue(conflito()),
      lerExistentes: vi.fn().mockRejectedValue(new Error('explodiu')),
    };
    await expect(gravarLoteDeTitulos([titulo(2)], portas)).resolves.toBeDefined();
  });
});
