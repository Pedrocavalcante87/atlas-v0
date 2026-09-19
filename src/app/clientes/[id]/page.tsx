import { supabase } from '@/lib/supabase';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Interacao, Cliente, Titulo } from '@/types';
import { formatarMoeda } from '@/lib/format';
import { ler, lerPaginado, SupabaseIndisponivelError } from '@/lib/supabase-io';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

const STATUS_CONFIG: Record<string, { label: string; cls: string; dot: string }> = {
  aberto:       { label: 'Em aberto',      cls: 'bg-risco-100 text-risco-700',     dot: 'bg-risco-500' },
  pago:         { label: 'Pago',           cls: 'bg-marca-100 text-marca-700', dot: 'bg-marca-600' },
  promessa:     { label: 'Prometeu pagar', cls: 'bg-marca-100 text-marca-800',   dot: 'bg-marca-600' },
  sem_resposta: { label: 'Sem resposta',   cls: 'bg-superficie-afundada text-texto-suave', dot: 'bg-tinta-400' },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.aberto;
  return (
    <span className={`inline-flex items-center gap-1.5 text-legenda px-2.5 py-1 rounded-full font-medium ${cfg.cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

function formatarData(iso: string) {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR');
}

export default async function ClienteHistoricoPage({ params }: PageProps) {
  const { id } = await params;

  // O erro destas consultas era ignorado. Com o banco fora, `cliente` vinha
  // nulo e a página respondia notFound() — dizia "este cliente não existe"
  // quando o certo era "não consegui verificar". Pior nos totais logo abaixo:
  // eles somam dinheiro, e uma leitura falha ou truncada em 1000 linhas
  // (teto do PostgREST) devolveria um total menor do que o cliente realmente
  // deve, sem nenhum sinal de que faltou coisa.
  let cliente: Cliente | null;
  let titulos: (Titulo & { interacoes: Interacao[] })[];

  try {
    [{ data: cliente }, titulos] = await Promise.all([
      ler<Cliente | null>(
        (s) => supabase.from('clientes').select('*').eq('id', id).abortSignal(s).maybeSingle(),
        'cliente do histórico',
      ),
      // Ordenado por `id` para paginar com cursor; a ordem de EXIBIÇÃO
      // (vencimento mais recente primeiro) é reaplicada em memória abaixo —
      // paginação precisa de chave estável e única, `data_vencimento` não é.
      lerPaginado<Titulo & { interacoes: Interacao[] }>((s, apos, limite) => {
        const base = supabase
          .from('titulos')
          .select('*, interacoes(*)', { count: 'exact' })
          .eq('cliente_id', id);
        return (apos ? base.gt('id', apos) : base).order('id').limit(limite).abortSignal(s);
      }, 'títulos do cliente'),
    ]);
  } catch (e) {
    const mensagem =
      e instanceof SupabaseIndisponivelError ? e.message : 'Erro inesperado ao carregar o histórico.';
    return (
      <main className="max-w-3xl mx-auto px-4 py-8">
        <div className="bg-risco-50 border border-risco-200 rounded-md p-4 text-base text-risco-700">
          {mensagem}
        </div>
      </main>
    );
  }

  if (!cliente) notFound();

  // A leitura veio ordenada por `id` (exigência da paginação por cursor).
  // Reaplica aqui a ordem que esta tela sempre teve: vencimento mais recente
  // primeiro. É ordenação de apresentação sobre uma lista já completa.
  titulos.sort((a, b) => b.data_vencimento.localeCompare(a.data_vencimento));

  // "Em aberto" = tudo que ainda não foi pago. Filtrar por status === 'aberto'
  // deixaria de fora títulos em 'promessa' e 'sem_resposta', que continuam
  // sendo dívida — o cliente veria um total menor do que realmente deve.
  const totalAberto = (titulos ?? [])
    .filter((t) => t.status !== 'pago')
    .reduce((sum: number, t: { valor: number }) => sum + t.valor, 0);

  const totalPago = (titulos ?? [])
    .filter((t) => t.status === 'pago')
    .reduce((sum: number, t: { valor: number }) => sum + t.valor, 0);

  return (
    <main className="max-w-3xl mx-auto px-4 py-6">
      {/* Back */}
      <div className="mb-5">
        <Link href="/" className="text-texto-fraco hover:text-texto-suave text-base transition-colors">
          ← Lista do dia
        </Link>
      </div>

      {/* Card do cliente */}
      <div className="bg-superficie border border-borda rounded-lg p-5 mb-5 ">
        <div className="flex items-start justify-between">
          <div>
            <div className="w-10 h-10 bg-superficie-afundada rounded-md flex items-center justify-center mb-3">
              <span className="text-texto-suave font-bold text-titulo">{cliente.nome.charAt(0).toUpperCase()}</span>
            </div>
            <h2 className="text-cifra font-bold text-texto">{cliente.nome}</h2>
            <p className="text-base text-texto-fraco mt-0.5 font-mono">{cliente.telefone}</p>
          </div>
          <div className="text-right">
            {totalAberto > 0 && (
              <div className="bg-risco-50 border border-risco-100 rounded-md px-3 py-2">
                <p className="text-legenda text-risco-500 font-medium">Em aberto</p>
                <p className="text-titulo font-bold text-risco-600">{formatarMoeda(totalAberto)}</p>
              </div>
            )}
            {totalPago > 0 && (
              <div className="bg-marca-50 border border-marca-100 rounded-md px-3 py-2 mt-2">
                <p className="text-legenda text-marca-600 font-medium">Pago</p>
                <p className="text-base font-bold text-marca-700">{formatarMoeda(totalPago)}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Título da seção */}
      <p className="text-legenda font-semibold text-texto-suave uppercase tracking-widest mb-3 px-1">
        Histórico de títulos
      </p>

      {(titulos ?? []).length === 0 ? (
        <div className="bg-superficie rounded-lg border border-borda p-10 text-center ">
          <p className="text-texto-fraco">Nenhum título encontrado.</p>
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
              <div key={titulo.id} className="bg-superficie border border-borda rounded-md overflow-hidden">
                <div className="flex justify-between items-start p-4">
                  <div>
                    <p className="text-cifra font-bold text-texto">
                      {formatarMoeda(titulo.valor)}
                    </p>
                    <p className="text-legenda text-texto-fraco mt-0.5">
                      Vencimento: {formatarData(titulo.data_vencimento)}
                    </p>
                    {titulo.data_promessa && (
                      <p className="text-legenda text-marca-700 mt-1 font-medium">
                        📅 Promessa para {formatarData(titulo.data_promessa)}
                      </p>
                    )}
                  </div>
                  <StatusBadge status={titulo.status} />
                </div>

                {titulo.interacoes && titulo.interacoes.length > 0 && (
                  <div className="border-t border-borda bg-superficie-sutil p-4">
                    <p className="text-legenda font-semibold text-texto-fraco uppercase tracking-wide mb-3">
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
                              <div className="w-2 h-2 rounded-full bg-borda-forte mt-1.5 shrink-0" />
                              <div className="w-px flex-1 bg-superficie-afundada mt-1" />
                            </div>
                            <div className="pb-3 flex-1">
                              <p className="text-legenda text-texto-fraco mb-1">
                                {new Date(inter.data_envio).toLocaleString('pt-BR', {
                                  day: '2-digit',
                                  month: '2-digit',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </p>
                              {inter.mensagem_enviada && (
                                <div className="bg-superficie border border-borda rounded-lg p-2.5 text-legenda text-texto-suave leading-relaxed italic">
                                  &ldquo;{inter.mensagem_enviada}&rdquo;
                                </div>
                              )}
                              {inter.resultado && (
                                <p className="text-legenda text-marca-700 font-semibold mt-1.5">
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
