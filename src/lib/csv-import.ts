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
export const NOME_TAMANHO_MAXIMO = 200;

export type ResultadoValidacao =
  | { ok: true; linha: LinhaImportacao }
  | { ok: false; motivo: string };

/**
 * Validação estrutural de uma linha já normalizada — a ÚNICA fonte de verdade
 * sobre "esta linha pode ser gravada".
 *
 * Chamada nos dois pontos do fluxo de importação, de propósito:
 *   1. na prévia (api/upload-csv), como último portão antes de dizer ao
 *      usuário "N títulos prontos pra importar";
 *   2. na confirmação (api/upload-csv/confirmar), onde o corpo do POST não é
 *      confiável (vem do browser e pode ter sido forjado).
 *
 * Chamar nos dois lugares garante por construção que a prévia nunca aprove uma
 * linha que a gravação vá recusar — antes as duas tinham regras próprias
 * (telefone >= 8 dígitos na prévia vs. 10-15 aqui), e a diferença virava
 * descarte silencioso na hora de gravar.
 *
 * Devolve o motivo da recusa para que quem chamou possa dizer ao usuário o que
 * há de errado com a linha, em vez de um contador anônimo.
 */
export function validarLinhaRecebida(input: unknown): ResultadoValidacao {
  if (!input || typeof input !== 'object') {
    return { ok: false, motivo: 'Formato de linha inválido' };
  }
  const l = input as Record<string, unknown>;

  const linha = typeof l.linha === 'number' && Number.isFinite(l.linha) ? l.linha : null;
  const nome = typeof l.nome === 'string' ? l.nome.trim() : '';
  const telefone = typeof l.telefone === 'string' ? l.telefone.trim() : '';
  const valor = typeof l.valor === 'number' ? l.valor : NaN;
  const dataVencimento = typeof l.dataVencimento === 'string' ? l.dataVencimento.trim() : '';

  if (linha === null) {
    return { ok: false, motivo: 'Número da linha ausente ou inválido' };
  }
  if (!nome) {
    return { ok: false, motivo: 'Nome em branco' };
  }
  if (nome.length > NOME_TAMANHO_MAXIMO) {
    return { ok: false, motivo: `Nome com mais de ${NOME_TAMANHO_MAXIMO} caracteres` };
  }
  if (!/^\d{10,15}$/.test(telefone)) {
    return {
      ok: false,
      motivo: `Telefone fora do padrão esperado (10 a 15 dígitos com DDI) — "${telefone}"`,
    };
  }
  if (!Number.isFinite(valor) || valor <= 0) {
    return { ok: false, motivo: `Valor inválido — "${String(l.valor)}"` };
  }
  if (valor > VALOR_MAXIMO) {
    return { ok: false, motivo: `Valor acima do limite aceito — "${String(l.valor)}"` };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataVencimento)) {
    return { ok: false, motivo: `Data fora do formato AAAA-MM-DD — "${dataVencimento}"` };
  }
  if (!dataEmFaixaRazoavel(dataVencimento)) {
    return {
      ok: false,
      motivo: `Data fora da faixa esperada — "${dataVencimento}" (mais de 5 anos no passado ou no futuro)`,
    };
  }

  return { ok: true, linha: { linha, nome, telefone, valor, dataVencimento } };
}
