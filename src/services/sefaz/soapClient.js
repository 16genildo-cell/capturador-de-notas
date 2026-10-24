import fs from 'node:fs';
import https from 'node:https';
import tls from 'node:tls';
import { env } from '../../config/env.js';

/**
 * Lista de autoridades certificadoras confiaveis para falar com a SEFAZ.
 *
 * Os servidores da SEFAZ usam certificados da ICP-Brasil, que NAO vem na lista
 * padrao do Node. Por isso juntamos:
 *  1. as CAs padrao do Node;
 *  2. as CAs do sistema operacional (Windows/macOS/Linux), quando o Node suporta;
 *  3. um arquivo .pem extra com a cadeia ICP-Brasil (SEFAZ_CA_FILE no .env), se informado.
 */
let caCache = null;
function obterCAs() {
  if (caCache) return caCache;
  const cas = [...tls.rootCertificates];

  if (typeof tls.getCACertificates === 'function') {
    try {
      cas.push(...tls.getCACertificates('system'));
    } catch {
      // versao do Node sem suporte ao store do sistema
    }
  }

  if (env.sefazCaFile) {
    try {
      cas.push(fs.readFileSync(env.sefazCaFile, 'utf8'));
    } catch (err) {
      console.error(`[sefaz] Nao foi possivel ler SEFAZ_CA_FILE (${env.sefazCaFile}): ${err.message}`);
    }
  }

  caCache = cas;
  return cas;
}

const ERROS_CADEIA = new Set([
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'CERT_UNTRUSTED',
]);

/** Traduz erros de rede/TLS para mensagens que ajudam a resolver o problema. */
function explicarErro(err) {
  if (ERROS_CADEIA.has(err.code)) {
    return new Error(
      `Nao foi possivel validar o certificado do servidor da SEFAZ (${err.code}). ` +
        'O Node nao conhece a cadeia ICP-Brasil. Baixe a cadeia de certificados da ICP-Brasil ' +
        '(arquivo .pem) e informe o caminho em SEFAZ_CA_FILE no .env, ou, como ultimo recurso, ' +
        'defina SEFAZ_TLS_VERIFICAR=false.',
    );
  }
  if (err.code === 'ERR_SSL_TLSV1_ALERT_UNKNOWN_CA' || /alert (unknown ca|bad certificate|certificate)/i.test(err.message)) {
    return new Error(
      `A SEFAZ recusou o seu certificado digital (${err.message}). ` +
        'Confira se o certificado A1 e valido, nao esta vencido e e da empresa (e-CNPJ).',
    );
  }
  if (err.code === 'ECONNRESET' || err.code === 'EPROTO') {
    return new Error(
      `Conexao com a SEFAZ interrompida (${err.code}). Normalmente isso indica certificado digital ` +
        'invalido, vencido ou sem a cadeia completa.',
    );
  }
  if (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
    return new Error(`Sem conexao com a SEFAZ (${err.code}). Verifique a internet/firewall.`);
  }
  return err;
}

/**
 * Requisicao HTTPS com autenticacao mutua (mTLS) usando o certificado A1 (cert/chave em PEM).
 * Usada pelos web services da SEFAZ (SOAP) e pela API do Ambiente Nacional da NFS-e (REST).
 * Resolve com { status, body } para qualquer status HTTP; erros de rede/TLS sao traduzidos.
 */
export function requisicaoMtls({ method = 'GET', url, headers = {}, body, keyPem, certPem, timeoutMs = 60000 }) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const dados = body === undefined ? null : Buffer.from(body, 'utf8');

    const req = https.request(
      {
        host: target.hostname,
        port: target.port || 443,
        path: target.pathname + target.search,
        method,
        key: keyPem,
        cert: certPem,
        ca: obterCAs(),
        rejectUnauthorized: env.sefazTlsVerificar,
        minVersion: 'TLSv1.2',
        headers: dados ? { ...headers, 'Content-Length': dados.length } : headers,
        timeout: timeoutMs,
        // Cada empresa tem seu proprio certificado: nao reaproveitar conexoes entre elas.
        agent: false,
      },
      (resp) => {
        const chunks = [];
        resp.on('data', (c) => chunks.push(c));
        resp.on('end', () => resolve({ status: resp.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
      },
    );

    req.on('timeout', () => req.destroy(new Error(`Tempo esgotado na conexao com ${target.hostname}.`)));
    req.on('error', (err) => reject(explicarErro(err)));
    if (dados) req.write(dados);
    req.end();
  });
}

/**
 * Faz um POST SOAP 1.2 para um web service da SEFAZ usando autenticacao mutua (mTLS)
 * com o certificado A1 da empresa (cert/chave em PEM).
 *
 * A SEFAZ exige TLS com certificado cliente: e isso que prova "sou este CNPJ".
 */
export async function postSoap({ url, soapAction, xml, keyPem, certPem, timeoutMs = 60000 }) {
  const { status, body } = await requisicaoMtls({
    method: 'POST',
    url,
    headers: { 'Content-Type': `application/soap+xml; charset=utf-8; action="${soapAction}"` },
    body: xml,
    keyPem,
    certPem,
    timeoutMs,
  });
  if (status >= 200 && status < 300) return body;
  if (status === 403) {
    throw new Error(
      'SEFAZ respondeu HTTP 403 (acesso negado). O certificado digital nao foi aceito: ' +
        'confira se e um A1 valido da empresa.',
    );
  }
  throw new Error(`SEFAZ respondeu HTTP ${status}: ${body.slice(0, 500)}`);
}
