import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { gravar, lerPaginado } from '@/lib/supabase-io';
import {
  validarLinhaRecebida,
  clientesParaUpsert,
  planejarImportacao,
  emLotes,
  type LinhaImportacao,
  type TituloExistente,
  type TituloParaInserir,
} from '@/lib/csv-import';

const MAX_LINHAS = 20_000;

// Lotes. Os dois primeiros limites são de tamanho de corpo/URL, não de banco:
// os ids de cliente do filtro `.in(...)` viajam na query string, então um lote
// grande demais estoura o limite de URL do PostgREST/Cloudflare antes de
// chegar ao Postgres.
const LOTE_UPSERT_CLIENTES = 500;
const LOTE_IDS_EM_FILTRO = 100;
const LOTE_INSERT_TITULOS = 500;

// ---------------------------------------------------------------------------
// Confirma uma importação já revisada em /api/upload-csv (prévia). Recebe as
// linhas que o BROWSER devolveu da prévia — ou seja, dado que não é confiável
// por si só: um POST autenticado montado manualmente (fora da UI) poderia
// tentar gravar qualquer coisa nesse body. Por isso cada linha é revalidada
// estruturalmente aqui (validarLinhaRecebida), com as mesmas regras de forma
// e faixa da prévia — não apenas "é um array não vazio" (ver ARCHITECTURE.md
// §9).
//
// Também refaz a checagem de duplicata por segurança — dado pode ter mudado
// entre a prévia e a confirmação (ex: usuário deixou a prévia aberta e
// importou de outro jeito enquanto isso).
//
// GRAVAÇÃO EM LOTE: antes esta rota fazia 3 idas ao banco por linha (upsert
// cliente → consulta duplicata → insert título). 90 linhas custavam 270
// requisições e ~67s, crescendo linearmente; e, quando a rede caía, cada linha
// pagava um stall de DNS inteiro, o que transformou uma queda de ~10s em 78s de
// espera e num relatório que culpava as linhas do CSV. Agora o trabalho é
// sempre o mesmo punhado de requisições em lote, e a decisão de quem inserir
// acontece em memória (lib/csv-import.ts::planejarImportacao), onde os testes
// alcançam.
// ---------------------------------------------------------------------------

type Resultado = 'completo' | 'parcial' | 'indisponivel';

interface Relatorio {
  resultado: Resultado;
  count: number;
  duplicatas: number;
  naoGravadas: number;
  errors: string[];
  message: string;
}

function montarMensagem(r: Omit<Relatorio, 'message'>): string {
  if (r.resultado === 'indisponivel') {
    return r.count > 0
      ? `Conexão perdida durante a importação. ${r.count} título(s) chegaram a ser gravados; ` +
        `${r.naoGravadas} não. Reimportar o mesmo arquivo é seguro — o que já entrou será ` +
        `reconhecido como duplicata.`
      : 'Não foi possível gravar: o banco de dados não respondeu. Nenhum título foi importado. ' +
        'Reimportar o mesmo arquivo é seguro.';
  }
  return (
    `${r.count} título(s) importado(s)` +
    (r.duplicatas > 0 ? ` · ${r.duplicatas} duplicata(s) ignorada(s)` : '') +
    (r.errors.length > 0 ? ` · ${r.errors.length} erro(s)` : '')
  );
}

function responder(parcial: Omit<Relatorio, 'message'>): NextResponse {
  const relatorio: Relatorio = { ...parcial, message: montarMensagem(parcial) };
  // 503 só quando a operação não pôde ser concluída por indisponibilidade da
  // dependência. Rejeição de linha por dado ruim continua sendo 200 com
  // relatório — a operação aconteceu, alguns itens é que foram recusados, e
  // isso é resposta legítima de um import em lote.
  const status = relatorio.resultado === 'indisponivel' ? 503 : 200;
  return NextResponse.json(
    relatorio.resultado === 'indisponivel'
      ? { ...relatorio, error: relatorio.message }
      : relatorio,
    { status },
  );
}

