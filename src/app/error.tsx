'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import Pagina from '@/components/ui/Pagina';
import CabecalhoPagina from '@/components/ui/CabecalhoPagina';
import Aviso from '@/components/ui/Aviso';
import { Botao, estiloBotao } from '@/components/ui/Botao';

// ---------------------------------------------------------------------------
// Erro inesperado ao montar uma tela.
//
// Falha de banco conhecida não chega aqui: cada página trata a dela e diz o
// que está indisponível (ver app/page.tsx). Isto é a rede de segurança para
// o resto, que antes caía na tela padrão do Next, em inglês e fora da
// identidade. Não mostra `error.message`: em produção o Next troca a
// mensagem de erro do servidor por uma genérica, e o `digest` é o que liga a
// tela ao log.
//
// Next 16: a função de recuperação é `unstable_retry` (refaz a leitura), não
// o antigo `reset` (ver node_modules/next/dist/docs/.../error.md).
// ---------------------------------------------------------------------------

export default function ErroDaTela({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <Pagina>
      <CabecalhoPagina titulo="Não foi possível mostrar esta tela" />
      <Aviso
        tom="risco"
        titulo="Algo deu errado ao montar a página."
        acao={
          <>
            <Botao variante="primario" onClick={() => unstable_retry()}>
              Tentar de novo
            </Botao>
            <Link href="/" className={estiloBotao('secundario')}>
              Ir para a lista do dia
            </Link>
          </>
        }
      >
        Tentar de novo refaz a leitura dos dados.
        {error.digest && (
          <>
            {' '}
            Código para suporte: <span className="numero">{error.digest}</span>.
          </>
        )}
      </Aviso>
    </Pagina>
  );
}
