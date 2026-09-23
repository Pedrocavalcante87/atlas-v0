'use client';

import { useState, type KeyboardEvent } from 'react';
import Link from 'next/link';
import type { ClienteAgrupado, StatusTitulo } from '@/types';
import { registrarEnvio, atualizarStatusTitulo } from '@/actions';
import { DIAS_SILENCIO_SEM_RESPOSTA } from '@/lib/prioridade';
import { rotuloReentrada } from '@/lib/contato';
import {
  formatarMoeda,
  formatarTelefone,
  formatarData,
  formatarDataCurta,
  dataLocalISO,
  plural,
  rotuloVencimento,
} from '@/lib/format';
import Badge, { tomDaCategoria } from './ui/Badge';
import { BotaoIcone, LinkIcone } from './ui/BotaoIcone';
import { Botao, BotaoLink } from './ui/Botao';
import {
  IconeWhatsApp,
  IconeTelefone,
  IconePago,
  IconePromessa,
  IconeSemResposta,
  IconeDivisa,
  IconeRetorno,
} from './ui/Icone';
import { useAvisos } from './Avisos';
import type { ContatoDoCliente } from './FilaCobranca';

interface Props {
  grupo: ClienteAgrupado;
  contato: ContatoDoCliente | null;
  /** YYYY-MM-DD do servidor. Vem pronto para servidor e navegador concordarem na hidratação. */
  hoje: string;
}

function linkWhatsApp(telefone: string, mensagem: string) {
  return `https://wa.me/${telefone}?text=${encodeURIComponent(mensagem)}`;
}


const ROTULO_RESOLVIDO: Record<StatusTitulo, string> = {
  pago: 'pago',
  promessa: 'prometeu pagar',
  sem_resposta: 'sem resposta',
  aberto: 'em aberto',
};

/**
 * Uma linha da fila: um CLIENTE, não um título. Um cliente com 3 títulos em
 * aberto ocupa uma linha, com mensagem e envio de WhatsApp consolidados —
 * ninguém gosta de receber 3 cobranças separadas da mesma empresa no mesmo
 * dia. Os títulos individuais aparecem ao expandir, porque o cliente pode
 * pagar um e não outro, e o registro de resultado é por título.
 */
