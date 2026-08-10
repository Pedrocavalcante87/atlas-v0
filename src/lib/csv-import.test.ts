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
    const resultado = validarLinhaRecebida(linhaValida);
    expect(resultado.ok).toBe(true);
    if (resultado.ok) expect(resultado.linha).toEqual(linhaValida);
  });

  it('rejeita entrada que não é objeto', () => {
    expect(validarLinhaRecebida(null).ok).toBe(false);
    expect(validarLinhaRecebida('string').ok).toBe(false);
    expect(validarLinhaRecebida(42).ok).toBe(false);
  });

  it('rejeita nome vazio', () => {
    expect(validarLinhaRecebida({ ...linhaValida, nome: '' }).ok).toBe(false);
  });

  it('rejeita nome absurdamente longo', () => {
    expect(validarLinhaRecebida({ ...linhaValida, nome: 'x'.repeat(201) }).ok).toBe(false);
  });

  it('rejeita telefone fora do formato normalizado (não numérico ou tamanho errado)', () => {
    expect(validarLinhaRecebida({ ...linhaValida, telefone: '(11) 99999-0000' }).ok).toBe(false);
    expect(validarLinhaRecebida({ ...linhaValida, telefone: '123' }).ok).toBe(false);
  });

  it('rejeita valor não numérico, zero, negativo ou acima do teto de sanidade', () => {
    expect(validarLinhaRecebida({ ...linhaValida, valor: 'não é número' }).ok).toBe(false);
    expect(validarLinhaRecebida({ ...linhaValida, valor: 0 }).ok).toBe(false);
    expect(validarLinhaRecebida({ ...linhaValida, valor: -100 }).ok).toBe(false);
    expect(validarLinhaRecebida({ ...linhaValida, valor: 10_000_000_000 }).ok).toBe(false);
  });

  it('rejeita data fora do formato ISO ou fora da faixa razoável', () => {
    expect(validarLinhaRecebida({ ...linhaValida, dataVencimento: '15/08/2025' }).ok).toBe(false);
    expect(validarLinhaRecebida({ ...linhaValida, dataVencimento: '1900-01-01' }).ok).toBe(false);
  });

  it('explica o motivo da recusa em vez de só negar', () => {
    const resultado = validarLinhaRecebida({ ...linhaValida, telefone: '123' });
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.motivo).toMatch(/telefone/i);
      expect(resultado.motivo).toContain('123');
    }
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
    expect(validarLinhaRecebida(payloadForjado).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Paridade prévia × confirmação. A prévia normaliza texto cru do CSV e depois
// chama validarLinhaRecebida como portão final; a confirmação chama a mesma
// função. Estes testes cobrem o caso que antes divergia: telefones que a
// prévia aceitava (>= 8 dígitos) e a gravação recusava (10-15 dígitos), o que
// virava descarte silencioso.
// ---------------------------------------------------------------------------
describe('paridade entre prévia e confirmação', () => {
  /** Reproduz a normalização que api/upload-csv/route.ts faz antes do portão. */
  function normalizarComoPrevia(nome: string, telefoneRaw: string, valorRaw: string, dataRaw: string) {
    return {
      linha: 2,
      nome,
      telefone: limparTelefone(telefoneRaw),
      valor: normalizarValor(valorRaw),
      dataVencimento: normalizarData(dataRaw) ?? '',
    };
  }

  const hoje = new Date();
  const dataOk = `${hoje.getFullYear()}-01-15`;

  it('telefone brasileiro comum passa nos dois lados', () => {
    const linha = normalizarComoPrevia('Cliente', '(11) 99999-0000', 'R$ 1.500,00', dataOk);
    expect(validarLinhaRecebida(linha).ok).toBe(true);
  });

  it('telefone de 8 dígitos (fixo sem DDD) vira 10 com o DDI e passa nos dois lados', () => {
    const linha = normalizarComoPrevia('Cliente', '33334444', '100', dataOk);
    expect(linha.telefone).toBe('5533334444');
    expect(validarLinhaRecebida(linha).ok).toBe(true);
  });

  it('telefone longo demais é recusado — e a prévia recusa junto, sem descarte silencioso', () => {
    const linha = normalizarComoPrevia('Cliente', '1234567890123456', '100', dataOk);
    const resultado = validarLinhaRecebida(linha);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.motivo).toMatch(/telefone/i);
  });
});
