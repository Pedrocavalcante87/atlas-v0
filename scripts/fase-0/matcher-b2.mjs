// ---------------------------------------------------------------------------
// B2 — segundo baseline de reconhecimento de coluna (medição da Fase 0)
//
// Usa a MESMA lista `COLUMN_ALIASES` da produção, sem acrescentar um único
// alias. A ÚNICA coisa que muda é a normalização do cabeçalho. A pergunta que
// isso responde é específica e vale a medição inteira:
//
//   a heurística de aliases chegou ao seu limite, ou está quebrada por
//   construção e nunca foi exercida de verdade?
//
// Se B2 destrava muitos arquivos que B1 recusa, os aliases já cobriam o mundo
// e quem falha é `normalizarHeader`. Se B2 destrava pouco, a lista é que não
// converge — e aí a tela de mapeamento do §11.2/3 é o centro da Fase 1, não um
// fallback.
//
// ISTO NÃO É CÓDIGO DE PRODUÇÃO E NÃO DEVE VIRAR. Nada aqui altera
// `src/lib/csv-import.ts`; o PLANEJAMENTO.md §14 proíbe. É instrumento de
// medição — mede o que ACONTECERIA, não muda o que acontece.
// ---------------------------------------------------------------------------

import { COLUMN_ALIASES, normalizarHeader } from '../../src/lib/csv-import.ts';

export const CAMPOS = ['nome', 'telefone', 'valor', 'data_vencimento'];

// Conectivos que não carregam significado num cabeçalho de planilha:
// "Data de Vencimento" e "Data Vencimento" são o mesmo campo.
const STOPWORDS = new Set(['de', 'do', 'da', 'dos', 'das', 'e', 'em', 'no', 'na']);

// Combining marks do latim (U+0300–U+036F): é o que sobra do acento depois
// que NFD separa a letra do sinal.
const COMBINING_MIN = 0x300;
const COMBINING_MAX = 0x36f;

// Filtra por code point em vez de por intervalo em regex de propósito: escrever
// o intervalo como literal deixa bytes invisíveis no fonte, e escrevê-lo com
// escape depende de a barra invertida sobreviver a toda ferramenta que tocar o
// arquivo. Aqui não há o que reinterpretar.
export function semAcento(s) {
  let saida = '';
  for (const ch of String(s ?? '').normalize('NFD')) {
    const cp = ch.codePointAt(0);
    if (cp >= COMBINING_MIN && cp <= COMBINING_MAX) continue;
    saida += ch;
  }
  return saida;
}

/**
 * Normalização do B2 — as quatro correções pedidas, nesta ordem.
 *
 * Comparar com a produção (`normalizarHeader`), que só faz trim + lowercase +
 * troca de separadores:
 *   "Número"       B1 "número"       B2 "numero"    (acento)
 *   "Tel."         B1 "tel_"         B2 "tel"       (separador terminal)
 *   "Valor (R$)"   B1 "valor_(r$)"   B2 "valor"     (unidade entre parênteses)
 */
export function normalizarHeaderB2(h) {
  let s = String(h ?? '').trim().toLowerCase();
  s = semAcento(s);
  s = s.replace(/\([^)]*\)/g, ' '); // unidade/moeda entre parênteses não é nome de campo
  s = s.replace(/[\s\-./]+/g, '_'); // mesma classe de separadores que a produção usa
  s = s.replace(/_+/g, '_');
  s = s.replace(/^_+|_+$/g, ''); // separador no início ou no fim não é token
  return s;
}

export function tokensDe(s) {
  return normalizarHeaderB2(s)
    .split('_')
    .filter((t) => t && !STOPWORDS.has(t));
}

/**
 * Um casamento entre um cabeçalho e um alias, ou null.
 *
 * SÓ TRÊS FORMAS SÃO ACEITAS, e a exclusão importa mais que a inclusão:
 *   - `exato`       — string normalizada idêntica ao alias;
 *   - `conjunto`    — mesmo conjunto de tokens, ignorando conectivos
 *                     ("Data de Vencimento" == "data_vencimento");
 *   - `subconjunto` — os tokens do ALIAS estão contidos nos tokens do HEADER
 *                     ("data_vencimento" ⊂ "data_vencimento_titulo").
 *
 * O QUE NÃO É ACEITO, DE PROPÓSITO: o header contido no alias. Aceitar essa
 * direção faz "VL" casar com "vl_titulo" e "DT" com "dt_vencimento" — falso
 * positivo que infla o B2 e faria a medição recomendar a decisão errada.
 *
 * A contenção é por TOKEN, não por substring de texto. Substring crua ainda
 * produziria falso positivo na direção permitida: o alias "vl" está contido no
 * texto do header "vlr_desconto" sem que sejam o mesmo campo. Exigir alinhamento
 * a token elimina essa classe inteira.
 */
