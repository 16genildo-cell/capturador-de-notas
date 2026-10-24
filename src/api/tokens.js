import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { SessaoApi } from '../models/SessaoApi.js';

/**
 * Tokens da API:
 *  - acesso: JWT (HS256) curto, enviado em "Authorization: Bearer <token>";
 *  - renovacao: aleatorio, longo, guardado com hash no banco e trocado a cada uso.
 */
const ACESSO_MIN = 15;
const RENOVACAO_DIAS = 30;

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const assinar = (dados) => crypto.createHmac('sha256', env.jwtSecret).update(dados).digest('base64url');
const hash = (t) => crypto.createHash('sha256').update(t).digest('hex');

export function gerarTokenAcesso(user) {
  const agora = Math.floor(Date.now() / 1000);
  const cab = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const corpo = b64url(JSON.stringify({ sub: String(user._id), iat: agora, exp: agora + ACESSO_MIN * 60 }));
  return `${cab}.${corpo}.${assinar(`${cab}.${corpo}`)}`;
}

/** Valida o token de acesso; retorna o id do usuario ou null. */
export function lerTokenAcesso(token) {
  const partes = String(token || '').split('.');
  if (partes.length !== 3) return null;
  const esperado = Buffer.from(assinar(`${partes[0]}.${partes[1]}`));
  const recebido = Buffer.from(partes[2]);
  if (esperado.length !== recebido.length || !crypto.timingSafeEqual(esperado, recebido)) return null;
  try {
    const corpo = JSON.parse(Buffer.from(partes[1], 'base64url').toString('utf8'));
    if (!corpo.exp || corpo.exp * 1000 < Date.now()) return null;
    return corpo.sub;
  } catch {
    return null;
  }
}

/** Cria a sessao e devolve o par de tokens. */
export async function abrirSessao(user, { cliente, ip } = {}) {
  const refresh = crypto.randomBytes(48).toString('base64url');
  await SessaoApi.create({
    user: user._id,
    refreshHash: hash(refresh),
    expiraEm: new Date(Date.now() + RENOVACAO_DIAS * 864e5),
    cliente: String(cliente || 'web').slice(0, 20),
    ip,
  });
  return { accessToken: gerarTokenAcesso(user), refreshToken: refresh, expiraEmSegundos: ACESSO_MIN * 60 };
}

/** Troca o token de renovacao por um novo par. Retorna null se invalido/expirado. */
export async function renovarSessao(refresh, ip) {
  if (!refresh) return null;
  const novo = crypto.randomBytes(48).toString('base64url');
  const s = await SessaoApi.findOneAndUpdate(
    { refreshHash: hash(String(refresh)), expiraEm: { $gt: new Date() } },
    { refreshHash: hash(novo), ultimoUso: new Date(), ip, expiraEm: new Date(Date.now() + RENOVACAO_DIAS * 864e5) },
    { new: true },
  );
  if (!s) return null;
  return { userId: s.user, refreshToken: novo };
}

export async function encerrarSessao(refresh) {
  if (refresh) await SessaoApi.deleteOne({ refreshHash: hash(String(refresh)) });
}

/** Ao trocar/redefinir a senha: derruba todas as sessoes do usuario. */
export async function encerrarTodas(userId) {
  await SessaoApi.deleteMany({ user: userId });
}
