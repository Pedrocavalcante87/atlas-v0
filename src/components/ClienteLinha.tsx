'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ClienteAgrupado, StatusTitulo } from '@/types';
import { registrarEnvio, atualizarStatusTitulo } from '@/actions';
import { formatarMoeda } from '@/lib/format';
import Badge, { tomDaCategoria } from './ui/Badge';
import { BotaoIcone, LinkIcone } from './ui/BotaoIcone';
import { Botao } from './ui/Botao';
import {
  IconeWhatsApp,
  IconeTelefone,
  IconePago,
  IconePromessa,
  IconeSemResposta,
  IconeDivisa,
} from './ui/Icone';

interface Props {
  grupo: ClienteAgrupado;
}

function linkWhatsApp(telefone: string, mensagem: string) {
  return `https://wa.me/${telefone}?text=${encodeURIComponent(mensagem)}`;
}

/** Telefone só com dígitos vira exibição legível: 55 11 98888-7777. */
function formatarTelefone(digitos: string): string {
  const m = digitos.match(/^(\d{2})(\d{2})(\d{4,5})(\d{4})$/);
  return m ? `+${m[1]} ${m[2]} ${m[3]}-${m[4]}` : digitos;
}

/**
 * Uma linha da fila: um CLIENTE, não um título. Um cliente com 3 títulos em
 * aberto ocupa uma linha, com mensagem e envio de WhatsApp consolidados —
 * ninguém gosta de receber 3 cobranças separadas da mesma empresa no mesmo
 * dia. Os títulos individuais aparecem ao expandir, porque o cliente pode
 * pagar um e não outro, e o registro de resultado é por título.
 */
