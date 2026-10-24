/**
 * Protecoes basicas de seguranca HTTP.
 *  - Cabecalhos de seguranca (anti-clickjacking, anti-sniffing...).
 *  - Protecao CSRF por verificacao de origem: todo POST precisa vir de uma
 *    pagina do proprio sistema (cabecalho Origin ou Referer com o mesmo host).
 *    Junto com o cookie de sessao SameSite=Lax, impede que outro site envie
 *    acoes em nome de quem esta logado.
 */
export function cabecalhosSeguranca(req, res, next) {
  res.set('X-Frame-Options', 'DENY');
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'same-origin');
  res.set('Cross-Origin-Opener-Policy', 'same-origin');
  next();
}

const METODOS_SEGUROS = new Set(['GET', 'HEAD', 'OPTIONS']);

function hostDe(url) {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

export function protecaoCsrf(req, res, next) {
  if (METODOS_SEGUROS.has(req.method)) return next();
  // Webhooks (ex.: Asaas) vem de fora e sao autenticados pelo proprio token.
  // A API usa token no cabecalho Authorization (nao cookie), entao nao sofre CSRF.
  const caminho = String(req.path || req.originalUrl || '');
  if (caminho.startsWith('/webhooks/') || caminho.startsWith('/api/')) return next();
  const esperado = String(req.get('host') || '').toLowerCase();
  const origem = req.get('origin');
  const referer = req.get('referer');
  const host = origem && origem !== 'null' ? hostDe(origem) : referer ? hostDe(referer) : null;
  if (host && host === esperado) return next();
  console.warn(`[seguranca] POST bloqueado (origem "${origem || referer || 'ausente'}") em ${req.originalUrl}`);
  res.status(403).send('Requisicao bloqueada: origem inválida. Recarregue a página e tente novamente.');
}

/**
 * Limite de tentativas de login: 5 falhas seguidas por IP + e-mail bloqueiam
 * novas tentativas por 15 minutos.
 */
const tentativas = new Map();
const MAX_FALHAS = 5;
const BLOQUEIO_MS = 15 * 60 * 1000;

function chave(req, email) {
  return `${req.ip}|${String(email || '').toLowerCase().trim()}`;
}

export function loginBloqueado(req, email) {
  const t = tentativas.get(chave(req, email));
  if (!t || !t.ate) return 0;
  const resta = t.ate - Date.now();
  if (resta <= 0) {
    tentativas.delete(chave(req, email));
    return 0;
  }
  return Math.ceil(resta / 60000);
}

export function registrarFalhaLogin(req, email) {
  const k = chave(req, email);
  const t = tentativas.get(k) || { falhas: 0, ate: 0 };
  t.falhas += 1;
  if (t.falhas >= MAX_FALHAS) {
    t.ate = Date.now() + BLOQUEIO_MS;
    t.falhas = 0;
  }
  tentativas.set(k, t);
}

export function limparFalhasLogin(req, email) {
  tentativas.delete(chave(req, email));
}

/**
 * Limite generico por chave (ex.: cadastros por IP, pedidos de nova senha).
 * Retorna true se a acao ainda e permitida e ja conta a tentativa.
 */
const contadores = new Map();
export function dentroDoLimite(chaveLimite, max, janelaMs) {
  const agora = Date.now();
  const c = contadores.get(chaveLimite);
  if (!c || c.inicio + janelaMs < agora) {
    contadores.set(chaveLimite, { inicio: agora, n: 1 });
    return true;
  }
  c.n += 1;
  return c.n <= max;
}
