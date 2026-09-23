import type { ReactNode } from 'react';
import Link from 'next/link';
import { IconeVoltar } from './Icone';

// ---------------------------------------------------------------------------
// Topo de página: o único `h1` da tela, descrição e ações.
//
// Existe porque cada tela resolvia o próprio título — 18px semibold na home,
// 22px bold (o degrau `cifra`, que é de DINHEIRO) nas outras — e três delas
// nem tinham `h1`, o que deixava o leitor de tela sem o nome da página.
//
// `voltar` é para telas que não estão na navegação (o histórico do cliente,
// aberto a partir da fila). Tela que está na barra superior não precisa: o
// link repetiria a navegação que já está à vista.
// ---------------------------------------------------------------------------

interface Props {
  titulo: ReactNode;
  descricao?: ReactNode;
  voltar?: { href: string; rotulo: string };
  acoes?: ReactNode;
}

export default function CabecalhoPagina({ titulo, descricao, voltar, acoes }: Props) {
  return (
    <header className="mb-6">
      {voltar && (
        <Link
          href={voltar.href}
          className="inline-flex items-center gap-1.5 mb-3 text-corpo text-texto-suave hover:text-texto transition-colors"
        >
          <IconeVoltar className="w-3.5 h-3.5" />
          {voltar.rotulo}
        </Link>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-titulo font-semibold text-texto break-words">{titulo}</h1>
          {descricao && <div className="text-corpo text-texto-suave mt-0.5">{descricao}</div>}
        </div>
        {acoes && <div className="flex flex-wrap items-center gap-2 shrink-0">{acoes}</div>}
      </div>
    </header>
  );
}
