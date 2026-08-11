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

// ---------------------------------------------------------------------------
// Planejamento da gravação em lote
//
// A confirmação da importação fazia 3 idas ao banco POR LINHA (upsert cliente
// → consulta duplicata → insert título): 90 linhas = 270 requisições, ~67s
// medidos, crescimento linear. As funções abaixo movem TODA a decisão para a
// memória, para que a rota precise de um punhado de requisições em lote em vez
// de três por linha.
//
// Elas são puras de propósito: é aqui que moram as regras que, se quebrarem,
// duplicam dado financeiro — então é aqui que os testes conseguem alcançá-las.
// ---------------------------------------------------------------------------

/** Um título já existente no banco, no formato mínimo para detectar duplicata. */
export interface TituloExistente {
  cliente_id: string;
  valor: number;
  data_vencimento: string;
}

/** Título pronto para inserção, com a linha de origem para relatar erro. */
export interface TituloParaInserir {
  linha: number;
  cliente_id: string;
  valor: number;
  data_vencimento: string;
}

export interface PlanoDeImportacao {
  aInserir: TituloParaInserir[];
  duplicatas: number;
  /** Linhas cujo cliente não voltou do upsert — nunca devem sumir caladas. */
  semCliente: LinhaImportacao[];
}

/**
 * Chave de identidade de um título em aberto: mesmo cliente, mesmo valor,
 * mesmo vencimento. É a MESMA regra que o loop linha-a-linha aplicava via
 * `.eq('cliente_id',…).eq('valor',…).eq('data_vencimento',…).eq('status','aberto')`.
 *
 * `Number(valor)` normaliza os dois lados antes de comparar: o Postgres devolve
 * `numeric` como número JSON (2850.00 vira 2850, 1200.50 vira 1200.5) e o CSV
 * passa por `parseFloat` — sem normalizar, "2850.00" e 2850 gerariam chaves
 * diferentes e o título entraria duplicado.
 */
function chaveDoTitulo(clienteId: string, valor: number, dataVencimento: string): string {
  return `${clienteId}|${Number(valor)}|${dataVencimento}`;
}

/**
 * Clientes únicos por telefone, prontos para um único upsert em lote.
 *
 * Deduplicar é OBRIGATÓRIO, não uma otimização: mandar o mesmo telefone duas
 * vezes no mesmo `upsert` faz o Postgres recusar o comando inteiro com
 * "ON CONFLICT DO UPDATE command cannot affect row a second time" (SQLSTATE
 * 21000, confirmado contra o banco real) — ou seja, um CSV com duas linhas do
 * mesmo cliente derrubaria o lote todo.
 *
 * Vence o ÚLTIMO nome visto, preservando o comportamento do loop anterior, em
 * que cada linha sobrescrevia o nome do cliente ao passar pelo upsert.
 */
export function clientesParaUpsert(
  linhas: LinhaImportacao[],
): { nome: string; telefone: string }[] {
  const porTelefone = new Map<string, string>();
  for (const l of linhas) porTelefone.set(l.telefone, l.nome);
  return [...porTelefone].map(([telefone, nome]) => ({ nome, telefone }));
}

/**
 * Decide, em memória, quais títulos inserir e quais já existem.
 *
 * Reproduz exatamente a semântica do loop sequencial anterior, incluindo a
 * parte que era fácil perder na conversão para lote: **duplicatas dentro do
 * próprio arquivo**. No loop antigo isso funcionava por acidente de ordem — a
 * segunda linha idêntica consultava o banco depois de a primeira já ter sido
 * inserida e a encontrava. Aqui o mesmo efeito é explícito: a chave de cada
 * título aceito entra no conjunto `vistos`, então a próxima linha igual conta
 * como duplicata em vez de virar um segundo registro.
 *
 * Preserva também o recorte de `status = 'aberto'`: `titulosExistentes` deve
 * vir filtrado por isso. Um título já pago não bloqueia a reimportação — é uma
 * cobrança nova, não uma repetição.
 */
export function planejarImportacao(
  linhas: LinhaImportacao[],
  clienteIdPorTelefone: Map<string, string>,
  titulosExistentes: TituloExistente[],
): PlanoDeImportacao {
  const vistos = new Set(
    titulosExistentes.map((t) => chaveDoTitulo(t.cliente_id, t.valor, t.data_vencimento)),
  );

  const aInserir: TituloParaInserir[] = [];
  const semCliente: LinhaImportacao[] = [];
  let duplicatas = 0;

  for (const l of linhas) {
    const clienteId = clienteIdPorTelefone.get(l.telefone);
    if (!clienteId) {
      semCliente.push(l);
      continue;
    }

    const chave = chaveDoTitulo(clienteId, l.valor, l.dataVencimento);
    if (vistos.has(chave)) {
      duplicatas++;
      continue;
    }

    vistos.add(chave);
    aInserir.push({
      linha: l.linha,
      cliente_id: clienteId,
      valor: l.valor,
      data_vencimento: l.dataVencimento,
    });
  }

  return { aInserir, duplicatas, semCliente };
}

/** Quebra uma lista em lotes de no máximo `tamanho`. */
export function emLotes<T>(itens: T[], tamanho: number): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) lotes.push(itens.slice(i, i + tamanho));
  return lotes;
}
