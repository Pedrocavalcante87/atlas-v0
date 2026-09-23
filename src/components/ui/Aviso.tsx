import type { ReactNode } from 'react';
import { IconeAlerta, IconeInfo, IconePago } from './Icone';

// ---------------------------------------------------------------------------
// Aviso em bloco: erro, cuidado, sucesso ou informação.
//
// Substitui as caixas montadas à mão em cada tela, que usavam emoji como ícone
// e repetiam a mesma combinação de fundo, borda e texto com pequenas
// diferenças. A cor segue a gramática de globals.css: risco é o que impede a
// operação, atencao é o que pede cuidado, marca é o que deu certo.
//
// `papel`: só o erro é anunciado de imediato (`alert`) por padrão. Um aviso
// que já nasce com a tela ("isto é uma prévia") não deve interromper o leitor
// de tela; um que aparece depois de uma ação pode pedir `status`.
// ---------------------------------------------------------------------------

export type TomAviso = 'risco' | 'atencao' | 'marca' | 'neutro';

const TONS: Record<TomAviso, { caixa: string; titulo: string; texto: string; icone: string }> = {
  risco: {
    caixa: 'bg-risco-50 border-risco-200',
    titulo: 'text-risco-700',
    texto: 'text-risco-700',
    icone: 'text-risco-600',
  },
  atencao: {
    caixa: 'bg-atencao-50 border-atencao-200',
    titulo: 'text-atencao-700',
    texto: 'text-atencao-700',
    icone: 'text-atencao-700',
  },
  marca: {
    caixa: 'bg-marca-50 border-marca-200',
    titulo: 'text-marca-800',
    texto: 'text-marca-700',
    icone: 'text-marca-600',
  },
  neutro: {
    caixa: 'bg-superficie border-borda',
    titulo: 'text-texto',
    texto: 'text-texto-suave',
    icone: 'text-texto-suave',
  },
};

const ICONES: Record<TomAviso, typeof IconeInfo> = {
  risco: IconeAlerta,
  atencao: IconeAlerta,
  marca: IconePago,
  neutro: IconeInfo,
};

interface Props {
  tom?: TomAviso;
  titulo?: ReactNode;
  children?: ReactNode;
  /** Botão ou link de saída ("Tentar de novo", "Entrar de novo"). */
  acao?: ReactNode;
  papel?: 'alert' | 'status';
  className?: string;
}

export default function Aviso({ tom = 'neutro', titulo, children, acao, papel, className = '' }: Props) {
  const t = TONS[tom];
  const Icone = ICONES[tom];
  return (
    <div
      role={papel ?? (tom === 'risco' ? 'alert' : undefined)}
      className={`flex gap-2.5 rounded-md border px-3.5 py-3 ${t.caixa} ${className}`}
    >
      <Icone className={`w-4 h-4 mt-0.5 shrink-0 ${t.icone}`} />
      <div className="min-w-0 flex-1">
        {titulo && <p className={`text-corpo font-semibold ${t.titulo}`}>{titulo}</p>}
        {children && (
          <div className={`text-corpo ${t.texto} ${titulo ? 'mt-0.5' : ''}`}>{children}</div>
        )}
        {acao && <div className="mt-2.5 flex flex-wrap gap-2">{acao}</div>}
      </div>
    </div>
  );
}
