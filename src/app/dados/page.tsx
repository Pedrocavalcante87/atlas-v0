'use client';

import { useState, useEffect, useCallback, useId, type KeyboardEvent } from 'react';
import Link from 'next/link';
import { formatarMoeda, plural } from '@/lib/format';
import { chamarApi, mensagemDeFalha, type FalhaDeResposta } from '@/lib/resposta-http';
import Pagina from '@/components/ui/Pagina';
import CabecalhoPagina from '@/components/ui/CabecalhoPagina';
import Painel from '@/components/ui/Painel';
import Aviso from '@/components/ui/Aviso';
import KpiCard from '@/components/ui/KpiCard';
import { Botao, estiloBotao } from '@/components/ui/Botao';

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

/** Por que os números não estão na tela — e se "tentar de novo" resolve. */
interface FalhaDeLeitura {
  mensagem: string;
  sessaoExpirada: boolean;
}

/**
 * A frase que a rota exige para apagar tudo (FRASE_CONFIRMACAO_TUDO em
 * api/dados/route.ts). Repetida aqui de propósito: se as duas divergirem, a
 * exclusão falha com 400 — o erro seguro. Antes a tela enviava a frase
 * sozinha no segundo clique, e a salvaguarda do servidor não pedia nada a
 * quem estava na frente da tela.
 */
const FRASE_EXCLUIR_TUDO = 'EXCLUIR TUDO';

// A exclusão é irreversível: cada falha diz o que se sabe sobre o que foi
// apagado. Só a sessão expirada permite afirmar "nada foi removido" — o proxy
// barrou a requisição antes da rota.
function textoFalhaExclusao(falha: FalhaDeResposta): string {
  switch (falha.tipo) {
    case 'sessao_expirada':
      return 'Sua sessão expirou. Nada foi removido: entre de novo para continuar.';
    case 'sem_conexao':
      return 'Não foi possível falar com o servidor. Nada foi confirmado; os números abaixo mostram o estado atual.';
    case 'invalida':
      return `${mensagemDeFalha(falha, '')} Nada foi confirmado; confira os números abaixo.`;
    case 'erro':
      return mensagemDeFalha(falha, 'Não foi possível remover os dados.');
  }
}

