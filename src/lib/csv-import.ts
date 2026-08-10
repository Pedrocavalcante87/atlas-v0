// ---------------------------------------------------------------------------
// Domínio de importação de CSV — parsing de linha, normalização e validação.
// Sem I/O (não fala com o banco). Usado por DUAS rotas:
//   - api/upload-csv/route.ts            (prévia: parseia o arquivo inteiro)
//   - api/upload-csv/confirmar/route.ts  (confirmação: revalida cada linha
//     recebida do browser antes de gravar — não confia que o JSON que voltou
//     é de fato o que a prévia gerou)
// Extraído de api/upload-csv/route.ts, onde essa lógica vivia sozinha e não
// era reaproveitada pela rota de gravação (ver ARCHITECTURE.md §6 e §9).
// ---------------------------------------------------------------------------

// Mapa de aliases — colunas conhecidas de diferentes sistemas (ERP, planilhas)
export const COLUMN_ALIASES: Record<string, string[]> = {
  nome: [
    'nome', 'name', 'cliente', 'nome_cliente', 'razao_social', 'devedor',
    'sacado', 'nominativo', 'credor', 'beneficiario', 'pagador', 'empresa',
    'cliente_nome', 'nome_devedor', 'nome_sacado', 'titular', 'contratante',
  ],
  telefone: [
    'telefone', 'phone', 'celular', 'fone', 'tel', 'whatsapp', 'contato',
    'numero', 'telefone_celular', 'tel_celular', 'mobile', 'telefone_whatsapp',
    'cel', 'nr_celular', 'telefone1', 'fone1', 'tel1',
  ],
  valor: [
    'valor', 'value', 'montante', 'vl_titulo', 'vl_documento', 'saldo',
    'total', 'vlr', 'valor_total', 'valor_nominal', 'valor_cobrado',
    'vl_total', 'amount', 'saldo_devedor', 'vl_original', 'vl_saldo',
    'valor_aberto', 'vl_aberto', 'valor_due', 'vl_vencido',
  ],
  data_vencimento: [
    'data_vencimento', 'vencimento', 'due_date', 'dt_vencimento', 'data',
    'prazo', 'venc', 'data_venc', 'dt_venc', 'validade', 'data_limite',
    'expiry', 'expiration', 'dt_vencto', 'vencto', 'data_vencto',
    'dt_venc_titulo', 'data_vencimento_titulo', 'vencimento_titulo',
  ],
};

export function normalizarHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[\s\-\.\/]+/g, '_');
}

export function detectarMapeamentoColunas(
  headers: string[],
): { mapping: Record<string, string | null>; headerNorm: string[] } {
  const headerNorm = headers.map(normalizarHeader);
  const mapping: Record<string, string | null> = {
    nome: null,
    telefone: null,
    valor: null,
    data_vencimento: null,
  };

  for (const canonical of Object.keys(mapping)) {
    for (const alias of COLUMN_ALIASES[canonical]) {
      const idx = headerNorm.findIndex((h) => h === alias);
      if (idx !== -1) {
        mapping[canonical] = headers[idx];
        break;
      }
    }
  }

  return { mapping, headerNorm };
}

export function normalizarValor(raw: string): number {
  let s = raw.trim().replace(/^R\$\s*/, '').replace(/^\$\s*/, '').trim();

  const temPonto = s.includes('.');
  const temVirgula = s.includes(',');

  if (temPonto && temVirgula) {
    const ultimoPonto = s.lastIndexOf('.');
    const ultimaVirgula = s.lastIndexOf(',');
    if (ultimaVirgula > ultimoPonto) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      s = s.replace(/,/g, '');
    }
  } else if (temVirgula) {
    const posVirgula = s.lastIndexOf(',');
    const aposVirgula = s.slice(posVirgula + 1);
    if (aposVirgula.length <= 2) {
      s = s.replace(',', '.');
    } else {
      s = s.replace(/,/g, '');
    }
  }

  return parseFloat(s);
}

export function normalizarData(raw: string): string | null {
  const s = raw.trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) {
    const [d, m, y] = s.split('/');
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(s)) {
    const [d, m, y] = s.split('-');
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  if (/^\d{1,2}\.\d{1,2}\.\d{4}$/.test(s)) {
    const [d, m, y] = s.split('.');
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  if (/^\d{4}\/\d{2}\/\d{2}$/.test(s)) {
    return s.replace(/\//g, '-');
  }

  if (/^\d{8}$/.test(s)) {
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  }

  return null;
}

export function limparTelefone(tel: string): string {
  const digits = tel.replace(/\D/g, '');
  return digits.startsWith('55') ? digits : `55${digits}`;
}

// Um ano pra cada lado é uma faixa generosa pra atraso/adiantamento real de
// cobrança; datas fora disso quase sempre são erro de digitação ou de coluna
// trocada na planilha (ex: campo de valor caindo na coluna de data).
const ANOS_PASSADO_MAX = 5;
const ANOS_FUTURO_MAX = 5;

export function dataEmFaixaRazoavel(dataISO: string): boolean {
  const data = new Date(`${dataISO}T12:00:00`);
  if (Number.isNaN(data.getTime())) return false;
  const hoje = new Date();
  const min = new Date(hoje);
  min.setFullYear(min.getFullYear() - ANOS_PASSADO_MAX);
  const max = new Date(hoje);
  max.setFullYear(max.getFullYear() + ANOS_FUTURO_MAX);
  return data >= min && data <= max;
}

/** Linha já normalizada e pronta para gravação. */
export interface LinhaImportacao {
  linha: number;
  nome: string;
  telefone: string;
  valor: number;
  dataVencimento: string;
}

const VALOR_MAXIMO = 1_000_000_000; // 1 bilhão — teto de sanidade, não regra de negócio

/**
 * Revalida estruturalmente uma linha que chegou como JSON não confiável
 * (ex: corpo de POST /api/upload-csv/confirmar). Diferente de normalizarValor
 * /normalizarData (que interpretam texto cru do CSV), aqui os campos já
 * deveriam estar normalizados — a função checa se o formato e a faixa fazem
 * sentido, sem tentar converter texto livre.
 */
export function validarLinhaRecebida(input: unknown): LinhaImportacao | null {
  if (!input || typeof input !== 'object') return null;
  const l = input as Record<string, unknown>;

  const linha = typeof l.linha === 'number' && Number.isFinite(l.linha) ? l.linha : null;
  const nome = typeof l.nome === 'string' ? l.nome.trim() : '';
  const telefone = typeof l.telefone === 'string' ? l.telefone.trim() : '';
  const valor = typeof l.valor === 'number' ? l.valor : NaN;
  const dataVencimento = typeof l.dataVencimento === 'string' ? l.dataVencimento.trim() : '';

  if (linha === null) return null;
  if (!nome || nome.length > 200) return null;
  if (!/^\d{10,15}$/.test(telefone)) return null;
  if (!Number.isFinite(valor) || valor <= 0 || valor > VALOR_MAXIMO) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataVencimento)) return null;
  if (!dataEmFaixaRazoavel(dataVencimento)) return null;

  return { linha, nome, telefone, valor, dataVencimento };
}
