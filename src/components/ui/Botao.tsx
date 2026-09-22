import type { ButtonHTMLAttributes, AnchorHTMLAttributes, ReactNode } from 'react';

// ---------------------------------------------------------------------------
// Botão do sistema. Existe para que "qual verde?", "qual altura?" e "como fica
// desabilitado?" tenham UMA resposta — antes cada tela respondia sozinha e as
// respostas já divergiam (px-4 py-2.5 aqui, px-3 py-1.5 ali, dois azuis).
//
// Variante é PAPEL, não cor: `primario` é a ação que a tela existe para
// receber, e só deve haver uma por bloco. Trocar a identidade um dia é mudar
// este arquivo, não caçar `bg-emerald-600` em seis lugares.
// ---------------------------------------------------------------------------

export type VarianteBotao = 'primario' | 'secundario' | 'sutil' | 'perigo';
export type TamanhoBotao = 'sm' | 'md' | 'lg';

const VARIANTES: Record<VarianteBotao, string> = {
  // A borda interna clara (inset) dá ao botão sólido um relevo de 1px sem
  // sombra nenhuma — é o truque que mantém o botão com presença física num
  // sistema que baniu elevação. O escurecimento no active substitui o
  // deslocamento de 1px, que em tela densa lê como tremor.
  primario:
    'bg-marca-700 text-white border border-marca-800 ' +
    'shadow-[inset_0_1px_0_0_rgb(255_255_255/0.12)] ' +
    'hover:bg-marca-800 active:bg-marca-900 active:shadow-none',
  secundario:
    'bg-superficie text-texto border border-borda-forte ' +
    'hover:bg-superficie-sutil hover:border-tinta-400 active:bg-superficie-afundada',
  sutil:
    'bg-transparent text-texto-suave border border-transparent ' +
    'hover:bg-superficie-afundada hover:text-texto active:bg-borda',
  // Contorno, não preenchido: uma ação destrutiva não deve competir em peso
  // visual com a ação principal da tela — ela precisa ser encontrável, não
  // convidativa. Vira sólida só no hover, quando a intenção já está clara.
  perigo:
    'bg-superficie text-risco-600 border border-risco-200 ' +
    'hover:bg-risco-600 hover:text-white hover:border-risco-600 active:bg-risco-700',
};

// Altura e respiro horizontal crescem juntos; o texto não cresce junto de
// propósito. Botão grande com letra grande vira banner — o que muda entre os
// tamanhos é a área de clique e o peso na composição, não o volume do texto.
const TAMANHOS: Record<TamanhoBotao, string> = {
  sm: 'h-7 px-2.5 text-corpo gap-1.5',
  md: 'h-9 px-3.5 text-corpo gap-2',
  lg: 'h-10 px-4 text-base gap-2',
};

const BASE =
  'inline-flex items-center justify-center rounded-md font-medium leading-none ' +
  // Tracking levemente fechado: em peso 500 e caixa baixa, o rótulo curto de
  // um botão abre demais e perde a leitura como bloco único.
  'tracking-[-0.006em] whitespace-nowrap ' +
  'transition-colors duration-100 select-none cursor-pointer ' +
  'disabled:opacity-40 disabled:pointer-events-none disabled:cursor-not-allowed';

function classes(variante: VarianteBotao, tamanho: TamanhoBotao, largura?: boolean, extra?: string) {
  return [BASE, VARIANTES[variante], TAMANHOS[tamanho], largura ? 'w-full' : '', extra ?? '']
    .filter(Boolean)
    .join(' ');
}

interface ComunsBotao {
  variante?: VarianteBotao;
  tamanho?: TamanhoBotao;
  largura?: boolean;
  children: ReactNode;
}

type PropsBotao = ComunsBotao & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> & {
  className?: string;
};

export function Botao({
  variante = 'secundario',
  tamanho = 'md',
  largura,
  className,
  children,
  ...props
}: PropsBotao) {
  return (
    <button className={classes(variante, tamanho, largura, className)} {...props}>
      {children}
    </button>
  );
}

type PropsBotaoLink = ComunsBotao & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'className'> & {
  className?: string;
};

/** Mesma aparência, elemento `<a>` — para navegação e links externos (wa.me). */
export function BotaoLink({
  variante = 'secundario',
  tamanho = 'md',
  largura,
  className,
  children,
  ...props
}: PropsBotaoLink) {
  return (
    <a className={classes(variante, tamanho, largura, className)} {...props}>
      {children}
    </a>
  );
}
