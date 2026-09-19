// ---------------------------------------------------------------------------
// Limitador de tentativas em memória, por chave (hoje: IP do login).
//
// Vive aqui, e não dentro de `api/login/route.ts`, por um motivo concreto: o
// comportamento que interessa é o que acontece ao longo do TEMPO — a janela
// expirar, a contagem reiniciar, as entradas velhas saírem da memória. Dentro
// da rota isso só seria observável subindo servidor e esperando cinco minutos.
// Aqui o "agora" é parâmetro, e o teste acerta o relógio.
//
// LIMITAÇÃO CONHECIDA, herdada e mantida: o estado é do processo. Não sobrevive
// a restart nem é compartilhado entre instâncias. Serve ao deploy de instância
// única do Atlas hoje; num deploy serverless ou com réplicas, isso precisa
// virar store compartilhado (ex.: uma tabela no próprio Supabase).
// ---------------------------------------------------------------------------

export interface OpcoesLimitador {
  /** Duração da janela de contagem. */
  janelaMs: number;
  /** Quantas tentativas são permitidas dentro da janela. */
  maxTentativas: number;
  /**
   * A partir de quantas chaves vivas o expurgo roda.
   *
   * O expurgo não roda a cada chamada de propósito: varrer o mapa inteiro em
   * todo login seria O(n) por requisição para resolver um problema que, no uso
   * real (um punhado de IPs), não existe.
   */
  maxChavesRastreadas?: number;
}

interface Registro {
  count: number;
  resetAt: number;
}

export const MAX_CHAVES_PADRAO = 10_000;

export interface Limitador {
  /** Conta esta tentativa e diz se a chave estourou o limite. */
  excedeu(chave: string, agora?: number): boolean;
  /** Quantas chaves estão em memória agora — existe para o teste enxergar o expurgo. */
  tamanho(): number;
}

/**
 * Cria um limitador isolado. Cada chamada tem o próprio estado, então dois
 * limitadores não interferem um no outro (e cada teste começa limpo).
 *
 * O que este módulo corrige em relação à versão anterior, que vivia solta na
 * rota de login: **as entradas nunca eram removidas.** Um registro só era
 * sobrescrito se aquele mesmo IP voltasse depois da janela; IPs que aparecem
 * uma vez e somem ficavam para sempre. Num processo de longa duração exposto à
 * internet, isso é crescimento sem teto — devagar, mas sem fim.
 */
export function criarLimitador(opcoes: OpcoesLimitador): Limitador {
  const { janelaMs, maxTentativas, maxChavesRastreadas = MAX_CHAVES_PADRAO } = opcoes;
  const registros = new Map<string, Registro>();

  function expurgar(agora: number): void {
    for (const [chave, reg] of registros) {
      if (agora > reg.resetAt) registros.delete(chave);
    }

    // Ainda acima do teto depois de tirar os expirados significa mais de
    // `maxChavesRastreadas` chaves DISTINTAS dentro de uma única janela — um
    // ataque distribuído, contra o qual um limitador por IP em memória já não
    // protege de qualquer forma. Entre perder a contagem e crescer sem limite,
    // perder a contagem é o dano menor: o pior caso é alguns atacantes
    // ganharem a janela de volta; o outro derruba o processo para todo mundo.
    if (registros.size > maxChavesRastreadas) registros.clear();
  }

  return {
    excedeu(chave: string, agora: number = Date.now()): boolean {
      if (registros.size > maxChavesRastreadas) expurgar(agora);

      const registro = registros.get(chave);

      if (!registro || agora > registro.resetAt) {
        registros.set(chave, { count: 1, resetAt: agora + janelaMs });
        return false;
      }

      registro.count++;
      return registro.count > maxTentativas;
    },

    tamanho: () => registros.size,
  };
}
