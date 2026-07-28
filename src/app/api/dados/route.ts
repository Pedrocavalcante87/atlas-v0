import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET() {
  const [
    { count: totalClientes },
    { count: totalTitulos },
    { count: totalInteracoes },
    { data: abertos },
    { count: totalAbertos },
    { count: totalConcluidos },
  ] = await Promise.all([
    supabase.from('clientes').select('*', { count: 'exact', head: true }),
    supabase.from('titulos').select('*', { count: 'exact', head: true }),
    supabase.from('interacoes').select('*', { count: 'exact', head: true }),
    supabase.from('titulos').select('valor, data_vencimento').eq('status', 'aberto'),
    supabase.from('titulos').select('*', { count: 'exact', head: true }).eq('status', 'aberto'),
    supabase.from('titulos').select('*', { count: 'exact', head: true }).neq('status', 'aberto'),
  ]);

  // Mesma lógica da página principal: só títulos já vencidos contam como "em risco"
  const hoje = new Date().toISOString().split('T')[0];
  const lista = abertos ?? [];
  const valorVencido  = lista
    .filter((t) => (t.data_vencimento as string) < hoje)
    .reduce((sum, t) => sum + (t.valor as number), 0);
  const valorAberto = lista.reduce((sum, t) => sum + (t.valor as number), 0);

  return NextResponse.json({
    clientes: totalClientes ?? 0,
    titulos: totalTitulos ?? 0,
    titulosAbertos: totalAbertos ?? 0,
    titulosConcluidos: totalConcluidos ?? 0,
    interacoes: totalInteracoes ?? 0,
    valorVencido,
    valorAberto,
  });
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const modo = searchParams.get('modo');

  if (modo === 'tudo') {
    await supabase.from('interacoes').delete().not('id', 'is', null);
    await supabase.from('titulos').delete().not('id', 'is', null);
    await supabase.from('clientes').delete().not('id', 'is', null);
    return NextResponse.json({ success: true, mensagem: 'Todos os dados foram removidos.' });
  }

  if (modo === 'concluidos') {
    const { data: ids } = await supabase
      .from('titulos')
      .select('id')
      .neq('status', 'aberto');

    if (ids && ids.length > 0) {
      const idList = ids.map((t) => t.id);
      await supabase.from('interacoes').delete().in('titulo_id', idList);
      await supabase.from('titulos').delete().in('id', idList);
    }
    return NextResponse.json({ success: true, mensagem: 'Títulos concluídos removidos.' });
  }

  return NextResponse.json({ error: 'Modo inválido. Use ?modo=tudo ou ?modo=concluidos' }, { status: 400 });
}
