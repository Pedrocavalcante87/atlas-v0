'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { formatarMoeda } from '@/lib/format';

interface Stats {
  clientes: number;
  titulos: number;
  titulosAbertos: number;
  titulosConcluidos: number;
  interacoes: number;
  valorVencido: number;
  valorAberto: number;
  /** null quando a apuração falha — nunca exibir como zero (ver lib/recuperacao.ts). */
  valorRecuperado: number | null;
  janelaRecuperacaoDias: number;
}

export default function DadosPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loadingStats, setLoadingStats] = useState(true);
  const [indisponivel, setIndisponivel] = useState('');
  const [confirmacao, setConfirmacao] = useState<'tudo' | 'concluidos' | null>(null);
  const [deletando, setDeletando] = useState(false);
  const [mensagem, setMensagem] = useState('');
  const [erroExclusao, setErroExclusao] = useState('');

  // Não seta loadingStats(true) aqui — o estado inicial já é `true` (skeleton
  // aparece no primeiro render) e chamar setState de forma síncrona dentro do
  // efeito de montagem dispara re-render em cascata. Quem precisa mostrar o
  // skeleton de novo depois de montado (recarregar após limpar dados) seta
  // explicitamente antes de chamar esta função — ver `limpar()` abaixo.
  const carregarStats = useCallback(async () => {
    // `!res.ok` precisa ser tratado aqui: a rota agora responde 503 quando não
    // consegue ler o banco, e o corpo é `{ error }`, não estatísticas. Sem esta
    // checagem o objeto de erro virava `stats` e a tela renderizava
    // "undefined"/zeros — o mesmo tipo de número inventado que a rota passou a
    // se recusar a produzir.
    try {
      const res = await fetch('/api/dados', { cache: 'no-store' });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setIndisponivel(data?.error ?? 'Não foi possível carregar os dados.');
        setStats(null);
      } else {
        setIndisponivel('');
        setStats(data);
      }
    } catch {
      setIndisponivel('Não foi possível falar com o servidor.');
      setStats(null);
    }
    setLoadingStats(false);
  }, []);

  useEffect(() => {
    // Fetch-on-mount intencional (única tela do app que é Client Component +
    // fetch a uma API Route — ver ARCHITECTURE.md §4.4). A regra experimental
    // react-hooks/set-state-in-effect prefere padrões de fetch baseados em
    // Suspense/bibliotecas dedicadas; migrar isso é uma mudança de padrão de
    // dados maior do que o escopo desta tela justifica hoje.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    carregarStats();
  }, [carregarStats]);

  async function limpar(modo: 'tudo' | 'concluidos') {
    setDeletando(true);
    setMensagem('');
    setErroExclusao('');

    try {
      const res = await fetch(`/api/dados?modo=${modo}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        // "tudo" exige a frase exata que o servidor valida — ver api/dados/route.ts.
        body: JSON.stringify(modo === 'tudo' ? { confirmacao: 'EXCLUIR TUDO' } : {}),
      });
      const data = await res.json().catch(() => null);

      // Falha de exclusão NÃO pode entrar em `mensagem`: aquilo é renderizado
      // numa caixa verde com um ✅. Uma auditoria pegou "A exclusão foi
      // interrompida — parte dos dados pode ter sido removida" aparecendo como
      // sucesso. É o mesmo tipo de mentira que este ciclo veio eliminar, só que
      // sobre uma operação irreversível.
      if (!res.ok) {
        setErroExclusao(data?.error ?? 'Não foi possível remover os dados.');
      } else {
        setMensagem(data?.mensagem ?? 'Dados removidos.');
      }
    } catch {
      setErroExclusao('Não foi possível falar com o servidor. Nada foi confirmado.');
    }

    // Recarrega SEMPRE, inclusive depois de falhar: se a exclusão parou no meio,
    // os números da tela viraram ficção e o usuário precisa ver o estado real.
    setLoadingStats(true);
    await carregarStats();

    setConfirmacao(null);
    setDeletando(false);
  }

  return (
    <main className="max-w-3xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="mb-6">
        <div className="mb-1">
          <Link href="/" className="text-slate-400 hover:text-slate-600 text-sm transition-colors">
            ← Lista do dia
          </Link>
        </div>
        <h2 className="text-xl font-bold text-slate-900">Gerenciar dados</h2>
        <p className="text-sm text-slate-500 mt-0.5">Visão geral do banco e opções de limpeza para testes</p>
      </div>

      {/* Indisponibilidade: nenhum número é melhor do que um número falso.
          Os botões de exclusão ficam escondidos enquanto não sabemos o estado
          do banco — apagar dado às cegas é a pior coisa que se pode fazer aqui. */}
      {indisponivel && !loadingStats && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 text-sm">
          <p className="text-red-800 font-semibold">Dados indisponíveis</p>
          <p className="text-red-700 text-xs mt-1 leading-relaxed">{indisponivel}</p>
          <button
            onClick={() => {
              setLoadingStats(true);
              carregarStats();
            }}
            className="mt-3 text-xs font-semibold px-3 py-1.5 rounded-lg bg-white border border-red-200 text-red-700 hover:bg-red-100 transition-colors"
          >
            Tentar de novo
          </button>
        </div>
      )}

      {/* Stats */}
      <div className={`grid grid-cols-2 md:grid-cols-3 gap-3 mb-6 ${indisponivel && !loadingStats ? 'hidden' : ''}`}>
        {loadingStats ? (
          Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm animate-pulse">
              <div className="h-3 bg-slate-100 rounded w-2/3 mb-2" />
              <div className="h-6 bg-slate-100 rounded w-1/2" />
            </div>
          ))
        ) : stats ? (
          <>
            <StatCard label="Clientes" value={stats.clientes} />
            <StatCard
              label="Títulos em aberto"
              value={stats.titulosAbertos}
              highlight="blue"
              hint="Tudo que ainda não foi pago, incluindo follow-ups"
            />
            <StatCard
              label="Títulos pagos"
              value={stats.titulosConcluidos}
              hint="Único estado que encerra um título"
            />
            <StatCard label="Total de títulos" value={stats.titulos} />
            {/* Valor vencido = mesma lógica da lista do dia (diasAtraso > 0) */}
            <StatCard
              label="Valor vencido"
              value={formatarMoeda(stats.valorVencido)}
              highlight="red"
              hint="Apenas títulos já vencidos — igual à lista do dia"
            />
            {/* Valor aberto = todos em aberto, incluindo os que ainda vão vencer */}
            <StatCard
              label="Total em aberto"
              value={formatarMoeda(stats.valorAberto)}
              hint="Inclui vencidos + títulos que ainda vão vencer"
            />
            <StatCard
              label="Recuperado"
              value={stats.valorRecuperado === null ? '—' : formatarMoeda(stats.valorRecuperado)}
              hint={
                stats.valorRecuperado === null
                  ? 'Apuração indisponível — confira o log do servidor'
                  : `Títulos pagos nos últimos ${stats.janelaRecuperacaoDias} dias`
              }
            />
          </>
        ) : (
          <p className="text-sm text-slate-400 col-span-3">Erro ao carregar dados.</p>
        )}
      </div>

      {/* Sucesso da exclusão */}
      {mensagem && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3.5 flex gap-2.5 text-sm text-emerald-800 mb-6">
          <span>✅</span>
          <span>{mensagem}</span>
        </div>
      )}

      {/* Falha da exclusão — vermelho, nunca verde. A exclusão pode ter parado
          no meio, e o usuário precisa saber disso antes de tentar de novo. */}
      {erroExclusao && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3.5 flex gap-2.5 text-sm mb-6">
          <span className="shrink-0">❌</span>
          <div>
            <p className="text-red-800 font-semibold">A exclusão não foi concluída</p>
            <p className="text-red-700 text-xs mt-0.5 leading-relaxed">{erroExclusao}</p>
          </div>
        </div>
      )}

      {/* Zona de perigo — some enquanto o estado do banco é desconhecido.
          Era possível ver "0 títulos" por falha de leitura e clicar em
          "Limpar tudo" logo abaixo, achando que não havia nada a perder. */}
      <div
        className={`bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden ${
          indisponivel && !loadingStats ? 'hidden' : ''
        }`}
      >
        <div className="px-5 py-4 border-b border-slate-100 bg-slate-50">
          <h3 className="text-sm font-semibold text-slate-700">Zona de perigo</h3>
          <p className="text-xs text-slate-400 mt-0.5">Ações irreversíveis — não há desfazer</p>
        </div>

        <div className="divide-y divide-slate-100">
          <AcaoPerigo
            titulo="Limpar títulos pagos"
            descricao="Remove apenas títulos já pagos, com o histórico de interações deles. Títulos aguardando follow-up (promessa ou sem resposta) são mantidos — continuam sendo dívida em aberto."
            labelBotao="Limpar pagos"
            cor="amber"
            confirmando={confirmacao === 'concluidos'}
            deletando={deletando}
            onSolicitar={() => setConfirmacao('concluidos')}
            onConfirmar={() => limpar('concluidos')}
            onCancelar={() => setConfirmacao(null)}
          />
          <AcaoPerigo
            titulo="Limpar tudo"
            descricao="Remove absolutamente todos os clientes, títulos e interações. O sistema ficará em branco — útil para reiniciar os testes."
            labelBotao="Limpar tudo"
            cor="red"
            confirmando={confirmacao === 'tudo'}
            deletando={deletando}
            onSolicitar={() => setConfirmacao('tudo')}
            onConfirmar={() => limpar('tudo')}
            onCancelar={() => setConfirmacao(null)}
          />
        </div>
      </div>
    </main>
  );
}

function StatCard({
  label,
  value,
  highlight,
  hint,
}: {
  label: string;
  value: string | number;
  highlight?: 'blue' | 'red';
  hint?: string;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
      <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">{label}</p>
      <p
        className={`text-xl font-bold truncate ${
          highlight === 'blue'
            ? 'text-blue-600'
            : highlight === 'red'
            ? 'text-red-600'
            : 'text-slate-800'
        }`}
      >
        {value}
      </p>
      {hint && <p className="text-xs text-slate-400 mt-1 leading-tight">{hint}</p>}
    </div>
  );
}

function AcaoPerigo({
  titulo,
  descricao,
  labelBotao,
  cor,
  confirmando,
  deletando,
  onSolicitar,
  onConfirmar,
  onCancelar,
}: {
  titulo: string;
  descricao: string;
  labelBotao: string;
  cor: 'amber' | 'red';
  confirmando: boolean;
  deletando: boolean;
  onSolicitar: () => void;
  onConfirmar: () => void;
  onCancelar: () => void;
}) {
  const btnBase = 'text-sm font-semibold px-4 py-2 rounded-lg transition-colors whitespace-nowrap';
  const corSolicitacao =
    cor === 'red'
      ? 'bg-red-50 hover:bg-red-100 text-red-700 border border-red-200'
      : 'bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200';
  const corConfirmar =
    cor === 'red'
      ? 'bg-red-600 hover:bg-red-700 text-white disabled:opacity-50'
      : 'bg-amber-500 hover:bg-amber-600 text-white disabled:opacity-50';

  return (
    <div className="px-5 py-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-700">{titulo}</p>
          <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">{descricao}</p>
        </div>

        {!confirmando ? (
          <button onClick={onSolicitar} className={`${btnBase} ${corSolicitacao} shrink-0`}>
            {labelBotao}
          </button>
        ) : (
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            <span className="text-xs font-semibold text-red-700">Tem certeza?</span>
            <button
              onClick={onConfirmar}
              disabled={deletando}
              className={`${btnBase} ${corConfirmar}`}
            >
              {deletando ? 'Removendo…' : 'Sim, remover'}
            </button>
            <button
              onClick={onCancelar}
              disabled={deletando}
              className={`${btnBase} bg-slate-100 hover:bg-slate-200 text-slate-700`}
            >
              Cancelar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
