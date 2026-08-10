'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ClienteAgrupado } from '@/types';
import { registrarEnvio } from '@/actions';
import { formatarMoeda } from '@/lib/format';
import TituloCard from './TituloCard';

interface Props {
  grupo: ClienteAgrupado;
}

function linkWhatsApp(telefone: string, mensagem: string) {
  return `https://wa.me/${telefone}?text=${encodeURIComponent(mensagem)}`;
}

/**
 * Card do CLIENTE, não do título. Um cliente com 3 títulos em aberto aparece
 * uma vez só, com uma mensagem e um envio de WhatsApp consolidados — ninguém
 * gosta de receber 3 cobranças separadas da mesma empresa no mesmo dia.
 * Cada título individual ainda tem seu próprio controle de status logo
 * abaixo, porque o cliente pode pagar um e não outro.
 */
export default function ClienteCard({ grupo }: Props) {
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const { cliente, titulos, valorTotal, categoriaMaisUrgente, mensagemConsolidada } = grupo;

  // categoriaMaisUrgente já vem calculada por agruparPorCliente() com a mesma
  // regra de corte de lib/prioridade.ts::categorizarTitulo — reaproveitar em
  // vez de recomputar a partir de diasAtrasoMax evita duas fontes da mesma
  // decisão divergirem se o corte mudar (ver ARCHITECTURE.md §6).
  const corFaixa =
    categoriaMaisUrgente === 'atraso_longo'
      ? 'bg-red-500'
      : categoriaMaisUrgente === 'atraso_leve'
      ? 'bg-amber-500'
      : 'bg-blue-500';

  async function handleEnviar() {
    setEnviando(true);
    // Registra a interação em CADA título aberto desse cliente — assim o
    // histórico individual de cada um mostra que essa mensagem foi enviada,
    // mesmo que o usuário nunca volte pra marcar um resultado depois.
    await Promise.all(titulos.map((t) => registrarEnvio(t.id, mensagemConsolidada)));
    setEnviando(false);
    setEnviado(true);
  }

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
      <div className={`h-1 ${corFaixa}`} />
      <div className="p-4">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <Link
              href={`/clientes/${cliente.id}`}
              className="font-bold text-slate-900 hover:text-blue-600 transition-colors truncate block"
            >
              {cliente.nome}
            </Link>
            <p className="text-xs text-slate-400 font-mono mt-0.5">{cliente.telefone}</p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-lg font-bold text-slate-900">{formatarMoeda(valorTotal)}</p>
            <p className="text-xs text-slate-400">
              {titulos.length} {titulos.length !== 1 ? 'títulos' : 'título'}
            </p>
          </div>
        </div>

        <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 mb-3">
          <p className="text-sm text-slate-600 leading-relaxed">{mensagemConsolidada}</p>
        </div>

        <a
          href={linkWhatsApp(cliente.telefone, mensagemConsolidada)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={handleEnviar}
          className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-2.5 rounded-xl transition-colors text-sm mb-3"
        >
          📱 {enviando ? 'Registrando envio...' : enviado ? 'Enviado — clique pra reenviar' : 'Enviar via WhatsApp'}
        </a>

        <div className="space-y-1.5">
          {titulos.map((t) => (
            <TituloCard key={t.id} titulo={t} compact />
          ))}
        </div>
      </div>
    </div>
  );
}
