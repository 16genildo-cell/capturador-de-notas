import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { Dispositivo } from '../models/Dispositivo.js';
import { User } from '../models/User.js';

/**
 * Notificacoes push pelo Firebase Cloud Messaging (API HTTP v1), sem dependencias:
 * assina um JWT com a conta de servico, troca por um token OAuth e envia.
 * Configure FIREBASE_SERVICE_ACCOUNT com o JSON da conta de servico (uma linha).
 */
let credencial = null;
let tokenOauth = { valor: null, expira: 0 };

function conta() {
  if (credencial === null) {
    try {
      credencial = env.firebaseServiceAccount ? JSON.parse(env.firebaseServiceAccount) : false;
    } catch {
      console.error('[push] FIREBASE_SERVICE_ACCOUNT não é um JSON válido.');
      credencial = false;
    }
  }
  return credencial;
}

export function pushConfigurado() {
  return Boolean(conta());
}

async function obterTokenOauth() {
  if (tokenOauth.valor && tokenOauth.expira > Date.now() + 60000) return tokenOauth.valor;
  const c = conta();
  const agora = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const dados = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: c.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: agora,
    exp: agora + 3600,
  })}`;
  const assinatura = crypto.createSign('RSA-SHA256').update(dados).sign(c.private_key, 'base64url');
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${dados}.${assinatura}` }),
  });
  const j = await resp.json();
  if (!resp.ok) throw new Error(`OAuth Google: ${j.error_description || resp.status}`);
  tokenOauth = { valor: j.access_token, expira: Date.now() + j.expires_in * 1000 };
  return tokenOauth.valor;
}

/** Envia uma notificacao para todos os celulares de uma conta. */
export async function enviarPushConta(contaId, { titulo, texto, dados = {} }) {
  if (!pushConfigurado()) return 0;
  // Os avisos sao da conta inteira (todas as empresas): operadores restritos a algumas
  // empresas nao recebem, para nao ver dados de empresas que nao podem acessar.
  const restritos = await User.find({ conta: contaId, $or: [{ role: 'cliente' }, { role: 'operador', todasEmpresas: false }] }).distinct('_id');
  const dispositivos = await Dispositivo.find({ conta: contaId, user: { $nin: restritos } }).lean();
  if (!dispositivos.length) return 0;
  const oauth = await obterTokenOauth();
  let enviados = 0;
  for (const d of dispositivos) {
    const resp = await fetch(`https://fcm.googleapis.com/v1/projects/${conta().project_id}/messages:send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${oauth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          token: d.token,
          notification: { title: titulo, body: texto },
          data: Object.fromEntries(Object.entries(dados).map(([k, v]) => [k, String(v)])),
        },
      }),
    });
    if (resp.ok) enviados += 1;
    else if (resp.status === 404 || resp.status === 400) await Dispositivo.deleteOne({ _id: d._id }); // token antigo
  }
  return enviados;
}
