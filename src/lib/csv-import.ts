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
  } else if (temPonto) {
    // Só pontos, nenhuma vírgula — o caso onde mora o defeito do §5.3.
    //
    // O que decide é a forma dos grupos DEPOIS de cada ponto. Separador de
    // milhar sempre deixa grupos de exatamente três dígitos; decimal deixa um
    // ou dois. Três situações, e só uma delas é ambígua de verdade:
    const grupos = s.split('.').slice(1);
    const todosDeTres = grupos.every((g) => /^\d{3}$/.test(g));

    if (grupos.length > 1) {
      // DOIS OU MAIS pontos: não existe número com duas partes decimais, então
      // milhar é a única leitura possível — não há escolha a fazer, e por isso
      // isto não invade o §5.3. Antes, `parseFloat('1.234.567')` parava no
      // segundo ponto e devolvia 1.234: R$ 1,2 milhão virava R$ 1,23.
      //
      // Se os grupos não são todos de três (`1.500.00`), o texto não é milhar
      // nem decimal em convenção nenhuma — é formato que não sabemos ler, e
      // limpar os pontos daria 150000, um número inventado.
      if (!todosDeTres) return NaN;
      s = s.replace(/\./g, '');
    } else if (todosDeTres) {
      // UM ponto com exatamente três dígitos: `1.500` é mil e quinhentos em
      // convenção BR e um e meio em US. As duas leituras são legítimas e a
      // célula sozinha não decide — é exatamente o §5.3.
      //
      // Recusamos em vez de adivinhar. Assumir decimal gravava R$ 1,50 no lugar
      // de R$ 1.500 em silêncio; assumir milhar cobraria 1000x a mais de quem
      // exporta em US. Número de dinheiro não se inventa (CLAUDE.md), e célula
      // que não parseia vira linha rejeitada com motivo (PLANEJAMENTO.md §9,
      // barreira #5). Quem explica o porquê ao usuário é `motivoValorRecusado`.
      //
      // Isto NÃO antecipa a Fase 1: não escolhe convenção nenhuma. Quando o
      // formato passar a ser decidido por coluna, estas linhas voltam a ser
      // aceitas — com o valor certo.
      return NaN;
    }
    // Um ponto com um, dois ou 4+ dígitos (`1500.00`, `1500.5`) é decimal sem
    // ambiguidade: milhar teria exatamente três. parseFloat resolve.
  }

  return parseFloat(s);
}

/**
 * Monta AAAA-MM-DD recusando dia/mês que não existem no calendário.
 *
 * Sem esta checagem, um arquivo em formato americano (MM/DD/AAAA) produzia
 * data impossível em silêncio: `10/25/2026` virava `"2026-25-10"` — mês 25.
 * Isso passava o regex de `validarLinhaRecebida` e só era barrado adiante por
 * `dataEmFaixaRazoavel`, porque `new Date` devolve `Invalid Date` — ou seja, a
 * linha era recusada com o motivo ERRADO ("mais de 5 anos no passado ou no
 * futuro"), mandando o usuário procurar um problema que não existe. Recusar
 * aqui produz o diagnóstico certo.
 *
 * O que isto NÃO resolve, de propósito: `03/04/2026` é 3 de abril em DD/MM e
 * 4 de março em MM/DD, e as duas leituras são válidas. Uma célula isolada não
 * tem como decidir — só a coluna inteira tem (ver PLANEJAMENTO.md §5.3 e a
 * Fase 1). Aqui recusamos o impossível, não o ambíguo.
 */
