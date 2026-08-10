import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

interface LinhaValida {
  linha: number;
  nome: string;
  telefone: string;
  valor: number;
  dataVencimento: string;
}

// ---------------------------------------------------------------------------
// Confirma uma importação já revisada em /api/upload-csv (prévia). Recebe as
// linhas já validadas (não recebe o arquivo de novo) e só então grava no banco.
// Refaz a checagem de duplicata por segurança — dado pode ter mudado entre a
// prévia e a confirmação (ex: usuário deixou a prévia aberta e importou de
// outro jeito enquanto isso).
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const linhas = body?.linhas as LinhaValida[] | undefined;

  if (!linhas || !Array.isArray(linhas) || linhas.length === 0) {
    return NextResponse.json({ error: 'Nenhuma linha para importar.' }, { status: 400 });
  }

  let count = 0;
  let duplicatas = 0;
  const importErrors: string[] = [];

  for (const l of linhas) {
    const { data: cliente, error: errCliente } = await supabase
      .from('clientes')
      .upsert({ nome: l.nome, telefone: l.telefone }, { onConflict: 'telefone' })
      .select()
      .single();

    if (errCliente || !cliente) {
      importErrors.push(`Linha ${l.linha}: erro ao salvar cliente — ${errCliente?.message}`);
      continue;
    }

    const { data: existente } = await supabase
      .from('titulos')
      .select('id')
      .eq('cliente_id', cliente.id)
      .eq('valor', l.valor)
      .eq('data_vencimento', l.dataVencimento)
      .eq('status', 'aberto')
      .maybeSingle();

    if (existente) {
      duplicatas++;
      continue;
    }

    const { error: errTitulo } = await supabase.from('titulos').insert({
      cliente_id: cliente.id,
      valor: l.valor,
      data_vencimento: l.dataVencimento,
      status: 'aberto',
    });

    if (errTitulo) {
      importErrors.push(`Linha ${l.linha}: erro ao salvar título — ${errTitulo.message}`);
      continue;
    }

    count++;
  }

  return NextResponse.json({
    success: true,
    count,
    duplicatas,
    errors: importErrors,
    message:
      `${count} título(s) importado(s)` +
      (duplicatas > 0 ? ` · ${duplicatas} duplicata(s) ignorada(s)` : '') +
      (importErrors.length > 0 ? ` · ${importErrors.length} erro(s)` : ''),
  });
}
