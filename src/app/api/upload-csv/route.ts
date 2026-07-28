import { NextRequest, NextResponse } from 'next/server';
import Papa from 'papaparse';
import { supabase } from '@/lib/supabase';

// ---------------------------------------------------------------------------
// Mapa de aliases — colunas conhecidas de diferentes sistemas (ERP, planilhas)
// ---------------------------------------------------------------------------
const COLUMN_ALIASES: Record<string, string[]> = {
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

// ---------------------------------------------------------------------------
// Detecção de colunas por alias (case-insensitive, ignora espaços e hifens)
// ---------------------------------------------------------------------------
function normalizarHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[\s\-\.\/]+/g, '_');
}

function detectarMapeamentoColunas(
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
        mapping[canonical] = headers[idx]; // guarda nome original para acessar no row
        break;
      }
    }
  }

  return { mapping, headerNorm };
}

// ---------------------------------------------------------------------------
// Normalização de valor — aceita formatos BR e US, com e sem símbolo de moeda
// ---------------------------------------------------------------------------
function normalizarValor(raw: string): number {
  let s = raw.trim().replace(/^R\$\s*/, '').replace(/^\$\s*/, '').trim();

  const temPonto = s.includes('.');
  const temVirgula = s.includes(',');

  if (temPonto && temVirgula) {
    const ultimoPonto  = s.lastIndexOf('.');
    const ultimaVirgula = s.lastIndexOf(',');
    if (ultimaVirgula > ultimoPonto) {
      // BR: 1.500,00 → remover pontos, trocar vírgula por ponto
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      // US: 1,500.00 → remover vírgulas
      s = s.replace(/,/g, '');
    }
  } else if (temVirgula) {
    const posVirgula = s.lastIndexOf(',');
    const aposVirgula = s.slice(posVirgula + 1);
    if (aposVirgula.length <= 2) {
      // Decimal BR: 1500,00 → 1500.00
      s = s.replace(',', '.');
    } else {
      // Milhar: 1,500 → 1500
      s = s.replace(/,/g, '');
    }
  }

  return parseFloat(s);
}

// ---------------------------------------------------------------------------
// Normalização de data — aceita 7 formatos
// ---------------------------------------------------------------------------
function normalizarData(raw: string): string | null {
  const s = raw.trim();

  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // DD/MM/YYYY ou D/M/YYYY
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) {
    const [d, m, y] = s.split('/');
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // DD-MM-YYYY ou D-M-YYYY
  if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(s)) {
    const [d, m, y] = s.split('-');
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // DD.MM.YYYY
  if (/^\d{1,2}\.\d{1,2}\.\d{4}$/.test(s)) {
    const [d, m, y] = s.split('.');
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // YYYY/MM/DD
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(s)) {
    return s.replace(/\//g, '-');
  }

  // YYYYMMDD (compacto)
  if (/^\d{8}$/.test(s)) {
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Limpeza de telefone — preserva apenas dígitos, garante prefixo +55
// ---------------------------------------------------------------------------
function limparTelefone(tel: string): string {
  const digits = tel.replace(/\D/g, '');
  return digits.startsWith('55') ? digits : `55${digits}`;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get('file') as File | null;
  if (!file) {
    return NextResponse.json({ error: 'Arquivo não encontrado.' }, { status: 400 });
  }

  const text = await file.text();

  // Auto-detecta separador (vírgula, ponto-e-vírgula, tab, pipe)
  const { data: rows, errors: parseErrors, meta } = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    delimiter: '',          // '' = auto-detect
    transformHeader: (h) => h.trim(), // mantém original para o mapeamento
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

  const importErrors: string[] = [];
  let count = 0;
  let duplicatas = 0;

  // Breakdown financeiro calculado durante o processamento
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const breakdown = {
    vencidos:    { count: 0, valor: 0 },   // diasAtraso > 0 — cobrar hoje
    preventivos: { count: 0, valor: 0 },   // 0 a -3 dias — enviar lembrete
    futuros:     { count: 0, valor: 0 },   // > 3 dias no futuro — monitorar
  };
  const linhasIgnoradas: { linha: number; nome: string; motivo: string }[] = [];

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

    const { data: cliente, error: errCliente } = await supabase
      .from('clientes')
      .upsert({ nome, telefone }, { onConflict: 'telefone' })
      .select()
      .single();

    if (errCliente || !cliente) {
      linhasIgnoradas.push({ linha, nome, motivo: `Erro interno ao salvar cliente` });
      importErrors.push(`Linha ${linha}: erro ao salvar cliente — ${errCliente?.message}`);
      continue;
    }

    // Deduplicação: pula se já existe título idêntico em aberto
    const { data: existente } = await supabase
      .from('titulos')
      .select('id')
      .eq('cliente_id', cliente.id)
      .eq('valor', valor)
      .eq('data_vencimento', dataVencimento)
      .eq('status', 'aberto')
      .maybeSingle();

    if (existente) {
      duplicatas++;
      continue;
    }

    const { error: errTitulo } = await supabase.from('titulos').insert({
      cliente_id: cliente.id,
      valor,
      data_vencimento: dataVencimento,
      status: 'aberto',
    });

    if (errTitulo) {
      linhasIgnoradas.push({ linha, nome, motivo: `Erro interno ao salvar título` });
      importErrors.push(`Linha ${linha}: erro ao salvar título — ${errTitulo.message}`);
      continue;
    }

    // Classifica no breakdown
    const venc = new Date(`${dataVencimento}T12:00:00`);
    venc.setHours(0, 0, 0, 0);
    const dias = Math.round((hoje.getTime() - venc.getTime()) / (1000 * 60 * 60 * 24));
    if (dias > 0) {
      breakdown.vencidos.count++;
      breakdown.vencidos.valor += valor;
    } else if (dias >= -3) {
      breakdown.preventivos.count++;
      breakdown.preventivos.valor += valor;
    } else {
      breakdown.futuros.count++;
      breakdown.futuros.valor += valor;
    }

    count++;
  }

  // Relatório de mapeamento para exibir ao usuário
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
    count,
    duplicatas,
    errors: importErrors,
    linhasIgnoradas,
    colunasDetectadas,
    separadorDetectado: delimiterLabel,
    breakdown,
    totalValor,
    message:
      `${count} título(s) importado(s)` +
      (duplicatas > 0 ? ` · ${duplicatas} duplicata(s) ignorada(s)` : '') +
      (importErrors.length > 0 ? ` · ${importErrors.length} aviso(s)` : ''),
  });
}
