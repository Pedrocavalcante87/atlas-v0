// Formatação compartilhada de exibição (moeda). Antes reimplementada de forma
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
