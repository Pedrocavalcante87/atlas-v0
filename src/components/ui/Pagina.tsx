import type { ReactNode } from 'react';

// ---------------------------------------------------------------------------
// Contêiner de toda tela: a mesma largura e o mesmo respiro, alinhados à barra
// superior. Antes cada página escolhia o seu (px-4 aqui, px-5 ali; py-6, py-7,
// py-8), e o conteúdo "pulava" alguns pixels ao trocar de tela.
// ---------------------------------------------------------------------------

export default function Pagina({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <main className={`max-w-6xl mx-auto px-4 sm:px-5 py-6 sm:py-7 ${className}`}>{children}</main>;
}
