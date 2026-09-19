'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ClienteAgrupado } from '@/types';
import { registrarEnvio } from '@/actions';
import { formatarMoeda } from '@/lib/format';
import TituloCard from './TituloCard';
import { BotaoLink } from './ui/Botao';

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
  const [erro, setErro] = useState('');
  const { cliente, titulos, valorTotal, categoriaMaisUrgente, mensagemConsolidada } = grupo;

  // Faixa vertical na borda esquerda em vez de barra colorida no topo: marca a
  // urgência sem gastar altura, o que importa numa fila que pode ter centenas
  // de cards. categoriaMaisUrgente já vem calculada por agruparPorCliente().
  const faixa =
    categoriaMaisUrgente === 'atraso_longo'
      ? 'before:bg-risco-500'
      : categoriaMaisUrgente === 'atraso_leve'
      ? 'before:bg-atencao-500'
      : 'before:bg-borda-forte';

  async function handleEnviar() {
    setEnviando(true);
    setErro('');

    // Registra a interação em CADA título aberto desse cliente — assim o
    // histórico individual de cada um mostra que essa mensagem foi enviada,
    // mesmo que o usuário nunca volte pra marcar um resultado depois.
    //
    // `allSettled`, não `all`: o clique já abriu o WhatsApp numa aba nova, e
    // `all` rejeitaria no primeiro erro sem dizer quantos dos outros títulos
    // chegaram a ser registrados. Num cliente com 3 títulos, "falhou" e
    // "falhou 1 de 3" são situações diferentes para quem vai conferir depois.
    const resultados = await Promise.allSettled(
      titulos.map((t) => registrarEnvio(t.id, mensagemConsolidada)),
    );
    const falhas = resultados.filter((r) => r.status === 'rejected').length;

    setEnviando(false);

    // Sem este tratamento a rejeição ficava sem dono: o botão travava em
    // "Registrando envio..." para sempre e o usuário seguia para o WhatsApp
    // achando que a cobrança tinha sido registrada. `registrarEnvio` falha
    // alto de propósito (actions/index.ts) justamente para que a perda do
    // histórico não passe despercebida — quem chama precisa mostrar isso.
    if (falhas > 0) {
      setErro(
        falhas === titulos.length
          ? 'A mensagem foi aberta, mas o envio não ficou registrado. Tente de novo.'
          : `A mensagem foi aberta, mas ${falhas} de ${titulos.length} títulos não tiveram o envio registrado. Tente de novo.`,
      );
      return;
    }

    setEnviado(true);
  }

  return (
    <article
      className={`relative bg-superficie border border-borda rounded-lg overflow-hidden
                  before:absolute before:left-0 before:top-0 before:bottom-0 before:w-0.75 ${faixa}`}
    >
      <div className="pl-5 pr-4 py-4">
        <div className="flex items-start justify-between gap-4 mb-3">
          <div className="min-w-0">
            <Link
              href={`/clientes/${cliente.id}`}
              className="text-[15px] font-medium text-texto hover:text-marca-700 transition-colors truncate block"
            >
              {cliente.nome}
            </Link>
            <p className="text-[13px] text-texto-suave mt-0.5 numero">{cliente.telefone}</p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-[17px] font-semibold text-texto numero leading-none">
              {formatarMoeda(valorTotal)}
            </p>
            <p className="text-[13px] text-texto-suave mt-1">
              {titulos.length} {titulos.length !== 1 ? 'títulos' : 'título'}
            </p>
          </div>
        </div>

        {/* A mensagem é o produto: é o que o usuário vai enviar. Fundo sutil e
            borda esquerda de citação, para ler como texto e não como campo. */}
        <p className="text-[13px] text-texto-suave leading-relaxed border-l-2 border-borda pl-3 mb-3">
          {mensagemConsolidada}
        </p>

        <BotaoLink
          href={linkWhatsApp(cliente.telefone, mensagemConsolidada)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={handleEnviar}
          variante={enviado ? 'secundario' : 'primario'}
          tamanho="md"
          largura
        >
          {enviando ? 'Registrando envio…' : enviado ? 'Enviado — clique para reenviar' : 'Enviar via WhatsApp'}
        </BotaoLink>

        {/* Falha de gravação não pode passar como sucesso. Aqui é especialmente
            importante porque o WhatsApp já abriu — a cobrança foi feita, só o
            registro dela é que não existe, e quem olhar o histórico depois não
            vai saber disso. */}
        {erro && (
          <p role="alert" className="text-[13px] text-risco-600 mt-2">
            {erro}
          </p>
        )}

        <div className="space-y-1.5 mt-3">
          {titulos.map((t) => (
            <TituloCard key={t.id} titulo={t} />
          ))}
        </div>
      </div>
    </article>
  );
}
