// Formatação compartilhada de exibição. Antes reimplementada de forma
// idêntica em 6 arquivos (page.tsx, dados/page.tsx, clientes/[id]/page.tsx,
// ClienteLinha.tsx, upload/page.tsx) — ver ARCHITECTURE.md §6.
//
// Não confundir com lib/templates.ts::formatarValor: aquela função formata só
// o número (sem símbolo de moeda) para compor dentro do texto de uma mensagem
// de cobrança ("R$ {valor}") — é um formato diferente, de propósito diferente,
// e continua vivendo lá.
export function formatarMoeda(valor: number): string {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** "1 título", "0 títulos", "3 títulos". A tela escrevia "1 dias" em quatro lugares. */
export function plural(n: number, singular: string, pluralForma: string): string {
  return `${n} ${Math.abs(n) === 1 ? singular : pluralForma}`;
}

/** Telefone só com dígitos vira exibição legível: +55 11 98888-7777. */
export function formatarTelefone(digitos: string): string {
  const m = digitos.match(/^(\d{2})(\d{2})(\d{4,5})(\d{4})$/);
  return m ? `+${m[1]} ${m[2]} ${m[3]}-${m[4]}` : digitos;
}

/**
 * Data de calendário (YYYY-MM-DD, como `data_vencimento`) em dd/mm/aaaa.
 * Por string, não por `Date`: uma data sem hora não tem fuso, e passar por
 * `Date` é o caminho para ela virar o dia anterior à noite.
 */
export function formatarData(iso: string): string {
  const [ano, mes, dia] = iso.slice(0, 10).split('-');
  return `${dia}/${mes}/${ano}`;
}

/** Mesma coisa, sem o ano: dd/mm. */
export function formatarDataCurta(iso: string): string {
  const [, mes, dia] = iso.slice(0, 10).split('-');
  return `${dia}/${mes}`;
}

/** YYYY-MM-DD do dia local — para `min` de campo de data e comparação de dia. */
export function dataLocalISO(data: Date): string {
  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const dia = String(data.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

/**
 * Instante vindo do banco, lido como UTC quando não traz fuso.
 *
 * `interacoes.data_envio` e `criado_em` são `timestamp` SEM fuso, preenchidos
 * por `now()` num Postgres em UTC. O PostgREST devolve "2026-09-21T10:21:49"
 * sem `Z`, e `new Date()` lê isso como hora LOCAL. Medido em 2026-09-23: a
 * interação gravada junto de um `resolvido_em` (timestamptz) de
 * 10:21:49+00:00 veio como "10:21:49.65", e o histórico do cliente exibia a
 * hora três horas adiantada. `resolvido_em` é timestamptz e já vem com fuso.
 */
export function instanteDoBanco(valor: string): Date {
  const temFuso = /(?:[zZ]|[+-]\d{2}(?::?\d{2})?)$/.test(valor.trim());
  return new Date(temFuso ? valor : `${valor.trim().replace(' ', 'T')}Z`);
}

/** "10:32" no fuso local de quem renderiza. */
export function formatarHora(instante: Date): string {
  return instante.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

/** Primeira letra maiúscula, o resto intocado. `capitalize` do CSS fazia "23 De Setembro". */
export function comMaiuscula(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/**
 * Situação de vencimento em poucas palavras, a partir de `diasAtraso`
 * (positivo = vencido há N dias; 0 = hoje; negativo = vence em N dias).
 *   curto: cabe na coluna da tabela — "12 dias", "vence hoje", "em 2 dias"
 *   longo: frase para a lista de títulos — "12 dias em atraso", "vence em 2 dias"
 */
export function rotuloVencimento(diasAtraso: number, forma: 'curto' | 'longo' = 'longo'): string {
  if (diasAtraso === 0) return 'vence hoje';
  if (diasAtraso === -1) return 'vence amanhã';
  if (diasAtraso < 0) {
    const faltam = plural(-diasAtraso, 'dia', 'dias');
    return forma === 'curto' ? `em ${faltam}` : `vence em ${faltam}`;
  }
  const atraso = plural(diasAtraso, 'dia', 'dias');
  return forma === 'curto' ? atraso : `${atraso} em atraso`;
}
