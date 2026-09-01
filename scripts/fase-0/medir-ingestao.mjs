// ---------------------------------------------------------------------------
// FASE 0 — medição de ingestão (PLANEJAMENTO.md §11.1)
//
// Responde, com arquivos reais:
//   1. quantos arquivos mapeiam os 4 campos canônicos SEM AMBIGUIDADE — e
//      quantos "mapeiam" com dois candidatos disputando o mesmo campo, que é
//      sucesso falso e não sucesso;
//   2. qual campo falha mais;
//   3. o que um segundo baseline (B2), com a MESMA lista de aliases e só a
//      normalização corrigida, destravaria — a diferença entre B1 e B2 decide
//      se a heurística chegou ao limite ou nunca foi exercida;
//   4. quais formatos de valor e de data aparecem de verdade;
//   5. se o caso "1.500" do §5.3 ocorre, e quanto dinheiro custa;
//   6. se a ordem dia/mês é provável, provada trocada, ou indecidível;
//   7. a forma real do telefone, incluindo os arquivos que NÃO têm essa coluna
//      e por isso são recusados inteiros (§5.2);
//   8. se o cabeçalho está mesmo na linha 1 e se há rodapé de totais.
//
// O QUE ESTE SCRIPT NÃO FAZ, por construção:
//   - não importa `src/lib/supabase.ts` nem qualquer coisa que fale com o banco;
//   - não grava nada, em lugar nenhum, exceto o JSON que você pedir com --json;
//   - não altera nenhum arquivo de `src/` ou `supabase/`;
//   - não corrige, não contorna e não "melhora" nenhuma das funções medidas.
//
// Ele importa as funções puras REAIS de `src/lib/csv-import.ts`. O número que
// ele reporta é o número que a produção produziria — não uma reimplementação.
//
// LIMITE HONESTO DESTA MEDIÇÃO: o laço de validação por linha abaixo é um
// ESPELHO de `src/app/api/upload-csv/route.ts`, não a rota em si — a rota
// importa `next/server` e o Supabase e não roda offline. Os portões e a ordem
// deles foram copiados de lá e estão marcados um a um. Se a rota mudar, este
// espelho envelhece em silêncio. É a única divergência possível entre o que
// isto mede e o que o produto faz.
//
// USO:
//   node --experimental-strip-types scripts/fase-0/medir-ingestao.mjs [pasta] [--json saida.json]
// ---------------------------------------------------------------------------

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve, extname, basename } from 'node:path';
import Papa from 'papaparse';

import {
  normalizarValor,
  normalizarData,
  dataEmFaixaRazoavel,
  limparTelefone,
  validarLinhaRecebida,
} from '../../src/lib/csv-import.ts';

import { mapearB1, mapearB2, categorizarArquivo, porQueB2Destravou, CAMPOS } from './matcher-b2.mjs';

import {
  classificarValor,
  classificarData,
  veredictoColunaValor,
  veredictoColunaData,
  primeiroCampoDeData,
  formaTelefone,
  sinaisDeCabecalho,
  pareceLinhaDeTotais,
  FORMAS_SUSPEITAS_5_3,
} from './classificadores.mjs';

// Espelhado de route.ts — teto de sanidade de um upload de planilha de PME.
const MAX_LINHAS = 20_000;
const EXTENSOES = new Set(['.csv', '.txt', '.tsv']);

// ---------------------------------------------------------------------------
// Leitura de arquivo — replica `File.text()`, que é o que a rota usa
// ---------------------------------------------------------------------------
// A rota recebe um `File` do FormData e chama `await file.text()`, que decodifica
// como UTF-8 e descarta a BOM. `readFile(path, 'utf8')` NÃO é equivalente: ele
// preserva a BOM, e uma BOM colada no primeiro cabeçalho faz o alias não casar —
// o arquivo seria recusado aqui e aceito na produção, ou o contrário.
async function lerComoAProducaoLe(caminho) {
  const bytes = await readFile(caminho);
  return await new Blob([bytes]).text();
}