export default function ClienteLinha({ grupo, contato, hoje }: Props) {
  const [aberta, setAberta] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [erro, setErro] = useState('');
  const [emCurso, setEmCurso] = useState<string | null>(null);
  const [resolvidos, setResolvidos] = useState<Record<string, StatusTitulo>>({});
  const [confirmandoPago, setConfirmandoPago] = useState<string | null>(null);
  const [pedindoPromessa, setPedindoPromessa] = useState<string | null>(null);
  const [dataPromessa, setDataPromessa] = useState('');
  const avisar = useAvisos();

  const { cliente, titulos, valorTotal, categoriaMaisUrgente, diasAtrasoMax, mensagemConsolidada } =
    grupo;

  const pendentes = titulos.filter((t) => !resolvidos[t.id]);
  const tituloUnico = pendentes.length === 1 ? pendentes[0] : null;
  const idExpansao = `titulos-${cliente.id}`;

  // Um cliente com uma promessa quebrada e outro título que só voltou do
  // silêncio: a promessa quebrada é o que quem cobra precisa saber primeiro.
  const reentrada =
    titulos.find((t) => t.motivoReentrada === 'promessa_vencida') ??
    titulos.find((t) => t.motivoReentrada === 'silencio_expirado');

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
      setConfirmandoPago(null);
      setPedindoPromessa(null);
      setDataPromessa('');
      // A confirmação vai para fora da linha: a revalidação tira o título da
      // fila, e com o único título do cliente a linha inteira some. Nome
      // completo, não o primeiro: em "FERREIRA & ASSOCIADOS ME" o primeiro
      // nome não identifica ninguém.
      const valor = formatarMoeda(titulo.valor);
      // Promessa para hoje NÃO tira o título da fila: a data já chegou, e o
      // domínio o mantém à vista para conferir o pagamento.
      const promessaParaHoje = promessa !== undefined && promessa <= dataLocalISO(new Date());
      avisar(
        status === 'pago'
          ? `${cliente.nome}: pagamento de ${valor} registrado.`
          : status === 'promessa' && promessa
          ? promessaParaHoje
            ? `${cliente.nome}: promessa de ${valor} para hoje. Fica na fila para você conferir o pagamento.`
            : `${cliente.nome}: promessa de ${valor} para ${formatarDataCurta(promessa)}. Sai da fila até lá.`
          : `${cliente.nome}: sem resposta registrado. Volta à fila em ${plural(DIAS_SILENCIO_SEM_RESPOSTA, 'dia', 'dias')}.`,
      );
    } catch {
      // Sem isto a linha mostraria "pago" com o banco intacto.
      setErro('Não foi possível registrar. Tente de novo.');
    } finally {
      setEmCurso(null);
    }
  }

  /** Pago é o único estado sem volta — pede confirmação; os outros dois são pausas. */
  function pedirConfirmacaoDePago(tituloId: string) {
    setPedindoPromessa(null);
    setConfirmandoPago(tituloId);
  }

  function alternarPromessa(tituloId: string) {
    setConfirmandoPago(null);
    setDataPromessa('');
    setPedindoPromessa((id) => (id === tituloId ? null : tituloId));
  }

  const rotuloPrazo = rotuloVencimento(diasAtrasoMax, 'curto');
  const tomPrazo = tomDaCategoria(categoriaMaisUrgente);
  const td = 'px-2 sm:px-3 py-2.5 align-middle';
  const confirmacaoNaLinha = !aberta && tituloUnico !== null && confirmandoPago === tituloUnico.id;

  return (
    <>
      <tr
        className={`border-b border-borda transition-colors ${
          aberta ? 'bg-linha-hover' : 'hover:bg-linha-hover'
        }`}
      >
        <td className="pl-2 sm:pl-3 pr-0 py-2.5 w-9 align-middle">
          <BotaoIcone
            rotulo={aberta ? 'Recolher títulos' : 'Ver títulos'}
            aria-expanded={aberta}
            aria-controls={idExpansao}
            onClick={() => setAberta((v) => !v)}
            className="w-6 h-6"
          >
            <IconeDivisa
              className={`w-3.5 h-3.5 transition-transform duration-150 ${aberta ? 'rotate-90' : ''}`}
            />
          </BotaoIcone>
        </td>

        <td className={`${td} min-w-0 max-w-0 w-full sm:max-w-none sm:w-auto`}>
          <Link
            href={`/clientes/${cliente.id}`}
            className="text-base font-medium text-texto hover:text-marca-700 transition-colors block truncate sm:max-w-88"
          >
            {cliente.nome}
          </Link>

          {/* No celular, valor e prazo moram aqui: as colunas deles somem. */}
          <div className="sm:hidden mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-corpo font-semibold text-texto numero">{formatarMoeda(valorTotal)}</span>
            <Badge tom={tomPrazo}>{rotuloPrazo}</Badge>
          </div>

          {(reentrada || contato) && (
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-legenda">
              {reentrada && (
                <Badge tom="neutro">
                  <IconeRetorno className="w-3 h-3" />
                  {rotuloReentrada(reentrada, hoje)}
                </Badge>
              )}
              {contato && (
                <span className={contato.hoje ? 'text-texto font-medium' : 'text-texto-suave'}>
                  {contato.hoje ? `Contatado ${contato.rotulo}` : `Último contato ${contato.rotulo}`}
                </span>
              )}
            </div>
          )}
        </td>

        <td className={`${td} hidden lg:table-cell`}>
          <span className="text-corpo text-texto-suave numero whitespace-nowrap">
            {formatarTelefone(cliente.telefone)}
          </span>
        </td>

        <td className={`${td} text-right whitespace-nowrap hidden sm:table-cell`}>
          <span className="text-base font-semibold text-texto numero">{formatarMoeda(valorTotal)}</span>
        </td>

        <td className={`${td} whitespace-nowrap hidden sm:table-cell`}>
          <Badge tom={tomPrazo}>{rotuloPrazo}</Badge>
        </td>

        <td className={`${td} text-right hidden md:table-cell`}>
          <span className="text-corpo text-texto-suave numero">{pendentes.length}</span>
        </td>

        <td className="pl-1 pr-2 sm:px-3 py-2.5 text-right whitespace-nowrap align-middle">
          <div className="inline-flex items-center gap-0.5">
            <LinkIcone
              rotulo={enviado ? 'Enviar de novo pelo WhatsApp' : 'Enviar cobrança pelo WhatsApp'}
              tom="marca"
              href={linkWhatsApp(cliente.telefone, mensagemConsolidada)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={handleEnviar}
              className={enviado || contato?.hoje ? 'text-marca-600' : ''}
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
              // Com a linha aberta, a confirmação aparece no próprio título,
              // dentro da lista; fechada, numa linha logo abaixo.
              onClick={() => (tituloUnico ? pedirConfirmacaoDePago(tituloUnico.id) : setAberta(true))}
              className={confirmacaoNaLinha ? 'bg-marca-50 text-marca-700 border-marca-200' : ''}
            >
              <IconePago />
            </BotaoIcone>
          </div>
        </td>
      </tr>

      {confirmacaoNaLinha && tituloUnico && (
        <tr className="border-b border-borda bg-linha-hover">
          <td colSpan={7} className="px-3 py-2.5 sm:pl-12">
            <ConfirmacaoDePago
              valor={tituloUnico.valor}
              registrando={emCurso === tituloUnico.id}
              onConfirmar={() => marcar(tituloUnico.id, 'pago')}
              onCancelar={() => setConfirmandoPago(null)}
            />
          </td>
        </tr>
      )}

      {(erro || enviando) && (
        <tr className="border-b border-borda bg-linha-hover">
          <td colSpan={7} className="px-3 pb-2.5 pt-1 sm:pl-12">
            <p
              role={erro ? 'alert' : 'status'}
              className={`text-corpo ${erro ? 'text-risco-600' : 'text-texto-suave'}`}
            >
              {erro || 'Registrando envio…'}
            </p>
          </td>
        </tr>
      )}

      {aberta && (
        <tr id={idExpansao} className="border-b border-borda bg-superficie-sutil">
          <td colSpan={7} className="px-3 py-4 sm:pl-12 sm:pr-4">
            <div className="space-y-4">
              {/* A mensagem é o entregável do produto: é o texto que vai ser
                  enviado. Some da linha para caber na tabela, mas não pode
                  sumir do produto — e o botão de envio mora ao lado dela. */}
              <div>
                <p className="text-legenda text-texto-suave uppercase tracking-[0.04em] mb-1.5">
                  Mensagem que será enviada
                </p>
                <p className="text-corpo text-texto leading-relaxed border-l-2 border-borda-forte pl-3 max-w-3xl">
                  {mensagemConsolidada}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <BotaoLink
                    variante="primario"
                    tamanho="sm"
                    href={linkWhatsApp(cliente.telefone, mensagemConsolidada)}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={handleEnviar}
                  >
                    <IconeWhatsApp className="w-3.5 h-3.5" />
                    {enviado ? 'Enviar de novo' : 'Enviar pelo WhatsApp'}
                  </BotaoLink>
                  <BotaoLink variante="secundario" tamanho="sm" href={`tel:+${cliente.telefone}`}>
                    <IconeTelefone className="w-3.5 h-3.5" />
                    Ligar
                    <span className="numero text-texto-suave">{formatarTelefone(cliente.telefone)}</span>
                  </BotaoLink>
                </div>
              </div>

              <div>
                <p className="text-legenda text-texto-suave uppercase tracking-[0.04em] mb-1.5">
                  {titulos.length === 1 ? 'Título em aberto' : 'Títulos em aberto'}
                </p>
                <ul className="space-y-1.5 max-w-3xl">
                  {titulos.map((t) => {
                    const resolvido = resolvidos[t.id];
                    const reentradaDoTitulo = rotuloReentrada(t, hoje);
                    return (
                      <li key={t.id} className="bg-superficie border border-borda rounded-md">
                        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 min-w-0">
                            <span
                              className={`text-corpo font-medium numero ${
                                resolvido ? 'text-texto-fraco line-through' : 'text-texto'
                              }`}
                            >
                              {formatarMoeda(t.valor)}
                            </span>
                            <span className="text-legenda text-texto-suave">
                              venc. <span className="numero">{formatarData(t.data_vencimento)}</span>
                            </span>
                            {resolvido ? (
                              <Badge tom={resolvido === 'pago' ? 'marca' : 'neutro'}>
                                {ROTULO_RESOLVIDO[resolvido]}
                              </Badge>
                            ) : (
                              <Badge tom={tomDaCategoria(t.categoria)}>{rotuloVencimento(t.diasAtraso)}</Badge>
                            )}
                            {!resolvido && reentradaDoTitulo && (
                              <Badge tom="neutro">
                                <IconeRetorno className="w-3 h-3" />
                                {reentradaDoTitulo}
                              </Badge>
                            )}
                          </div>

                          {!resolvido && (
                            <div className="flex items-center gap-0.5 shrink-0">
                              <BotaoIcone
                                rotulo="Marcar como pago"
                                tom="marca"
                                disabled={emCurso !== null}
                                onClick={() => pedirConfirmacaoDePago(t.id)}
                                className={
                                  confirmandoPago === t.id ? 'bg-marca-50 text-marca-700 border-marca-200' : ''
                                }
                              >
                                <IconePago />
                              </BotaoIcone>
                              <BotaoIcone
                                rotulo="Registrar promessa de pagamento"
                                aria-expanded={pedindoPromessa === t.id}
                                disabled={emCurso !== null}
                                onClick={() => alternarPromessa(t.id)}
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

                        {!resolvido && confirmandoPago === t.id && (
                          <div className="border-t border-borda px-3 py-2.5">
                            <ConfirmacaoDePago
                              valor={t.valor}
                              registrando={emCurso === t.id}
                              onConfirmar={() => marcar(t.id, 'pago')}
                              onCancelar={() => setConfirmandoPago(null)}
                            />
                          </div>
                        )}

                        {!resolvido && pedindoPromessa === t.id && (
                          <FormularioPromessa
                            idCampo={`promessa-${t.id}`}
                            valor={t.valor}
                            data={dataPromessa}
                            registrando={emCurso === t.id}
                            onMudarData={setDataPromessa}
                            onRegistrar={() => marcar(t.id, 'promessa', dataPromessa)}
                            onCancelar={() => setPedindoPromessa(null)}
                          />
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function cancelarComEsc(onCancelar: () => void) {
  return (e: KeyboardEvent) => {
    if (e.key === 'Escape') onCancelar();
  };
}

/**
 * "Pago" é o único estado terminal: tira o título da fila de vez, e a
 * interface não oferece como desfazer. Até aqui ele era um clique num ícone
 * colado ao do WhatsApp. Agora pede um segundo clique, num botão que diz o
 * valor — e que fica em outro lugar, para que um clique duplo no ícone não
 * confirme sozinho. Promessa e sem resposta não pedem: são pausas, e o título
 * volta sozinho.
 */
function ConfirmacaoDePago({
  valor,
  registrando,
  onConfirmar,
  onCancelar,
}: {
  valor: number;
  registrando: boolean;
  onConfirmar: () => void;
  onCancelar: () => void;
}) {
  return (
    <div
      role="group"
      aria-label="Confirmar pagamento"
      onKeyDown={cancelarComEsc(onCancelar)}
      className="flex flex-wrap items-center gap-x-3 gap-y-2"
    >
      <p className="text-corpo text-texto">
        Registrar pagamento de <span className="numero font-semibold">{formatarMoeda(valor)}</span>?{' '}
        <span className="text-texto-suave">O título sai da fila de vez.</span>
      </p>
      <div className="flex items-center gap-1.5">
        <Botao tamanho="sm" variante="primario" autoFocus carregando={registrando} onClick={onConfirmar}>
          {registrando ? 'Registrando…' : 'Confirmar pagamento'}
        </Botao>
        <Botao tamanho="sm" variante="sutil" disabled={registrando} onClick={onCancelar}>
          Cancelar
        </Botao>
      </div>
    </div>
  );
}

function FormularioPromessa({
  idCampo,
  valor,
  data,
  registrando,
  onMudarData,
  onRegistrar,
  onCancelar,
}: {
  idCampo: string;
  valor: number;
  data: string;
  registrando: boolean;
  onMudarData: (data: string) => void;
  onRegistrar: () => void;
  onCancelar: () => void;
}) {
  // Só aparece depois de um clique, então calcular "hoje" aqui não arrisca
  // divergência entre servidor e navegador na hidratação.
  const hoje = dataLocalISO(new Date());
  // Data no passado faria o título voltar à fila na hora, como "promessa
  // vencida", e o registro diria que o cliente prometeu algo que já venceu.
  const noPassado = data !== '' && data < hoje;

  return (
    <div
      role="group"
      aria-label="Registrar promessa de pagamento"
      onKeyDown={cancelarComEsc(onCancelar)}
      className="border-t border-borda px-3 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-2"
    >
      <label htmlFor={idCampo} className="text-corpo text-texto">
        Pagamento de <span className="numero font-semibold">{formatarMoeda(valor)}</span> prometido para
      </label>
      <input
        id={idCampo}
        type="date"
        min={hoje}
        value={data}
        autoFocus
        onChange={(e) => onMudarData(e.target.value)}
        aria-invalid={noPassado || undefined}
        aria-describedby={noPassado ? `${idCampo}-erro` : undefined}
        className="h-8 border border-borda-forte rounded-md px-2 text-corpo bg-superficie text-texto numero"
      />
      <div className="flex items-center gap-1.5">
        <Botao
          tamanho="sm"
          variante="primario"
          disabled={!data || noPassado}
          carregando={registrando}
          onClick={onRegistrar}
        >
          {registrando ? 'Registrando…' : 'Registrar promessa'}
        </Botao>
        <Botao tamanho="sm" variante="sutil" disabled={registrando} onClick={onCancelar}>
          Cancelar
        </Botao>
      </div>
      {noPassado && (
        <p id={`${idCampo}-erro`} className="w-full text-legenda text-risco-600">
          A data precisa ser hoje ou depois.
        </p>
      )}
    </div>
  );
}
