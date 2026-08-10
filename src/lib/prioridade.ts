import { Titulo, Cliente, TituloComPrioridade, Categoria, ClienteAgrupado } from '@/types';
import { gerarMensagem, gerarMensagemConsolidada } from './templates';

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

export function priorizarTitulos(
  titulos: (Titulo & { clientes: Cliente })[],
): TituloComPrioridade[] {
  const resultado: TituloComPrioridade[] = [];

  for (const titulo of titulos) {
    if (titulo.status !== 'aberto') continue;

    const diasAtraso = calcularDiasAtraso(titulo.data_vencimento);
    const categoria = categorizarTitulo(diasAtraso);
    if (!categoria) continue;

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

  // Mesma regra de antes: vencidos (por score) primeiro, depois preventivos (por urgência)
  const vencidos = resultado
    .filter((c) => c.diasAtrasoMax > 0)
    .sort((a, b) => b.scoreTotal - a.scoreTotal);

  const preventivos = resultado
    .filter((c) => c.diasAtrasoMax <= 0)
    .sort((a, b) => a.diasAtrasoMax - b.diasAtrasoMax);

  return [...vencidos, ...preventivos];
}
