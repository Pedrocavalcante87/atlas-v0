'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Marca from './Marca';
import { IconeImportar, IconeSair } from './ui/Icone';

// Barra clara com borda, não a faixa escura de antes: numa ferramenta operada
// o dia inteiro, o cabeçalho deve desaparecer e deixar a fila ser a única
// coisa com peso visual na tela.
//
// A composição é ancorada à ESQUERDA — marca, régua, navegação, coladas — com
// as ações empurradas para a direita. A primeira versão espalhava os três
// grupos com `flex-1` no meio e o resultado era uma barra sem centro de
// gravidade: nada liderava e sobrava vazio no meio.
//
// No celular a barra precisa caber em ~340px úteis. Medido antes desta versão:
// em 375px de largura a página inteira rolava na horizontal e "Lista do dia"
// quebrava em três linhas. Abaixo de `sm` a marca fica só com o símbolo e as
// ações ficam só com o ícone — o texto continua lá para o leitor de tela
// (`sr-only`), não some.

const LINKS = [
  { href: '/', rotulo: 'Lista do dia' },
  { href: '/dados', rotulo: 'Dados' },
];

export default function Navbar() {
  const pathname = usePathname();

  return (
    <header className="bg-superficie border-b border-borda sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-4 sm:px-5 h-14 flex items-center">
        <Link
          href="/"
          className="inline-flex items-center text-marca-700 hover:text-marca-800 transition-colors shrink-0"
          aria-label="Atlas — início"
        >
          {/* Cada versão num invólucro próprio: somar `hidden` ao `inline-flex`
              da Marca deixaria a exibição à mercê da ordem do CSS gerado. */}
          <span className="sm:hidden">
            <Marca apenasSimbolo />
          </span>
          <span className="hidden sm:inline">
            <Marca />
          </span>
        </Link>

        {/* Régua vertical curta: separa marca de navegação sem gastar o vazio
            que antes ficava entre elas. */}
        <span aria-hidden className="w-px h-5 bg-borda mx-3 sm:mx-4 shrink-0" />

        <nav aria-label="Principal" className="flex items-center gap-0.5">
          {LINKS.map(({ href, rotulo }) => {
            const ativo = href === '/' ? pathname === '/' : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={ativo ? 'page' : undefined}
                // O item ativo ganha fundo, não só peso: com a barra clara e
                // texto pequeno, a diferença entre 400 e 500 era sutil demais
                // para dizer onde você está.
                className={`text-corpo px-2.5 h-8 inline-flex items-center rounded-md whitespace-nowrap transition-colors ${
                  ativo
                    ? 'text-texto font-medium bg-superficie-afundada'
                    : 'text-texto-suave font-medium hover:text-texto hover:bg-superficie-sutil'
                }`}
              >
                {rotulo}
              </Link>
            );
          })}
        </nav>

        <div className="flex-1" />

        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {/* Ação principal da barra. Secundária de propósito: importar
              planilha é uma tarefa ocasional, e um botão sólido aqui competiria
              todo dia com o botão de enviar cobrança, que é a ação que importa. */}
          <Link
            href="/upload"
            aria-current={pathname.startsWith('/upload') ? 'page' : undefined}
            className="inline-flex items-center gap-1.5 h-8 px-2 sm:px-3 text-corpo font-medium rounded-md
                       border border-borda-forte text-texto bg-superficie
                       hover:bg-superficie-sutil hover:border-tinta-400
                       active:bg-superficie-afundada transition-colors"
          >
            <IconeImportar className="w-3.5 h-3.5 text-texto-suave" />
            <span className="sr-only sm:not-sr-only">Importar planilha</span>
          </Link>

          {/* Sair é POST (ver api/logout/route.ts): um link de saída seria
              disparado pelo prefetch do Next. Funciona sem JavaScript. */}
          <form action="/api/logout" method="post">
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 h-8 px-2 sm:px-2.5 text-corpo font-medium rounded-md
                         text-texto-suave hover:text-texto hover:bg-superficie-sutil
                         active:bg-superficie-afundada transition-colors cursor-pointer"
            >
              <IconeSair className="w-3.5 h-3.5" />
              <span className="sr-only sm:not-sr-only">Sair</span>
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
