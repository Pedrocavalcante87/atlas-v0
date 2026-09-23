import type { ReactNode } from 'react';

// ---------------------------------------------------------------------------
// Bloco de conteúdo com cabeçalho — a superfície padrão das telas.
//
// Mesma anatomia do cabeçalho da fila do dia (fundo `cabecalho`, borda de
// 1px, título em peso 600), para que prévia de importação, histórico do
// cliente e zona de perigo pareçam partes do mesmo produto. Antes cada tela
// inventava a sua: uma faixa azul-escura aqui, um título em caixa alta ali.
//
// O título é `h2`: o `h1` da página vem de `CabecalhoPagina`.
// ---------------------------------------------------------------------------

interface Props {
  titulo?: ReactNode;
  /** Texto de apoio ao lado do título — contagem, instrução curta. */
  complemento?: ReactNode;
  /** Ação alinhada à direita do cabeçalho. */
  acoes?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Base do id do título, para `aria-labelledby`. Obrigatório com mais de um painel na página. */
  id?: string;
}

export default function Painel({ titulo, complemento, acoes, children, className = '', id }: Props) {
  const idTitulo = id ? `${id}-titulo` : undefined;
  return (
    <section
      aria-labelledby={titulo && idTitulo ? idTitulo : undefined}
      className={`bg-superficie border border-borda rounded-lg overflow-hidden ${className}`}
    >
      {titulo && (
        <header className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-3 border-b border-borda bg-cabecalho">
          <h2 id={idTitulo} className="text-base font-semibold text-texto">
            {titulo}
          </h2>
          {complemento && <span className="text-corpo text-texto-suave">{complemento}</span>}
          {acoes && <div className="ml-auto flex items-center gap-2">{acoes}</div>}
        </header>
      )}
      {children}
    </section>
  );
}
