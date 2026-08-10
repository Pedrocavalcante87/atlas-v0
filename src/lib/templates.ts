import { Categoria } from '@/types';

const TEMPLATES: Record<Categoria, string> = {
  preventivo:
    'Oi {nome}! Passando pra lembrar que seu pagamento de R$ {valor} vence em {dias} dias. Qualquer dúvida, só chamar!',
  atraso_leve:
    'Oi {nome}, tudo bem? Notei que o pagamento de R$ {valor}, que venceu dia {data}, ainda tá em aberto. Consegue regularizar ou prefere combinar uma nova data?',
  atraso_longo:
    'Oi {nome}, o pagamento de R$ {valor} está em atraso há {dias} dias. Preciso resolver isso com você — pode me passar uma data certa pra pagamento?',
};

function formatarValor(valor: number): string {
  return valor.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatarData(dataISO: string): string {
  const [year, month, day] = dataISO.split('-');
  return `${day}/${month}/${year}`;
}

export function gerarMensagem(
  nomeCompleto: string,
  valor: number,
  dataVencimento: string,
  categoria: Categoria,
  dias: number,
): string {
  const primeiroNome = nomeCompleto.split(' ')[0];
  return TEMPLATES[categoria]
    .replace('{nome}', primeiroNome)
    .replace('{valor}', formatarValor(valor))
    .replace('{data}', formatarData(dataVencimento))
    .replace('{dias}', String(dias));
}

interface TituloResumo {
  valor: number;
  data_vencimento: string;
  categoria: Categoria;
}

// Quando o cliente tem mais de um título em aberto, mandar uma mensagem só
// por cliente (não uma por título) — evita spammar a mesma pessoa 3x seguidas.
export function gerarMensagemConsolidada(
  nomeCompleto: string,
  titulos: TituloResumo[],
): string {
  const primeiroNome = nomeCompleto.split(' ')[0];

  if (titulos.length === 1) {
    const t = titulos[0];
    const venc = new Date(`${t.data_vencimento}T12:00:00`);
    venc.setHours(0, 0, 0, 0);
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const dias = Math.round((hoje.getTime() - venc.getTime()) / (1000 * 60 * 60 * 24));
    return gerarMensagem(nomeCompleto, t.valor, t.data_vencimento, t.categoria, Math.abs(dias));
  }

  const total = titulos.reduce((s, t) => s + t.valor, 0);
  const temVencido = titulos.some((t) => t.categoria !== 'preventivo');

  const itens = titulos
    .map((t) => `R$ ${formatarValor(t.valor)} (venc. ${formatarData(t.data_vencimento)})`)
    .join(', ');

  const abertura = temVencido
    ? `Oi ${primeiroNome}, você tem ${titulos.length} pagamentos em aberto comigo, totalizando R$ ${formatarValor(total)}:`
    : `Oi ${primeiroNome}! Passando pra lembrar que você tem ${titulos.length} pagamentos vencendo em breve, totalizando R$ ${formatarValor(total)}:`;

  const fechamento = temVencido
    ? 'Consegue regularizar ou prefere combinar novas datas?'
    : 'Qualquer dúvida, só chamar!';

  return `${abertura} ${itens}. ${fechamento}`;
}
