import type { ButtonHTMLAttributes, AnchorHTMLAttributes, ReactNode } from 'react';

// ---------------------------------------------------------------------------
// Ação em ícone, para as colunas de ação da tabela.
//
// Regra inegociável: `rotulo` é obrigatório e vira `aria-label` e `title`. Um
// ícone sozinho numa linha que muda estado financeiro é adivinhação — para
// quem usa leitor de tela é inacessível, e para quem enxerga é um teste de
// memória na primeira semana de uso.
//
// Em repouso os ícones são neutros e discretos; a cor entra no hover, quando a
// intenção já existe. Linha com três ações coloridas o tempo todo vira
// semáforo e a urgência (que mora na coluna de atraso) perde a vez.
// ---------------------------------------------------------------------------

export type TomAcao = 'marca' | 'neutro' | 'risco';

const TONS: Record<TomAcao, string> = {
  marca: 'hover:bg-marca-50 hover:text-marca-700 hover:border-marca-200',
  neutro: 'hover:bg-superficie-afundada hover:text-texto hover:border-borda-forte',
  risco: 'hover:bg-risco-50 hover:text-risco-600 hover:border-risco-200',
};

const BASE =
  'inline-flex items-center justify-center w-8 h-8 rounded-md border border-transparent ' +
  'text-texto-fraco transition-colors duration-100 cursor-pointer ' +
  'disabled:opacity-40 disabled:pointer-events-none';

interface Comuns {
  rotulo: string;
  tom?: TomAcao;
  children: ReactNode;
  className?: string;
}

type PropsBotao = Comuns & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'title'>;

export function BotaoIcone({ rotulo, tom = 'neutro', className = '', children, ...props }: PropsBotao) {
  return (
    <button aria-label={rotulo} title={rotulo} className={`${BASE} ${TONS[tom]} ${className}`} {...props}>
      {children}
    </button>
  );
}

type PropsLink = Comuns & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'className' | 'title'>;

/** Mesma aparência, elemento `<a>` — para `wa.me` e `tel:`. */
export function LinkIcone({ rotulo, tom = 'neutro', className = '', children, ...props }: PropsLink) {
  return (
    <a aria-label={rotulo} title={rotulo} className={`${BASE} ${TONS[tom]} ${className}`} {...props}>
      {children}
    </a>
  );
}
