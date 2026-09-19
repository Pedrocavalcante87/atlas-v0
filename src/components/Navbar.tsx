'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Marca from './Marca';

// Barra clara com borda, não a faixa escura de antes: numa ferramenta operada
// o dia inteiro, o cabeçalho deve desaparecer e deixar a fila ser a única
// coisa com peso visual na tela.

const LINKS = [
  { href: '/', rotulo: 'Lista do dia' },
  { href: '/dados', rotulo: 'Dados' },
];

export default function Navbar() {
  const pathname = usePathname();

  return (
    <header className="bg-superficie border-b border-borda sticky top-0 z-50">
      <div className="max-w-5xl mx-auto px-5 h-14 flex items-center gap-8">
        <Link
          href="/"
          className="text-marca-700 hover:text-marca-800 transition-colors shrink-0"
          aria-label="Atlas — início"
        >
          <Marca />
        </Link>

        <nav className="flex items-center gap-1 flex-1">
          {LINKS.map(({ href, rotulo }) => {
            // O item ativo é marcado por peso e cor, não por caixa preenchida —
            // pinta-se o estado, não o fundo.
            const ativo = href === '/' ? pathname === '/' : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={ativo ? 'page' : undefined}
                className={`text-sm px-2.5 py-1.5 rounded-md transition-colors ${
                  ativo
                    ? 'text-texto font-medium'
                    : 'text-texto-suave hover:text-texto hover:bg-superficie-afundada'
                }`}
              >
                {rotulo}
              </Link>
            );
          })}
        </nav>

        <Link
          href="/upload"
          className="inline-flex items-center h-8 px-3 text-[13px] font-medium rounded-md border border-borda-forte text-texto hover:bg-superficie-sutil transition-colors"
        >
          Importar planilha
        </Link>
      </div>
    </header>
  );
}
