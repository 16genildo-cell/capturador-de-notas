import crypto from 'node:crypto';
import { env } from '../../config/env.js';

/**
 * Cofre baseado em AES-256-GCM para guardar segredos (certificado .pfx e senhas)
 * criptografados no banco.
 *
 * Recursos de segurança:
 *  - Suporte a versionamento de chave (prefixo v1:...).
 *  - Suporte a rotação de chave (fallback para CERT_ENCRYPTION_KEY_OLD).
 *  - Sanitização de erros para impedir vazamento de buffers ou senhas em stack traces.
 */

function parseKey(hex, nomeVariavel = 'CERT_ENCRYPTION_KEY') {
  if (!hex || hex.length !== 64) {
    throw new Error(
      `${nomeVariavel} invalida. Defina 32 bytes em hex (64 caracteres) no .env. ` +
        'Gere com: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }
  return Buffer.from(hex, 'hex');
}

export function getKey(chaveCustomizadaHex) {
  if (chaveCustomizadaHex) return parseKey(chaveCustomizadaHex, 'chave customizada');
  return parseKey(env.certEncryptionKey, 'CERT_ENCRYPTION_KEY');
}

export function getOldKey() {
  const hex = env.certEncryptionKeyOld;
  if (hex && hex.length === 64) {
    return Buffer.from(hex, 'hex');
  }
  return null;
}

/** Criptografa um Buffer ou string com AES-256-GCM. Retorna string formatada "v1:<base64>". */
export function encrypt(input, { keyHex, versao = 'v1' } = {}) {
  const key = getKey(keyHex);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'utf8');
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payloadB64 = Buffer.concat([iv, tag, encrypted]).toString('base64');
  return versao ? `${versao}:${payloadB64}` : payloadB64;
}

function decodificarComChave(raw, key) {
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const data = raw.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

/**
 * Descriptografa e retorna um Buffer.
 * Suporta formatos com versão ("v1:<b64>") e legados ("<b64>").
 * Se a chave primária falhar e CERT_ENCRYPTION_KEY_OLD estiver configurada, tenta com a chave antiga.
 */
export function decryptBuffer(payload, { keyHex, permitirChaveAntiga = true } = {}) {
  const texto = String(payload || '').trim();
  // Se contiver prefixo de versão (ex.: "v1:..."), remove o prefixo para obter o base64
  const payloadBase64 = texto.includes(':') ? texto.split(':').slice(1).join(':') : texto;
  const raw = Buffer.from(payloadBase64, 'base64');

  if (raw.length < 28) {
    throw new Error('Payload criptografado inválido ou corrompido (tamanho insuficiente).');
  }

  const chavePrimaria = getKey(keyHex);
  try {
    return decodificarComChave(raw, chavePrimaria);
  } catch (errPrimaria) {
    // Se falhar e a rotação de chave estiver ativa, tenta com a chave antiga
    if (permitirChaveAntiga && !keyHex) {
      const chaveAntiga = getOldKey();
      if (chaveAntiga) {
        try {
          return decodificarComChave(raw, chaveAntiga);
        } catch {
          // continua para o erro consolidado
        }
      }
    }
    throw new Error(
      'Falha de autenticação ao descriptografar dado sensível: o certificado foi gravado com outra CERT_ENCRYPTION_KEY ou foi corrompido.',
    );
  }
}

/** Descriptografa e retorna uma string utf8. */
export function decryptString(payload, options) {
  return decryptBuffer(payload, options).toString('utf8');
}

/**
 * Re-criptografa um payload da chave antiga para a chave nova (para scripts de rotação).
 */
export function recriptografar(payload, chaveAntigaHex, chaveNovaHex) {
  const dados = decryptBuffer(payload, { keyHex: chaveAntigaHex, permitirChaveAntiga: false });
  return encrypt(dados, { keyHex: chaveNovaHex, versao: 'v1' });
}
