import { ClienteAgrupado } from '@/types';
import ClienteLinha from './ClienteLinha';

// ---------------------------------------------------------------------------
// A fila do dia como tabela.
//
// Continua sendo uma lista de CLIENTES, não de títulos — a regra central do
// produto ("cobrar a pessoa, não cada título") não muda por causa do formato.
// Cada linha agrupa os títulos em aberto de um cliente, e a expansão mostra os
// títulos individuais, onde o resultado é registrado.
//
// `table` de verdade, não `div` com grid: são dados tabulares, e leitor de
// tela depende da associação célula-cabeçalho para anunciar "Valor em aberto:
// R$ 5.600,00" em vez de ler números soltos.
// ---------------------------------------------------------------------------

interface Props {
  titulo: string;
  complemento: string;
  grupos: ClienteAgrupado[];
}

const TH =
  'px-3 py-2 text-legenda font-medium text-texto-suave uppercase tracking-[0.04em] whitespace-nowrap';

export default function FilaCobranca({ titulo, complemento, grupos }: Props) {
  if (grupos.length === 0) return null;

  return (
    <section className="bg-superficie border border-borda rounded-lg overflow-hidden">
      <header className="flex items-baseline gap-2 px-4 py-3 border-b border-borda bg-cabecalho">
        <h2 className="text-base font-semibold text-texto">{titulo}</h2>
        <span className="text-corpo text-texto-fraco numero">{grupos.length}</span>
        <span className="text-corpo text-texto-fraco">· {complemento}</span>
      </header>

      {/* Rolagem horizontal só em telas estreitas: a tabela é desenhada para
          desktop, e colunas secundárias já somem antes disso (ver hidden). */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-borda bg-cabecalho">
              <th className="w-9" />
              <th scope="col" className={`${TH} text-left`}>Cliente</th>
              <th scope="col" className={`${TH} text-left hidden lg:table-cell`}>Telefone</th>
              <th scope="col" className={`${TH} text-right`}>Em aberto</th>
              <th scope="col" className={`${TH} text-left`}>Atraso</th>
              <th scope="col" className={`${TH} text-right hidden md:table-cell`}>Títulos</th>
              <th scope="col" className={`${TH} text-right`}>Ações</th>
            </tr>
          </thead>
          <tbody>
            {grupos.map((grupo) => (
              <ClienteLinha key={grupo.cliente.id} grupo={grupo} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
