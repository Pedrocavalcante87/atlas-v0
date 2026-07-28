import { NextRequest, NextResponse } from 'next/server';
import Papa from 'papaparse';
import { supabase } from '@/lib/supabase';

interface CSVRow {
  nome: string;
  telefone: string;
  valor: string;
  data_vencimento: string;
  [key: string]: string;
}

function limparTelefone(tel: string): string {
  return tel.replace(/\D/g, '');
}

function normalizarData(data: string): string | null {
  const s = data.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
    const [d, m, y] = s.split('/');
    return `${y}-${m}-${d}`;
  }
  return null;
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get('file') as File | null;

  if (!file) {
    return NextResponse.json({ error: 'Arquivo não encontrado.' }, { status: 400 });
  }

  const text = await file.text();

  const { data: rows, errors: parseErrors } = Papa.parse<CSVRow>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, '_'),
  });

  if (parseErrors.length > 0) {
    return NextResponse.json(
      { error: `Erro ao ler o CSV: ${parseErrors[0].message}` },
      { status: 400 },
    );
  }

  if (rows.length === 0) {
    return NextResponse.json({ error: 'O arquivo CSV está vazio.' }, { status: 400 });
  }

  const required = ['nome', 'telefone', 'valor', 'data_vencimento'];
  const cols = Object.keys(rows[0]);
  const missing = required.filter((c) => !cols.includes(c));
  if (missing.length > 0) {
    return NextResponse.json(
      {
        error: `Colunas ausentes: ${missing.join(', ')}. Esperadas: nome, telefone, valor, data_vencimento`,
      },
      { status: 400 },
    );
  }

  const importErrors: string[] = [];
  let count = 0;

  for (const [i, row] of rows.entries()) {
    const linha = i + 2;

    const nome = row.nome?.trim();
    if (!nome) {
      importErrors.push(`Linha ${linha}: nome em branco.`);
      continue;
    }

    const telefone = limparTelefone(row.telefone ?? '');
    if (!telefone || telefone.length < 8) {
      importErrors.push(`Linha ${linha}: telefone inválido — "${row.telefone}".`);
      continue;
    }

    const valor = parseFloat(String(row.valor).replace(',', '.'));
    if (isNaN(valor) || valor <= 0) {
      importErrors.push(`Linha ${linha}: valor inválido — "${row.valor}".`);
      continue;
    }

    const dataVencimento = normalizarData(row.data_vencimento ?? '');
    if (!dataVencimento) {
      importErrors.push(
        `Linha ${linha}: data_vencimento inválida — "${row.data_vencimento}". Use DD/MM/AAAA ou AAAA-MM-DD.`,
      );
      continue;
    }

    // Upsert cliente por telefone (unique constraint no schema)
    const { data: cliente, error: errCliente } = await supabase
      .from('clientes')
      .upsert({ nome, telefone }, { onConflict: 'telefone' })
      .select()
      .single();

    if (errCliente || !cliente) {
      importErrors.push(`Linha ${linha}: erro ao salvar cliente — ${errCliente?.message}`);
      continue;
    }

    const { error: errTitulo } = await supabase.from('titulos').insert({
      cliente_id: cliente.id,
      valor,
      data_vencimento: dataVencimento,
      status: 'aberto',
    });

    if (errTitulo) {
      importErrors.push(`Linha ${linha}: erro ao salvar título — ${errTitulo.message}`);
      continue;
    }

    count++;
  }

  return NextResponse.json({
    success: true,
    count,
    errors: importErrors,
    message: `${count} título(s) importado(s)${importErrors.length > 0 ? ` · ${importErrors.length} erro(s)` : ''}.`,
  });
}