export default function ClienteLinha({ grupo }: Props) {
  const [aberta, setAberta] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [erro, setErro] = useState('');
  const [emCurso, setEmCurso] = useState<string | null>(null);
  const [resolvidos, setResolvidos] = useState<Record<string, StatusTitulo>>({});
  const [dataPromessa, setDataPromessa] = useState('');
  const [pedindoPromessa, setPedindoPromessa] = useState<string | null>(null);

  const { cliente, titulos, valorTotal, categoriaMaisUrgente, diasAtrasoMax, mensagemConsolidada } =
    grupo;

  const pendentes = titulos.filter((t) => !resolvidos[t.id]);
  const tituloUnico = pendentes.length === 1 ? pendentes[0] : null;

  async function handleEnviar() {
    setEnviando(true);
    setErro('');

    // `allSettled`, não `all`: o clique já abriu o WhatsApp numa aba nova, e
    // `all` rejeitaria no primeiro erro sem dizer quantos dos outros títulos
    // chegaram a ser registrados. "Falhou" e "falhou 1 de 3" são situações
    // diferentes para quem vai conferir o histórico depois.
    const r = await Promise.allSettled(
      pendentes.map((t) => registrarEnvio(t.id, mensagemConsolidada)),
    );
    const falhas = r.filter((x) => x.status === 'rejected').length;

    setEnviando(false);

    // registrarEnvio falha alto de propósito (actions/index.ts) para que a
    // perda de histórico não passe despercebida — quem chama precisa mostrar.
    if (falhas > 0) {
      setErro(
        falhas === pendentes.length
          ? 'A mensagem foi aberta, mas o envio não ficou registrado.'
          : `A mensagem foi aberta, mas ${falhas} de ${pendentes.length} títulos não tiveram o envio registrado.`,
      );
      return;
    }
    setEnviado(true);
  }

  async function marcar(tituloId: string, status: StatusTitulo, promessa?: string) {
    const titulo = titulos.find((t) => t.id === tituloId);
    if (!titulo) return;
    setEmCurso(tituloId);
    setErro('');
    try {
      await atualizarStatusTitulo(tituloId, status, titulo.mensagem, promessa);
      setResolvidos((r) => ({ ...r, [tituloId]: status }));
      setPedindoPromessa(null);
      setDataPromessa('');
    } catch {
      // Sem isto a linha mostraria "pago" com o banco intacto.
      setErro('Não foi possível registrar. Tente de novo.');
    } finally {
      setEmCurso(null);
    }
  }

  const rotuloAtraso =
    diasAtrasoMax > 0
      ? `${diasAtrasoMax} dias`
      : diasAtrasoMax === 0
      ? 'vence hoje'
      : `em ${Math.abs(diasAtrasoMax)} dias`;

  const td = 'px-3 py-2.5 align-middle';

  return (
    <>
      <tr
        className={`border-b border-borda transition-colors ${
          aberta ? 'bg-linha-hover' : 'hover:bg-linha-hover'
        }`}
      >
        <td className="pl-3 pr-0 py-2.5 w-9">
          <BotaoIcone
            rotulo={aberta ? 'Recolher títulos' : 'Ver títulos'}
            onClick={() => setAberta((v) => !v)}
            className="w-6 h-6"
          >
            <IconeDivisa
              className={`w-3.5 h-3.5 transition-transform duration-150 ${aberta ? 'rotate-90' : ''}`}
            />
          </BotaoIcone>
        </td>

        <td className={`${td} min-w-0`}>
          <Link
            href={`/clientes/${cliente.id}`}
            className="text-base font-medium text-texto hover:text-marca-700 transition-colors block truncate max-w-[22rem]"
          >
            {cliente.nome}
          </Link>
        </td>

        <td className={`${td} hidden lg:table-cell`}>
          <span className="text-corpo text-texto-suave numero whitespace-nowrap">
            {formatarTelefone(cliente.telefone)}
          </span>
        </td>

        <td className={`${td} text-right whitespace-nowrap`}>
          <span className="text-base font-semibold text-texto numero">
            {formatarMoeda(valorTotal)}
          </span>
        </td>

        <td className={`${td} whitespace-nowrap`}>
          <Badge tom={tomDaCategoria(categoriaMaisUrgente)}>{rotuloAtraso}</Badge>
        </td>

        <td className={`${td} text-right hidden md:table-cell`}>
          <span className="text-corpo text-texto-suave numero">{pendentes.length}</span>
        </td>

        <td className="px-3 py-2.5 text-right whitespace-nowrap">
          <div className="inline-flex items-center gap-0.5">
            <LinkIcone
              rotulo={enviado ? 'Reenviar pelo WhatsApp' : 'Enviar cobrança pelo WhatsApp'}
              tom="marca"
              href={linkWhatsApp(cliente.telefone, mensagemConsolidada)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={handleEnviar}
              className={enviado ? 'text-marca-600' : ''}
            >
              <IconeWhatsApp />
            </LinkIcone>

            <LinkIcone rotulo="Ligar para o cliente" href={`tel:+${cliente.telefone}`}>
              <IconeTelefone />
            </LinkIcone>

            {/* Marcar pago direto só faz sentido com UM título pendente. Com
                vários, qual deles foi pago é informação que a linha não tem —
                então o botão abre a lista em vez de adivinhar. */}
            <BotaoIcone
              rotulo={tituloUnico ? 'Marcar como pago' : 'Escolher qual título foi pago'}
              tom="marca"
              disabled={enviando || emCurso !== null}
              onClick={() => (tituloUnico ? marcar(tituloUnico.id, 'pago') : setAberta(true))}
            >
              <IconePago />
            </BotaoIcone>
          </div>
        </td>
      </tr>

      {(erro || enviando) && (
        <tr className="border-b border-borda bg-linha-hover">
          <td colSpan={7} className="px-3 pb-2.5 pt-0">
            <p
              role={erro ? 'alert' : undefined}
              className={`text-corpo ${erro ? 'text-risco-600' : 'text-texto-suave'}`}
            >
              {erro || 'Registrando envio…'}
            </p>
          </td>
        </tr>
      )}

      {aberta && (
        <tr className="border-b border-borda bg-superficie-sutil">
          <td colSpan={7} className="px-3 py-3.5">
            <div className="pl-6 space-y-3">
              {/* A mensagem é o entregável do produto: é o texto que vai ser
                  enviado. Some da linha para caber na tabela, mas não pode
                  sumir do produto. */}
              <div>
                <p className="text-legenda text-texto-fraco uppercase tracking-[0.04em] mb-1">
                  Mensagem que será enviada
                </p>
                <p className="text-corpo text-texto-suave leading-relaxed border-l-2 border-borda-forte pl-3 max-w-3xl">
                  {mensagemConsolidada}
                </p>
              </div>

              <div>
                <p className="text-legenda text-texto-fraco uppercase tracking-[0.04em] mb-1.5">
                  Títulos em aberto
                </p>
                <div className="space-y-1">
                  {titulos.map((t) => {
                    const resolvido = resolvidos[t.id];
                    return (
                      <div
                        key={t.id}
                        className="flex items-center justify-between gap-3 bg-superficie border border-borda rounded-md px-3 py-2"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span
                            className={`text-corpo font-medium numero ${
                              resolvido ? 'text-texto-fraco line-through' : 'text-texto'
                            }`}
                          >
                            {formatarMoeda(t.valor)}
                          </span>
                          {resolvido ? (
                            <Badge tom={resolvido === 'pago' ? 'marca' : 'neutro'}>
                              {resolvido === 'pago'
                                ? 'pago'
                                : resolvido === 'promessa'
                                ? 'prometeu pagar'
                                : 'sem resposta'}
                            </Badge>
                          ) : (
                            <Badge tom={tomDaCategoria(t.categoria)}>
                              {t.diasAtraso > 0
                                ? `${t.diasAtraso} dias em atraso`
                                : t.diasAtraso === 0
                                ? 'vence hoje'
                                : `vence em ${Math.abs(t.diasAtraso)} dias`}
                            </Badge>
                          )}
                        </div>

                        {!resolvido && (
                          <div className="flex items-center gap-0.5 shrink-0">
                            <BotaoIcone
                              rotulo="Marcar como pago"
                              tom="marca"
                              disabled={emCurso !== null}
                              onClick={() => marcar(t.id, 'pago')}
                            >
                              <IconePago />
                            </BotaoIcone>
                            <BotaoIcone
                              rotulo="Registrar promessa de pagamento"
                              disabled={emCurso !== null}
                              onClick={() =>
                                setPedindoPromessa((id) => (id === t.id ? null : t.id))
                              }
                            >
                              <IconePromessa />
                            </BotaoIcone>
                            <BotaoIcone
                              rotulo="Marcar como sem resposta"
                              disabled={emCurso !== null}
                              onClick={() => marcar(t.id, 'sem_resposta')}
                            >
                              <IconeSemResposta />
                            </BotaoIcone>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {pedindoPromessa && (
                  <div className="flex items-center gap-2 mt-2 bg-superficie border border-borda rounded-md px-3 py-2">
                    <label htmlFor={`promessa-${pedindoPromessa}`} className="text-corpo text-texto-suave">
                      Pagamento prometido para
                    </label>
                    <input
                      id={`promessa-${pedindoPromessa}`}
                      type="date"
                      value={dataPromessa}
                      onChange={(e) => setDataPromessa(e.target.value)}
                      className="h-8 border border-borda-forte rounded-md px-2 text-corpo bg-superficie text-texto numero"
                    />
                    <Botao
                      tamanho="sm"
                      variante="primario"
                      disabled={!dataPromessa || emCurso !== null}
                      onClick={() => marcar(pedindoPromessa, 'promessa', dataPromessa)}
                    >
                      Confirmar
                    </Botao>
                  </div>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
