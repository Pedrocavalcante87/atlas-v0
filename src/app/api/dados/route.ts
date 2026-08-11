import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { calcularDiasAtraso } from '@/lib/prioridade';
import { totalRecuperado, JANELA_RECUPERACAO_DIAS } from '@/lib/recuperacao';
import { ler, lerPaginado, gravar, SupabaseIndisponivelError } from '@/lib/supabase-io';
import { emLotes } from '@/lib/csv-import';

/** Ids num filtro `.in(...)` viajam na query string — lotes pequenos evitam URL longa demais. */
const LOTE_IDS_EM_FILTRO = 100;

interface TituloEmAberto {
  valor: number;
  data_vencimento: string;
}

// ---------------------------------------------------------------------------
// "Concluído" aqui significa PAGO, não "status != aberto". Desde que 'promessa'
// e 'sem_resposta' deixaram de ser terminais (ver lib/prioridade.ts), um título
// nesses estados é uma dívida em follow-up — contá-lo como concluído mentiria
// nas estatísticas, e apagá-lo destruiria dado financeiro (ver DELETE abaixo).
//
// Toda leitura aqui passa por `ler`/`lerPaginado`, que LANÇAM em vez de
// devolver vazio. Antes cada agregação terminava em `?? 0` e, com o Supabase
// inalcançável, esta rota respondia HTTP 200 com "0 clientes, R$ 0,00" — foi
// reproduzido com o banco contendo 3 clientes. Um apagão de rede virava uma
// afirmação falsa sobre dinheiro, ao lado de dois botões de exclusão em massa.
// A regra do produto é a oposta: sem saber o estado real do banco, não se
// inventa um estado que pareça válido.
// ---------------------------------------------------------------------------
export async function GET() {
  try {
    const [
      { count: totalClientes },
      { count: totalTitulos },
      { count: totalInteracoes },
      naoPagos,
      { count: totalEmAberto },
      { count: totalPagos },
      recuperado,
    ] = await Promise.all([
      ler((s) => supabase.from('clientes').select('*', { count: 'exact', head: true }).abortSignal(s), 'contagem de clientes'),
      ler((s) => supabase.from('titulos').select('*', { count: 'exact', head: true }).abortSignal(s), 'contagem de títulos'),
      ler((s) => supabase.from('interacoes').select('*', { count: 'exact', head: true }).abortSignal(s), 'contagem de interações'),
      // Paginado: esta lista alimenta soma de dinheiro, e uma resposta truncada
      // pelo teto de linhas do PostgREST subnotificaria o total em silêncio.
      lerPaginado<TituloEmAberto>(
        (s, de, ate) =>
          supabase.from('titulos').select('valor, data_vencimento').neq('status', 'pago').range(de, ate).abortSignal(s),
        'títulos não pagos',
      ),
      ler((s) => supabase.from('titulos').select('*', { count: 'exact', head: true }).neq('status', 'pago').abortSignal(s), 'contagem de títulos em aberto'),
      ler((s) => supabase.from('titulos').select('*', { count: 'exact', head: true }).eq('status', 'pago').abortSignal(s), 'contagem de títulos pagos'),
      totalRecuperado(),
    ]);

    // Mesma lógica da lista do dia (lib/prioridade.ts::calcularDiasAtraso) — só
    // títulos já vencidos contam como "em risco". Antes esse cálculo comparava
    // strings ISO de data diretamente em vez de reaproveitar a fonte oficial de
    // "dias de atraso" (ver ARCHITECTURE.md §6); reaproveitar evita que os dois
    // números divirjam se a regra mudar em só um dos lugares.
    const valorVencido = naoPagos
      .filter((t) => calcularDiasAtraso(t.data_vencimento) > 0)
      .reduce((sum, t) => sum + Number(t.valor), 0);
    const valorAberto = naoPagos.reduce((sum, t) => sum + Number(t.valor), 0);

    return NextResponse.json({
      clientes: totalClientes ?? 0,
      titulos: totalTitulos ?? 0,
      titulosAbertos: totalEmAberto ?? 0,
      titulosConcluidos: totalPagos ?? 0,
      interacoes: totalInteracoes ?? 0,
      valorVencido,
      valorAberto,
      valorRecuperado: recuperado,
      janelaRecuperacaoDias: JANELA_RECUPERACAO_DIAS,
    });
  } catch (e) {
    if (e instanceof SupabaseIndisponivelError) {
      return NextResponse.json({ error: e.message, indisponivel: true }, { status: 503 });
    }
    throw e;
  }
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

  // "Removi tudo" é uma afirmação sobre dado destruído. Antes as três exclusões
  // eram disparadas sem checar o resultado e a rota respondia sucesso de
  // qualquer jeito — com o banco fora, o usuário lia "Todos os dados foram
  // removidos" e nada tinha sido tocado. Cada passo agora precisa confirmar.
  if (modo === 'tudo') {
    if (body?.confirmacao !== FRASE_CONFIRMACAO_TUDO) {
      return NextResponse.json(
        { error: `Confirmação inválida. Envie { confirmacao: "${FRASE_CONFIRMACAO_TUDO}" } no corpo da requisição.` },
        { status: 400 },
      );
    }

    // Ordem obrigatória: filhos antes dos pais.
    const passos = [
      ['interações', (s: AbortSignal) => supabase.from('interacoes').delete().not('id', 'is', null).abortSignal(s)],
      ['títulos', (s: AbortSignal) => supabase.from('titulos').delete().not('id', 'is', null).abortSignal(s)],
      ['clientes', (s: AbortSignal) => supabase.from('clientes').delete().not('id', 'is', null).abortSignal(s)],
    ] as const;

    for (const [oQue, construir] of passos) {
      const r = await gravar<null>(construir, `exclusão de ${oQue}`);
      if (!r.ok) {
        return NextResponse.json(
          {
            error:
              `A exclusão foi interrompida ao remover ${oQue} — ${r.mensagem} ` +
              `Parte dos dados pode ter sido removida. Confira antes de tentar de novo.`,
          },
          { status: r.indisponivel ? 503 : 500 },
        );
      }
    }
    return NextResponse.json({ success: true, mensagem: 'Todos os dados foram removidos.' });
  }

  if (modo === 'concluidos') {
    // SÓ títulos pagos. Este filtro era .neq('status','aberto') — que agora
    // apagaria títulos em 'promessa' e 'sem_resposta', ou seja, dívidas ainda
    // não pagas que estão apenas aguardando follow-up, junto com todo o
    // histórico de interações delas. Perda de dado financeiro, não limpeza.
    try {
      const ids = await lerPaginado<{ id: string }>(
        (s, de, ate) =>
          supabase.from('titulos').select('id').eq('status', 'pago').range(de, ate).abortSignal(s),
        'títulos pagos a remover',
      );

      for (const lote of emLotes(ids.map((t) => t.id), LOTE_IDS_EM_FILTRO)) {
        for (const [oQue, construir] of [
          ['interações', (s: AbortSignal) => supabase.from('interacoes').delete().in('titulo_id', lote).abortSignal(s)],
          ['títulos', (s: AbortSignal) => supabase.from('titulos').delete().in('id', lote).abortSignal(s)],
        ] as const) {
          const r = await gravar<null>(construir, `exclusão de ${oQue} pagos`);
          if (!r.ok) {
            return NextResponse.json(
              {
                error:
                  `A limpeza foi interrompida ao remover ${oQue} — ${r.mensagem} ` +
                  `Parte dos títulos pagos pode ter sido removida.`,
              },
              { status: r.indisponivel ? 503 : 500 },
            );
          }
        }
      }
      return NextResponse.json({ success: true, mensagem: 'Títulos pagos removidos.' });
    } catch (e) {
      if (e instanceof SupabaseIndisponivelError) {
        return NextResponse.json(
          { error: `Não foi possível listar os títulos pagos — ${e.message} Nada foi removido.` },
          { status: 503 },
        );
      }
      throw e;
    }
  }

  return NextResponse.json({ error: 'Modo inválido. Use ?modo=tudo ou ?modo=concluidos' }, { status: 400 });
}
