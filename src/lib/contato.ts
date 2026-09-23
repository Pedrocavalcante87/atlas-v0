import { dataLocalISO, formatarData, formatarDataCurta, formatarHora, instanteDoBanco, plural } from './format';

// ---------------------------------------------------------------------------
// Último contato com cada cliente — o que a fila do dia mostra para evitar
// cobrar a mesma pessoa duas vezes.
//
// O envio pelo WhatsApp acontece fora do app e o título continua na fila
// (só `pago` o tira de vez). Até aqui, a única pista de que a mensagem já
// tinha saído era a cor do ícone, guardada em estado do componente: bastava
// recarregar a página para ela sumir. A prova de envio existe no banco
// (`interacoes.data_envio`, gravada por `registrarEnvio`), e é ela que vale.
//
// "Hoje" é o dia do relógio de quem renderiza — o servidor —, a mesma
// convenção de `lib/prioridade.ts::calcularDiasAtraso`. As duas contas
// precisam concordar sobre que dia é hoje.
// ---------------------------------------------------------------------------

export interface TituloComInteracoes {
  cliente_id: string;
  interacoes?: { data_envio: string | null }[] | null;
}

/**
 * Instante do contato mais recente com cada cliente, considerando todas as
 * interações de todos os títulos dele que foram lidos — não só os da fila de
 * hoje: se falei com a pessoa ontem sobre outro título, isso importa hoje.
 */
export function ultimoContatoPorCliente(titulos: TituloComInteracoes[]): Map<string, Date> {
  const ultimo = new Map<string, Date>();
  for (const titulo of titulos) {
    for (const interacao of titulo.interacoes ?? []) {
      if (!interacao.data_envio) continue;
      const instante = instanteDoBanco(interacao.data_envio);
      if (Number.isNaN(instante.getTime())) continue;
      const atual = ultimo.get(titulo.cliente_id);
      if (!atual || instante > atual) ultimo.set(titulo.cliente_id, instante);
    }
  }
  return ultimo;
}

/** O contato aconteceu no mesmo dia de calendário que `agora`? */
export function foiHoje(instante: Date, agora: Date): boolean {
  return dataLocalISO(instante) === dataLocalISO(agora);
}

/** Dias de calendário entre o contato e hoje. Meio-dia: imune a horário de verão. */
function diasDesde(instante: Date, agora: Date): number {
  const a = new Date(instante);
  a.setHours(12, 0, 0, 0);
  const b = new Date(agora);
  b.setHours(12, 0, 0, 0);
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/** "hoje às 10:32", "ontem às 16:05", "há 3 dias", "em 02/09". */
export function rotuloContato(instante: Date, agora: Date): string {
  const dias = diasDesde(instante, agora);
  // Instante no futuro só acontece com relógios desencontrados; é "hoje".
  if (dias <= 0) return `hoje às ${formatarHora(instante)}`;
  if (dias === 1) return `ontem às ${formatarHora(instante)}`;
  if (dias < 7) return `há ${plural(dias, 'dia', 'dias')}`;
  const dia = dataLocalISO(instante);
  return instante.getFullYear() === agora.getFullYear()
    ? `em ${formatarDataCurta(dia)}`
    : `em ${formatarData(dia)}`;
}
