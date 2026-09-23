import type { ReactNode } from 'react';

// ---------------------------------------------------------------------------
// Card de indicador do cabeçalho.
//
// Quatro leituras do mesmo estado, em cards separados. O tom pinta apenas o
// VALOR e um filete no topo — nunca o fundo inteiro: quatro superfícies
// coloridas lado a lado competem entre si e nenhuma consegue significar
// urgência, que é justamente o trabalho da cor neste produto.
// ---------------------------------------------------------------------------

export type TomKpi = 'risco' | 'atencao' | 'neutro' | 'marca';

const VALOR: Record<TomKpi, string> = {
  risco: 'text-risco-600',
  atencao: 'text-atencao-600',
  neutro: 'text-texto',
  marca: 'text-marca-700',
};

const FILETE: Record<TomKpi, string> = {
  risco: 'bg-risco-500',
  atencao: 'bg-atencao-500',
  neutro: 'bg-tinta-300',
  marca: 'bg-marca-600',
};

interface Props {
  rotulo: string;
  valor: ReactNode;
  /** Texto pequeno sob o valor — janela de apuração, unidade, indisponibilidade. */
  nota?: string;
  tom?: TomKpi;
  /** Classes de grade de quem posiciona o card (ex.: ocupar duas colunas no celular). */
  className?: string;
}

export default function KpiCard({ rotulo, valor, nota, tom = 'neutro', className = '' }: Props) {
  return (
    <div className={`relative bg-superficie border border-borda rounded-md px-4 py-3.5 overflow-hidden ${className}`}>
      <span aria-hidden className={`absolute left-0 top-0 h-0.5 w-full ${FILETE[tom]}`} />
      <p className="text-legenda text-texto-suave mb-1.5 uppercase tracking-[0.04em]">{rotulo}</p>
      <p className={`text-cifra font-semibold numero leading-none truncate ${VALOR[tom]}`}>
        {valor}
      </p>
      {nota && <p className="text-legenda text-texto-fraco mt-1.5">{nota}</p>}
    </div>
  );
}
