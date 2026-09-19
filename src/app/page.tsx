import { supabase } from '@/lib/supabase';
import { priorizarTitulos, agruparPorCliente } from '@/lib/prioridade';
import { totalRecuperado, JANELA_RECUPERACAO_DIAS } from '@/lib/recuperacao';
import { lerPaginado, SupabaseIndisponivelError } from '@/lib/supabase-io';
import { Titulo, Cliente } from '@/types';
import FilaCobranca from '@/components/FilaCobranca';
import KpiCard from '@/components/ui/KpiCard';
import { formatarMoeda } from '@/lib/format';
import Link from 'next/link';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

export default async function HomePage() {
  // Busca tudo que ainda não foi pago e deixa o domínio decidir quem entra na
  // fila de hoje (lib/prioridade.ts::estaNaFilaHoje) — títulos com promessa
  // vencida ou silêncio expirado precisam voltar, e um filtro
  // .eq('status','aberto') aqui os esconderia para sempre.
  //
  // `lerPaginado` impõe prazo, transforma qualquer falha em exceção e busca
  // TODAS as páginas. Dois motivos, os dois medidos:
  //
  //  - uma lista do dia vazia precisa significar "não há o que cobrar hoje",
  //    nunca "a consulta falhou". Sem prazo, uma queda de DNS deixava esta
  //    página carregando por mais de um minuto antes de decidir o que mostrar;
  //  - o PostgREST corta a resposta em 1000 linhas (confirmado neste projeto:
  //    com 1149 títulos não pagos, um `select` sem paginar devolveu 1000). A
  //    lista do dia simplesmente perderia as cobranças excedentes, em silêncio.
  let titulosComClientes: (Titulo & { clientes: Cliente })[];
  let recuperado: number | null;

  try {
    [titulosComClientes, recuperado] = await Promise.all([
      lerPaginado<Titulo & { clientes: Cliente }>((s, apos, limite) => {
        const base = supabase.from('titulos').select('*, clientes(*)', { count: 'exact' }).neq('status', 'pago');
        return (apos ? base.gt('id', apos) : base).order('id').limit(limite).abortSignal(s);
      }, 'títulos da lista do dia'),
      totalRecuperado(),
    ]);
  } catch (e) {
    const mensagem =
      e instanceof SupabaseIndisponivelError ? e.message : 'Erro inesperado ao carregar os dados.';
    return (
      <main className="max-w-6xl mx-auto px-5 py-8">
        <div
          role="alert"
          className="bg-risco-50 border border-risco-200 rounded-md px-4 py-3 text-base text-risco-700"
        >
          {mensagem}
        </div>
      </main>
    );
  }
  const priorizados = priorizarTitulos(titulosComClientes);

  // Cobrança é por CLIENTE, não por título — um cliente com 3 títulos em
  // aberto aparece uma vez, com mensagem e envio de WhatsApp consolidados
  // (lib/prioridade.ts::agruparPorCliente). Os cards de estatística no topo
  // continuam contando títulos individuais, que é o que o texto de cada card
  // descreve ("títulos já em atraso" / "títulos que vencem em até 3 dias").
  const grupos = agruparPorCliente(priorizados);
  const gruposVencidos    = grupos.filter((g) => g.diasAtrasoMax > 0);
  const gruposPreventivos = grupos.filter((g) => g.diasAtrasoMax <= 0);

  const vencidos    = priorizados.filter((t) => t.diasAtraso > 0);
  const preventivos = priorizados.filter((t) => t.diasAtraso <= 0);
  const valorEmRisco = vencidos.reduce((sum, t) => sum + t.valor, 0);

  const hoje = new Date().toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  return (
    <main className="max-w-6xl mx-auto px-5 py-7">

      <div className="mb-6">
        <h1 className="text-titulo font-semibold text-texto tracking-[-0.01em]">Lista do dia</h1>
        <p className="text-corpo text-texto-suave capitalize mt-0.5">{hoje}</p>
      </div>

      {/* Indicadores em cards. O recuperado aparece mesmo com a fila vazia —
          dia sem ninguém pra cobrar é justamente quando o resultado importa. */}
      {(priorizados.length > 0 || (recuperado ?? 0) > 0) && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          <KpiCard rotulo="Vencidos" valor={vencidos.length} tom="risco" nota="títulos em atraso" />
          <KpiCard
            rotulo="A vencer"
            valor={preventivos.length}
            tom="atencao"
            nota="vencem em até 3 dias"
          />
          <KpiCard
            rotulo="Em risco"
            valor={formatarMoeda(valorEmRisco)}
            tom="neutro"
            nota="soma dos vencidos"
          />
          {/* null = a apuração falhou. Mostrar "—" em vez de R$ 0,00: zero
              seria uma afirmação falsa sobre dinheiro. */}
          <KpiCard
            rotulo="Recuperado"
            valor={recuperado === null ? '—' : formatarMoeda(recuperado)}
            tom="marca"
            nota={recuperado === null ? 'indisponível' : `últimos ${JANELA_RECUPERACAO_DIAS} dias`}
          />
        </div>
      )}

      {priorizados.length === 0 ? (
        // Estado vazio sem ilustração nem emoji: o normal aqui é bom (não há
        // ninguém atrasado), e o que a tela precisa é dizer isso com clareza e
        // oferecer o próximo passo.
        <div className="bg-superficie border border-borda rounded-lg px-6 py-12 text-center">
          <p className="text-destaque font-medium text-texto">Nada para cobrar hoje</p>
          <p className="text-corpo text-texto-suave mt-1 mb-5 max-w-sm mx-auto">
            Nenhum título está vencido ou vence nos próximos 3 dias. Importe uma planilha para
            atualizar a carteira.
          </p>
          <Link
            href="/upload"
            className="inline-flex items-center h-9 px-4 text-base font-medium rounded-md bg-marca-700 text-white hover:bg-marca-800 transition-colors"
          >
            Importar planilha
          </Link>
        </div>
      ) : (
        <div className="space-y-5">
          <FilaCobranca
            titulo="Vencidos"
            complemento="cobrar hoje"
            grupos={gruposVencidos}
          />
          <FilaCobranca
            titulo="A vencer"
            complemento="enviar lembrete"
            grupos={gruposPreventivos}
          />
        </div>
      )}
    </main>
  );
}
