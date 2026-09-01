// ---------------------------------------------------------------------------
// Classificadores de FORMA — usados só pela medição da Fase 0 (§11.1).
//
// ATENÇÃO AO LER ISTO: nada aqui é correção, proposta de correção, ou opinião
// sobre como o valor DEVERIA ser lido. São rotuladores de forma textual, cuja
// única função é permitir contar "quantas células têm este aspecto" no
// relatório. Quem decide o número gravado continua sendo, exclusivamente,
// `normalizarValor`/`normalizarData` de `src/lib/csv-import.ts`, sem nenhuma
// alteração.
//
// A correção do §5.3 é estrutural (decisão por coluna, com confirmação) e o
// PLANEJAMENTO.md §14 a proíbe explicitamente fora do plano da Fase 1. Se
// alguém for tentado a promover este arquivo a código de produção: não é isso.
// ---------------------------------------------------------------------------

/**
 * Rotula a forma textual de uma célula de valor.
 *
 * Os dois rótulos que começam com `ponto_` são a família do §5.3 — ponto usado
 * como separador de milhar, que `normalizarValor` lê como decimal:
 *   - `ponto_milhar_inequivoco`: dois ou mais pontos ("1.234.567"). Não existe
 *     leitura decimal possível; o erro é certo, não suspeito.
 *   - `ponto_ambiguo_3_digitos`: um ponto com exatamente 3 dígitos depois
 *     ("1.500"). Ambíguo NA CÉLULA — é justamente o caso que o §5.3 diz ser
 *     trivial na coluna inteira. Quem resolve é `veredictoColunaValor`.
 */
export function classificarValor(bruto) {
  const original = String(bruto ?? '').trim();
  if (!original) return 'vazio';

  // Mesmo descascamento de moeda que normalizarValor faz — só no início.
  const s = original.replace(/^R\$\s*/, '').replace(/^\$\s*/, '').trim();

  if (!/^-?[\d.,]+$/.test(s)) return 'nao_numerico';

  const temPonto = s.includes('.');
  const temVirgula = s.includes(',');

  if (temPonto && temVirgula) {
    return s.lastIndexOf(',') > s.lastIndexOf('.')
      ? 'br_milhar_e_decimal'   // 1.234,56
      : 'us_milhar_e_decimal';  // 1,234.56
  }

  if (temVirgula) {
    const apos = s.slice(s.lastIndexOf(',') + 1);
    return apos.length <= 2
      ? 'decimal_virgula'         // 1234,56
      : 'us_milhar_sem_decimal';  // 1,500  — já tratado e coberto por teste
  }

  if (temPonto) {
    const grupos = s.split('.');
    const ultimo = grupos[grupos.length - 1];
    if (grupos.length > 2) {
      return ultimo.length === 3 ? 'ponto_milhar_inequivoco' : 'ponto_irregular';
    }
    return ultimo.length === 3 ? 'ponto_ambiguo_3_digitos' : 'decimal_ponto';
  }

  return 'inteiro_simples';
}

export const FORMAS_SUSPEITAS_5_3 = new Set([
  'ponto_milhar_inequivoco',
  'ponto_ambiguo_3_digitos',
]);

/**
 * Veredicto da COLUNA de valor — o experimento que o §5.3 pede.
 *
 * A afirmação a testar é: "'1.500' é ambíguo em uma célula e trivial na coluna
 * inteira". Aqui ela vira medição. Um sinal desambiguador na coluna é qualquer
 * célula que só faça sentido numa das convenções:
 *   - vírgula decimal em qualquer célula  => nesta coluna o ponto é milhar;
 *   - dois ou mais pontos em qualquer célula => idem;
 *   - ponto com 1 ou 2 dígitos depois     => nesta coluna o ponto é decimal.
 *
 * Devolve 'milhar' | 'decimal' | 'conflito' | 'sem_sinal'.
 * `conflito` significa que a coluna mistura as duas convenções — caso em que
 * nem a decisão por coluna resolve sozinha, e é o achado mais informativo que
 * esta medição pode produzir.
 */
export function veredictoColunaValor(formas) {
  const sinalMilhar =
    formas.has('br_milhar_e_decimal') ||
    formas.has('decimal_virgula') ||
    formas.has('ponto_milhar_inequivoco');
  const sinalDecimal = formas.has('decimal_ponto') || formas.has('us_milhar_e_decimal');

  if (sinalMilhar && sinalDecimal) return 'conflito';
  if (sinalMilhar) return 'milhar';
  if (sinalDecimal) return 'decimal';
  return 'sem_sinal';
}

/** Rotula a forma textual de uma célula de data, sem julgar se está certa. */
export function classificarData(bruto) {
  const s = String(bruto ?? '').trim();
  if (!s) return 'vazio';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return 'iso_AAAA-MM-DD';
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) return 'barra_DD/MM/AAAA';
  if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(s)) return 'traco_DD-MM-AAAA';
  if (/^\d{1,2}\.\d{1,2}\.\d{4}$/.test(s)) return 'ponto_DD.MM.AAAA';
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(s)) return 'barra_AAAA/MM/DD';
  if (/^\d{8}$/.test(s)) return 'compacto_AAAAMMDD';
  if (/^\d{1,2}\/\d{1,2}\/\d{2}$/.test(s)) return 'ano_2_digitos';
  return 'nao_reconhecido';
}

/**
 * Extrai o primeiro campo numérico de uma data com dois campos + ano, quando
 * a ordem dia/mês é decidida por convenção e não pelo texto.
 *
 * `normalizarData` assume DD/MM incondicionalmente. Num export em convenção
 * US ("03/04/2026" = 4 de março) ele produz uma data válida e errada, sem
 * nenhum sinal. Só há prova de DD/MM quando o primeiro campo passa de 12.
 *
 * Devolve null quando a forma não tem essa ambiguidade.
 */
