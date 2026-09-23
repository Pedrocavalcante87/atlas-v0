'use client';

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { IconeAlerta, IconeFechar, IconeInfo, IconePago } from './ui/Icone';

// ---------------------------------------------------------------------------
// Avisos flutuantes: a confirmação de que um registro aconteceu.
//
// Registrar um resultado revalida a página (`revalidatePath('/')` em
// actions/index.ts), e o título sai da fila na mesma hora — com o único
// título do cliente, a LINHA INTEIRA some. Qualquer confirmação desenhada
// dentro da linha sumiria junto, então ela mora aqui, fora da fila, num
// provedor que fica no layout e sobrevive à revalidação.
//
// Região `aria-live` sempre presente no DOM: leitor de tela só anuncia o que
// entra numa região que já existia.
// ---------------------------------------------------------------------------

export type TomDoAviso = 'marca' | 'neutro' | 'risco';
type Avisar = (texto: string, tom?: TomDoAviso) => void;

interface AvisoFlutuante {
  id: number;
  tom: TomDoAviso;
  texto: string;
}

const Contexto = createContext<Avisar | null>(null);

/** Função para mostrar um aviso. Só funciona dentro de `<Avisos>` (no layout). */
export function useAvisos(): Avisar {
  const avisar = useContext(Contexto);
  if (!avisar) throw new Error('useAvisos precisa estar dentro de <Avisos>.');
  return avisar;
}

const DURACAO_MS = 6000;
const MAXIMO_NA_TELA = 3;

const ICONE: Record<TomDoAviso, { Icone: typeof IconeInfo; cor: string }> = {
  marca: { Icone: IconePago, cor: 'text-marca-600' },
  neutro: { Icone: IconeInfo, cor: 'text-texto-suave' },
  risco: { Icone: IconeAlerta, cor: 'text-risco-600' },
};

export default function Avisos({ children }: { children: ReactNode }) {
  const [avisos, setAvisos] = useState<AvisoFlutuante[]>([]);
  const proximoId = useRef(1);

  const fechar = useCallback((id: number) => {
    setAvisos((atuais) => atuais.filter((a) => a.id !== id));
  }, []);

  const avisar = useCallback<Avisar>(
    (texto, tom = 'marca') => {
      const id = proximoId.current++;
      setAvisos((atuais) => [...atuais.slice(-(MAXIMO_NA_TELA - 1)), { id, tom, texto }]);
      window.setTimeout(() => fechar(id), DURACAO_MS);
    },
    [fechar],
  );

  return (
    <Contexto.Provider value={avisar}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="fixed z-60 bottom-4 inset-x-4 sm:inset-x-auto sm:right-5 sm:w-96 flex flex-col gap-2 pointer-events-none"
      >
        {avisos.map(({ id, tom, texto }) => {
          const { Icone, cor } = ICONE[tom];
          return (
            // Única superfície com sombra fora de menu: ela flutua de verdade.
            <div
              key={id}
              className="pointer-events-auto flex items-start gap-2.5 rounded-md border border-borda bg-superficie px-3.5 py-3 shadow-flutuante motion-safe:animate-entrar"
            >
              <Icone className={`w-4 h-4 mt-0.5 shrink-0 ${cor}`} />
              <p className="flex-1 text-corpo text-texto">{texto}</p>
              <button
                type="button"
                aria-label="Fechar aviso"
                onClick={() => fechar(id)}
                className="-m-1 p-1 rounded-sm text-texto-fraco hover:text-texto transition-colors cursor-pointer"
              >
                <IconeFechar className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </Contexto.Provider>
  );
}
