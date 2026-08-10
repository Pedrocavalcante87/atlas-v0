'use client';

import { useState } from 'react';
import Link from 'next/link';
import { TituloComPrioridade, StatusTitulo, MotivoReentrada } from '@/types';
import { atualizarStatusTitulo } from '@/actions';
import { formatarMoeda } from '@/lib/format';

/**
 * Linha de um título individual, sempre renderizada DENTRO de um ClienteCard —
 * que já mostra a mensagem consolidada e tem o botão de WhatsApp do cliente.
 * Por isso aqui não há CTA de envio nem caixa de mensagem: teria dois botões
 * de WhatsApp por cliente. O que é por título mesmo fica aqui: valor, urgência
 * e o registro de resultado.
 */
interface Props {
  titulo: TituloComPrioridade;
}

const STATUS_OPTIONS: { value: StatusTitulo; label: string; icon: string }[] = [
  { value: 'pago',         label: 'Pago',           icon: '✓' },
  { value: 'promessa',     label: 'Prometeu pagar', icon: '📅' },
  { value: 'sem_resposta', label: 'Sem resposta',   icon: '—' },
];

const REENTRADA_LABEL: Record<MotivoReentrada, string> = {
  promessa_vencida: '⏰ prometeu e não pagou',
  silencio_expirado: '🔁 sem resposta antes',
};

export default function TituloCard({ titulo }: Props) {
  const [selected, setSelected] = useState<StatusTitulo | null>(null);
  const [dataPromessa, setDataPromessa] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [erro, setErro] = useState('');

  // Usa a categoria já calculada pelo domínio (lib/prioridade.ts) em vez de
  // re-derivar os cortes de 7/1 dia aqui — eram os mesmos números escritos
  // duas vezes, prontos para divergir na próxima mudança de regra.
  const accentColor =
    titulo.categoria === 'atraso_longo'
      ? 'border-l-red-500'
      : titulo.categoria === 'atraso_leve'
      ? 'border-l-amber-400'
      : 'border-l-blue-400';

  const badgeStyle =
    titulo.categoria === 'atraso_longo'
      ? 'bg-red-100 text-red-700'
      : titulo.categoria === 'atraso_leve'
      ? 'bg-amber-100 text-amber-700'
      : 'bg-blue-100 text-blue-700';

  async function confirmarStatus(status: StatusTitulo, promessa?: string) {
    setLoading(true);
    setErro('');
    try {
      await atualizarStatusTitulo(titulo.id, status, titulo.mensagem, promessa);
      setDone(true);
    } catch {
      // Sem isso o card mostraria "Pago" mesmo com a gravação tendo falhado.
      setErro('Não foi possível registrar. Tente de novo.');
      setSelected(null);
    } finally {
      setLoading(false);
    }
  }

  async function handleStatusClick(status: StatusTitulo) {
    if (status === 'promessa') {
      setSelected('promessa');
      return;
    }
    setSelected(status);
    await confirmarStatus(status);
  }

  if (done) {
    const label = STATUS_OPTIONS.find((s) => s.value === selected)?.label ?? 'Atualizado';
    const doneStyle =
      selected === 'pago'
        ? 'bg-emerald-50 border-l-emerald-400'
        : selected === 'promessa'
        ? 'bg-blue-50 border-l-blue-400'
        : 'bg-slate-50 border-l-slate-300';
    return (
      <div className={`rounded-xl border border-slate-200 border-l-4 ${doneStyle} px-4 py-3 flex items-center justify-between`}>
        <span className="text-sm font-medium text-slate-500">{titulo.cliente.nome}</span>
        <span className="text-xs text-slate-400 font-medium">{label}</span>
      </div>
    );
  }

  return (
    <div className={`bg-white rounded-xl border border-slate-200 border-l-4 ${accentColor} shadow-sm overflow-hidden`}>
      {/* Header row */}
      <div className="flex items-start justify-between px-4 pt-4 pb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <Link
              href={`/clientes/${titulo.cliente_id}`}
              className="font-semibold text-slate-800 hover:text-blue-600 transition-colors truncate"
            >
              {titulo.cliente.nome}
            </Link>
          </div>
          <p className="text-2xl font-bold text-slate-900 tracking-tight">
            {formatarMoeda(titulo.valor)}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 ml-3 mt-0.5 shrink-0">
          <span className={`text-xs font-bold px-2.5 py-1 rounded-full whitespace-nowrap ${badgeStyle}`}>
            {titulo.diasAtraso > 0
              ? `${titulo.diasAtraso}d em atraso`
              : titulo.diasAtraso === 0
              ? 'vence hoje'
              : `vence em ${Math.abs(titulo.diasAtraso)}d`}
          </span>
          {/* Quem cobra precisa saber que já falou com essa pessoa antes — um
              título que voltou não pode parecer um contato novo. */}
          {titulo.motivoReentrada && (
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap bg-slate-100 text-slate-600">
              {REENTRADA_LABEL[titulo.motivoReentrada]}
            </span>
          )}
        </div>
      </div>

      {/* Ações */}
      <div className="px-4 pb-4 pt-1 space-y-3">
        {/* Status buttons */}
        <div>
          <p className="text-xs font-medium text-slate-400 mb-2">Registrar resultado:</p>
          <div className="flex flex-wrap gap-2">
            {STATUS_OPTIONS.map(({ value, label, icon }) => (
              <button
                key={value}
                onClick={() => handleStatusClick(value)}
                disabled={loading}
                className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-all ${
                  selected === value
                    ? 'bg-slate-800 text-white border-slate-800 shadow-sm'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400 hover:bg-slate-50'
                }`}
              >
                {icon} {label}
              </button>
            ))}
          </div>

          {erro && (
            <p className="text-xs text-red-600 mt-2 font-medium">⚠ {erro}</p>
          )}

          {selected === 'promessa' && (
            <div className="flex gap-2 mt-3">
              <input
                type="date"
                value={dataPromessa}
                onChange={(e) => setDataPromessa(e.target.value)}
                className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              />
              <button
                onClick={() => confirmarStatus('promessa', dataPromessa)}
                disabled={!dataPromessa || loading}
                className="text-sm bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors font-medium"
              >
                {loading ? '…' : 'Confirmar'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
