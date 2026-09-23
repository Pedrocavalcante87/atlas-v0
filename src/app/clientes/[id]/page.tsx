import { supabase } from '@/lib/supabase';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { Interacao, Cliente, Titulo } from '@/types';
import { ler, lerPaginado, SupabaseIndisponivelError } from '@/lib/supabase-io';
import { calcularDiasAtraso, categorizarTitulo } from '@/lib/prioridade';
import { ultimoContatoPorCliente, rotuloContato } from '@/lib/contato';
import {
  formatarMoeda,
  formatarTelefone,
  formatarData,
  formatarDataCurta,
  formatarHora,
  dataLocalISO,
  instanteDoBanco,
  plural,
  rotuloVencimento,
} from '@/lib/format';
import Pagina from '@/components/ui/Pagina';
import CabecalhoPagina from '@/components/ui/CabecalhoPagina';
import Painel from '@/components/ui/Painel';
import KpiCard from '@/components/ui/KpiCard';
import Aviso from '@/components/ui/Aviso';
import Badge, { tomDaCategoria } from '@/components/ui/Badge';
import { estiloBotao } from '@/components/ui/Botao';
import { IconeTelefone } from '@/components/ui/Icone';

export const metadata: Metadata = { title: 'Histórico do cliente' };

export const revalidate = 0;
export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

type TituloComHistorico = Titulo & { interacoes: Interacao[] };

/** Resultado gravado numa interação, em palavras. `null` = só a mensagem saiu. */
const ROTULO_RESULTADO: Record<string, string> = {
  pago: 'pago',
  promessa: 'prometeu pagar',
  sem_resposta: 'sem resposta',
};

/** "21/09/2026 às 07:21", no relógio do servidor — o mesmo da fila. */
function dataHora(valorDoBanco: string): string {
  const instante = instanteDoBanco(valorDoBanco);
  return `${formatarData(dataLocalISO(instante))} às ${formatarHora(instante)}`;
}

/**
 * Situação atual do título. Neutra, exceto "pago" (marca): a cor de urgência
 * mora na etiqueta de vencimento ao lado, e pintar "em aberto" de vermelho
 * mesmo antes do vencimento — como esta tela fazia — gritava sem motivo.
 * "Prometeu pagar" era verde, a cor de dinheiro que entrou; promessa não é
 * dinheiro, e o verde fazia parecer que era.
 */