function montarDataISO(dia: string, mes: string, ano: string): string | null {
  const d = Number(dia);
  const m = Number(mes);
  if (!(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) return null;
  return `${ano}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Por que este texto de valor foi recusado, em linguagem que diz o que fazer.
 *
 * Existe porque `normalizarValor` devolve `NaN` para dois motivos bem
 * diferentes, e "Valor inválido" para os dois manda o usuário procurar um erro
 * de digitação quando o problema é o formato da planilha inteira. Uma recusa
 * que não diz como sair dela é quase tão ruim quanto o valor errado que ela
 * veio evitar.
 */
export function motivoValorRecusado(raw: string): string {
  const s = raw.trim().replace(/^R\$\s*/, '').replace(/^\$\s*/, '').trim();
  const grupos = s.includes(',') ? [] : s.split('.').slice(1);

  if (grupos.length === 1 && /^\d{3}$/.test(grupos[0])) {
    // As duas leituras, escritas como o usuário as veria na tela. A decimal é
    // calculada, não montada por substituição de texto: "1.500" lido como
    // decimal é 1,5 — ou seja R$ 1,50, e não "R$ 1,500", que nem existe em real.
    const comoMilhar = `${s.replace('.', '.')},00`;
    const comoDecimal = parseFloat(s).toLocaleString('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return (
      `Valor ambíguo — "${raw.trim()}" pode significar R$ ${comoMilhar} ` +
      `(ponto como milhar) ou R$ ${comoDecimal} (ponto como decimal). ` +
      `Escreva com os centavos ("${comoMilhar}") ou sem separador ` +
      `("${s.replace('.', '')}") para não deixar dúvida.`
    );
  }

  if (grupos.length > 1 && !grupos.every((g) => /^\d{3}$/.test(g))) {
    return (
      `Valor em formato não reconhecido — "${raw.trim()}" tem mais de um ponto, ` +
      `mas os grupos não são de três dígitos, então não é separador de milhar ` +
      `nem decimal. Confira a coluna de valor na planilha.`
    );
  }

  return `Valor inválido — "${raw.trim()}"`;
}

export function normalizarData(raw: string): string | null {
  const s = raw.trim();

  // Ano primeiro: dia e mês estão em posição conhecida, mas ainda precisam
  // existir — "2026-25-10" chegava até aqui e era devolvido como se fosse
  // válido, só porque tinha o formato certo.
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-');
    return montarDataISO(d, m, y);
  }

  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) {
    const [d, m, y] = s.split('/');
    return montarDataISO(d, m, y);
  }

  if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(s)) {
    const [d, m, y] = s.split('-');
    return montarDataISO(d, m, y);
  }

  if (/^\d{1,2}\.\d{1,2}\.\d{4}$/.test(s)) {
    const [d, m, y] = s.split('.');
    return montarDataISO(d, m, y);
  }

  if (/^\d{4}\/\d{2}\/\d{2}$/.test(s)) {
    const [y, m, d] = s.split('/');
    return montarDataISO(d, m, y);
  }

  if (/^\d{8}$/.test(s)) {
    return montarDataISO(s.slice(6, 8), s.slice(4, 6), s.slice(0, 4));
  }

  return null;
}

/**
 * Quantos dígitos tem um número brasileiro que JÁ inclui o DDI: 55 + DDD (2) +
 * assinante (8 em fixo, 9 em celular). Sem DDI são 10 ou 11.
 */
const DIGITOS_COM_DDI = new Set([12, 13]);

/**
 * Normaliza o telefone para o formato que o link `wa.me` espera (só dígitos,
 * com DDI).
 *
 * O teste `startsWith('55')` sozinho não decide, e isso tinha consequência
 * real: **55 também é o DDD de Santa Maria/RS**. Um celular de lá,
 * `(55) 99999-8888`, vira `55999998888` — 11 dígitos, começa com 55 — e era
 * lido como "já tem DDI". O número ia para o banco sem país, passava a
 * validação de 10 a 15 dígitos sem reclamar, e o link de WhatsApp apontava
 * para outro número. Cobrança enviada para a pessoa errada, sem nenhum aviso.
 *
 * O comprimento desempata: `55` só é DDI se o total já for de número completo
 * com DDI (12 ou 13 dígitos). Com 10 ou 11, o `55` inicial é DDD e o DDI falta.
 */
export function limparTelefone(tel: string): string {
  const digits = tel.replace(/\D/g, '');
  const temDDI = digits.startsWith('55') && DIGITOS_COM_DDI.has(digits.length);
  return temDDI ? digits : `55${digits}`;
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
 * Dos títulos que iam ser inseridos, quais ainda não existem no banco.
 *
 * Usada quando o índice único (`supabase/migration-02`) recusa um lote porque
 * outra importação gravou parte dele no meio do caminho: reconsultamos o que
 * existe agora e reenviamos só o que falta.
 *
 * Vive aqui, junto de `planejarImportacao`, porque as duas precisam concordar
 * sobre o que é "o mesmo título" — se a chave divergir entre a decisão inicial
 * e a reconciliação pós-conflito, o retry reenvia algo que já existe e a
 * importação entra em laço ou reporta número errado.
 */
export function removerJaExistentes<T extends { cliente_id: string; valor: number; data_vencimento: string }>(
  pendentes: T[],
  existentes: TituloExistente[],
): T[] {
  const jaExiste = new Set(
    existentes.map((t) => chaveDoTitulo(t.cliente_id, t.valor, t.data_vencimento)),
  );
  return pendentes.filter(
    (t) => !jaExiste.has(chaveDoTitulo(t.cliente_id, t.valor, t.data_vencimento)),
  );
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