export function primeiroCampoDeData(bruto) {
  const s = String(bruto ?? '').trim();
  const m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.]\d{4}$/.exec(s);
  if (!m) return null;
  return { primeiro: Number(m[1]), segundo: Number(m[2]) };
}

// ---------------------------------------------------------------------------
// Ordem dia/mês — veredicto por COLUNA
// ---------------------------------------------------------------------------
// `normalizarData` assume DD/MM incondicionalmente. Contra um export em
// convenção US ela não falha: produz uma data VÁLIDA e trocada, e o título
// entra no banco com vencimento errado sem uma única rejeição.
//
// Só o dado prova a convenção, e só em uma direção por vez:
//   primeiro campo > 12  => é dia  => DD/MM
//   segundo  campo > 12  => é dia  => MM/DD
//
// O caso perigoso é não haver prova nenhuma. Vencimento de PME concentra em
// dia 5 e 10 — um arquivo inteiro pode ficar abaixo de 12 nos dois campos, ter
// 100% das datas invertidas e zero rejeições. `ambiguo_sem_sinal` não é
// "provavelmente ok": é "não dá para saber, e o silêncio não é evidência".
export function veredictoColunaData({ primeiroAcima12, segundoAcima12, aplicaveis }) {
  if (aplicaveis === 0) return 'nao_aplicavel'; // coluna toda em ISO ou não reconhecida
  if (primeiroAcima12 > 0 && segundoAcima12 > 0) return 'inconsistente';
  if (primeiroAcima12 > 0) return 'DD/MM_provado';
  if (segundoAcima12 > 0) return 'MM/DD_provado';
  return 'ambiguo_sem_sinal';
}

// ---------------------------------------------------------------------------
// Forma do telefone
// ---------------------------------------------------------------------------
// `limparTelefone` prefixa "55" a tudo que não começa com "55". A regra tem um
// buraco de forma: o DDD 55 (Santa Maria/RS e região) também começa com 55.
// Um celular "55 99999-0000" chega com 11 dígitos começando em 55, é lido como
// se o 55 fosse o DDI, e o número fica sem país e com DDD errado.
// 12+ dígitos começando com 55 é DDI de verdade; 10 ou 11, é suspeita.
export function formaTelefone(bruto) {
  const digitos = String(bruto ?? '').replace(/\D/g, '');
  return {
    digitos: digitos.length,
    vazio: digitos.length === 0,
    ganhaPrefixo55: digitos.length > 0 && !digitos.startsWith('55'),
    suspeitaDDD55: digitos.startsWith('55') && digitos.length <= 11,
  };
}

// ---------------------------------------------------------------------------
// Estrutura do arquivo
// ---------------------------------------------------------------------------
// Export de ERP costuma trazer título do relatório, filtros e data de emissão
// ACIMA do cabeçalho real. O PapaParse então lê a primeira linha do relatório
// como cabeçalho, e o produto recusa o arquivo por "não identifiquei as
// colunas" — diagnóstico errado para um arquivo perfeitamente importável.
//
// Sinais de que o cabeçalho não está na linha 1:
//   - 2 ou mais campos vazios (célula em branco vira header vazio);
//   - campo no padrão "_N", que é como algumas ferramentas nomeiam coluna sem
//     nome;
//   - campo com mais de 40 caracteres, que é frase de relatório, não nome de
//     coluna.
const HEADER_LONGO = 40;

export function sinaisDeCabecalho(fields) {
  const lista = (fields ?? []).map((f) => String(f ?? ''));
  const vazios = lista.filter((f) => !f.trim() || /^_\d+$/.test(f.trim())).length;
  const longos = lista.filter((f) => f.length > HEADER_LONGO);
  return {
    vazios,
    longos: longos.length,
    exemploLongo: longos[0] ? `${longos[0].slice(0, 60)}…` : null,
    suspeito: vazios >= 2 || longos.length > 0,
  };
}

// PapaParse guarda em `__parsed_extra` as células além do número de cabeçalhos.
// Não é campo do arquivo e não deve entrar em nenhuma contagem de preenchimento.
const CHAVE_EXTRA = '__parsed_extra';
const PALAVRA_DE_TOTAL = /^(total|totais|soma|somatorio|somatório|subtotal|geral|acumulado)\b/i;

/**
 * A última linha parece um rodapé de totais?
 *
 * Duas assinaturas, qualquer uma basta:
 *   - alguma célula começa com "Total", "Soma", "Subtotal"…;
 *   - a maioria das células está vazia mas a de VALOR está preenchida — que é
 *     como um rodapé de soma se parece quando não vem rotulado.
 *
 * Importa porque a linha passa como título: nome vira "Total", o valor é a soma
 * do arquivo inteiro, e entra uma cobrança fantasma com o valor de todas as
 * outras somadas.
 */
export function pareceLinhaDeTotais(row, colunaValor) {
  if (!row) return false;
  const celulas = Object.entries(row)
    .filter(([k]) => k !== CHAVE_EXTRA)
    .map(([, v]) => String(v ?? '').trim());
  if (celulas.length === 0) return false;

  if (celulas.some((c) => PALAVRA_DE_TOTAL.test(c))) return true;

  const preenchidas = celulas.filter((c) => c !== '').length;
  const valorPreenchido = colunaValor ? String(row[colunaValor] ?? '').trim() !== '' : false;
  const maioriaVazia = preenchidas <= Math.max(1, Math.floor(celulas.length / 2));
  return maioriaVazia && valorPreenchido;
}
