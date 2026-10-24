import zlib from 'node:zlib';
import { BaseNfseAdapter } from '../baseAdapter.js';
import { requisicaoMtls } from '../../sefaz/soapClient.js';
import { env } from '../../../config/env.js';
import { tipoPessoa } from '../../../utils/documento.js';

/**
 * Adaptador do PADRAO NACIONAL DA NFS-e (Ambiente de Dados Nacional - ADN).
 *
 * API de distribuicao para contribuintes, autenticada pelo certificado A1 (mTLS):
 *   GET {base}/DFe/{ultimoNSU}?lote=true[&cnpjConsulta=...]
 * Retorna JSON com:
 *   StatusProcessamento: "DOCUMENTOS_LOCALIZADOS" | "NENHUM_DOCUMENTO_LOCALIZADO" | "REJEICAO"
 *   LoteDFe: [{ NSU, ChaveAcesso, TipoDocumento, TipoEvento, ArquivoXml (gzip+base64), DataHoraGeracao }]
 *   Erros: [{ Codigo, Descricao, Complemento }]
 *
 * Entrega as NFS-e em que o CNPJ/CPF do certificado aparece como prestador,
 * TOMADOR ou intermediario - inclusive notas tomadas por pessoa fisica (e-CPF).
 * Diferente da NF-e, o XML ja vem completo (nao ha manifestacao).
 *
 * Documentacao: https://www.gov.br/nfse (Manual dos Contribuintes - APIs ADN).
 */
export const ADN_URLS = {
  producao: 'https://adn.nfse.gov.br/contribuintes',
  homologacao: 'https://adn.producaorestrita.nfse.gov.br/contribuintes',
};

const MAX_LOTES = 40;

function campo(obj, nome) {
  if (!obj) return undefined;
  if (obj[nome] !== undefined) return obj[nome];
  const camel = nome.charAt(0).toLowerCase() + nome.slice(1);
  return obj[camel];
}

/** ArquivoXml vem compactado (gzip) e em base64; aceita tambem XML ja descompactado. */
export function decodificarArquivoXml(valor) {
  const texto = String(valor || '').trim();
  if (texto.startsWith('<')) return texto;
  const buf = Buffer.from(texto, 'base64');
  try {
    return zlib.gunzipSync(buf).toString('utf8');
  } catch {
    return buf.toString('utf8');
  }
}

/** Le a resposta da API e normaliza. Lanca erro em rejeicao/resposta inesperada. */
export function lerRespostaAdn({ status, body }) {
  let json = null;
  try {
    json = body ? JSON.parse(body) : null;
  } catch {
    json = null;
  }

  if (!json) {
    if (status === 401 || status === 403) {
      throw new Error(
        `ADN da NFS-e recusou o certificado (HTTP ${status}). Confira se o certificado A1 e valido e do mesmo CNPJ/CPF.`,
      );
    }
    if (status === 404) {
      // Alguns retornos "sem documentos" chegam como 404 sem corpo.
      return { status: 'NENHUM_DOCUMENTO_LOCALIZADO', docs: [] };
    }
    if (status === 429) throw new Error('ADN da NFS-e: muitas consultas seguidas (HTTP 429). Tente mais tarde.');
    throw new Error(`Resposta inesperada do ADN da NFS-e (HTTP ${status}): ${String(body).slice(0, 300)}`);
  }

  const situacao = String(campo(json, 'StatusProcessamento') || '').toUpperCase();
  const erros = campo(json, 'Erros') || [];
  const lote = campo(json, 'LoteDFe') || [];

  if (situacao === 'REJEICAO' || (Array.isArray(erros) && erros.length > 0 && lote.length === 0)) {
    const msg = (Array.isArray(erros) ? erros : [erros])
      .map((e) => [campo(e, 'Codigo'), campo(e, 'Descricao'), campo(e, 'Complemento')].filter(Boolean).join(' - '))
      .join('; ');
    if (/NENHUM/i.test(msg)) return { status: 'NENHUM_DOCUMENTO_LOCALIZADO', docs: [] };
    throw new Error(`ADN da NFS-e rejeitou a consulta: ${msg || situacao || `HTTP ${status}`}`);
  }

  const docs = (Array.isArray(lote) ? lote : [lote]).map((d) => ({
    nsu: String(campo(d, 'NSU') ?? ''),
    chave: String(campo(d, 'ChaveAcesso') || ''),
    tipoDocumento: String(campo(d, 'TipoDocumento') || ''),
    xml: decodificarArquivoXml(campo(d, 'ArquivoXml')),
  }));

  return { status: situacao || (docs.length ? 'DOCUMENTOS_LOCALIZADOS' : 'NENHUM_DOCUMENTO_LOCALIZADO'), docs };
}

export class NfseNacionalAdapter extends BaseNfseAdapter {
  constructor() {
    super();
    this.nome = 'nacional';
  }

  /**
   * Captura incremental por NSU. `salvar(doc)` grava cada documento e retorna 'novo' | 'atualizado' | 'duplicado'.
   * Retorna { novos, total, aviso }.
   */
  // eslint-disable-next-line class-methods-use-this
  async capturarIncremental({ empresa, certificado, salvar, atualizarNSU }) {
    if (!certificado) {
      throw new Error('A NFS-e nacional exige o certificado digital A1 vinculado ao cadastro.');
    }
    const base = env.sefazAmbiente === 'producao' ? ADN_URLS.producao : ADN_URLS.homologacao;

    let ultimoNSU = Number(empresa.ultimoNSUNfse || 0);
    let novos = 0;
    let total = 0;

    for (let i = 0; i < MAX_LOTES; i += 1) {
      const params = new URLSearchParams({ lote: 'true' });
      // Para empresa (filial/matriz) informa o CNPJ consultado; pessoa fisica usa o CPF do proprio e-CPF.
      if (tipoPessoa(empresa.cnpj) === 'PJ') params.set('cnpjConsulta', empresa.cnpj);

      const resp = await requisicaoMtls({
        method: 'GET',
        url: `${base}/DFe/${ultimoNSU}?${params}`,
        headers: { Accept: 'application/json' },
        keyPem: certificado.keyPem,
        certPem: certificado.certPem,
      });
      const r = lerRespostaAdn(resp);
      if (r.docs.length === 0) break;

      let maiorNSU = ultimoNSU;
      for (const doc of r.docs) {
        total += 1;
        const resultado = await salvar(doc);
        if (resultado === 'novo' || resultado === 'atualizado') novos += 1;
        if (Number(doc.nsu) > maiorNSU) maiorNSU = Number(doc.nsu);
      }
      if (maiorNSU <= ultimoNSU) break; // protecao contra loop
      ultimoNSU = maiorNSU;
      await atualizarNSU(String(ultimoNSU));

      if (r.docs.length < 50) break; // ultimo lote
      await new Promise((ok) => setTimeout(ok, 1000));
    }

    return {
      novos,
      total,
      aviso: `${novos} NFS-e/evento(s) novo(s) no Ambiente Nacional (ultimo NSU ${ultimoNSU}).`,
    };
  }
}