export default function DadosPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loadingStats, setLoadingStats] = useState(true);
  const [falha, setFalha] = useState<FalhaDeLeitura | null>(null);
  const [confirmacao, setConfirmacao] = useState<'tudo' | 'concluidos' | null>(null);
  const [fraseDigitada, setFraseDigitada] = useState('');
  const [deletando, setDeletando] = useState(false);
  const [mensagem, setMensagem] = useState('');
  const [erroExclusao, setErroExclusao] = useState('');

  // Não seta loadingStats(true) aqui — o estado inicial já é `true` (skeleton
  // aparece no primeiro render) e chamar setState de forma síncrona dentro do
  // efeito de montagem dispara re-render em cascata. Quem precisa mostrar o
  // skeleton de novo depois de montado (recarregar após limpar dados) seta
  // explicitamente antes de chamar esta função — ver `limpar()` abaixo.
  const carregarStats = useCallback(async () => {
    // Só um 2xx com JSON vira estatística. A rota responde 503 `{ error }`
    // quando não lê o banco, e sem sessão o proxy devolve o HTML do login COM
    // STATUS 200 — que a versão anterior lia como "estatística nula" e, sem
    // marcar indisponibilidade, deixava a zona de perigo na tela.
    const leitura = await chamarApi<Stats>('/api/dados', { cache: 'no-store' });
    if (leitura.tipo === 'ok') {
      setFalha(null);
      setStats(leitura.dados);
    } else {
      setFalha({
        mensagem: mensagemDeFalha(leitura, 'Não foi possível carregar os dados.'),
        sessaoExpirada: leitura.tipo === 'sessao_expirada',
      });
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

  function pedirConfirmacao(modo: 'tudo' | 'concluidos') {
    setFraseDigitada('');
    setConfirmacao(modo);
  }

  async function limpar(modo: 'tudo' | 'concluidos') {
    setDeletando(true);
    setMensagem('');
    setErroExclusao('');

    const leitura = await chamarApi<{ mensagem?: string }>(`/api/dados?modo=${modo}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      // "tudo" exige a frase exata que o servidor valida — ver api/dados/route.ts.
      // Ela só é enviada depois que a pessoa a digitou (ver AcaoPerigo).
      body: JSON.stringify(modo === 'tudo' ? { confirmacao: FRASE_EXCLUIR_TUDO } : {}),
    });

    // Falha de exclusão NÃO pode entrar em `mensagem`: aquilo é renderizado
    // como sucesso. Uma auditoria pegou "A exclusão foi interrompida — parte
    // dos dados pode ter sido removida" aparecendo em verde. É o mesmo tipo de
    // mentira que este ciclo veio eliminar, só que sobre uma operação
    // irreversível. Pelo mesmo motivo só um 2xx com JSON conta como sucesso:
    // o HTML do login também chega com 200.
    if (leitura.tipo === 'ok') {
      setMensagem(leitura.dados?.mensagem ?? 'Dados removidos.');
    } else {
      setErroExclusao(textoFalhaExclusao(leitura));
    }

    // Recarrega SEMPRE, inclusive depois de falhar: se a exclusão parou no meio,
    // os números da tela viraram ficção e o usuário precisa ver o estado real.
    setLoadingStats(true);
    await carregarStats();

    setConfirmacao(null);
    setFraseDigitada('');
    setDeletando(false);
  }

  const semNumeros = falha !== null && !loadingStats;

  return (
    <Pagina>
      <CabecalhoPagina titulo="Gerenciar dados" descricao="Resumo da carteira e limpeza de dados." />

      <div className="space-y-6">
        {/* Indisponibilidade: nenhum número é melhor do que um número falso.
            Os botões de exclusão ficam escondidos enquanto não sabemos o estado
            do banco — apagar dado às cegas é a pior coisa que se pode fazer aqui. */}
        {semNumeros && falha && (
          <Aviso
            tom="risco"
            titulo={falha.sessaoExpirada ? 'Sessão expirada' : 'Dados indisponíveis'}
            acao={
              falha.sessaoExpirada ? (
                <Link href="/login" className={estiloBotao('secundario', 'sm')}>
                  Entrar de novo
                </Link>
              ) : (
                <Botao
                  tamanho="sm"
                  onClick={() => {
                    setLoadingStats(true);
                    carregarStats();
                  }}
                >
                  Tentar de novo
                </Botao>
              )
            }
          >
            {falha.mensagem}
          </Aviso>
        )}

        {mensagem && (
          <Aviso tom="marca" papel="status">
            {mensagem}
          </Aviso>
        )}

        {/* Falha da exclusão — vermelho, nunca verde. A exclusão pode ter parado
            no meio, e o usuário precisa saber disso antes de tentar de novo. */}
        {erroExclusao && (
          <Aviso tom="risco" titulo="A exclusão não foi concluída">
            {erroExclusao}
          </Aviso>
        )}

        {!semNumeros && (
          <section aria-label="Resumo da carteira" className="space-y-3">
            {loadingStats ? (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" role="status">
                <span className="sr-only">Carregando os números…</span>
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="bg-superficie border border-borda rounded-md px-4 py-3.5 motion-safe:animate-pulse">
                    <div className="h-3 bg-superficie-afundada rounded-sm w-2/3 mb-2.5" />
                    <div className="h-6 bg-superficie-afundada rounded-sm w-1/2" />
                  </div>
                ))}
              </div>
            ) : stats ? (
              <>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <KpiCard rotulo="Clientes" valor={stats.clientes} nota="cadastrados" />
                  <KpiCard rotulo="Títulos em aberto" valor={stats.titulosAbertos} nota="inclui promessa e sem resposta" />
                  <KpiCard rotulo="Títulos pagos" valor={stats.titulosConcluidos} nota="único estado que encerra um título" />
                  <KpiCard rotulo="Total de títulos" valor={stats.titulos} nota="abertos e pagos" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {/* Mesma conta da lista do dia (diasAtraso > 0). */}
                  <KpiCard
                    rotulo="Valor vencido"
                    valor={formatarMoeda(stats.valorVencido)}
                    tom={stats.valorVencido > 0 ? 'risco' : 'neutro'}
                    nota="só o que já venceu — igual à lista do dia"
                  />
                  <KpiCard
                    rotulo="Total em aberto"
                    valor={formatarMoeda(stats.valorAberto)}
                    nota="inclui o que ainda vai vencer"
                  />
                  {/* "—" e não R$ 0,00 quando a apuração falha: zero seria uma
                      afirmação falsa sobre dinheiro. */}
                  <KpiCard
                    rotulo="Recuperado"
                    valor={stats.valorRecuperado === null ? '—' : formatarMoeda(stats.valorRecuperado)}
                    tom={stats.valorRecuperado ? 'marca' : 'neutro'}
                    nota={
                      stats.valorRecuperado === null
                        ? 'não foi possível apurar agora'
                        : `pago nos últimos ${stats.janelaRecuperacaoDias} dias`
                    }
                  />
                </div>
              </>
            ) : null}
          </section>
        )}

        {/* Zona de perigo — só existe quando os números da tela foram lidos de
            verdade. Era possível ver "0 títulos" por falha de leitura e clicar em
            "Limpar tudo" logo abaixo, achando que não havia nada a perder; e a
            condição anterior (esconder só quando havia erro marcado) deixava os
            botões na tela quando a resposta nem era das estatísticas. */}
        {stats && !loadingStats && (
          <Painel id="perigo" titulo="Zona de perigo" complemento="ações irreversíveis, sem desfazer">
            <div className="divide-y divide-borda">
              <AcaoPerigo
                titulo="Limpar títulos pagos"
                descricao="Remove apenas títulos já pagos, com o histórico de interações deles. Títulos aguardando retorno (promessa ou sem resposta) ficam: continuam sendo dívida em aberto. O valor removido sai da apuração de recuperado."
                impacto={`Remove ${plural(stats.titulosConcluidos, 'título pago', 'títulos pagos')} e o histórico deles.`}
                rotuloBotao="Limpar pagos"
                indisponivel={stats.titulosConcluidos === 0 ? 'Nenhum título pago para remover.' : undefined}
                confirmando={confirmacao === 'concluidos'}
                deletando={deletando}
                onSolicitar={() => pedirConfirmacao('concluidos')}
                onConfirmar={() => limpar('concluidos')}
                onCancelar={() => setConfirmacao(null)}
              />
              <AcaoPerigo
                titulo="Limpar tudo"
                descricao="Remove todos os clientes, títulos e interações. O sistema fica em branco."
                impacto={`Remove ${plural(stats.clientes, 'cliente', 'clientes')}, ${plural(stats.titulos, 'título', 'títulos')} e ${plural(stats.interacoes, 'interação', 'interações')}.`}
                rotuloBotao="Limpar tudo"
                indisponivel={stats.clientes === 0 && stats.titulos === 0 ? 'Não há dados para remover.' : undefined}
                exigeFrase={FRASE_EXCLUIR_TUDO}
                frase={fraseDigitada}
                onFrase={setFraseDigitada}
                confirmando={confirmacao === 'tudo'}
                deletando={deletando}
                onSolicitar={() => pedirConfirmacao('tudo')}
                onConfirmar={() => limpar('tudo')}
                onCancelar={() => setConfirmacao(null)}
              />
            </div>
          </Painel>
        )}
      </div>
    </Pagina>
  );
}

function AcaoPerigo({
  titulo,
  descricao,
  impacto,
  rotuloBotao,
  indisponivel,
  exigeFrase,
  frase = '',
  onFrase,
  confirmando,
  deletando,
  onSolicitar,
  onConfirmar,
  onCancelar,
}: {
  titulo: string;
  descricao: string;
  /** O que exatamente vai sumir, com números — dito na hora de confirmar. */
  impacto: string;
  rotuloBotao: string;
  /** Motivo para o botão não estar disponível (nada a remover). */
  indisponivel?: string;
  /** Frase que precisa ser digitada antes de liberar a exclusão. */
  exigeFrase?: string;
  frase?: string;
  onFrase?: (frase: string) => void;
  confirmando: boolean;
  deletando: boolean;
  onSolicitar: () => void;
  onConfirmar: () => void;
  onCancelar: () => void;
}) {
  const idFrase = useId();
  // Maiúsculas e espaços nas pontas não contam: o que a frase prova é a
  // intenção, não a digitação.
  const fraseConfere = !exigeFrase || frase.trim().toUpperCase() === exigeFrase;

  function cancelarComEsc(e: KeyboardEvent) {
    if (e.key === 'Escape' && !deletando) onCancelar();
  }

  return (
    <div className="px-4 py-4">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-base font-semibold text-texto">{titulo}</p>
          <p className="text-corpo text-texto-suave mt-0.5 leading-relaxed max-w-2xl">{descricao}</p>
          {indisponivel && !confirmando && <p className="text-legenda text-texto-suave mt-1.5">{indisponivel}</p>}
        </div>
        {!confirmando && (
          <Botao variante="perigo" className="shrink-0 self-start" disabled={!!indisponivel} onClick={onSolicitar}>
            {rotuloBotao}
          </Botao>
        )}
      </div>

      {confirmando && (
        <div
          role="group"
          aria-label={`Confirmar: ${titulo}`}
          onKeyDown={cancelarComEsc}
          className="mt-3 rounded-md border border-risco-200 bg-risco-50 px-3.5 py-3 space-y-3"
        >
          <p className="text-corpo font-semibold text-risco-700">{impacto} Não há como desfazer.</p>
          {exigeFrase && (
            <div className="space-y-1.5">
              <label htmlFor={idFrase} className="block text-corpo text-risco-700">
                Para confirmar, digite <strong className="font-mono">{exigeFrase}</strong>
              </label>
              <input
                id={idFrase}
                value={frase}
                onChange={(e) => onFrase?.(e.target.value)}
                autoFocus
                autoComplete="off"
                spellCheck={false}
                className="h-9 w-full sm:w-64 border border-risco-200 rounded-md px-3 text-base font-mono bg-superficie text-texto"
              />
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Botao
              variante="perigo"
              autoFocus={!exigeFrase}
              disabled={!fraseConfere}
              carregando={deletando}
              onClick={onConfirmar}
            >
              {deletando ? 'Removendo…' : 'Sim, remover'}
            </Botao>
            <Botao variante="sutil" disabled={deletando} onClick={onCancelar}>
              Cancelar
            </Botao>
          </div>
        </div>
      )}
    </div>
  );
}
