import { NextRequest, NextResponse } from 'next/server';
import Papa from 'papaparse';
import { supabase } from '@/lib/supabase';
import { calcularDiasAtraso, categorizarTitulo } from '@/lib/prioridade';
import {
  COLUMN_ALIASES,
  detectarMapeamentoColunas,
  normalizarValor,
  normalizarData,
  limparTelefone,
  dataEmFaixaRazoavel,
  validarLinhaRecebida,
  planejarImportacao,
  emLotes,
  type TituloExistente,
} from '@/lib/csv-import';
import { lerPaginado, SupabaseIndisponivelError } from '@/lib/supabase-io';

/** Valores num filtro `.in(...)` viajam na query string — lotes pequenos evitam URL longa demais. */
const LOTE_IDS_EM_FILTRO = 100;

// ---------------------------------------------------------------------------
// Esta rota é SOMENTE PRÉVIA — faz o parsing, a validação e checa duplicatas
// (leitura), mas NÃO grava nada no banco. A gravação de fato acontece em
// /api/upload-csv/confirmar, chamada depois que o usuário revisa o relatório
// e clica em "Confirmar importação". Isso evita subir uma planilha errada
// (data trocada, coluna mapeada errado) direto pro banco sem chance de revisar.
//
// Reconhecimento de coluna, normalização de valor/data/telefone e o corte de
// urgência vivem em lib/csv-import.ts e lib/prioridade.ts — reaproveitados
// aqui e em confirmar/route.ts, em vez de reimplementados (ver ARCHITECTURE.md
// §6, duplicações agora resolvidas).
// ---------------------------------------------------------------------------

const MAX_LINHAS = 20_000; // teto de sanidade para um upload de planilha de PME