function casar(headerNorm, headerTokens, alias) {
  const aliasNorm = normalizarHeaderB2(alias);
  const aliasTokens = tokensDe(alias);
  if (aliasTokens.length === 0) return null;

  const especificidade = aliasTokens.length;

  if (headerNorm === aliasNorm) return { tipo: 'exato', especificidade };

  const hs = new Set(headerTokens);
  const as = new Set(aliasTokens);
  const todosNoHeader = [...as].every((t) => hs.has(t));
  if (!todosNoHeader) return null;

  if (hs.size === as.size) return { tipo: 'conjunto', especificidade };
  if (as.size < hs.size) return { tipo: 'subconjunto', especificidade };
  return null;
}

/** Por que este header casou no B2 e não no B1 — atribuição da normalização. */
export function porQueB2Destravou(headerOriginal) {
  const razoes = [];
  const bruto = String(headerOriginal ?? '');
  if (semAcento(bruto) !== bruto) razoes.push('acento');
  if (/\([^)]*\)/.test(bruto)) razoes.push('parenteses');
  const b1 = normalizarHeader(bruto);
  if (/^_|_$/.test(b1)) razoes.push('separador_terminal');
  if (tokensDe(bruto).length !== b1.split('_').filter(Boolean).length) razoes.push('conectivo');
  return razoes.length > 0 ? razoes : ['conjunto_de_tokens'];
}

// ---------------------------------------------------------------------------
// B1 — replica EXATAMENTE o que `detectarMapeamentoColunas` faz, mas devolvendo
// TODOS os candidatos em vez de só o primeiro.
//
// A produção faz `headerNorm.findIndex(h => h === alias)` e para no primeiro
// alias que casa. Isso significa que um segundo cabeçalho igualmente candidato
// existe e é descartado em silêncio — que é exatamente o "sucesso falso" que
// esta medição precisa contar. A escolha final aqui é idêntica à da produção
// (mesma ordem de alias, mesmo findIndex); só o registro de candidatos é novo.
// ---------------------------------------------------------------------------
export function mapearB1(headers) {
  const headerNorm = headers.map(normalizarHeader);
  const escolhido = {};
  const candidatos = {};

  for (const campo of CAMPOS) {
    const aliases = COLUMN_ALIASES[campo];
    const vistos = new Map(); // header original -> alias que o fez candidato

    for (const alias of aliases) {
      headerNorm.forEach((h, i) => {
        if (h === alias && !vistos.has(headers[i])) {
          vistos.set(headers[i], { header: headers[i], alias, tipo: 'exato', especificidade: 1 });
        }
      });
    }

    candidatos[campo] = [...vistos.values()];

    // A escolha da produção, reproduzida literalmente.
    let pick = null;
    for (const alias of aliases) {
      const idx = headerNorm.findIndex((h) => h === alias);
      if (idx !== -1) {
        pick = headers[idx];
        break;
      }
    }
    escolhido[campo] = pick;
  }

  return finalizar('B1', escolhido, candidatos);
}

// ---------------------------------------------------------------------------
// B2 — mesma lista de aliases, normalização corrigida, escolha por especificidade
// ---------------------------------------------------------------------------
export function mapearB2(headers) {
  const perfil = headers.map((h) => ({
    header: h,
    norm: normalizarHeaderB2(h),
    tokens: tokensDe(h),
  }));

  const escolhido = {};
  const candidatos = {};

  for (const campo of CAMPOS) {
    const aliases = COLUMN_ALIASES[campo];
    const achados = [];

    for (const p of perfil) {
      // Por header, guarda só o MELHOR casamento (alias mais específico).
      let melhor = null;
      for (const [aliasIndex, alias] of aliases.entries()) {
        const c = casar(p.norm, p.tokens, alias);
        if (!c) continue;
        if (!melhor || c.especificidade > melhor.especificidade) {
          melhor = {
            header: p.header,
            alias,
            aliasIndex,
            tipo: c.tipo,
            especificidade: c.especificidade,
          };
        }
      }
      if (melhor) achados.push(melhor);
    }

    candidatos[campo] = achados;

    if (achados.length === 0) {
      escolhido[campo] = null;
      continue;
    }

    // Alias mais específico vence o genérico; empate no topo vira ambiguidade.
    // No empate a escolha segue a ORDEM DA LISTA DE ALIASES, que é o critério
    // que a produção já usa — assim o B2 nunca escolhe pior que o B1 num caso
    // que os dois enxergam igual, e a diferença medida entre eles fica sendo só
    // a normalização, que é a variável do experimento.
    const maxEsp = Math.max(...achados.map((a) => a.especificidade));
    const noTopo = achados
      .filter((a) => a.especificidade === maxEsp)
      .sort((a, b) => a.aliasIndex - b.aliasIndex);
    escolhido[campo] = noTopo[0].header;
  }

  return finalizar('B2', escolhido, candidatos);
}

