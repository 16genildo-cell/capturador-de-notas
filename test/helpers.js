import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import forge from 'node-forge';

process.env.CERT_ENCRYPTION_KEY = process.env.CERT_ENCRYPTION_KEY || 'a'.repeat(64);
process.env.SEFAZ_AMBIENTE = 'producao';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
export const fixture = (nome) => fs.readFileSync(path.join(dir, nome), 'utf8');

/** Gera um .pfx de teste (CN "NOME:DOCUMENTO"), opcionalmente com CA na frente. */
export function gerarPfx(cn, { comCa = false, senha = 's' } = {}) {
  const mk = (subject, issuerCert, issuerKey, ca) => {
    const keys = forge.pki.rsa.generateKeyPair(1024);
    const c = forge.pki.createCertificate();
    c.publicKey = keys.publicKey;
    c.serialNumber = String(Math.floor(Math.random() * 1e6));
    c.validity.notBefore = new Date(Date.now() - 864e5);
    c.validity.notAfter = new Date(Date.now() + 365 * 864e5);
    c.setSubject([{ name: 'commonName', value: subject }]);
    c.setIssuer(issuerCert ? issuerCert.subject.attributes : [{ name: 'commonName', value: subject }]);
    c.setExtensions([{ name: 'basicConstraints', cA: ca }]);
    c.sign(issuerKey || keys.privateKey, forge.md.sha256.create());
    return { c, keys };
  };
  const raiz = mk('AC Teste', null, null, true);
  const titular = mk(cn, raiz.c, raiz.keys.privateKey, false);
  const certs = comCa ? [raiz.c, titular.c] : [titular.c];
  const p12 = forge.pkcs12.toPkcs12Asn1(titular.keys.privateKey, certs, senha, { algorithm: '3des' });
  return Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary');
}