/** Grava um lote de títulos. O `insert` do Postgres é atômico: ou entra tudo, ou nada. */
function inserirTitulos(lote: TituloParaInserir[]) {
  return gravar<null>(
    (sinal) =>
      supabase
        .from('titulos')
        .insert(
          lote.map((t) => ({
            cliente_id: t.cliente_id,
            valor: t.valor,
            data_vencimento: t.data_vencimento,
            status: 'aberto',
          })),
        )
        .abortSignal(sinal),
    `insert de ${lote.length} título(s)`,
  );
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const linhasRecebidas = body?.linhas;

  if (!linhasRecebidas || !Array.isArray(linhasRecebidas) || linhasRecebidas.length === 0) {
    return NextResponse.json({ error: 'Nenhuma linha para importar.' }, { status: 400 });
  }

  if (linhasRecebidas.length > MAX_LINHAS) {
    return NextResponse.json(
      { error: `Excede o limite de ${MAX_LINHAS} linhas por importação.` },
      { status: 400 },
    );
  }

  const linhas: LinhaImportacao[] = [];
  const rejeicoes: string[] = [];
  for (const raw of linhasRecebidas) {
    const validada = validarLinhaRecebida(raw);
    if (validada.ok) {
      linhas.push(validada.linha);
    } else {
      // A prévia aplica exatamente esta mesma validação antes de contar a linha
      // como "pronta pra importar", então chegar aqui significa que o payload
      // não veio da prévia. Reportar o motivo, não só o número.
      const numero = typeof raw?.linha === 'number' ? `Linha ${raw.linha}` : 'Linha desconhecida';
      rejeicoes.push(`${numero}: ${validada.motivo}`);
    }
  }

  if (linhas.length === 0) {
    return NextResponse.json(
      {
        error:
          'Nenhuma linha passou na revalidação — os dados recebidos não têm o formato esperado.\n\n' +
          rejeicoes.join('\n'),
      },
      { status: 400 },
    );
  }

  const errors: string[] = [...rejeicoes];

  // ---- Passo 1: garantir os clientes (um upsert por lote, não por linha) ----
  const clientes = clientesParaUpsert(linhas);
  const clienteIdPorTelefone = new Map<string, string>();

  for (const lote of emLotes(clientes, LOTE_UPSERT_CLIENTES)) {
    const r = await gravar<{ id: string; telefone: string }[]>(
      (sinal) =>
        supabase
          .from('clientes')
          .upsert(lote, { onConflict: 'telefone' })
          .select('id, telefone')
          .abortSignal(sinal),
      `upsert de ${lote.length} cliente(s)`,
    );

    if (!r.ok) {
      // Sem os clientes não há como associar título nenhum deste lote. Parar
      // aqui é melhor do que seguir gravando pela metade: nada foi escrito
      // ainda em `titulos`, então o banco continua consistente.
      errors.push(`Erro ao salvar clientes — ${r.mensagem}`);
      return responder({
        resultado: r.indisponivel ? 'indisponivel' : 'parcial',
        count: 0,
        duplicatas: 0,
        naoGravadas: linhas.length,
        errors,
      });
    }

    for (const c of r.data ?? []) clienteIdPorTelefone.set(c.telefone, c.id);
  }

  // ---- Passo 2: títulos em aberto que já existem para esses clientes ----
  // Uma leitura por lote de ids, paginada. Se esta consulta falhar não dá para
  // decidir duplicata com segurança, e inserir "no escuro" criaria títulos
  // repetidos — dado financeiro duplicado. Por isso ela aborta a importação.
  const ids = [...clienteIdPorTelefone.values()];
  const titulosExistentes: TituloExistente[] = [];

  try {
    for (const loteIds of emLotes(ids, LOTE_IDS_EM_FILTRO)) {
      const pagina = await lerPaginado<TituloExistente>(
        (sinal, de, ate) =>
          supabase
            .from('titulos')
            .select('cliente_id, valor, data_vencimento')
            .in('cliente_id', loteIds)
            .eq('status', 'aberto')
            .range(de, ate)
            .abortSignal(sinal),
        'consulta de títulos já existentes',
      );
      titulosExistentes.push(...pagina);
    }
  } catch {
    errors.push(
      'Não foi possível verificar quais títulos já existem. A importação foi interrompida ' +
      'para não criar cobranças duplicadas.',
    );
    return responder({
      resultado: 'indisponivel',
      count: 0,
      duplicatas: 0,
      naoGravadas: linhas.length,
      errors,
    });
  }

  // ---- Passo 3: decidir em memória (inclui duplicata dentro do arquivo) ----
  const plano = planejarImportacao(linhas, clienteIdPorTelefone, titulosExistentes);

  for (const l of plano.semCliente) {
    errors.push(`Linha ${l.linha}: cliente não pôde ser identificado após a gravação.`);
  }

  // ---- Passo 4: inserir os títulos em lote ----
  let count = 0;
  let indisponivel = false;

  for (const lote of emLotes(plano.aInserir, LOTE_INSERT_TITULOS)) {
    const r = await inserirTitulos(lote);

    if (r.ok) {
      count += lote.length;
      continue;
    }

    if (r.indisponivel) {
      // Dependência fora: os próximos lotes falhariam igual, só que mais
      // devagar. Era exatamente isso que fazia a importação levar 78s e
      // devolver um erro por linha, como se o CSV estivesse errado.
      errors.push(
        `Linhas ${lote[0].linha}–${lote[lote.length - 1].linha}: ` +
        `${lote.length} título(s) não gravados — ${r.mensagem}`,
      );
      indisponivel = true;
      break;
    }

    // Erro do BANCO (não da rede): o `insert` é atômico por lote, então uma
    // única linha problemática derruba as outras 499 junto. Reinserir o lote
    // linha a linha custa caro, mas só acontece nesse caminho raro — e evita
    // que um dado ruim leve consigo um monte de dado bom, que era o
    // comportamento do loop original.
    for (const t of lote) {
      const individual = await inserirTitulos([t]);
      if (individual.ok) {
        count++;
      } else if (individual.indisponivel) {
        errors.push(`Linha ${t.linha}: não gravada — ${individual.mensagem}`);
        indisponivel = true;
        break;
      } else {
        errors.push(`Linha ${t.linha}: não gravada — ${individual.mensagem}`);
      }
    }
    if (indisponivel) break;
  }

  const naoGravadas = plano.aInserir.length - count;

  return responder({
    resultado: indisponivel ? 'indisponivel' : errors.length > 0 ? 'parcial' : 'completo',
    count,
    duplicatas: plano.duplicatas,
    naoGravadas,
    errors,
  });
}
