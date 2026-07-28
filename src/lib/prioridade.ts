import { Titulo, Cliente, TituloComPrioridade, Categoria } from '@/types';
import { gerarMensagem } from './templates';

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
