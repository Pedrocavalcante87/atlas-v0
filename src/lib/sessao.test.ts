import { describe, it, expect } from 'vitest';
import { criarValorDeSessao, sessaoValida, DURACAO_SESSAO_MS } from './sessao';

const SEGREDO = 'senha-do-app-para-teste';
/** "Agora" fixo: a validade é relativa, então o teste precisa de referência estável. */
const AGORA = new Date('2026-09-18T12:00:00-03:00').getTime();

const DIA_MS = 24 * 60 * 60 * 1000;

describe('criarValorDeSessao', () => {
  it('produz o formato versionado de três partes', () => {
    const partes = criarValorDeSessao(SEGREDO, AGORA).split('.');
    expect(partes).toHaveLength(3);
    expect(partes[0]).toBe('v1');
    expect(Number(partes[1])).toBe(AGORA + DURACAO_SESSAO_MS);
    expect(partes[2].length).toBeGreaterThan(0);
  });

  it('não contém a senha em lugar nenhum do valor', () => {
    expect(criarValorDeSessao(SEGREDO, AGORA)).not.toContain(SEGREDO);
  });

  it('assina de forma determinística para o mesmo instante e segredo', () => {
    expect(criarValorDeSessao(SEGREDO, AGORA)).toBe(criarValorDeSessao(SEGREDO, AGORA));
  });
});

describe('sessaoValida — o caminho legítimo', () => {
  it('aceita um valor recém-emitido', () => {
    expect(sessaoValida(SEGREDO, criarValorDeSessao(SEGREDO, AGORA), AGORA)).toBe(true);
  });

  it('aceita até o último instante antes de expirar', () => {
    const valor = criarValorDeSessao(SEGREDO, AGORA);
    const ultimoInstante = AGORA + DURACAO_SESSAO_MS - 1;
    expect(sessaoValida(SEGREDO, valor, ultimoInstante)).toBe(true);
  });
});

// Este bloco é o motivo do módulo existir: antes da correção, o valor do cookie
// era a string "1" e QUALQUER uma destas entradas era aceita como sessão válida.
describe('sessaoValida — recusa de valor forjado', () => {
  it('recusa o cookie literal "1" — o bypass que existia antes', () => {
    expect(sessaoValida(SEGREDO, '1', AGORA)).toBe(false);
  });

  it.each([
    ['vazio', ''],
    ['nulo', null],
    ['indefinido', undefined],
    ['sem separadores', 'qualquercoisa'],
    ['partes de menos', 'v1.99999999999'],
    ['partes de mais', 'v1.99999999999.abc.def'],
    ['versão desconhecida', 'v2.99999999999.abc'],
    ['expiração não numérica', 'v1.amanha.abc'],
    ['expiração com sufixo (parseInt aceitaria)', 'v1.99999999999dias.abc'],
    ['expiração vazia', 'v1..abc'],
  ])('recusa valor %s', (_rotulo, valor) => {
    expect(sessaoValida(SEGREDO, valor, AGORA)).toBe(false);
  });

  it('recusa assinatura trocada por outra de tamanho igual', () => {
    const valor = criarValorDeSessao(SEGREDO, AGORA);
    const [versao, exp, assinatura] = valor.split('.');
    // Troca o primeiro caractere por outro, preservando o comprimento — o
    // caminho de comparação que importa é o de tamanhos iguais.
    const alterada = (assinatura[0] === 'A' ? 'B' : 'A') + assinatura.slice(1);
    expect(sessaoValida(SEGREDO, `${versao}.${exp}.${alterada}`, AGORA)).toBe(false);
  });

  it('recusa assinatura vazia', () => {
    const [versao, exp] = criarValorDeSessao(SEGREDO, AGORA).split('.');
    expect(sessaoValida(SEGREDO, `${versao}.${exp}.`, AGORA)).toBe(false);
  });
});

describe('sessaoValida — expiração', () => {
  it('recusa depois do prazo', () => {
    const valor = criarValorDeSessao(SEGREDO, AGORA);
    expect(sessaoValida(SEGREDO, valor, AGORA + DURACAO_SESSAO_MS + 1)).toBe(false);
  });

  it('recusa exatamente no instante da expiração', () => {
    const valor = criarValorDeSessao(SEGREDO, AGORA);
    expect(sessaoValida(SEGREDO, valor, AGORA + DURACAO_SESSAO_MS)).toBe(false);
  });

  it('não deixa esticar a validade editando a expiração do próprio cookie', () => {
    // O ataque óbvio contra "a expiração viaja em claro": pegar um cookie
    // legítimo e adiar a data. A assinatura cobre a expiração, então não cola.
    const valor = criarValorDeSessao(SEGREDO, AGORA, DIA_MS);
    const [versao, , assinatura] = valor.split('.');
    const bemDepois = AGORA + 365 * DIA_MS;
    const esticado = `${versao}.${bemDepois}.${assinatura}`;

    expect(sessaoValida(SEGREDO, esticado, AGORA + 2 * DIA_MS)).toBe(false);
  });

  it('respeita uma duração customizada', () => {
    const valor = criarValorDeSessao(SEGREDO, AGORA, DIA_MS);
    expect(sessaoValida(SEGREDO, valor, AGORA + DIA_MS / 2)).toBe(true);
    expect(sessaoValida(SEGREDO, valor, AGORA + 2 * DIA_MS)).toBe(false);
  });
});

describe('sessaoValida — vínculo com o segredo', () => {
  it('recusa sessão assinada com outra senha', () => {
    const valor = criarValorDeSessao('outra-senha', AGORA);
    expect(sessaoValida(SEGREDO, valor, AGORA)).toBe(false);
  });

  it('trocar APP_PASSWORD invalida as sessões em curso', () => {
    const valor = criarValorDeSessao(SEGREDO, AGORA);
    expect(sessaoValida(SEGREDO, valor, AGORA)).toBe(true);
    expect(sessaoValida(`${SEGREDO}-rotacionada`, valor, AGORA)).toBe(false);
  });

  it('recusa qualquer valor quando não há segredo configurado', () => {
    const valor = criarValorDeSessao(SEGREDO, AGORA);
    expect(sessaoValida('', valor, AGORA)).toBe(false);
    expect(sessaoValida('', '1', AGORA)).toBe(false);
  });
});