// ---------------------------------------------------------------------------
// Avaliação de um arquivo
// ---------------------------------------------------------------------------
async function avaliarArquivo(caminho) {
  const nomeArquivo = basename(caminho);
  const texto = await lerComoAProducaoLe(caminho);

  // Export de ERP brasileiro em Latin-1 lido como UTF-8 vira U+FFFD. A produção
  // decodifica exatamente assim, então isto é defeito observável do produto.
  const bytesInvalidos = [...texto].filter((c) => c.codePointAt(0) === 0xfffd).length;

  const { data: rows, errors: parseErrors, meta } = Papa.parse(texto, {
    header: true,
    skipEmptyLines: true,
    delimiter: '',
    transformHeader: (h) => h.trim(),
  });

  const base = {
    arquivo: nomeArquivo,
    delimitador: meta?.delimiter ?? null,
    bytesInvalidos,
    totalLinhas: rows.length,
  };

  if (parseErrors.length > 0 && rows.length === 0) {
    return { ...base, desfecho: 'erro_de_parse', detalhe: parseErrors[0].message };
  }
  if (rows.length === 0) return { ...base, desfecho: 'arquivo_vazio' };
  if (rows.length > MAX_LINHAS) return { ...base, desfecho: 'excede_teto_de_linhas' };

  // Produção usa `Object.keys(rows[0])`; `meta.fields` preserva colunas vazias e
  // repetidas que aquele perde. O mapeamento usa o primeiro (fidelidade), a
  // análise de estrutura usa o segundo (é dela que vem o sinal).
  const headers = Object.keys(rows[0]);
  const cabecalho = sinaisDeCabecalho(meta?.fields ?? headers);

  const b1 = mapearB1(headers);
  const b2 = mapearB2(headers);
  const cat = categorizarArquivo(b1, b2);

  // O que B2 destravou que B1 não via, com a razão da normalização.
  const destravadosPorB2 = CAMPOS.filter(
    (c) => b1.escolhido[c] === null && b2.escolhido[c] !== null,
  ).map((c) => ({ campo: c, header: b2.escolhido[c], razoes: porQueB2Destravou(b2.escolhido[c]) }));

  // Perfil de CONTEÚDO usa a melhor coluna disponível: B1 quando existe, B2 como
  // segunda opção. Não é o que a produção faz — é o que o ARQUIVO contém, e um
  // arquivo recusado no portão continua tendo formatos a medir.
  const col = {};
  for (const c of CAMPOS) col[c] = b1.escolhido[c] ?? b2.escolhido[c];

  const simulaProducao = b1.naoMapeadas.length === 0;

  const motivos = {
    nome_em_branco: 0,
    telefone_invalido: 0,
    valor_invalido: 0,
    data_invalida: 0,
    data_fora_de_faixa: 0,
    portao_final: 0,
  };
  const formasValor = new Map();
  const formasData = new Map();
  const digitosTelefone = new Map();
  const exemplosValorRecusado = new Set();
  const exemplosDataRecusada = new Set();
  const celulas5_3 = [];
  let aceitas = 0;
  let primeiroAcima12 = 0;
  let segundoAcima12 = 0;
  let aplicaveisDiaMes = 0;
  let telefonesGanhamPrefixo = 0;
  let telefonesSuspeitaDDD55 = 0;
  let telefonesVazios = 0;

  for (const [i, row] of rows.entries()) {
    const linha = i + 2;

    // ---- Perfil de conteúdo (independe de a produção aceitar o arquivo) ----
    if (col.valor) {
      const valorRaw = row[col.valor]?.trim() ?? '';
      const formaV = classificarValor(valorRaw);
      formasValor.set(formaV, (formasValor.get(formaV) ?? 0) + 1);
      if (FORMAS_SUSPEITAS_5_3.has(formaV)) {
        celulas5_3.push({
          linha,
          bruto: valorRaw,
          forma: formaV,
          lido: normalizarValor(valorRaw),
          aceita: false,
        });
      }
    }

    if (col.data_vencimento) {
      const dataRaw = row[col.data_vencimento]?.trim() ?? '';
      formasData.set(classificarData(dataRaw), (formasData.get(classificarData(dataRaw)) ?? 0) + 1);
      const campos = primeiroCampoDeData(dataRaw);
      if (campos) {
        aplicaveisDiaMes++;
        if (campos.primeiro > 12) primeiroAcima12++;
        if (campos.segundo > 12) segundoAcima12++;
      }
    }

    if (col.telefone) {
      const f = formaTelefone(row[col.telefone]);
      digitosTelefone.set(f.digitos, (digitosTelefone.get(f.digitos) ?? 0) + 1);
      if (f.vazio) telefonesVazios++;
      if (f.ganhaPrefixo55) telefonesGanhamPrefixo++;
      if (f.suspeitaDDD55) telefonesSuspeitaDDD55++;
    }

    // ---- Simulação da produção: só quando o B1 mapeou os 4 campos ----
    if (!simulaProducao) continue;

    // Portão 1 — nome
    const nomeRaw = row[b1.escolhido.nome]?.trim();
    if (!nomeRaw) {
      motivos.nome_em_branco++;
      continue;
    }

    // Portão 2 — telefone (route.ts: dígitos crus < 8 recusa)
    const telefoneRaw = row[b1.escolhido.telefone]?.trim() ?? '';
    const rawDigits = telefoneRaw.replace(/\D/g, '');
    if (!rawDigits || rawDigits.length < 8) {
      motivos.telefone_invalido++;
      continue;
    }
    const telefone = limparTelefone(telefoneRaw);

    // Portão 3 — valor
    const valorRaw = row[b1.escolhido.valor]?.trim() ?? '';
    const valor = normalizarValor(valorRaw);
    if (Number.isNaN(valor) || valor <= 0) {
      motivos.valor_invalido++;
      if (exemplosValorRecusado.size < 8) exemplosValorRecusado.add(valorRaw);
      continue;
    }

    // Portão 4 — data reconhecida
    const dataRaw = row[b1.escolhido.data_vencimento]?.trim() ?? '';
    const dataVencimento = normalizarData(dataRaw);
    if (!dataVencimento) {
      motivos.data_invalida++;
      if (exemplosDataRecusada.size < 8) exemplosDataRecusada.add(dataRaw);
      continue;
    }

    // Portão 5 — data em faixa razoável
    if (!dataEmFaixaRazoavel(dataVencimento)) {
      motivos.data_fora_de_faixa++;
      if (exemplosDataRecusada.size < 8) exemplosDataRecusada.add(dataRaw);
      continue;
    }

    // Portão 6 — a MESMA validação que a gravação aplica
    const validada = validarLinhaRecebida({ linha, nome: nomeRaw, telefone, valor, dataVencimento });
    if (!validada.ok) {
      motivos.portao_final++;
      continue;
    }

    aceitas++;
    const ocorrencia = celulas5_3.find((c) => c.linha === linha);
    if (ocorrencia) ocorrencia.aceita = true;
  }

  return {
    ...base,
    desfecho: cat.desfecho,
    cabecalhos: headers,
    cabecalho,
    ultimaLinhaEhTotais: pareceLinhaDeTotais(rows[rows.length - 1], col.valor),
    b1: { escolhido: b1.escolhido, naoMapeadas: b1.naoMapeadas, desfecho: b1.desfecho },
    b2: { escolhido: b2.escolhido, naoMapeadas: b2.naoMapeadas, desfecho: b2.desfecho },
    destravadosPorB2,
    ambiguidadeUniao: cat.ambiguidadeUniao,
    discordancias: cat.discordancias,
    colunasDoPerfil: col,
    simulaProducao,
    aceitas: simulaProducao ? aceitas : null,
    motivos: simulaProducao ? motivos : null,
    formasValor: Object.fromEntries(formasValor),
    formasData: Object.fromEntries(formasData),
    digitosTelefone: Object.fromEntries(digitosTelefone),
    telefonesGanhamPrefixo,
    telefonesSuspeitaDDD55,
    telefonesVazios,
    exemplosValorRecusado: [...exemplosValorRecusado],
    exemplosDataRecusada: [...exemplosDataRecusada],
    veredictoColunaValor: veredictoColunaValor(new Set(formasValor.keys())),
    veredictoColunaData: veredictoColunaData({
      primeiroAcima12,
      segundoAcima12,
      aplicaveis: aplicaveisDiaMes,
    }),
    diaMes: { primeiroAcima12, segundoAcima12, aplicaveis: aplicaveisDiaMes },
    celulas5_3,
  };
}