function situacao(t: Titulo): { texto: string; tom: 'marca' | 'neutro' } {
  if (t.status === 'pago') {
    return {
      texto: t.resolvido_em ? `pago em ${formatarDataCurta(dataLocalISO(instanteDoBanco(t.resolvido_em)))}` : 'pago',
      tom: 'marca',
    };
  }
  if (t.status === 'promessa') {
    if (!t.data_promessa) return { texto: 'promessa', tom: 'neutro' };
    return {
      texto:
        calcularDiasAtraso(t.data_promessa) > 0
          ? `promessa de ${formatarDataCurta(t.data_promessa)} vencida`
          : `promessa para ${formatarDataCurta(t.data_promessa)}`,
      tom: 'neutro',
    };
  }
  if (t.status === 'sem_resposta') {
    return {
      texto:
        t.silenciado_ate && calcularDiasAtraso(t.silenciado_ate) < 0
          ? `sem resposta · volta em ${formatarDataCurta(t.silenciado_ate)}`
          : 'sem resposta · de volta à fila',
      tom: 'neutro',
    };
  }
  return { texto: 'em aberto', tom: 'neutro' };
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
  let titulos: TituloComHistorico[];

  try {
    [{ data: cliente }, titulos] = await Promise.all([
      ler<Cliente | null>(
        (s) => supabase.from('clientes').select('*').eq('id', id).abortSignal(s).maybeSingle(),
        'cliente do histórico',
      ),
      // Ordenado por `id` para paginar com cursor; a ordem de EXIBIÇÃO
      // (vencimento mais recente primeiro) é reaplicada em memória abaixo —
      // paginação precisa de chave estável e única, `data_vencimento` não é.
      lerPaginado<TituloComHistorico>((s, apos, limite) => {
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
      <Pagina>
        <CabecalhoPagina titulo="Histórico do cliente" voltar={{ href: '/', rotulo: 'Lista do dia' }} />
        <Aviso tom="risco" titulo="Não foi possível carregar o histórico">
          {mensagem}
        </Aviso>
      </Pagina>
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
  const naoPagos = titulos.filter((t) => t.status !== 'pago');
  const pagos = titulos.filter((t) => t.status === 'pago');
  const totalAberto = naoPagos.reduce((soma, t) => soma + t.valor, 0);
  const totalPago = pagos.reduce((soma, t) => soma + t.valor, 0);
  const temVencido = naoPagos.some((t) => calcularDiasAtraso(t.data_vencimento) > 0);

  const agora = new Date();
  const ultimoContato = ultimoContatoPorCliente(titulos).get(cliente.id);

  return (
    <Pagina>
      <CabecalhoPagina
        voltar={{ href: '/', rotulo: 'Lista do dia' }}
        titulo={cliente.nome}
        descricao={
          <>
            <span className="numero">{formatarTelefone(cliente.telefone)}</span>
            {' · '}
            {ultimoContato ? `Último contato ${rotuloContato(ultimoContato, agora)}` : 'Nenhum contato registrado'}
          </>
        }
        acoes={
          <a href={`tel:+${cliente.telefone}`} className={estiloBotao('secundario', 'sm')}>
            <IconeTelefone className="w-3.5 h-3.5" />
            Ligar
          </a>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
        <KpiCard
          rotulo="Em aberto"
          valor={formatarMoeda(totalAberto)}
          tom={temVencido ? 'risco' : 'neutro'}
          nota={naoPagos.length === 0 ? 'nada a cobrar' : plural(naoPagos.length, 'título', 'títulos')}
        />
        {/* Verde só quando houve dinheiro: "R$ 0,00" em verde lia como conquista. */}
        <KpiCard
          rotulo="Pago"
          valor={formatarMoeda(totalPago)}
          tom={totalPago > 0 ? 'marca' : 'neutro'}
          nota={pagos.length === 0 ? 'nenhum pagamento registrado' : plural(pagos.length, 'título', 'títulos')}
        />
      </div>

      <Painel
        id="historico"
        titulo="Títulos"
        complemento={`${plural(titulos.length, 'título', 'títulos')} · do vencimento mais recente ao mais antigo`}
      >
        {titulos.length === 0 ? (
          <p className="px-4 py-10 text-center text-corpo text-texto-suave">
            Nenhum título registrado para este cliente.
          </p>
        ) : (
          <ul className="divide-y divide-borda">
            {titulos.map((titulo) => {
              const s = situacao(titulo);
              const dias = calcularDiasAtraso(titulo.data_vencimento);
              const categoria = categorizarTitulo(dias);
              const interacoes = [...(titulo.interacoes ?? [])].sort(
                (a, b) => instanteDoBanco(a.data_envio).getTime() - instanteDoBanco(b.data_envio).getTime(),
              );
              return (
                <li key={titulo.id} className="px-4 py-3.5">
                  <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                    <div>
                      <p className="text-destaque font-semibold text-texto numero">{formatarMoeda(titulo.valor)}</p>
                      <p className="text-legenda text-texto-suave mt-0.5">
                        Vencimento <span className="numero">{formatarData(titulo.data_vencimento)}</span>
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tom={s.tom}>{s.texto}</Badge>
                      {/* A cor de urgência só para o que ainda é devido, pela
                          mesma escala da fila (tomDaCategoria). */}
                      {titulo.status !== 'pago' && (
                        <Badge tom={categoria ? tomDaCategoria(categoria) : 'neutro'}>{rotuloVencimento(dias)}</Badge>
                      )}
                    </div>
                  </div>

                  {interacoes.length > 0 && (
                    <ol className="mt-3 ml-1 border-l border-borda pl-4 space-y-3" aria-label="Interações">
                      {interacoes.map((inter) => (
                        <li key={inter.id} className="relative">
                          <span
                            aria-hidden
                            className="absolute -left-5 top-1.5 w-2 h-2 rounded-full bg-borda-forte ring-2 ring-superficie"
                          />
                          <p className="text-legenda text-texto-suave">
                            <span className="numero">{dataHora(inter.data_envio)}</span>
                            {' · '}
                            <span className={inter.resultado === 'pago' ? 'text-marca-700 font-medium' : 'text-texto'}>
                              {inter.resultado ? (ROTULO_RESULTADO[inter.resultado] ?? inter.resultado) : 'mensagem enviada'}
                            </span>
                          </p>
                          {inter.mensagem_enviada && (
                            <p className="mt-1 text-corpo text-texto-suave leading-relaxed max-w-3xl">
                              &ldquo;{inter.mensagem_enviada}&rdquo;
                            </p>
                          )}
                        </li>
                      ))}
                    </ol>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Painel>

      <p className="mt-4 text-legenda text-texto-suave">
        Esta tela é só de consulta. Para registrar um resultado, use a{' '}
        <Link href="/" className="underline hover:text-texto">
          lista do dia
        </Link>
        .
      </p>
    </Pagina>
  );
}
