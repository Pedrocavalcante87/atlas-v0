import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { validarLinhaRecebida, type LinhaImportacao } from '@/lib/csv-import';

const MAX_LINHAS = 20_000;

// ---------------------------------------------------------------------------
// Confirma uma importação já revisada em /api/upload-csv (prévia). Recebe as
// linhas que o BROWSER devolveu da prévia — ou seja, dado que não é confiável
// por si só: um POST autenticado montado manualmente (fora da UI) poderia
// tentar gravar qualquer coisa nesse body. Por isso cada linha é revalidada
// estruturalmente aqui (validarLinhaRecebida), com as mesmas regras de forma
// e faixa da prévia — não apenas "é um array não vazio" (ver ARCHITECTURE.md
// §9, risco agora fechado).
//
// Também refaz a checagem de duplicata por segurança — dado pode ter mudado
// entre a prévia e a confirmação (ex: usuário deixou a prévia aberta e
// importou de outro jeito enquanto isso).
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const linhasRecebidas = body?.linhas;

  if (!linhasRecebidas || !Array.isArray(linhasRecebidas) || linhasRecebidas.length === 0) {
    return NextResponse.json({ error: 'Nenhuma linha para importar.' }, { status: 400 });
  }

  if (linhasRecebidas.length > MAX_LINHAS) {
    return NextResponse.json(
      { error: `Excede o limite de ${MAX_LINHAS} linhas por importação.` },
      { status: 400 },
    );
  }

  const linhas: LinhaImportacao[] = [];
  const rejeitadas: number[] = [];
  for (const raw of linhasRecebidas) {
    const validada = validarLinhaRecebida(raw);
    if (validada) {
      linhas.push(validada);
    } else {
      rejeitadas.push(typeof raw?.linha === 'number' ? raw.linha : -1);
    }
  }

  if (linhas.length === 0) {
    return NextResponse.json(
      { error: 'Nenhuma linha passou na revalidação — os dados recebidos não têm o formato esperado.' },
      { status: 400 },
    );
  }

  let count = 0;
  let duplicatas = 0;
  const importErrors: string[] = [];
  if (rejeitadas.length > 0) {
    importErrors.push(
      `${rejeitadas.length} linha(s) rejeitada(s) na revalidação (formato inesperado) — não foram gravadas.`,
    );
  }

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