// ---------------------------------------------------------------------------
// Quantificação do §5.3 — em reais, e só onde é defensável
// ---------------------------------------------------------------------------
// O prejuízo só é AFIRMÁVEL quando a leitura correta é conhecida:
//   - `ponto_milhar_inequivoco` ("1.234.567"): não existe leitura decimal;
//   - `ponto_ambiguo_3_digitos` ("1.500") SOMENTE quando a coluna já provou ser
//     milhar (veredictoColunaValor === 'milhar').
// Fora disso a célula é contada como ocorrência e o prejuízo fica indeterminado
// — não se inventa número, nem para o lado ruim.
function quantificar5_3(r) {
  const conta = {
    ocorrencias: 0,
    emLinhasAceitas: 0,
    determinado: 0,
    indeterminado: 0,
    prejuizo: 0,
    exemplos: [],
  };
  for (const c of r.celulas5_3 ?? []) {
    conta.ocorrencias++;
    if (c.aceita) conta.emLinhasAceitas++;

    const determinavel =
      c.forma === 'ponto_milhar_inequivoco' || r.veredictoColunaValor === 'milhar';
    if (!determinavel) {
      conta.indeterminado++;
      continue;
    }
    conta.determinado++;

    const semMoeda = c.bruto.replace(/^R\$\s*/, '').replace(/^\$\s*/, '').trim();
    const correto = parseFloat(semMoeda.replace(/\./g, ''));
    if (!Number.isFinite(correto)) continue;

    // Só linha aceita chega ao banco — é só ela que é dinheiro errado gravado.
    if (c.aceita) conta.prejuizo += correto - c.lido;
    if (conta.exemplos.length < 5) {
      conta.exemplos.push({ bruto: c.bruto, lido: c.lido, correto, aceita: c.aceita });
    }
  }
  return conta;
}

