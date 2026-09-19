import type { ReactNode } from 'react';
import type { Categoria } from '@/types';

// ---------------------------------------------------------------------------
// Etiqueta de estado. É o elemento que carrega a gramática de cor do produto —
// o usuário lê a fila por cor antes de ler o texto, então estes três tons são
// informação, não decoração (ver globals.css).
//
// `deCategoria` existe para que a tradução categoria-do-domínio → cor viva em
// UM lugar. Antes cada card repetia o mesmo ternário de três braços, e eles já
// tinham divergido entre si uma vez.
// ---------------------------------------------------------------------------

export type TomBadge = 'risco' | 'atencao' | 'marca' | 'neutro';

const TONS: Record<TomBadge, string> = {
  risco: 'bg-risco-50 text-risco-700 border-risco-200',
  atencao: 'bg-atencao-50 text-atencao-700 border-atencao-200',
  marca: 'bg-marca-50 text-marca-700 border-marca-200',
  neutro: 'bg-superficie-afundada text-texto-suave border-borda',
};

/** A categoria de urgência do domínio decide o tom. Fonte única desta tradução. */
export function tomDaCategoria(categoria: Categoria): TomBadge {
  if (categoria === 'atraso_longo') return 'risco';
  if (categoria === 'atraso_leve') return 'atencao';
  return 'neutro';
}

interface Props {
  tom?: TomBadge;
  children: ReactNode;
  className?: string;
}

export default function Badge({ tom = 'neutro', children, className = '' }: Props) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-micro font-medium leading-none whitespace-nowrap ${TONS[tom]} ${className}`}
    >
      {children}
    </span>
  );
}
