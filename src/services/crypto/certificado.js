import forge from 'node-forge';
import { decryptBuffer, decryptString } from './vault.js';

/** Compara a chave publica do certificado com a chave privada (RSA). */
function chaveCorresponde(cert, key) {
  try {
    return (
      cert.publicKey.n.compareTo(key.n) === 0 && cert.publicKey.e.compareTo(key.e) === 0
    );
  } catch {
    return false;
  }
}

/**
 * Procura o CNPJ (OID 2.16.76.1.3.3) ou CPF (OID 2.16.76.1.3.1) no subjectAltName
 * do certificado ICP-Brasil. Retorna '' se nao encontrar.
 */
function cnpjCpfDoSubjectAltName(cert) {
  const ext = cert.extensions.find((e) => e.name === 'subjectAltName');
  if (!ext || !ext.value) return '';
  try {
    const asn1 = forge.asn1.fromDer(ext.value);
    const achados = {};
    for (const nome of asn1.value || []) {
      // otherName = [0] { type-id OID, [0] value }
      if (nome.type !== 0 || !Array.isArray(nome.value)) continue;
      const oid = forge.asn1.derToOid(nome.value[0].value);
      let valor = nome.value[1];
      while (valor && Array.isArray(valor.value)) valor = valor.value[0];
      const texto = valor ? String(valor.value) : '';
      achados[oid] = texto;
    }
    if (achados['2.16.76.1.3.3']) return achados['2.16.76.1.3.3'].replace(/\D/g, '').slice(0, 14);
    // No OID de CPF o CPF fica nas posicoes 8 a 19 (apos a data de nascimento).
    if (achados['2.16.76.1.3.1']) return achados['2.16.76.1.3.1'].replace(/\D/g, '').slice(8, 19);
  } catch {
    // ignora: e so metadado
  }
  return '';
}

/**
 * Le um .pfx (PKCS#12) e extrai metadados + chave privada e certificado em PEM.
 * Usado tanto na hora do upload (validar) quanto na captura (montar o agente mTLS).
 */
export function lerPfx(pfxBuffer, senha) {
  const p12Der = forge.util.createBuffer(pfxBuffer.toString('binary'));
  const p12Asn1 = forge.asn1.fromDer(p12Der);
  const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, senha);

  // Chave privada
  const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
  const keyBag =
    (keyBags[forge.pki.oids.pkcs8ShroudedKeyBag] || [])[0] ||
    (p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] || [])[0];

  if (!keyBag || !keyBag.key) {
    throw new Error('Nao foi possivel extrair a chave privada do certificado.');
  }

  const certBags = (p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [])
    .filter((b) => b.cert);
  if (certBags.length === 0) {
    throw new Error('Nenhum certificado encontrado no arquivo .pfx.');
  }

  // O .pfx costuma trazer tambem as autoridades certificadoras (cadeia).
  // O certificado da empresa e o que corresponde a chave privada - nao necessariamente o primeiro.
  const titularBag = certBags.find((b) => chaveCorresponde(b.cert, keyBag.key));
  if (!titularBag) {
    throw new Error('O certificado do arquivo nao corresponde a chave privada.');
  }
  const cert = titularBag.cert;

  // Envia o certificado da empresa seguido das intermediarias (cadeia completa no TLS).
  const intermediarias = certBags
    .filter((b) => b !== titularBag)
    .map((b) => b.cert)
    .filter((c) => !c.isIssuer(c)); // descarta raizes auto-assinadas
  const keyPem = forge.pki.privateKeyToPem(keyBag.key);
  const certPem = [cert, ...intermediarias].map((c) => forge.pki.certificateToPem(c)).join('');
  const certTitularPem = forge.pki.certificateToPem(cert);

  // Metadados
  const subject = cert.subject.getField('CN');
  const issuer = cert.issuer.getField('CN');
  const cn = subject ? subject.value : '';

  // CNPJ/CPF: no CN "NOME:CNPJ" ou no subjectAltName (padrao ICP-Brasil)
  const m = cn.match(/:(\d{11,14})$/);
  const cnpjCpf = m ? m[1] : cnpjCpfDoSubjectAltName(cert);

  return {
    titular: cn,
    emissor: issuer ? issuer.value : '',
    cnpjCpf,
    validoDe: cert.validity.notBefore,
    validoAte: cert.validity.notAfter,
    keyPem,
    certPem,
    certTitularPem,
  };
}

/**
 * A partir de um documento Certificado (do Mongo), devolve { keyPem, certPem, pfx, senha }
 * descriptografados, prontos para uso no https.Agent (mTLS).
 */
export function materializarCertificado(certDoc) {
  let pfx;
  let senha;
  try {
    pfx = decryptBuffer(certDoc.pfxCriptografado);
    senha = decryptString(certDoc.senhaCriptografada);
  } catch (err) {
    if (/CERT_ENCRYPTION_KEY/.test(err.message)) throw err;
    // Falha de autenticacao do AES-GCM: o certificado foi gravado com outra CERT_ENCRYPTION_KEY.
    throw new Error(
      'Nao foi possivel abrir o certificado digital salvo: ele foi gravado com outra CERT_ENCRYPTION_KEY. ' +
        'Restaure a chave original no .env ou envie o certificado (.pfx) novamente em Certificados.',
    );
  }
  const info = lerPfx(pfx, senha);
  if (info.validoAte && info.validoAte.getTime() < Date.now()) {
    throw new Error(
      `O certificado digital venceu em ${info.validoAte.toLocaleDateString('pt-BR')}. Envie um certificado valido.`,
    );
  }
  return { ...info, pfx, senha };
}
