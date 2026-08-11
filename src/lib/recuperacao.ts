import { supabase } from './supabase';
import { lerPaginado, SupabaseIndisponivelError } from './supabase-io';

// ---------------------------------------------------------------------------
// Apuração de receita recuperada — a métrica que a tese do Atlas diz importar
// mais que qualquer funcionalidade, e que até aqui o produto não conseguia
// responder.
//
// Fonte de verdade: `titulos.resolvido_em`, preenchido por
// actions/index.ts::atualizarStatusTitulo no momento em que o título vira
// 'pago'. Não usamos `interacoes.data_envio` para isso: ela marca quando a
// mensagem foi ENVIADA, não quando o pagamento foi confirmado — atribuir a
// recuperação à data do envio produziria um número errado.
//
// A parte pura (somarRecuperado) é o que os testes cobrem; a query é fina de
// propósito. Este módulo é a fonte única para a home e para /api/dados.
// ---------------------------------------------------------------------------

export const JANELA_RECUPERACAO_DIAS = 30;

export interface TituloRecuperavel {
  valor: number;
  resolvido_em: string | null;
}

/** Instante a partir do qual um pagamento conta para a janela de apuração. */
export function inicioJanelaRecuperacao(
  dias: number = JANELA_RECUPERACAO_DIAS,
  agora: Date = new Date(),
): Date {
  const inicio = new Date(agora);
  inicio.setDate(inicio.getDate() - dias);
  inicio.setHours(0, 0, 0, 0);
  return inicio;
}

/**
 * Soma o valor dos títulos pagos dentro da janela.
 *
 * Compara como Date, não como string: o Postgres devolve timestamptz num
 * formato (`...+00:00`) diferente do `toISOString()` do JS (`...Z`), e
 * comparação lexicográfica entre os dois erra em casos de borda.
 *
 * Títulos pagos antes desta funcionalidade existir têm `resolvido_em` nulo e
 * ficam de fora — inventar uma data retroativa produziria um número falso.
 */
export function somarRecuperado(
  titulos: TituloRecuperavel[],
  dias: number = JANELA_RECUPERACAO_DIAS,
  agora: Date = new Date(),
): number {
  const inicio = inicioJanelaRecuperacao(dias, agora).getTime();

  return titulos.reduce((soma, titulo) => {
    if (!titulo.resolvido_em) return soma;
    const quando = new Date(titulo.resolvido_em).getTime();
    if (Number.isNaN(quando) || quando < inicio) return soma;
    return soma + Number(titulo.valor);
  }, 0);
}

/**
 * Quanto foi recuperado na janela. Usado pela home e por /api/dados.
 *
 * Duas falhas diferentes, dois comportamentos diferentes — a distinção importa:
 *
 * - **O banco respondeu com erro** (tipicamente: a coluna `resolvido_em` não
 *   existe porque a migration ainda não rodou). Devolve `null`, e quem exibe
 *   mostra "—". Zero seria uma afirmação sobre dinheiro: dizer "você não
 *   recuperou nada" quando a leitura quebrou é pior do que admitir que o número
 *   não está disponível.
 * - **Não conseguimos falar com o banco** (rede fora, timeout). Aí `null` seria
 *   igualmente enganoso, porque não é uma limitação conhecida do schema — é
 *   ausência de informação sobre TODO o resto também. Propaga a exceção para
 *   que a rota inteira responda "indisponível" em vez de exibir uma tela cheia
 *   de números que não conferem.
 */
export async function totalRecuperado(
  dias: number = JANELA_RECUPERACAO_DIAS,
): Promise<number | null> {
  const desde = inicioJanelaRecuperacao(dias).toISOString();

  try {
    const linhas = await lerPaginado<TituloRecuperavel>(
      (sinal, de, ate) =>
        supabase
          .from('titulos')
          .select('valor, resolvido_em')
          .eq('status', 'pago')
          .gte('resolvido_em', desde)
          .range(de, ate)
          .abortSignal(sinal),
      'apuração de receita recuperada',
    );

    // O filtro já veio do banco; somarRecuperado reaplica a janela porque é ele
    // que os testes cobrem — a função continua correta mesmo com linhas a mais.
    return somarRecuperado(linhas, dias);
  } catch (e) {
    if (e instanceof SupabaseIndisponivelError && !e.indisponivel) {
      console.error(
        '[recuperacao] falha ao apurar receita recuperada — a coluna resolvido_em existe? ' +
        'Rode supabase/migration-01-ciclo-operacional.sql.',
        e.detalhe,
      );
      return null;
    }
    throw e;
  }
}
