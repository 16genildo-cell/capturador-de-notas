import mongoose from 'mongoose';
import { RateLimitRegistro } from '../models/RateLimitRegistro.js';

/**
 * Proteções de segurança HTTP:
 *  - Cabeçalhos de segurança (CSP, HSTS, anti-clickjacking, anti-sniffing, Permissions-Policy).
 *  - Proteção CSRF por verificação de origem nos POSTs de sessão.
 *  - Sanitização contra NoSQL Injection (remove chaves com '$' e '.').
 *  - Rate limiting persistente (MongoDB com TTL) + cache em memória para força bruta e DoS.
 */

const CSP_POLICIES = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' ws: wss: https:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

export function cabecalhosSeguranca(req, res, next) {
  res.set('Content-Security-Policy', CSP_POLICIES);
  res.set('X-Frame-Options', 'DENY');
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'same-origin');
  res.set('Cross-Origin-Opener-Policy', 'same-origin');
  res.set('X-XSS-Protection', '0');
  res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  // HSTS em conexões HTTPS ou ambiente de produção
  const isHttps = req.secure || req.get('x-forwarded-proto') === 'https' || process.env.NODE_ENV === 'production';
  if (isHttps) {
    res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }

  next();
}

/**
 * Remove chaves que comecem com '$' ou contenham '.' de req.body, req.query e req.params,
 * prevenindo ataques de NoSQL Injection em consultas do Mongoose/MongoDB.
 */
export function sanitizarNoSql(req, res, next) {
  const limpar = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) {
      for (const item of obj) limpar(item);
      return;
    }
    for (const k of Object.keys(obj)) {
      if (k.startsWith('$') || k.includes('.')) {
        delete obj[k];
      } else {
        limpar(obj[k]);
      }
    }
  };

  limpar(req.body);
  limpar(req.query);
  limpar(req.params);
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
  // Webhooks (ex.: Asaas) vêm de fora e são autenticados pelo próprio token.
  // A API usa token no cabeçalho Authorization (não cookie), então não sofre CSRF.
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
 * Utiliza cache em memória + persistência no MongoDB via RateLimitRegistro (com TTL).
 */
const tentativas = new Map();
const MAX_FALHAS = 5;
const BLOQUEIO_MS = 15 * 60 * 1000;

export function chave(req, email) {
  return `${req?.ip || '127.0.0.1'}|${String(email || '').toLowerCase().trim()}`;
}

/** Verificação síncrona (cache L1 em memória para rapidez e testes unitários). */
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

/**
 * Verificação assíncrona persistente:
 * Consulta a memória e o banco de dados (RateLimitRegistro) para resistir a
 * reinicializações e balanceamento de carga entre instâncias.
 */
export async function loginBloqueadoAsync(req, email) {
  const memMin = loginBloqueado(req, email);
  if (memMin > 0) return memMin;

  if (mongoose.connection && mongoose.connection.readyState === 1) {
    try {
      const reg = await RateLimitRegistro.findById(`login:${chave(req, email)}`);
      if (reg && reg.bloqueadoAte) {
        const resta = reg.bloqueadoAte.getTime() - Date.now();
        if (resta > 0) {
          // Sincroniza de volta para a memória
          tentativas.set(chave(req, email), { falhas: reg.contagem, ate: reg.bloqueadoAte.getTime() });
          return Math.ceil(resta / 60000);
        }
      }
    } catch {
      // Falha de banco não interrompe o fluxo (fallback na memória)
    }
  }

  return 0;
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

  // Persiste no MongoDB de forma assíncrona se o banco estiver conectado
  if (mongoose.connection && mongoose.connection.readyState === 1) {
    const bloqueadoAte = t.ate ? new Date(t.ate) : null;
    const expiraEm = new Date(Date.now() + (t.ate ? BLOQUEIO_MS : 30 * 60 * 1000));
    RateLimitRegistro.findOneAndUpdate(
      { _id: `login:${k}` },
      {
        $inc: { contagem: 1 },
        $set: { bloqueadoAte, expiraEm },
      },
      { upsert: true }
    ).catch(() => {});
  }
}

export function limparFalhasLogin(req, email) {
  const k = chave(req, email);
  tentativas.delete(k);

  if (mongoose.connection && mongoose.connection.readyState === 1) {
    RateLimitRegistro.deleteOne({ _id: `login:${k}` }).catch(() => {});
  }
}

/**
 * Limite genérico por chave em memória (ex.: cadastros por IP, pedidos de nova senha).
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

/**
 * Middleware de Rate Limiter flexível com suporte a MongoDB TTL e cabeçalho Retry-After.
 */
export function rateLimiter({
  janelaMs = 60 * 1000,
  max = 60,
  prefixo = 'api',
  mensagem = 'Muitas requisições. Tente novamente mais tarde.',
} = {}) {
  return async (req, res, next) => {
    const ip = req.ip || req.connection?.remoteAddress || '127.0.0.1';
    const chaveMem = `${prefixo}|${ip}`;
    const agora = Date.now();

    // 1) Checagem em memória L1
    let c = contadores.get(chaveMem);
    if (!c || c.inicio + janelaMs < agora) {
      c = { inicio: agora, n: 1 };
      contadores.set(chaveMem, c);
    } else {
      c.n += 1;
    }

    if (c.n > max) {
      const retryAfter = Math.ceil((c.inicio + janelaMs - agora) / 1000);
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({ erro: mensagem, retryAfter });
    }

    // 2) Se conectado ao MongoDB, sincroniza com RateLimitRegistro
    if (mongoose.connection && mongoose.connection.readyState === 1) {
      try {
        const id = `rate:${chaveMem}`;
        const expiraEm = new Date(agora + janelaMs);
        const doc = await RateLimitRegistro.findOneAndUpdate(
          { _id: id },
          { $inc: { contagem: 1 }, $setOnInsert: { expiraEm } },
          { upsert: true, new: true }
        );
        if (doc && doc.contagem > max) {
          const retryAfter = Math.max(1, Math.ceil((doc.expiraEm.getTime() - agora) / 1000));
          res.set('Retry-After', String(retryAfter));
          return res.status(429).json({ erro: mensagem, retryAfter });
        }
      } catch {
        // Fallback na contagem de memória
      }
    }

    next();
  };
}