// ---------------------------------------------------------------------------
// Route handler — PRÉVIA (leitura apenas, nada é gravado aqui)
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get('file') as File | null;
  if (!file) {
    return NextResponse.json({ error: 'Arquivo não encontrado.' }, { status: 400 });
  }

  const text = await file.text();

  const { data: rows, errors: parseErrors, meta } = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    delimiter: '',
    transformHeader: (h) => h.trim(),
  });

  if (parseErrors.length > 0 && rows.length === 0) {
    return NextResponse.json(
      { error: `Erro ao interpretar o arquivo: ${parseErrors[0].message}` },
      { status: 400 },
    );
  }

  if (rows.length === 0) {
    return NextResponse.json({ error: 'O arquivo CSV está vazio.' }, { status: 400 });
  }

  if (rows.length > MAX_LINHAS) {
    return NextResponse.json(
      { error: `Arquivo com ${rows.length} linhas excede o limite de ${MAX_LINHAS} por importação. Divida em arquivos menores.` },
      { status: 400 },
    );
  }

  const headers = Object.keys(rows[0]);
  const { mapping } = detectarMapeamentoColunas(headers);

  const naoMapeadas = Object.entries(mapping)
    .filter(([, v]) => v === null)
    .map(([k]) => k);

  if (naoMapeadas.length > 0) {
    return NextResponse.json(
      {
        error:
          `Não foi possível identificar: ${naoMapeadas.join(', ')}.\n\n` +
          `Colunas encontradas: ${headers.join(', ')}.\n\n` +
          `Nomes aceitos para cada campo:\n` +
          naoMapeadas
            .map((c) => `• ${c}: ${COLUMN_ALIASES[c].slice(0, 5).join(', ')}...`)
            .join('\n'),
      },
      { status: 400 },
    );
  }

  // ---- Passo 1: parsear e validar cada linha (sem tocar no banco ainda) ----
  const linhasValidas: {
    linha: number;
    nome: string;
    telefone: string;
    valor: number;
    dataVencimento: string;
  }[] = [];
  const linhasIgnoradas: { linha: number; nome: string; motivo: string }[] = [];
  const importErrors: string[] = [];

  for (const [i, row] of rows.entries()) {
    const linha = i + 2;
    const nomeRaw = row[mapping.nome!]?.trim();
    const nome = nomeRaw || `Linha ${linha}`;

    if (!nomeRaw) {
      linhasIgnoradas.push({ linha, nome, motivo: 'Nome em branco' });
      importErrors.push(`Linha ${linha}: nome em branco.`);
      continue;
    }

    const telefoneRaw = row[mapping.telefone!]?.trim() ?? '';
    const rawDigits = telefoneRaw.replace(/\D/g, '');
    if (!rawDigits || rawDigits.length < 8) {
      linhasIgnoradas.push({ linha, nome, motivo: `Telefone inválido — "${telefoneRaw}"` });
      importErrors.push(`Linha ${linha}: telefone inválido — "${telefoneRaw}".`);
      continue;
    }
    const telefone = limparTelefone(telefoneRaw);

    const valorRaw = row[mapping.valor!]?.trim() ?? '';
    const valor = normalizarValor(valorRaw);
    if (isNaN(valor) || valor <= 0) {
      linhasIgnoradas.push({ linha, nome, motivo: `Valor inválido — "${valorRaw}"` });
      importErrors.push(`Linha ${linha}: valor inválido — "${valorRaw}".`);
      continue;
    }

    const dataRaw = row[mapping.data_vencimento!]?.trim() ?? '';
    const dataVencimento = normalizarData(dataRaw);
    if (!dataVencimento) {
      linhasIgnoradas.push({ linha, nome, motivo: `Data inválida — "${dataRaw}"` });
      importErrors.push(
        `Linha ${linha}: data inválida — "${dataRaw}". ` +
        `Aceitos: DD/MM/AAAA, AAAA-MM-DD, DD-MM-AAAA, DD.MM.AAAA, AAAA/MM/DD, AAAAMMDD`,
      );
      continue;
    }
    if (!dataEmFaixaRazoavel(dataVencimento)) {
      linhasIgnoradas.push({
        linha,
        nome,
        motivo: `Data fora da faixa esperada — "${dataRaw}" (mais de 5 anos no passado ou no futuro; confira se a coluna certa foi mapeada)`,
      });
      importErrors.push(`Linha ${linha}: data fora da faixa esperada — "${dataRaw}".`);
      continue;
    }

    // Portão final: a MESMA validação que a gravação vai aplicar. As checagens
    // acima existem para dar mensagens boas sobre o texto cru do CSV; esta
    // garante que nada que a prévia aprove seja recusado depois na confirmação.
    const validada = validarLinhaRecebida({ linha, nome, telefone, valor, dataVencimento });
    if (!validada.ok) {
      linhasIgnoradas.push({ linha, nome, motivo: validada.motivo });
      importErrors.push(`Linha ${linha}: ${validada.motivo}.`);
      continue;
    }

    linhasValidas.push(validada.linha);
  }

  // ---- Passo 2: checar duplicatas contra o banco (somente leitura) ----
  //
  // As duas consultas abaixo eram feitas ignorando o `error` (só `{ data }` era
  // desestruturado). Quando falhavam, `data` vinha null, nenhuma duplicata era
  // detectada e a prévia prometia importar títulos que já existiam — a falha
  // aparecia como "tudo certo". Agora qualquer falha interrompe a prévia com
  // 503: melhor não prometer nada do que prometer errado.
  //
  // Os filtros `.in(...)` também são divididos em lotes: os valores viajam na
  // query string e um arquivo grande (o teto é 20.000 linhas) montaria uma URL
  // de centenas de KB, que o PostgREST rejeitaria.
  const telefonesUnicos = [...new Set(linhasValidas.map((l) => l.telefone))];
  const clienteIdPorTelefone = new Map<string, string>();
  const titulosExistentes: TituloExistente[] = [];

  try {
    for (const lote of emLotes(telefonesUnicos, LOTE_IDS_EM_FILTRO)) {
      const encontrados = await lerPaginado<{ id: string; telefone: string }>(
        (s, de, ate) =>
          supabase.from('clientes').select('id, telefone').in('telefone', lote).range(de, ate).abortSignal(s),
        'clientes já cadastrados',
      );
      for (const c of encontrados) clienteIdPorTelefone.set(c.telefone, c.id);
    }

    for (const lote of emLotes([...clienteIdPorTelefone.values()], LOTE_IDS_EM_FILTRO)) {
      const encontrados = await lerPaginado<TituloExistente>(
        (s, de, ate) =>
          supabase
            .from('titulos')
            .select('cliente_id, valor, data_vencimento')
            .in('cliente_id', lote)
            .eq('status', 'aberto')
            .range(de, ate)
            .abortSignal(s),
        'títulos já existentes',
      );
      titulosExistentes.push(...encontrados);
    }
  } catch (e) {
    if (e instanceof SupabaseIndisponivelError) {
      return NextResponse.json(
        {
          error:
            `Não foi possível verificar quais títulos já existem — ${e.message} ` +
            `Nada foi lido nem gravado; tente de novo em instantes.`,
        },
        { status: 503 },
      );
    }
    throw e;
  }

  // A MESMA função que a confirmação usa para decidir o que gravar
  // (lib/csv-import.ts::planejarImportacao) — paridade por construção, do mesmo
  // jeito que `validarLinhaRecebida` já garantia para a validação de linha.
  // Antes a prévia tinha a sua própria varredura, que não enxergava duplicata
  // DENTRO do arquivo: um CSV com a mesma linha duas vezes anunciava "2 títulos
  // prontos" e a gravação importava 1. Agora os dois lados contam igual.
  //
  // Cliente que ainda não existe recebe uma chave sintética: ele não tem título
  // nenhum no banco, então só pode colidir com outra linha do próprio arquivo —
  // que é exatamente a duplicata interna que queremos detectar.
  const chavesParaPlano = new Map(clienteIdPorTelefone);
  for (const t of telefonesUnicos) {
    if (!chavesParaPlano.has(t)) chavesParaPlano.set(t, `novo:${t}`);
  }

  const plano = planejarImportacao(linhasValidas, chavesParaPlano, titulosExistentes);
  const duplicatas = plano.duplicatas;
  const linhasDoPlano = new Set(plano.aInserir.map((t) => t.linha));
  const linhasParaImportar = linhasValidas.filter((l) => linhasDoPlano.has(l.linha));

  // ---- Breakdown financeiro pra exibir na prévia ----
  // Mesmo corte de urgência usado na lista do dia (lib/prioridade.ts) — antes
  // esse loop reimplementava a conta de "dias de atraso" por conta própria e
  // podia divergir do resto do sistema (ver ARCHITECTURE.md §6).
  const breakdown = {
    vencidos: { count: 0, valor: 0 },
    preventivos: { count: 0, valor: 0 },
    futuros: { count: 0, valor: 0 },
  };

  for (const l of linhasParaImportar) {
    const diasAtraso = calcularDiasAtraso(l.dataVencimento);
    const categoria = categorizarTitulo(diasAtraso);
    if (categoria === 'atraso_longo' || categoria === 'atraso_leve') {
      breakdown.vencidos.count++;
      breakdown.vencidos.valor += l.valor;
    } else if (categoria === 'preventivo') {
      breakdown.preventivos.count++;
      breakdown.preventivos.valor += l.valor;
    } else {
      breakdown.futuros.count++;
      breakdown.futuros.valor += l.valor;
    }
  }

  const colunasDetectadas: Record<string, string> = {};
  for (const [canonical, original] of Object.entries(mapping)) {
    colunasDetectadas[canonical] =
      original === canonical ? original! : `"${original}" → ${canonical}`;
  }

  const delimiterLabel =
    meta.delimiter === ';' ? 'ponto e vírgula (;)'
    : meta.delimiter === '\t' ? 'tab'
    : meta.delimiter === '|' ? 'pipe (|)'
    : 'vírgula (,)';

  const totalValor = breakdown.vencidos.valor + breakdown.preventivos.valor + breakdown.futuros.valor;

  return NextResponse.json({
    success: true,
    totalLinhas: rows.length,
    count: linhasParaImportar.length,
    duplicatas,
    errors: importErrors,
    linhasIgnoradas,
    colunasDetectadas,
    separadorDetectado: delimiterLabel,
    breakdown,
    totalValor,
    linhasValidas: linhasParaImportar, // usado pelo /confirmar — nada foi gravado ainda
    message:
      `${linhasParaImportar.length} título(s) prontos pra importar` +
      (duplicatas > 0 ? ` · ${duplicatas} duplicata(s) ignorada(s)` : '') +
      (importErrors.length > 0 ? ` · ${importErrors.length} aviso(s)` : ''),
  });
}
