import { supabase } from '@/lib/supabase';
import { priorizarTitulos, agruparPorCliente } from '@/lib/prioridade';
import { Titulo, Cliente } from '@/types';
import ClienteCard from '@/components/ClienteCard';
import { formatarMoeda } from '@/lib/format';
import Link from 'next/link';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const { data: titulos, error } = await supabase
    .from('titulos')
    .select('*, clientes(*)')
    .eq('status', 'aberto');

  if (error) {
    return (
      <main className="max-w-3xl mx-auto px-4 py-8">
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
          Erro ao carregar dados: {error.message}
        </div>
      </main>
    );
  }

  const titulosComClientes = (titulos ?? []) as (Titulo & { clientes: Cliente })[];
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
    <main className="max-w-3xl mx-auto px-4 py-6">

      {/* Page title */}
      <div className="mb-5">
        <h2 className="text-xl font-bold text-slate-900">Lista do dia</h2>
        <p className="text-sm text-slate-500 capitalize mt-0.5">{hoje}</p>
      </div>

      {/* Stats */}
      {priorizados.length > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Vencidos</p>
            <p className="text-2xl font-bold text-red-600">{vencidos.length}</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">A vencer</p>
            <p className="text-2xl font-bold text-amber-500">{preventivos.length}</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Em risco</p>
            <p className="text-lg font-bold text-slate-800 truncate">{formatarMoeda(valorEmRisco)}</p>
          </div>
        </div>
      )}

      {priorizados.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-12 text-center">
          <div className="w-14 h-14 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl">📋</span>
          </div>
          <p className="font-semibold text-slate-700 text-lg">Nenhum título urgente para hoje</p>
          <p className="text-slate-400 text-sm mt-1 mb-5">
            Importe uma planilha CSV para ver a lista priorizada.
          </p>
          <Link
            href="/upload"
            className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-5 py-2.5 rounded-xl transition-colors"
          >
            Importar planilha
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {gruposVencidos.length > 0 && (
            <>
              <p className="text-xs font-semibold text-red-500 uppercase tracking-widest px-1">
                🔴 Vencidos — cobrar hoje
              </p>
              <div className="space-y-3">
                {gruposVencidos.map((grupo) => (
                  <ClienteCard key={grupo.cliente.id} grupo={grupo} />
                ))}
              </div>
            </>
          )}
          {gruposPreventivos.length > 0 && (
            <div className={gruposVencidos.length > 0 ? 'pt-3' : ''}>
              <p className="text-xs font-semibold text-amber-500 uppercase tracking-widest px-1 mb-3">
                🟡 A vencer — enviar lembrete
              </p>
              <div className="space-y-3">
                {gruposPreventivos.map((grupo) => (
                  <ClienteCard key={grupo.cliente.id} grupo={grupo} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