// ---------------------------------------------------------------------------
// Relatório
// ---------------------------------------------------------------------------
const brl = (n) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const pct = (n, d) => (d === 0 ? '—' : `${((n / d) * 100).toFixed(0)}%`);
const DESFECHOS_DE_MAPEAMENTO = new Set([
  'mapeou_sem_ambiguidade',
  'mapeou_com_ambiguidade',
  'nao_mapeou',
]);

function tabela(titulo, mapa, total, ordenarPorChave = false) {
  const linhas = Object.entries(mapa);
  if (linhas.length === 0) return;
  linhas.sort((a, b) => (ordenarPorChave ? Number(a[0]) - Number(b[0]) : b[1] - a[1]));
  console.log(`\n${titulo}`);
  const larg = Math.max(...linhas.map(([k]) => String(k).length));
  for (const [k, v] of linhas) {
    console.log(`  ${String(k).padEnd(larg)}  ${String(v).padStart(6)}  ${pct(v, total).padStart(4)}`);
  }
}

function relatar(resultados) {
  const total = resultados.length;
  const analisados = resultados.filter((r) => DESFECHOS_DE_MAPEAMENTO.has(r.desfecho));
  const quebrados = resultados.filter((r) => !DESFECHOS_DE_MAPEAMENTO.has(r.desfecho));

  const semAmb = analisados.filter((r) => r.desfecho === 'mapeou_sem_ambiguidade');
  const comAmb = analisados.filter((r) => r.desfecho === 'mapeou_com_ambiguidade');
  const naoMap = analisados.filter((r) => r.desfecho === 'nao_mapeou');

  console.log('='.repeat(78));
  console.log('FASE 0 — medição de ingestão (offline; nada foi gravado em lugar nenhum)');
  console.log(`Arquivos analisados: ${total}  ·  ${new Date().toISOString().slice(0, 10)}`);
  console.log('='.repeat(78));

  // ---------------- 1. Portão de mapeamento ----------------
  console.log('\n### 1. PORTÃO DE MAPEAMENTO (§5.1)\n');
  console.log('  O número do §5.1 é a PRIMEIRA linha. "Mapeou os 4 campos" não é sucesso');
  console.log('  quando dois cabeçalhos disputam o mesmo campo: o produto escolhe um em');
  console.log('  silêncio e pode escrever a data de emissão no vencimento.\n');
  console.log(`  mapeou SEM ambiguidade         : ${semAmb.length}/${analisados.length}  (${pct(semAmb.length, analisados.length)})`);
  console.log(`  mapeou COM ambiguidade a confirmar : ${comAmb.length}/${analisados.length}  (${pct(comAmb.length, analisados.length)})`);
  console.log(`  não mapeou (HTTP 400)          : ${naoMap.length}/${analisados.length}  (${pct(naoMap.length, analisados.length)})`);

  if (quebrados.length > 0) {
    console.log(`\n  nem chegaram ao mapeamento     : ${quebrados.length}`);
    for (const r of quebrados) {
      console.log(`      ${r.arquivo}: ${r.desfecho}${r.detalhe ? ` — ${r.detalhe}` : ''}`);
    }
  }

  if (comAmb.length > 0) {
    console.log('\n  Ambiguidades, arquivo a arquivo:');
    for (const r of comAmb) {
      console.log(`    ${r.arquivo}`);
      for (const a of r.ambiguidadeUniao) {
        console.log(`      ${a.campo}: ${a.candidatos.map((c) => `"${c}"`).join('  vs  ')}`);
      }
      for (const d of r.discordancias) {
        console.log(`      ${d.campo}: produção escolhe "${d.b1}", B2 escolheria "${d.b2}"  <- silencioso`);
      }
    }
  }

  const falhaPorCampo = Object.fromEntries(CAMPOS.map((c) => [c, 0]));
  for (const r of naoMap) for (const c of r.b1.naoMapeadas) falhaPorCampo[c]++;
  tabela('  Campo não reconhecido, por frequência (base: arquivos recusados):', falhaPorCampo, naoMap.length);

  if (naoMap.length > 0) {
    console.log('\n  Cabeçalhos que a produção não reconheceu:');
    for (const r of naoMap) {
      console.log(`    ${r.arquivo}  —  faltou: ${r.b1.naoMapeadas.join(', ')}`);
      console.log(`      colunas: ${r.cabecalhos.join(' | ')}`);
    }
  }

  // ---------------- 2. Baseline B2 ----------------
  console.log('\n### 2. BASELINE B2 — mesma lista de aliases, só a normalização corrigida\n');
  console.log('  B2 não acrescenta um único alias. Ele remove acento, separador terminal e');
  console.log('  unidade entre parênteses, e casa por conjunto de tokens. Se a diferença for');
  console.log('  grande, a lista de aliases já cobria o mundo e quem falha é normalizarHeader.');
  console.log('  Se for pequena, a lista é que não converge — e a tela de mapeamento passa a');
  console.log('  ser o centro da Fase 1, não um fallback.\n');

  const b1Mapeou = analisados.filter((r) => r.b1.naoMapeadas.length === 0).length;
  const b2Mapeou = analisados.filter((r) => r.b2.naoMapeadas.length === 0).length;
  console.log(`  B1 (produção) mapeia os 4 campos : ${b1Mapeou}/${analisados.length}  (${pct(b1Mapeou, analisados.length)})`);
  console.log(`  B2 mapeia os 4 campos            : ${b2Mapeou}/${analisados.length}  (${pct(b2Mapeou, analisados.length)})`);
  console.log(`  diferença                        : ${b2Mapeou - b1Mapeou} arquivo(s)`);

  const destravados = analisados.filter(
    (r) => r.b1.naoMapeadas.length > 0 && r.b2.naoMapeadas.length === 0,
  );
  if (destravados.length > 0) {
    console.log('\n  Arquivos que B2 destrava e B1 recusa:');
    for (const r of destravados) {
      console.log(`    ${r.arquivo}`);
      for (const d of r.destravadosPorB2) {
        console.log(`      ${d.campo} <- "${d.header}"   (${d.razoes.join(', ')})`);
      }
    }
  }

  const porRazao = {};
  for (const r of analisados) {
    for (const d of r.destravadosPorB2) {
      for (const razao of d.razoes) porRazao[razao] = (porRazao[razao] ?? 0) + 1;
    }
  }
  tabela('  Regra de normalização que destravou cada campo:', porRazao, Object.values(porRazao).reduce((a, b) => a + b, 0));

  const discordam = analisados.filter((r) => r.discordancias.length > 0);
  console.log(`\n  Arquivos em que B1 e B2 escolhem colunas DIFERENTES: ${discordam.length}`);
  console.log('    (cada um é um caso em que a produção grava uma coluna sem avisar que havia outra)');

  // ---------------- 3. Formatos ----------------
  const somaFormas = (chave) => {
    const acc = {};
    for (const r of analisados) for (const [k, v] of Object.entries(r[chave] ?? {})) acc[k] = (acc[k] ?? 0) + v;
    return acc;
  };
  const totalLinhas = analisados.reduce((s, r) => s + r.totalLinhas, 0);

  console.log('\n### 3. FORMATOS QUE APARECEM DE VERDADE');
  console.log(`(${totalLinhas} linhas no total; perfil usa a coluna do B1, ou a do B2 quando o B1`);
  console.log(' não a reconhece. Arquivo sem a coluna não contribui célula nenhuma, então cada');
  console.log(' tabela abaixo tem a SUA própria base — a porcentagem é sobre as células que');
  console.log(' existem, não sobre o total de linhas.)');

  const formasV = somaFormas('formasValor');
  const formasD = somaFormas('formasData');
  const somar = (m) => Object.values(m).reduce((a, b) => a + b, 0);
  tabela(`  Valor (base: ${somar(formasV)} células):`, formasV, somar(formasV));
  tabela(`  Data (base: ${somar(formasD)} células):`, formasD, somar(formasD));

  const exV = [...new Set(analisados.flatMap((r) => r.exemplosValorRecusado))].slice(0, 10);
  const exD = [...new Set(analisados.flatMap((r) => r.exemplosDataRecusada))].slice(0, 10);
  if (exV.length) console.log(`\n  Valores recusados, texto cru: ${exV.map((v) => JSON.stringify(v)).join(', ')}`);
  if (exD.length) console.log(`  Datas recusadas, texto cru:   ${exD.map((v) => JSON.stringify(v)).join(', ')}`);

  // ---------------- 4. §5.3 ----------------
  console.log('\n### 4. DEFEITO §5.3 — ponto de milhar lido como decimal\n');
  const contas = analisados.map((r) => ({ r, c: quantificar5_3(r) }));
  const comOcorrencia = contas.filter(({ c }) => c.ocorrencias > 0);
  const soma = (f) => contas.reduce((s, { c }) => s + f(c), 0);

  console.log(`  arquivos com pelo menos uma ocorrência : ${comOcorrencia.length}/${analisados.length}  (${pct(comOcorrencia.length, analisados.length)})`);
  console.log(`  células na família §5.3                : ${soma((c) => c.ocorrencias)}`);
  console.log(`  dessas, em linhas que SERIAM GRAVADAS  : ${soma((c) => c.emLinhasAceitas)}`);
  console.log(`  leitura correta indeterminável         : ${soma((c) => c.indeterminado)}`);
  console.log(`  dinheiro gravado a menos (só as gravadas, e só onde a leitura correta é certa):`);
  console.log(`      ${brl(soma((c) => c.prejuizo))}`);

  for (const { r, c } of comOcorrencia) {
    console.log(`\n    ${r.arquivo}  —  veredicto da coluna de valor: ${r.veredictoColunaValor}`);
    for (const e of c.exemplos) {
      console.log(
        `      ${JSON.stringify(e.bruto).padEnd(16)} lido como ${String(e.lido).padEnd(12)} correto ${String(e.correto).padEnd(12)} ${e.aceita ? 'GRAVARIA' : '(linha não gravada)'}`,
      );
    }
  }

  const porVeredicto = {};
  for (const r of analisados) porVeredicto[r.veredictoColunaValor] = (porVeredicto[r.veredictoColunaValor] ?? 0) + 1;
  tabela('  Teste da tese "ambíguo na célula, trivial na coluna":', porVeredicto, analisados.length);
  console.log('    conflito / sem_sinal = casos em que decidir POR COLUNA também não basta.');

  // ---------------- 5. Ordem dia/mês ----------------
  console.log('\n### 5. ORDEM DIA/MÊS — a metade que some e a metade que entra trocada');
  const porVeredictoData = {};
  for (const r of analisados) porVeredictoData[r.veredictoColunaData] = (porVeredictoData[r.veredictoColunaData] ?? 0) + 1;
  tabela('  Veredicto por coluna de data:', porVeredictoData, analisados.length);

  const mmdd = analisados.filter((r) => r.veredictoColunaData === 'MM/DD_provado');
  const semSinalData = analisados.filter((r) => r.veredictoColunaData === 'ambiguo_sem_sinal');
  const inconsistentes = analisados.filter((r) => r.veredictoColunaData === 'inconsistente');

  if (mmdd.length > 0) {
    console.log(`\n  MM/DD PROVADO em ${mmdd.length} arquivo(s). O arquivo se parte em dois destinos,`);
    console.log('  os dois ruins — verificado executando as funções da produção nesta sessão:');
    console.log('    - linha com o dia > 12 ("10/25/2026"): normalizarData devolve "2026-25-10",');
    console.log('      mês 25. Isso PASSA o regex de validarLinhaRecebida; quem barra é');
    console.log('      dataEmFaixaRazoavel, e só porque new Date() devolve Invalid Date. A linha');
    console.log('      é recusada com "mais de 5 anos no passado ou no futuro" — diagnóstico');
    console.log('      errado para um arquivo que só está em outra convenção.');
    console.log('    - linha com dia e mês ambos <= 12 ("03/04/2026"): passa e entra TROCADA.');
    console.log('  O arquivo perde as linhas que provam a convenção e corrompe em silêncio as');
    console.log('  que não provam.');
    for (const r of mmdd) {
      console.log(
        `    ${r.arquivo}  (${r.diaMes.segundoAcima12} linha(s) provam MM/DD e são recusadas; ` +
          `${r.diaMes.aplicaveis - r.diaMes.segundoAcima12 - r.diaMes.primeiroAcima12} entram trocada(s))`,
      );
    }
  }
  if (inconsistentes.length > 0) {
    console.log(`\n  INCONSISTENTE em ${inconsistentes.length} arquivo(s) — a mesma coluna tem linhas`);
    console.log('  que provam DD/MM e linhas que provam MM/DD. Nenhuma convenção única serve:');
    for (const r of inconsistentes) {
      console.log(`    ${r.arquivo}  (DD/MM: ${r.diaMes.primeiroAcima12}, MM/DD: ${r.diaMes.segundoAcima12})`);
    }
  }
  if (semSinalData.length > 0) {
    console.log(`\n  AMBÍGUO SEM SINAL em ${semSinalData.length} arquivo(s). Este é o caso perigoso:`);
    console.log('  vencimento de PME concentra em dia 5 e 10, então um arquivo pode ter 100%');
    console.log('  das datas invertidas, zero rejeições, e nada no dado que denuncie:');
    for (const r of semSinalData) console.log(`    ${r.arquivo}  (${r.diaMes.aplicaveis} data(s) com dia e mês ambos <= 12)`);
  }

  // ---------------- 6. Telefone ----------------
  console.log('\n### 6. FORMA DO TELEFONE\n');
  const semTelefone = analisados.filter((r) => r.b2.escolhido.telefone === null);
  const soFaltaTelefone = semTelefone.filter((r) =>
    CAMPOS.every((c) => c === 'telefone' || r.b2.escolhido[c] !== null),
  );
  console.log(`  arquivos SEM coluna de telefone reconhecível : ${semTelefone.length}/${analisados.length}`);
  console.log(`  desses, com os outros 3 campos OK (§5.2)     : ${soFaltaTelefone.length}`);
  if (soFaltaTelefone.length > 0) {
    console.log('    Planilha de contas a receber íntegra, recusada inteira porque o campo');
    console.log('    existe para o WhatsApp e não para a contabilidade:');
    for (const r of soFaltaTelefone) console.log(`      ${r.arquivo}`);
  }

  const digitos = {};
  for (const r of analisados) for (const [k, v] of Object.entries(r.digitosTelefone ?? {})) digitos[k] = (digitos[k] ?? 0) + v;
  const totalTel = Object.values(digitos).reduce((a, b) => a + b, 0);
  tabela('  Distribuição de quantidade de dígitos:', digitos, totalTel, true);

  const ganham = analisados.reduce((s, r) => s + r.telefonesGanhamPrefixo, 0);
  const ddd55 = analisados.reduce((s, r) => s + r.telefonesSuspeitaDDD55, 0);
  const vazios = analisados.reduce((s, r) => s + r.telefonesVazios, 0);
  console.log(`\n  ganham o prefixo "55" (não começavam com 55) : ${ganham}/${totalTel}  (${pct(ganham, totalTel)})`);
  console.log(`  células de telefone vazias                   : ${vazios}`);
  console.log(`  SUSPEITA: começam com 55 e têm <= 11 dígitos  : ${ddd55}`);
  console.log('    (DDD 55 existe — Santa Maria/RS. limparTelefone lê esse 55 como DDI e');
  console.log('     não prefixa, então o número fica sem país. Suspeita, não defeito provado.)');

  // ---------------- 7. Estrutura ----------------
  console.log('\n### 7. ESTRUTURA DO ARQUIVO\n');
  const cabSuspeito = analisados.filter((r) => r.cabecalho.suspeito);
  const comTotais = analisados.filter((r) => r.ultimaLinhaEhTotais);
  const comMojibake = resultados.filter((r) => r.bytesInvalidos > 0);

  console.log(`  cabeçalho provavelmente NÃO está na linha 1 : ${cabSuspeito.length}/${analisados.length}`);
  for (const r of cabSuspeito) {
    console.log(`    ${r.arquivo}  (campos vazios: ${r.cabecalho.vazios}, campos longos: ${r.cabecalho.longos})`);
    if (r.cabecalho.exemploLongo) console.log(`      exemplo: ${JSON.stringify(r.cabecalho.exemploLongo)}`);
  }
  console.log(`\n  última linha parece rodapé de totais        : ${comTotais.length}/${analisados.length}`);
  for (const r of comTotais) console.log(`    ${r.arquivo}`);
  if (comTotais.length > 0) {
    console.log('    Um rodapé de totais passa como título: o valor é a soma do arquivo inteiro.');
  }
  console.log(`\n  byte inválido em UTF-8 (Latin-1 lido como UTF-8) : ${comMojibake.length}/${total}`);
  for (const r of comMojibake) console.log(`    ${r.arquivo}  (${r.bytesInvalidos} ocorrência(s))`);

  // ---------------- Por arquivo ----------------
  console.log('\n### POR ARQUIVO\n');
  for (const r of resultados) {
    if (!DESFECHOS_DE_MAPEAMENTO.has(r.desfecho)) {
      console.log(`  ${r.arquivo.padEnd(30)} ${r.desfecho}`);
      continue;
    }
    const linhas = r.simulaProducao ? `${r.aceitas}/${r.totalLinhas} aceitas` : `${r.totalLinhas} linhas (produção recusa o arquivo)`;
    const m = r.motivos
      ? Object.entries(r.motivos).filter(([, v]) => v > 0).map(([k, v]) => `${k}=${v}`).join(' ')
      : '';
    console.log(`  ${r.arquivo.padEnd(30)} ${r.desfecho.padEnd(23)} ${linhas}  ${m}`);
  }
  console.log('');
}

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------
async function main() {
  const argv = process.argv.slice(2);
  const iJson = argv.indexOf('--json');
  const saidaJson = iJson !== -1 ? argv[iJson + 1] : null;
  // `iJson + 1` só é o valor de --json quando --json existe; sem essa guarda,
  // iJson = -1 faria o índice 0 (o primeiro posicional) ser descartado.
  const posicionais = argv.filter(
    (a, i) => !a.startsWith('--') && !(iJson !== -1 && i === iJson + 1),
  );
  const pasta = resolve(posicionais[0] ?? join(import.meta.dirname, 'amostras'));

  let entradas;
  try {
    entradas = await readdir(pasta);
  } catch {
    console.error(`Pasta não encontrada: ${pasta}`);
    process.exit(1);
  }

  const arquivos = entradas
    .filter((f) => EXTENSOES.has(extname(f).toLowerCase()))
    .sort()
    .map((f) => join(pasta, f));

  if (arquivos.length === 0) {
    console.error(`Nenhum arquivo ${[...EXTENSOES].join('/')} em ${pasta}`);
    console.error('Coloque ali os exports reais de contas a receber e rode de novo.');
    console.error('Arquivos .xlsx não são lidos: o produto também não os lê (PLANEJAMENTO.md §11.2).');
    process.exit(1);
  }

  console.error(`Lendo ${arquivos.length} arquivo(s) de ${pasta}\n`);

  const resultados = [];
  for (const caminho of arquivos) {
    try {
      resultados.push(await avaliarArquivo(caminho));
    } catch (e) {
      resultados.push({
        arquivo: basename(caminho),
        desfecho: 'erro_ao_ler',
        detalhe: String(e?.message ?? e),
        totalLinhas: 0,
        bytesInvalidos: 0,
      });
    }
  }

  relatar(resultados);

  if (saidaJson) {
    await writeFile(
      saidaJson,
      JSON.stringify({ geradoEm: new Date().toISOString(), pasta, resultados }, null, 2),
      'utf8',
    );
    console.error(`JSON bruto gravado em ${saidaJson}`);
  }
}

await main();
