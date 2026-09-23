import { supabase } from '@/lib/supabase';
import { priorizarTitulos, agruparPorCliente } from '@/lib/prioridade';
import { totalRecuperado, JANELA_RECUPERACAO_DIAS } from '@/lib/recuperacao';
import { lerPaginado, SupabaseIndisponivelError } from '@/lib/supabase-io';
import { ultimoContatoPorCliente, foiHoje, rotuloContato } from '@/lib/contato';
import { Titulo, Cliente } from '@/types';
import FilaCobranca, { type ContatoDoCliente } from '@/components/FilaCobranca';
import KpiCard from '@/components/ui/KpiCard';
import Pagina from '@/components/ui/Pagina';
import CabecalhoPagina from '@/components/ui/CabecalhoPagina';
import Aviso from '@/components/ui/Aviso';
import { estiloBotao } from '@/components/ui/Botao';
import { formatarMoeda, comMaiuscula, dataLocalISO } from '@/lib/format';
import Link from 'next/link';
import type { Metadata } from 'next';

// Título completo: o `template` do layout raiz não se aplica ao segmento dele mesmo.
export const metadata: Metadata = { title: { absolute: 'Lista do dia · Atlas' } };

export const revalidate = 0;
export const dynamic = 'force-dynamic';

/** O que a home lê de cada título: o cliente e QUANDO houve contato. */
type TituloDaFila = Titulo & {
  clientes: Cliente;
  interacoes: { data_envio: string | null }[] | null;
};

