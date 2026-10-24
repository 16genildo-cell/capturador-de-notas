import crypto from 'node:crypto';
import { env } from '../../config/env.js';

/**
 * Cofre simples baseado em AES-256-GCM para guardar segredos (certificado .pfx e senhas)
 * criptografados no banco. A chave vem de CERT_ENCRYPTION_KEY (32 bytes em hex).
 */

function getKey() {
  const hex = env.certEncryptionKey;
  if (!hex || hex.length !== 64) {
    throw new Error(
      'CERT_ENCRYPTION_KEY invalida. Defina 32 bytes em hex (64 caracteres) no .env. ' +
        'Gere com: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }
  return Buffer.from(hex, 'hex');
}

/** Criptografa um Buffer ou string. Retorna string base64 com iv+tag+dados. */
export function encrypt(input) {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'utf8');
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

/** Descriptografa e retorna um Buffer. */
export function decryptBuffer(payloadBase64) {
  const key = getKey();
  const raw = Buffer.from(payloadBase64, 'base64');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const data = raw.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

/** Descriptografa e retorna uma string utf8. */
export function decryptString(payloadBase64) {
  return decryptBuffer(payloadBase64).toString('utf8');
}
