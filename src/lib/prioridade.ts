import {
  Titulo,
  Cliente,
  TituloComPrioridade,
  Categoria,
  ClienteAgrupado,
  MotivoReentrada,
} from '@/types';
import { gerarMensagem, gerarMensagemConsolidada } from './templates';

/** Quantos dias um título marcado "sem resposta" fica fora da fila antes de
 *  voltar. Constante única do domínio: mudar aqui muda o comportamento em todo
 *  o sistema, sem migration — o valor não é persistido, é sempre recalculado a
 *  partir da data em que o "sem resposta" foi registrado. */
export const DIAS_SILENCIO_SEM_RESPOSTA = 3;

/** Retorna quantos dias se passaram desde o vencimento.
 *  Positivo = já vencido. Negativo = ainda vai vencer.
 */
export function calcularDiasAtraso(dataVencimentoISO: string): number {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  // T12:00:00 evita deslocamentos de fuso horário no parse da data
  const vencimento = new Date(`${dataVencimentoISO}T12:00:00`);
  vencimento.setHours(0, 0, 0, 0);
  const diffMs = hoje.getTime() - vencimento.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

export function categorizarTitulo(diasAtraso: number): Categoria | null {
  if (diasAtraso > 7) return 'atraso_longo';
  if (diasAtraso >= 1) return 'atraso_leve';
  if (diasAtraso >= -3) return 'preventivo'; // vence hoje ou nos próximos 3 dias
  return null; // vence em mais de 3 dias — não urgente, não exibir
}

/** Data (YYYY-MM-DD) no fuso local. Não usar toISOString() para isso: ele
 *  converte para UTC e, à noite no Brasil, devolve o dia seguinte. */
function paraDataLocalISO(data: Date): string {
  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const dia = String(data.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

/** Até quando um título marcado "sem resposta" agora deve ficar fora da fila. */
export function calcularSilenciadoAte(
  diasSilencio: number = DIAS_SILENCIO_SEM_RESPOSTA,
): string {
  const data = new Date();
  data.setHours(12, 0, 0, 0); // meio-dia: imune a horário de verão na soma de dias
  data.setDate(data.getDate() + diasSilencio);
  return paraDataLocalISO(data);
}

/** Uma data-limite (promessa, silêncio) já chegou? Reaproveita
 *  calcularDiasAtraso para não criar uma segunda forma de comparar datas —
 *  >= 0 significa "hoje ou no passado". */
function jaChegou(dataISO: string): boolean {
  return calcularDiasAtraso(dataISO) >= 0;
}

type TituloParaFila = Pick<
  Titulo,
  'status' | 'data_vencimento' | 'data_promessa' | 'silenciado_ate'
>;

/**
 * O título deve aparecer na operação de hoje?
 *
 * Regra central do produto: **só 'pago' tira um título da operação de vez**.
 * 'promessa' e 'sem_resposta' são pausas, não saídas — se a dívida continua
 * existindo, ela precisa voltar. Antes desta regra os três botões eram portas
 * de mão única e a lista só encolhia, escondendo dívida real.
 *
 * Datas nulas são tratadas como "já chegou" de propósito: na dúvida o título
 * volta para a fila. Perder uma cobrança é pior do que mostrá-la cedo demais.
 */
export function estaNaFilaHoje(titulo: TituloParaFila): boolean {
  switch (titulo.status) {
    case 'pago':
      return false;
    case 'aberto':
      // Só entra quando fica urgente (vencido ou vencendo em até 3 dias).
      return categorizarTitulo(calcularDiasAtraso(titulo.data_vencimento)) !== null;
    // Datas ausentes usam falsy em vez de `=== null` de propósito: se a
    // migration ainda não rodou, o Supabase devolve `undefined` em vez de
    // `null`, e uma comparação estrita esconderia o título em silêncio — o
    // exato comportamento que este ciclo veio eliminar.
    case 'promessa':
      return !titulo.data_promessa || jaChegou(titulo.data_promessa);
    case 'sem_resposta':
      return !titulo.silenciado_ate || jaChegou(titulo.silenciado_ate);
    default:
      return false;
  }
}

function motivoDaReentrada(titulo: TituloParaFila): MotivoReentrada | null {
  if (titulo.status === 'promessa') return 'promessa_vencida';
  if (titulo.status === 'sem_resposta') return 'silencio_expirado';
  return null;
}

export function priorizarTitulos(
  titulos: (Titulo & { clientes: Cliente })[],
): TituloComPrioridade[] {
  const resultado: TituloComPrioridade[] = [];

  for (const titulo of titulos) {
    if (!estaNaFilaHoje(titulo)) continue;

    const diasAtraso = calcularDiasAtraso(titulo.data_vencimento);
    // Um título que REENTROU (promessa vencida / fim do silêncio) entra mesmo
    // que o vencimento ainda esteja longe: o compromisso assumido com o cliente
    // vence o corte de "ainda não é urgente". Para status 'aberto',
    // estaNaFilaHoje já garantiu que a categoria não é nula.
    const motivoReentrada = motivoDaReentrada(titulo);
    const categoria = categorizarTitulo(diasAtraso) ?? 'preventivo';

    const score = diasAtraso > 0 ? diasAtraso * titulo.valor : 0;
    const mensagem = gerarMensagem(
      titulo.clientes.nome,
      titulo.valor,
      titulo.data_vencimento,
      categoria,
      Math.abs(diasAtraso),
    );

    resultado.push({
      ...titulo,
      cliente: titulo.clientes,
      score,
      categoria,
      diasAtraso,
      mensagem,
      motivoReentrada,
    });
  }

  // Vencidos: mais crítico (maior score) primeiro
  const vencidos = resultado
    .filter((t) => t.diasAtraso > 0)
    .sort((a, b) => b.score - a.score);

  // Preventivos: vencimento mais próximo primeiro
  const preventivos = resultado
    .filter((t) => t.diasAtraso <= 0)
    .sort(
      (a, b) =>
        new Date(a.data_vencimento).getTime() -
        new Date(b.data_vencimento).getTime(),
    );

  return [...vencidos, ...preventivos];
}

// Ordem de urgência entre categorias — usada para decidir qual categoria
// "representa" um cliente que tem títulos em mais de uma situação.
const ORDEM_URGENCIA: Categoria[] = ['atraso_longo', 'atraso_leve', 'preventivo'];

/** Agrupa títulos já priorizados por cliente — cobrar a PESSOA, não o título. */
export function agruparPorCliente(
  titulosPriorizados: TituloComPrioridade[],
): ClienteAgrupado[] {
  const grupos = new Map<string, TituloComPrioridade[]>();

  for (const titulo of titulosPriorizados) {
    const lista = grupos.get(titulo.cliente_id) ?? [];
    lista.push(titulo);
    grupos.set(titulo.cliente_id, lista);
  }

  const resultado: ClienteAgrupado[] = [];

  for (const titulos of grupos.values()) {
    const cliente = titulos[0].cliente;
    const valorTotal = titulos.reduce((s, t) => s + t.valor, 0);
    const scoreTotal = titulos.reduce((s, t) => s + t.score, 0);
    const diasAtrasoMax = Math.max(...titulos.map((t) => t.diasAtraso));
    const categoriaMaisUrgente =
      ORDEM_URGENCIA.find((c) => titulos.some((t) => t.categoria === c)) ??
      'preventivo';

    const titulosOrdenados = [...titulos].sort((a, b) => b.score - a.score);

    resultado.push({
      cliente,
      titulos: titulosOrdenados,
      valorTotal,
      scoreTotal,
      categoriaMaisUrgente,
      diasAtrasoMax,
      mensagemConsolidada: gerarMensagemConsolidada(cliente.nome, titulosOrdenados),
    });
  }

  // Vencidos (por score) primeiro, depois preventivos por vencimento mais próximo.
  const vencidos = resultado
    .filter((c) => c.diasAtrasoMax > 0)
    .sort((a, b) => b.scoreTotal - a.scoreTotal);

  // diasAtrasoMax de preventivo é <= 0 (0 = vence hoje, -3 = vence em 3 dias),
  // então "mais próximo primeiro" é ordem DECRESCENTE. A ordem crescente que
  // estava aqui invertia a lista: quem vencia em 3 dias vinha antes de quem
  // vencia hoje.
  const preventivos = resultado
    .filter((c) => c.diasAtrasoMax <= 0)
    .sort((a, b) => b.diasAtrasoMax - a.diasAtrasoMax);

  return [...vencidos, ...preventivos];
}