// ---------------------------------------------------------------------------
// Categorização comum aos dois baselines
// ---------------------------------------------------------------------------
// "Mapeou os 4 campos" não é sucesso quando dois cabeçalhos disputam o mesmo
// campo: um arquivo com "Data" e "Data de Vencimento" mapeia os 4 e escreve a
// data de EMISSÃO no vencimento, sem nenhum aviso. Por isso o desfecho tem três
// valores, e o número do §5.1 é o primeiro deles — não a soma dos dois primeiros.
function finalizar(baseline, escolhido, candidatos) {
  const naoMapeadas = CAMPOS.filter((c) => escolhido[c] === null);

  // Empate no topo da especificidade = ambiguidade. No B1 toda especificidade
  // é 1, então dois candidatos quaisquer já empatam — que é o comportamento
  // certo: a produção não tem critério nenhum para desempatar.
  const ambiguos = [];
  for (const campo of CAMPOS) {
    const c = candidatos[campo];
    if (!c || c.length < 2) continue;
    const maxEsp = Math.max(...c.map((x) => x.especificidade));
    const noTopo = c.filter((x) => x.especificidade === maxEsp);
    if (noTopo.length >= 2) {
      ambiguos.push({ campo, candidatos: noTopo.map((x) => x.header) });
    }
  }

  const desfecho =
    naoMapeadas.length > 0
      ? 'nao_mapeou'
      : ambiguos.length > 0
        ? 'mapeou_com_ambiguidade'
        : 'mapeou_sem_ambiguidade';

  return { baseline, escolhido, candidatos, naoMapeadas, ambiguos, desfecho };
}

// ---------------------------------------------------------------------------
// Categorização do ARQUIVO — "mapeou os 4 campos" não é sucesso
// ---------------------------------------------------------------------------
// Aplicar a detecção de ambiguidade SÓ ao B1 não pega o caso que mais importa.
// Medido nesta sessão, com os cabeçalhos ["Data", "Data de Vencimento"]:
//
//   B1 -> mapeou_sem_ambiguidade, e escolhe "Data" (a EMISSÃO)
//
// Não é falha do detector: sob `normalizarHeader`, "Data de Vencimento" vira
// "data_de_vencimento", que não é alias de nada. Existe UM candidato de fato, e
// a coluna certa é invisível para o B1. O sucesso falso não é detectável dentro
// do próprio B1.
//
// Por isso o conjunto de candidatos é a UNIÃO B1 ∪ B2, e a discordância entre
// os dois baselines conta como ambiguidade por si só: dois reconhecedores
// razoáveis escolhendo colunas diferentes para o mesmo campo é a definição
// operacional de "isto precisa de confirmação humana".
//
// Os números estritos de B1 continuam sendo reportados ao lado — a união não
// substitui o que a produção faz hoje, ela mede o que a produção não vê.
export function categorizarArquivo(b1, b2) {
  const uniao = [];
  for (const campo of CAMPOS) {
    const headers = new Set();
    for (const c of b1.candidatos[campo] ?? []) headers.add(c.header);
    for (const c of b2.candidatos[campo] ?? []) headers.add(c.header);
    if (headers.size >= 2) uniao.push({ campo, candidatos: [...headers] });
  }

  const discordancias = CAMPOS.filter(
    (campo) =>
      b1.escolhido[campo] !== null &&
      b2.escolhido[campo] !== null &&
      b1.escolhido[campo] !== b2.escolhido[campo],
  ).map((campo) => ({ campo, b1: b1.escolhido[campo], b2: b2.escolhido[campo] }));

  const desfecho =
    b1.naoMapeadas.length > 0
      ? 'nao_mapeou'
      : uniao.length > 0 || discordancias.length > 0
        ? 'mapeou_com_ambiguidade'
        : 'mapeou_sem_ambiguidade';

  return { desfecho, ambiguidadeUniao: uniao, discordancias };
}
