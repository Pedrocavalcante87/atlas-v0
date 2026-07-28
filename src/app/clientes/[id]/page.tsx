import { supabase } from '@/lib/supabase';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Interacao } from '@/types';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

const STATUS_CONFIG: Record<string, { label: string; cls: string; dot: string }> = {
  aberto:       { label: 'Em aberto',      cls: 'bg-red-100 text-red-700',     dot: 'bg-red-500' },
  pago:         { label: 'Pago',           cls: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500' },
  promessa:     { label: 'Prometeu pagar', cls: 'bg-blue-100 text-blue-700',   dot: 'bg-blue-500' },
  sem_resposta: { label: 'Sem resposta',   cls: 'bg-slate-100 text-slate-500', dot: 'bg-slate-400' },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.aberto;
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium ${cfg.cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

function formatarMoeda(valor: number) {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatarData(iso: string) {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR');
}

export default async function ClienteHistoricoPage({ params }: PageProps) {
  const { id } = await params;

  const { data: cliente } = await supabase
    .from('clientes')
    .select('*')
    .eq('id', id)
    .single();

  if (!cliente) notFound();

  const { data: titulos } = await supabase
    .from('titulos')
    .select('*, interacoes(*)')
    .eq('cliente_id', id)
    .order('data_vencimento', { ascending: false });

  const totalAberto = (titulos ?? [])
    .filter((t) => t.status === 'aberto')
    .reduce((sum: number, t: { valor: number }) => sum + t.valor, 0);

  const totalPago = (titulos ?? [])
    .filter((t) => t.status === 'pago')
    .reduce((sum: number, t: { valor: number }) => sum + t.valor, 0);

  return (
    <main className="max-w-3xl mx-auto px-4 py-6">
      {/* Back */}
      <div className="mb-5">
        <Link href="/" className="text-slate-400 hover:text-slate-600 text-sm transition-colors">
          ← Lista do dia
        </Link>
      </div>

      {/* Card do cliente */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 mb-5 shadow-sm">
        <div className="flex items-start justify-between">
          <div>
            <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center mb-3">
              <span className="text-slate-600 font-bold text-lg">{cliente.nome.charAt(0).toUpperCase()}</span>
            </div>
            <h2 className="text-xl font-bold text-slate-900">{cliente.nome}</h2>
            <p className="text-sm text-slate-400 mt-0.5 font-mono">{cliente.telefone}</p>
          </div>
          <div className="text-right">
            {totalAberto > 0 && (
              <div className="bg-red-50 border border-red-100 rounded-xl px-3 py-2">
                <p className="text-xs text-red-400 font-medium">Em aberto</p>
                <p className="text-lg font-bold text-red-600">{formatarMoeda(totalAberto)}</p>
              </div>
            )}
            {totalPago > 0 && (
              <div className="bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-2 mt-2">
                <p className="text-xs text-emerald-500 font-medium">Pago</p>
                <p className="text-sm font-bold text-emerald-700">{formatarMoeda(totalPago)}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Título da seção */}
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3 px-1">
        Histórico de títulos
      </p>

      {(titulos ?? []).length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center shadow-sm">
          <p className="text-slate-400">Nenhum título encontrado.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {(titulos ?? []).map(
            (titulo: {
              id: string;
              valor: number;
              data_vencimento: string;
              data_promessa: string | null;
              status: string;
              interacoes: Interacao[];
            }) => (
              <div key={titulo.id} className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                <div className="flex justify-between items-start p-4">
                  <div>
                    <p className="text-xl font-bold text-slate-900">
                      {formatarMoeda(titulo.valor)}
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Vencimento: {formatarData(titulo.data_vencimento)}
                    </p>
                    {titulo.data_promessa && (
                      <p className="text-xs text-blue-600 mt-1 font-medium">
                        📅 Promessa para {formatarData(titulo.data_promessa)}
                      </p>
                    )}
                  </div>
                  <StatusBadge status={titulo.status} />
                </div>

                {titulo.interacoes && titulo.interacoes.length > 0 && (
                  <div className="border-t border-slate-100 bg-slate-50 p-4">
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">
                      Interações
                    </p>
                    <div className="space-y-3">
                      {[...titulo.interacoes]
                        .sort(
                          (a, b) =>
                            new Date(a.data_envio).getTime() -
                            new Date(b.data_envio).getTime(),
                        )
                        .map((inter) => (
                          <div key={inter.id} className="flex gap-3">
                            <div className="flex flex-col items-center">
                              <div className="w-2 h-2 rounded-full bg-slate-300 mt-1.5 shrink-0" />
                              <div className="w-px flex-1 bg-slate-200 mt-1" />
                            </div>
                            <div className="pb-3 flex-1">
                              <p className="text-xs text-slate-400 mb-1">
                                {new Date(inter.data_envio).toLocaleString('pt-BR', {
                                  day: '2-digit',
                                  month: '2-digit',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </p>
                              {inter.mensagem_enviada && (
                                <div className="bg-white border border-slate-200 rounded-lg p-2.5 text-xs text-slate-600 leading-relaxed italic">
                                  &ldquo;{inter.mensagem_enviada}&rdquo;
                                </div>
                              )}
                              {inter.resultado && (
                                <p className="text-xs text-emerald-700 font-semibold mt-1.5">
                                  → {inter.resultado}
                                </p>
                              )}
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            ),
          )}
        </div>
      )}
    </main>
  );
}
