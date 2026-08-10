import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { calcularDiasAtraso } from '@/lib/prioridade';

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

  // Mesma lógica da lista do dia (lib/prioridade.ts::calcularDiasAtraso) — só
  // títulos já vencidos contam como "em risco". Antes esse cálculo comparava
  // strings ISO de data diretamente em vez de reaproveitar a fonte oficial de
  // "dias de atraso" (ver ARCHITECTURE.md §6); reaproveitar evita que os dois
  // números divirjam se a regra mudar em só um dos lugares.
  const lista = abertos ?? [];
  const valorVencido = lista
    .filter((t) => calcularDiasAtraso(t.data_vencimento as string) > 0)
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

// A UI já pede confirmação em dois cliques antes de chamar esse endpoint,
// mas isso não protege contra alguém disparando o DELETE diretamente (fora
// da UI) com uma sessão válida — a única checagem que existia antes era a
// senha do app. Para a ação mais destrutiva ("tudo"), exigimos que o corpo
// da requisição inclua a frase exata que a UI pede pro usuário digitar; isso
// eleva a barra de "clique duplo" pra "precisa saber o contrato exato", o
// suficiente pra esse estágio do produto sem virar um fluxo de confirmação
// complexo (ver ARCHITECTURE.md §9).
const FRASE_CONFIRMACAO_TUDO = 'EXCLUIR TUDO';

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const modo = searchParams.get('modo');
  const body = await request.json().catch(() => null);

  if (modo === 'tudo') {
    if (body?.confirmacao !== FRASE_CONFIRMACAO_TUDO) {
      return NextResponse.json(
        { error: `Confirmação inválida. Envie { confirmacao: "${FRASE_CONFIRMACAO_TUDO}" } no corpo da requisição.` },
        { status: 400 },
      );
    }
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
