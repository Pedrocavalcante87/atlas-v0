import { describe, it, expect } from 'vitest';
import {
  normalizarValor,
  normalizarData,
  limparTelefone,
  detectarMapeamentoColunas,
  dataEmFaixaRazoavel,
  validarLinhaRecebida,
} from './csv-import';

describe('normalizarValor', () => {
  it('aceita número simples sem separador', () => {
    expect(normalizarValor('1500')).toBe(1500);
  });

  it('aceita vírgula decimal', () => {
    expect(normalizarValor('1500,00')).toBe(1500);
  });

  it('aceita ponto decimal', () => {
    expect(normalizarValor('1500.00')).toBe(1500);
  });

  it('aceita formato BR com milhar (ponto) e decimal (vírgula)', () => {
    expect(normalizarValor('1.500,00')).toBe(1500);
  });

  it('aceita formato US com milhar (vírgula) e decimal (ponto)', () => {
    expect(normalizarValor('1,500.00')).toBe(1500);
  });

  it('remove símbolo de moeda R$', () => {
    expect(normalizarValor('R$ 1.500,00')).toBe(1500);
  });

  it('remove símbolo de moeda $', () => {
    expect(normalizarValor('$ 1,500.00')).toBe(1500);
  });

  it('trata milhar sem decimal (vírgula com 3+ dígitos depois) como separador de milhar', () => {
    expect(normalizarValor('1,500')).toBe(1500);
  });
});

describe('normalizarData', () => {
  it('aceita AAAA-MM-DD (já normalizado)', () => {
    expect(normalizarData('2025-08-15')).toBe('2025-08-15');
  });

  it('converte DD/MM/AAAA', () => {
    expect(normalizarData('15/08/2025')).toBe('2025-08-15');
  });

  it('converte DD-MM-AAAA', () => {
    expect(normalizarData('15-08-2025')).toBe('2025-08-15');
  });

  it('converte DD.MM.AAAA', () => {
    expect(normalizarData('15.08.2025')).toBe('2025-08-15');
  });

  it('converte AAAA/MM/DD', () => {
    expect(normalizarData('2025/08/15')).toBe('2025-08-15');
  });

  it('converte AAAAMMDD compacto', () => {
    expect(normalizarData('20250815')).toBe('2025-08-15');
  });

  it('preserva zero à esquerda em dia/mês de um dígito', () => {
    expect(normalizarData('5/8/2025')).toBe('2025-08-05');
  });

  it('retorna null para formato não reconhecido', () => {
    expect(normalizarData('15 de agosto de 2025')).toBeNull();
    expect(normalizarData('não é uma data')).toBeNull();
    expect(normalizarData('')).toBeNull();
  });
});

describe('limparTelefone', () => {
  it('remove caracteres não numéricos', () => {
    expect(limparTelefone('(11) 99999-0000')).toBe('5511999990000');
  });

  it('não duplica o 55 se já presente', () => {
    expect(limparTelefone('5511999990000')).toBe('5511999990000');
  });

  it('adiciona 55 quando ausente', () => {
    expect(limparTelefone('11999990000')).toBe('5511999990000');
  });
});

describe('detectarMapeamentoColunas', () => {
  it('reconhece nomes de coluna canônicos', () => {
    const { mapping } = detectarMapeamentoColunas(['nome', 'telefone', 'valor', 'data_vencimento']);
    expect(mapping.nome).toBe('nome');
    expect(mapping.telefone).toBe('telefone');
    expect(mapping.valor).toBe('valor');
    expect(mapping.data_vencimento).toBe('data_vencimento');
  });

  it('reconhece aliases comuns de ERPs (sacado, celular, vl_titulo, vencimento)', () => {
    const { mapping } = detectarMapeamentoColunas(['sacado', 'celular', 'vl_titulo', 'vencimento']);
    expect(mapping.nome).toBe('sacado');
    expect(mapping.telefone).toBe('celular');
    expect(mapping.valor).toBe('vl_titulo');
    expect(mapping.data_vencimento).toBe('vencimento');
  });

  it('normaliza header com espaços, maiúsculas e pontuação antes de comparar', () => {
    const { mapping } = detectarMapeamentoColunas(['NOME COMPLETO', 'CLIENTE']);
    // "nome completo" normaliza pra "nome_completo", que não é alias — mas
    // "CLIENTE" normaliza pra "cliente", que é.
    expect(mapping.nome).toBe('CLIENTE');
  });

  it('retorna null para campo sem coluna correspondente', () => {
    const { mapping } = detectarMapeamentoColunas(['coluna_irrelevante']);
    expect(mapping.nome).toBeNull();
    expect(mapping.valor).toBeNull();
  });
});

describe('dataEmFaixaRazoavel', () => {
  it('aceita data de hoje', () => {
    const hoje = new Date().toISOString().split('T')[0];
    expect(dataEmFaixaRazoavel(hoje)).toBe(true);
  });

  it('rejeita data absurdamente no passado (provável erro de coluna)', () => {
    expect(dataEmFaixaRazoavel('1900-01-01')).toBe(false);
  });

  it('rejeita data absurdamente no futuro', () => {
    expect(dataEmFaixaRazoavel('2999-01-01')).toBe(false);
  });
});

describe('validarLinhaRecebida', () => {
  const linhaValida = {
    linha: 2,
    nome: 'João Silva',
    telefone: '5511999990000',
    valor: 150.5,
    dataVencimento: new Date().toISOString().split('T')[0],
  };

  it('aceita uma linha bem formada', () => {
    expect(validarLinhaRecebida(linhaValida)).toEqual(linhaValida);
  });

  it('rejeita entrada que não é objeto', () => {
    expect(validarLinhaRecebida(null)).toBeNull();
    expect(validarLinhaRecebida('string')).toBeNull();
    expect(validarLinhaRecebida(42)).toBeNull();
  });

  it('rejeita nome vazio', () => {
    expect(validarLinhaRecebida({ ...linhaValida, nome: '' })).toBeNull();
  });

  it('rejeita telefone fora do formato normalizado (não numérico ou tamanho errado)', () => {
    expect(validarLinhaRecebida({ ...linhaValida, telefone: '(11) 99999-0000' })).toBeNull();
    expect(validarLinhaRecebida({ ...linhaValida, telefone: '123' })).toBeNull();
  });

  it('rejeita valor não numérico, zero, negativo ou acima do teto de sanidade', () => {
    expect(validarLinhaRecebida({ ...linhaValida, valor: 'não é número' })).toBeNull();
    expect(validarLinhaRecebida({ ...linhaValida, valor: 0 })).toBeNull();
    expect(validarLinhaRecebida({ ...linhaValida, valor: -100 })).toBeNull();
    expect(validarLinhaRecebida({ ...linhaValida, valor: 10_000_000_000 })).toBeNull();
  });

  it('rejeita data fora do formato ISO ou fora da faixa razoável', () => {
    expect(validarLinhaRecebida({ ...linhaValida, dataVencimento: '15/08/2025' })).toBeNull();
    expect(validarLinhaRecebida({ ...linhaValida, dataVencimento: '1900-01-01' })).toBeNull();
  });

  it('é a defesa real contra um payload forjado no POST /confirmar', () => {
    // Simula alguém montando o request manualmente em vez de reenviar o que
    // a prévia gerou — exatamente o cenário de risco do ARCHITECTURE.md §9.
    const payloadForjado = {
      linha: 1,
      nome: 'Vítima',
      telefone: 'DROP TABLE titulos',
      valor: 999999999999,
      dataVencimento: 'amanhã',
    };
    expect(validarLinhaRecebida(payloadForjado)).toBeNull();
  });
});
