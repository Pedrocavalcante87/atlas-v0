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
