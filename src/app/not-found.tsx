import Link from 'next/link';
import Pagina from '@/components/ui/Pagina';
import CabecalhoPagina from '@/components/ui/CabecalhoPagina';
import { estiloBotao } from '@/components/ui/Botao';

// Endereço que não existe, ou `notFound()` do histórico de um cliente que não
// está mais no banco. Antes caía na página padrão do Next, em inglês.
export default function NaoEncontrada() {
  return (
    <Pagina>
      <CabecalhoPagina
        titulo="Página não encontrada"
        descricao="O endereço não existe, ou o cliente foi removido da carteira."
      />
      <Link href="/" className={estiloBotao('primario')}>
        Ir para a lista do dia
      </Link>
    </Pagina>
  );
}
