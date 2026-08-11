// ---------------------------------------------------------------------------
// O lado da ESCRITA da importação: como gravar um lote de títulos convivendo
// com o índice único `idx_titulos_aberto_unico` (supabase/migration-02).
//
// Este módulo não importa `lib/supabase.ts`. Ele recebe as duas operações de
// banco de que precisa (`Portas`) e não sabe de onde elas vêm — a rota liga nas
// reais, o teste liga em dublês. É o que torna esta lógica alcançável por teste.
//
// Vale a pena explicar por que esse cuidado: a máquina de estados abaixo
// produziu DOIS defeitos reais no ciclo em que foi escrita, e nenhum apareceu em
// teste unitário, porque ela morava dentro da rota e ninguém conseguia
// exercitá-la sem subir servidor e provocar concorrência à mão.
//
//   1. O conflito era reconhecido procurando "23505" dentro da MENSAGEM do
//      Postgres — que é texto humano e não contém o número. O caminho inteiro
//      de tratamento de conflito nunca executava.
//   2. Quando as tentativas se esgotavam, o relatório acusava perda que não
//      existia: com 4 importações simultâneas de 120 linhas, as três perdedoras
//      diziam "100 não gravadas" com as 120 no banco.
//
// Os dois só apareceram na reprodução de ponta a ponta. Extrair daqui é o que
// impede que voltem em silêncio.
// ---------------------------------------------------------------------------

import type { Resultado } from './supabase-io';
import { removerJaExistentes, type TituloExistente, type TituloParaInserir } from './csv-import';

/** SQLSTATE de violação de unicidade — aqui significa "outra importação chegou primeiro". */
export const CONFLITO_UNICIDADE = '23505';

/**
 * Quantas vezes reconsultar o banco e reenviar o que sobrou quando um lote bate
 * no índice único. Converge sozinho: cada rodada só reenvia o que ainda não
 * existe, e o competidor já gravou o resto. Esgotar o teto não é problema — a
 * conciliação final descobre o estado real de qualquer jeito.
 */
export const MAX_TENTATIVAS_CONFLITO = 3;

/** As duas operações de banco de que a gravação precisa. */
export interface Portas {
  /** Insere o lote inteiro (atômico) e devolve as linhas que entraram. */
  inserir(lote: TituloParaInserir[]): Promise<Resultado<{ id: string }[]>>;
  /** Títulos em aberto que existem AGORA para estes clientes. Lança se não conseguir ler. */
  lerExistentes(clienteIds: string[]): Promise<TituloExistente[]>;
}

export interface ResultadoLote {
  gravados: number;
  /** Recusados pelo banco por já existirem — são duplicatas, não erros. */
  duplicatasDeCorrida: number;
  falha?: { indisponivel: boolean; mensagem: string };
}

const clientesDe = (lote: TituloParaInserir[]) => [...new Set(lote.map((t) => t.cliente_id))];

/**
 * Última palavra sobre o que aconteceu, quando as tentativas se esgotam.
 *
 * Quem sabe a verdade é o banco. Uma linha que já está lá é duplicata, não
 * falha, pouco importa qual requisição a gravou. Só o que realmente não existe
 * é reportado como não gravado — sem isto o relatório inventa perda, que é o
 * bug original invertido.
 */
async function conciliar(
  lote: TituloParaInserir[],
  gravados: number,
  mensagemDoConflito: string,
  portas: Portas,
): Promise<ResultadoLote> {
  let faltando: TituloParaInserir[];
  try {
    faltando = removerJaExistentes(lote, await portas.lerExistentes(clientesDe(lote)));
  } catch {
    return {
      gravados,
      duplicatasDeCorrida: 0,
      falha: {
        indisponivel: true,
        mensagem: 'Não foi possível confirmar o que foi gravado após um conflito.',
      },
    };
  }

  const duplicatasDeCorrida = lote.length - gravados - faltando.length;

  // Tudo do lote existe: a importação está completa, mesmo que outra requisição
  // é que tenha gravado. Não há nada de errado para reportar.
  if (faltando.length === 0) return { gravados, duplicatasDeCorrida };

  return {
    gravados,
    duplicatasDeCorrida,
    falha: { indisponivel: false, mensagem: mensagemDoConflito },
  };
}

/**
 * Grava um lote de títulos, tratando conflito de unicidade como duplicata.
 *
 * A checagem de duplicata em memória olha o banco num instante e grava no
 * instante seguinte; entre os dois, outra importação pode gravar a mesma
 * cobrança. Com o índice único, essa segunda gravação falha com 23505 em vez de
 * duplicar — e aqui esse erro é traduzido para o que significa no domínio:
 * "alguém já gravou isto".
 *
 * Sem a migration aplicada o 23505 nunca acontece e o laço roda uma vez só.
 */
export async function gravarLoteDeTitulos(
  lote: TituloParaInserir[],
  portas: Portas,
): Promise<ResultadoLote> {
  if (lote.length === 0) return { gravados: 0, duplicatasDeCorrida: 0 };

  let pendentes = lote;
  let gravados = 0;

  for (let tentativa = 1; ; tentativa++) {
    const r = await portas.inserir(pendentes);

    if (r.ok) {
      gravados += r.data?.length ?? 0;
      return { gravados, duplicatasDeCorrida: lote.length - gravados };
    }

    // Pelo CÓDIGO, não pela mensagem: o texto do Postgres é "duplicate key
    // value violates unique constraint ..." e não contém o número.
    if (r.codigo !== CONFLITO_UNICIDADE) {
      return {
        gravados,
        duplicatasDeCorrida: 0,
        falha: { indisponivel: r.indisponivel, mensagem: r.mensagem },
      };
    }

    // Alguém gravou parte disto entre a nossa checagem e agora. Reconsulta e
    // reenvia só o que ainda falta — o lote encolhe a cada rodada.
    let restantes: TituloParaInserir[];
    try {
      restantes = removerJaExistentes(pendentes, await portas.lerExistentes(clientesDe(pendentes)));
    } catch {
      return {
        gravados,
        duplicatasDeCorrida: 0,
        falha: {
          indisponivel: true,
          mensagem: 'Não foi possível reverificar os títulos após um conflito de gravação.',
        },
      };
    }

    if (restantes.length === 0) {
      return { gravados, duplicatasDeCorrida: lote.length - gravados };
    }

    // "Travou" = conflitou mas nada apareceu como existente. Repetir a mesma
    // requisição não mudaria nada; deixa a conciliação dizer o que houve.
    const travou = restantes.length === pendentes.length;
    if (travou || tentativa >= MAX_TENTATIVAS_CONFLITO) {
      return conciliar(lote, gravados, r.mensagem, portas);
    }
    pendentes = restantes;
  }
}
