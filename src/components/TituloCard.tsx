'use client';

import { useState } from 'react';
import { TituloComPrioridade, StatusTitulo, MotivoReentrada } from '@/types';
import { atualizarStatusTitulo } from '@/actions';
import { formatarMoeda } from '@/lib/format';
import Badge, { tomDaCategoria } from './ui/Badge';
import { Botao } from './ui/Botao';

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

const STATUS_OPTIONS: { value: StatusTitulo; label: string }[] = [
  { value: 'pago', label: 'Pago' },
  { value: 'promessa', label: 'Prometeu pagar' },
  { value: 'sem_resposta', label: 'Sem resposta' },
];

const REENTRADA_LABEL: Record<MotivoReentrada, string> = {
  promessa_vencida: 'prometeu e não pagou',
  silencio_expirado: 'sem resposta antes',
};

export default function TituloCard({ titulo }: Props) {
  const [selected, setSelected] = useState<StatusTitulo | null>(null);
  const [dataPromessa, setDataPromessa] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [erro, setErro] = useState('');

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
    return (
      <div className="flex items-center justify-between gap-3 px-3 py-2.5 bg-superficie-sutil border border-borda rounded-md">
        <span className="text-[13px] text-texto-fraco line-through numero">
          {formatarMoeda(titulo.valor)}
        </span>
        <Badge tom={selected === 'pago' ? 'marca' : 'neutro'}>{label}</Badge>
      </div>
    );
  }

  const rotuloPrazo =
    titulo.diasAtraso > 0
      ? `${titulo.diasAtraso} dias em atraso`
      : titulo.diasAtraso === 0
      ? 'vence hoje'
      : `vence em ${Math.abs(titulo.diasAtraso)} dias`;

  return (
    <div className="border border-borda rounded-md bg-superficie">
      <div className="flex items-center justify-between gap-3 px-3 py-2.5">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="text-sm font-medium text-texto numero">
            {formatarMoeda(titulo.valor)}
          </span>
          <Badge tom={tomDaCategoria(titulo.categoria)}>{rotuloPrazo}</Badge>
          {/* Quem cobra precisa saber que já falou com essa pessoa antes — um
              título que voltou não pode parecer um contato novo. */}
          {titulo.motivoReentrada && (
            <Badge tom="neutro">{REENTRADA_LABEL[titulo.motivoReentrada]}</Badge>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {STATUS_OPTIONS.map(({ value, label }) => (
            <Botao
              key={value}
              tamanho="sm"
              variante={selected === value ? 'primario' : 'sutil'}
              onClick={() => handleStatusClick(value)}
              disabled={loading}
            >
              {label}
            </Botao>
          ))}
        </div>
      </div>

      {(erro || selected === 'promessa') && (
        <div className="px-3 pb-2.5 -mt-0.5">
          {erro && <p className="text-[13px] text-risco-600">{erro}</p>}

          {selected === 'promessa' && (
            <div className="flex gap-2 items-center">
              <label htmlFor={`promessa-${titulo.id}`} className="text-[13px] text-texto-suave">
                Pagamento prometido para
              </label>
              <input
                id={`promessa-${titulo.id}`}
                type="date"
                value={dataPromessa}
                onChange={(e) => setDataPromessa(e.target.value)}
                className="h-8 border border-borda-forte rounded-md px-2 text-[13px] bg-superficie text-texto"
              />
              <Botao
                tamanho="sm"
                variante="primario"
                onClick={() => confirmarStatus('promessa', dataPromessa)}
                disabled={!dataPromessa || loading}
              >
                {loading ? '…' : 'Confirmar'}
              </Botao>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