export default async function HomePage() {
  // Busca tudo que ainda não foi pago e deixa o domínio decidir quem entra na
  // fila de hoje (lib/prioridade.ts::estaNaFilaHoje) — títulos com promessa
  // vencida ou silêncio expirado precisam voltar, e um filtro
  // .eq('status','aberto') aqui os esconderia para sempre.
  //
  // `lerPaginado` impõe prazo, transforma qualquer falha em exceção e busca
  // TODAS as páginas. Dois motivos, os dois medidos:
  //
  //  - uma lista do dia vazia precisa significar "não há o que cobrar hoje",
  //    nunca "a consulta falhou". Sem prazo, uma queda de DNS deixava esta
  //    página carregando por mais de um minuto antes de decidir o que mostrar;
  //  - o PostgREST corta a resposta em 1000 linhas (confirmado neste projeto:
  //    com 1149 títulos não pagos, um `select` sem paginar devolveu 1000). A
  //    lista do dia simplesmente perderia as cobranças excedentes, em silêncio.
  //
  // `interacoes(data_envio)` traz só a data de cada contato, não a mensagem:
  // é o que a fila precisa para dizer quem já foi cobrado hoje. O embed não
  // muda a paginação, que continua sendo por `titulos.id`.
  let titulosComClientes: TituloDaFila[];
  let recuperado: number | null;

  try {
    [titulosComClientes, recuperado] = await Promise.all([
      lerPaginado<TituloDaFila>((s, apos, limite) => {
        const base = supabase
          .from('titulos')
          .select('*, clientes(*), interacoes(data_envio)', { count: 'exact' })
          .neq('status', 'pago');
        return (apos ? base.gt('id', apos) : base).order('id').limit(limite).abortSignal(s);
      }, 'títulos da lista do dia'),
      totalRecuperado(),
    ]);
  } catch (e) {
    const mensagem =
      e instanceof SupabaseIndisponivelError ? e.message : 'Erro inesperado ao carregar os dados.';
    return (
      <Pagina>
        <CabecalhoPagina titulo="Lista do dia" />
        {/* Nenhum número nem lista vazia: "nada para cobrar" seria uma
            afirmação falsa quando a verdade é "não consegui ler o banco". */}
        <Aviso
          tom="risco"
          titulo="Não foi possível carregar a lista do dia"
          acao={
            <Link href="/" className={estiloBotao('secundario', 'sm')}>
              Tentar de novo
            </Link>
          }
        >
          {mensagem}
        </Aviso>
      </Pagina>
    );
  }
  const priorizados = priorizarTitulos(titulosComClientes);

  // Cobrança é por CLIENTE, não por título — um cliente com 3 títulos em
  // aberto aparece uma vez, com mensagem e envio de WhatsApp consolidados
  // (lib/prioridade.ts::agruparPorCliente). Os cards de estatística no topo
  // continuam contando títulos individuais, que é o que o texto de cada card
  // descreve ("títulos em atraso" / "vencem em até 3 dias"); o cabeçalho de
  // cada seção conta clientes.
  const grupos = agruparPorCliente(priorizados);
  const gruposVencidos = grupos.filter((g) => g.diasAtrasoMax > 0);
  const gruposPreventivos = grupos.filter((g) => g.diasAtrasoMax <= 0);

  const vencidos = priorizados.filter((t) => t.diasAtraso > 0);
  const preventivos = priorizados.filter((t) => t.diasAtraso <= 0);
  const valorEmRisco = vencidos.reduce((sum, t) => sum + t.valor, 0);

  // Último contato calculado AQUI, no servidor, e entregue pronto: o rótulo
  // depende do relógio ("hoje às 10:32"), e calculá-lo no navegador arriscaria
  // o servidor e o navegador discordarem sobre o fuso na hidratação. Mesmo
  // relógio de calcularDiasAtraso — os dois precisam concordar sobre que dia
  // é hoje.
  const agora = new Date();
  const contatos: Record<string, ContatoDoCliente> = {};
  for (const [clienteId, instante] of ultimoContatoPorCliente(titulosComClientes)) {
    contatos[clienteId] = { rotulo: rotuloContato(instante, agora), hoje: foiHoje(instante, agora) };
  }

  const hoje = comMaiuscula(
    agora.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }),
  );
  const hojeISO = dataLocalISO(agora);

  return (
    <Pagina>
      <CabecalhoPagina titulo="Lista do dia" descricao={hoje} />

      {/* Indicadores em cards. O recuperado aparece mesmo com a fila vazia —
          dia sem ninguém pra cobrar é justamente quando o resultado importa.
          No celular os dois de dinheiro ocupam a largura toda: em meia coluna
          o valor era cortado ("R$ 10.56…"), e dinheiro cortado não serve. */}
      {(priorizados.length > 0 || (recuperado ?? 0) > 0) && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          <KpiCard
            rotulo="Vencidos"
            valor={vencidos.length}
            tom="risco"
            nota={vencidos.length === 1 ? 'título em atraso' : 'títulos em atraso'}
          />
          {/* Neutro, não âmbar: nada aqui está atrasado ainda (globals.css). */}
          <KpiCard rotulo="A vencer" valor={preventivos.length} tom="neutro" nota="vencem em até 3 dias" />
          <KpiCard
            rotulo="Em risco"
            valor={formatarMoeda(valorEmRisco)}
            tom="neutro"
            nota="soma dos vencidos"
            className="col-span-2 sm:col-span-1"
          />
          {/* null = a apuração falhou. Mostrar "—" em vez de R$ 0,00: zero
              seria uma afirmação falsa sobre dinheiro. */}
          <KpiCard
            rotulo="Recuperado"
            valor={recuperado === null ? '—' : formatarMoeda(recuperado)}
            tom={recuperado ? 'marca' : 'neutro'}
            nota={recuperado === null ? 'indisponível' : `últimos ${JANELA_RECUPERACAO_DIAS} dias`}
            className="col-span-2 sm:col-span-1"
          />
        </div>
      )}

      {priorizados.length === 0 ? (
        // Estado vazio sem ilustração nem emoji: o normal aqui é bom (não há
        // ninguém atrasado), e o que a tela precisa é dizer isso com clareza e
        // oferecer o próximo passo.
        <div className="bg-superficie border border-borda rounded-lg px-6 py-12 text-center">
          <p className="text-destaque font-medium text-texto">Nada para cobrar hoje</p>
          <p className="text-corpo text-texto-suave mt-1 mb-5 max-w-sm mx-auto">
            Nenhum título está vencido ou vence nos próximos 3 dias. Importe uma planilha para
            atualizar a carteira.
          </p>
          <Link href="/upload" className={estiloBotao('primario')}>
            Importar planilha
          </Link>
        </div>
      ) : (
        <div className="space-y-5">
          <FilaCobranca
            id="fila-vencidos"
            titulo="Vencidos"
            complemento="cobrar hoje"
            rotuloPrazo="Atraso"
            grupos={gruposVencidos}
            contatos={contatos}
            hoje={hojeISO}
          />
          <FilaCobranca
            id="fila-a-vencer"
            titulo="A vencer"
            complemento="enviar lembrete"
            rotuloPrazo="Vence"
            grupos={gruposPreventivos}
            contatos={contatos}
            hoje={hojeISO}
          />
        </div>
      )}
    </Pagina>
  );
}
