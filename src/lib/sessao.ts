import { createHmac, createHash, timingSafeEqual } from 'crypto';

// ---------------------------------------------------------------------------
// Valor do cookie de sessão — assinado, com expiração verificada no servidor.
//
// O bug que motivou este módulo: o cookie era a string literal `1`, e o gate de
// autenticação (src/proxy.ts) aceitava qualquer requisição que a trouxesse:
//
//     const isAuthenticated = request.cookies.get('atlas_auth')?.value === '1';
//
// Ou seja, `curl -H 'Cookie: atlas_auth=1'` entrava sem nunca ver a senha —
// incluindo em GET /api/dados (nome, telefone e valores de todos os clientes) e
// DELETE /api/dados?modo=tudo. A comparação constant-time da senha e o rate
// limiting do login protegiam uma porta que ninguém precisava atravessar.
//
// Cookie é dado do cliente: ele escolhe o que mandar. A única forma de confiar
// num cookie é o servidor conseguir provar que foi ele quem o emitiu — daí o
// HMAC. E a expiração precisa estar DENTRO do valor assinado, porque o `maxAge`
// do cookie é só uma instrução ao navegador: quem monta a requisição à mão
// simplesmente não a obedece.
//
// POR QUE A CHAVE VEM DE APP_PASSWORD, E NÃO DE UMA VARIÁVEL NOVA
// Uma env var nova e obrigatória quebraria todo deploy existente e toda
// instalação limpa que não a definisse — e o modo de falha seria "ninguém
// consegue logar". APP_PASSWORD já é obrigatória (src/proxy.ts falha fechado
// sem ela em produção), já é secreta, e já é exatamente o segredo que separa
// quem pode entrar de quem não pode. Derivar dela não perde nada: alguém capaz
// de adivinhá-la para forjar um cookie poderia apenas fazer login.
//
// Efeito colateral deliberado e desejável: trocar APP_PASSWORD invalida todas as
// sessões em curso. Antes, trocar a senha não desconectava ninguém.
// ---------------------------------------------------------------------------

/**
 * Nome do cookie de sessão. Um lugar só: quem grava (api/login), quem valida
 * (proxy.ts, actions) e quem apaga (api/logout) precisam concordar, e um nome
 * divergente na saída deixaria a sessão viva com o botão dizendo que saiu.
 */
export const COOKIE_SESSAO = 'atlas_auth';

/** Quanto tempo uma sessão vale. Espelha o `maxAge` do cookie em api/login. */
export const DURACAO_SESSAO_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

/**
 * Prefixo de versão do formato. Existe para que um dia trocar o algoritmo não
 * exija adivinhar como interpretar os cookies já emitidos: valor com versão
 * desconhecida é simplesmente inválido, e a pessoa loga de novo.
 */
const VERSAO = 'v1';

/**
 * Contexto de derivação da chave. Separa "a senha do app" de "a chave que assina
 * sessões", para que o HMAC nunca use a senha crua — se o valor do cookie algum
 * dia vazasse junto de um oráculo, o que estaria em jogo seria a chave derivada,
 * não a senha que o usuário digita.
 */
const CONTEXTO_CHAVE = 'atlas-sessao-v1';

function chaveDeAssinatura(segredo: string): Buffer {
  return createHash('sha256').update(`${CONTEXTO_CHAVE}:${segredo}`).digest();
}

function assinar(segredo: string, carga: string): string {
  return createHmac('sha256', chaveDeAssinatura(segredo)).update(carga).digest('base64url');
}

/**
 * Cria o valor do cookie para uma sessão que começa agora.
 *
 * Formato: `v1.<expiraEmMs>.<assinatura>` — a expiração viaja em claro (não é
 * segredo) mas entra na carga assinada, então adiantar o relógio do cookie
 * invalida a assinatura em vez de estender a sessão.
 */
export function criarValorDeSessao(
  segredo: string,
  agora: number = Date.now(),
  duracaoMs: number = DURACAO_SESSAO_MS,
): string {
  const expiraEm = agora + duracaoMs;
  const carga = `${VERSAO}.${expiraEm}`;
  return `${carga}.${assinar(segredo, carga)}`;
}

/** Comparação em tempo constante que não vaza o tamanho pelo caminho rápido. */
function assinaturaConfere(esperada: string, recebida: string): boolean {
  const bufEsperada = Buffer.from(esperada, 'utf8');
  const bufRecebida = Buffer.from(recebida, 'utf8');

  if (bufRecebida.length !== bufEsperada.length) {
    // Mesmo custo do caminho que compara de verdade — não retorna de imediato.
    timingSafeEqual(bufRecebida, Buffer.alloc(bufRecebida.length));
    return false;
  }

  return timingSafeEqual(bufRecebida, bufEsperada);
}

/**
 * O valor recebido é uma sessão que ESTE servidor emitiu e que ainda vale?
 *
 * Recusa por qualquer motivo devolvem `false` sem distinção: o cliente não
 * precisa saber se o cookie estava expirado, malformado ou forjado, e dizer isso
 * só ajudaria quem está tentando descobrir o formato.
 *
 * `segredo` vazio devolve `false` sempre — sem APP_PASSWORD não existe sessão
 * válida possível. Quem decide o que fazer nesse caso é src/proxy.ts, que em
 * produção recusa a requisição inteira antes de chegar aqui.
 */
export function sessaoValida(
  segredo: string,
  valor: string | undefined | null,
  agora: number = Date.now(),
): boolean {
  if (!segredo || !valor) return false;

  const partes = valor.split('.');
  if (partes.length !== 3) return false;

  const [versao, expiraEmTexto, assinaturaRecebida] = partes;
  if (versao !== VERSAO) return false;

  // Number() em vez de parseInt: parseInt("30dias") devolveria 30 em vez de NaN,
  // aceitando um valor que não é o que assinamos.
  const expiraEm = Number(expiraEmTexto);
  if (!Number.isSafeInteger(expiraEm)) return false;

  // Expiração é checada ANTES da assinatura só por economia; as duas precisam
  // passar, e a ordem não vaza nada útil — a expiração viaja em claro.
  if (agora >= expiraEm) return false;

  return assinaturaConfere(assinar(segredo, `${versao}.${expiraEm}`), assinaturaRecebida);
}
