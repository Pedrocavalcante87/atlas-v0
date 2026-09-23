import { ClienteAgrupado } from '@/types';
import ClienteLinha from './ClienteLinha';
import Painel from './ui/Painel';

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
//
// No celular (abaixo de `sm`) a tabela NÃO rola na horizontal: valor e
// vencimento descem para baixo do nome, e sobram três colunas — expandir,
// cliente, ações. Medido antes: em 375px só a coluna do cliente cabia, e as
// ações (inclusive o WhatsApp) ficavam fora da tela.
// ---------------------------------------------------------------------------

/** O que a fila sabe do último contato com o cliente, já em texto. */
export interface ContatoDoCliente {
  /** "hoje às 10:32", "há 3 dias" — calculado no servidor (lib/contato.ts). */
  rotulo: string;
  hoje: boolean;
}

interface Props {
  /** Base dos ids do painel e das linhas — precisa ser único na página. */
  id: string;
  titulo: string;
  complemento: string;
  /** Cabeçalho da coluna de prazo: "Atraso" nos vencidos, "Vence" nos a vencer. */
  rotuloPrazo: string;
  grupos: ClienteAgrupado[];
  contatos: Record<string, ContatoDoCliente>;
  /** YYYY-MM-DD no relógio do servidor (ver ClienteLinha). */
  hoje: string;
}

const TH =
  'px-3 py-2 text-legenda font-medium text-texto-suave uppercase tracking-[0.04em] whitespace-nowrap';

export default function FilaCobranca({ id, titulo, complemento, rotuloPrazo, grupos, contatos, hoje }: Props) {
  if (grupos.length === 0) return null;

  const contatadosHoje = grupos.filter((g) => contatos[g.cliente.id]?.hoje).length;

  return (
    <Painel
      id={id}
      titulo={titulo}
      complemento={
        <>
          <span className="numero">{grupos.length}</span> {grupos.length === 1 ? 'cliente' : 'clientes'} ·{' '}
          {complemento}
        </>
      }
      // O progresso do dia. O título continua na fila depois do envio (só
      // "pago" o tira de vez), então sem esta conta não dá para saber quanto
      // da lista já foi trabalhado.
      acoes={
        contatadosHoje > 0 ? (
          <span className="text-corpo text-texto-suave">
            <span className="numero">{contatadosHoje}</span> de <span className="numero">{grupos.length}</span>{' '}
            {contatadosHoje === 1 ? 'contatado' : 'contatados'} hoje
          </span>
        ) : undefined
      }
    >
      {/* Rolagem só como rede de segurança: o layout de celular foi feito para
          não precisar dela, mas um conteúdo que não quebre não pode empurrar a
          página inteira para os lados. */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <caption className="sr-only">
            {titulo}: {complemento}
          </caption>
          <thead>
            <tr className="border-b border-borda bg-cabecalho">
              <th className="w-9">
                <span className="sr-only">Expandir</span>
              </th>
              <th scope="col" className={`${TH} text-left`}>
                Cliente
              </th>
              <th scope="col" className={`${TH} text-left hidden lg:table-cell`}>
                Telefone
              </th>
              <th scope="col" className={`${TH} text-right hidden sm:table-cell`}>
                Em aberto
              </th>
              <th scope="col" className={`${TH} text-left hidden sm:table-cell`}>
                {rotuloPrazo}
              </th>
              <th scope="col" className={`${TH} text-right hidden md:table-cell`}>
                Títulos
              </th>
              <th scope="col" className={`${TH} text-right`}>
                Ações
              </th>
            </tr>
          </thead>
          <tbody>
            {grupos.map((grupo) => (
              <ClienteLinha
                key={grupo.cliente.id}
                grupo={grupo}
                contato={contatos[grupo.cliente.id] ?? null}
                hoje={hoje}
              />
            ))}
          </tbody>
        </table>
      </div>
    </Painel>
  );
}
