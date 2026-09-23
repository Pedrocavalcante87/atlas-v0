import type { Metadata } from 'next';

// A página desta rota é Client Component, que não pode exportar `metadata`:
// o título da aba mora aqui.
export const metadata: Metadata = { title: 'Importar planilha' };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
