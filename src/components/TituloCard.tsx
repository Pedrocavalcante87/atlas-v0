'use client';

import { useState } from 'react';
import Link from 'next/link';
import { TituloComPrioridade, StatusTitulo } from '@/types';
import { atualizarStatusTitulo } from '@/actions';
import { formatarMoeda } from '@/lib/format';

interface Props {
  titulo: TituloComPrioridade;
  /** Uso aninhado dentro de ClienteCard: some com o botão de WhatsApp, a
   *  caixa de mensagem e o rodapé de score — o card do cliente já mostra a
   *  mensagem consolidada e tem seu próprio botão de envio; repetir isso por
   *  título viraria dois CTAs de WhatsApp por cliente. Mantém só valor,
   *  badge de urgência e os botões de status, que são por título mesmo. */
  compact?: boolean;
}

const STATUS_OPTIONS: { value: StatusTitulo; label: string; icon: string }[] = [
  { value: 'pago',         label: 'Pago',           icon: '✓' },
  { value: 'promessa',     label: 'Prometeu pagar', icon: '📅' },
  { value: 'sem_resposta', label: 'Sem resposta',   icon: '—' },
];

function limparTelefone(tel: string): string {
  const digits = tel.replace(/\D/g, '');
  return digits.startsWith('55') ? digits : `55${digits}`;
}

export default function TituloCard({ titulo, compact = false }: Props) {
  const [selected, setSelected] = useState<StatusTitulo | null>(null);
  const [dataPromessa, setDataPromessa] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const isUrgent   = titulo.diasAtraso > 7;
  const isModerate = titulo.diasAtraso >= 1 && titulo.diasAtraso <= 7;

  const accentColor = isUrgent
    ? 'border-l-red-500'
    : isModerate
    ? 'border-l-amber-400'
    : 'border-l-blue-400';

  const badgeStyle = isUrgent
    ? 'bg-red-100 text-red-700'
    : isModerate
    ? 'bg-amber-100 text-amber-700'
    : 'bg-blue-100 text-blue-700';

  const whatsAppUrl = `https://wa.me/${limparTelefone(titulo.cliente.telefone)}?text=${encodeURIComponent(titulo.mensagem)}`;

  async function confirmarStatus(status: StatusTitulo, promessa?: string) {
    setLoading(true);
    await atualizarStatusTitulo(titulo.id, status, titulo.mensagem, promessa);
    setDone(true);
    setLoading(false);
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
        <span className={`text-xs font-bold px-2.5 py-1 rounded-full whitespace-nowrap ml-3 mt-0.5 ${badgeStyle}`}>
          {titulo.diasAtraso > 0
            ? `${titulo.diasAtraso}d em atraso`
            : titulo.diasAtraso === 0
            ? 'vence hoje'
            : `vence em ${Math.abs(titulo.diasAtraso)}d`}
        </span>
      </div>

      {/* Mensagem gerada — some no modo compacto (o card do cliente já mostra a consolidada) */}
      {!compact && (
        <div className="mx-4 mb-3 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2.5">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Mensagem gerada</p>
          <p className="text-sm text-slate-600 leading-relaxed">{titulo.mensagem}</p>
        </div>
      )}

      {/* Ações */}
      <div className={`px-4 pb-4 space-y-3 ${compact ? 'pt-1' : ''}`}>
        {/* Botão WhatsApp — some no modo compacto */}
        {!compact && (
          <a
            href={whatsAppUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 text-white text-sm font-semibold py-2.5 rounded-lg transition-colors shadow-sm"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
            </svg>
            Enviar via WhatsApp
          </a>
        )}

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

      {/* Score indicator — linha sutil no fundo; some no modo compacto */}
      {!compact && titulo.score > 0 && (
        <div className="px-4 py-2 border-t border-slate-100 bg-slate-50 flex items-center gap-2">
          <span className="text-xs text-slate-400">
            Score de prioridade:
          </span>
          <span className="text-xs font-semibold text-slate-600">
            {titulo.score.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}
          </span>
        </div>
      )}
    </div>
  );
}
