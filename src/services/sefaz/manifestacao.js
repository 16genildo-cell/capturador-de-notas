import { SignedXml } from 'xml-crypto';
import { getEndpoints, SOAP_ACTION, C_ORGAO_AN } from './endpoints.js';
import { postSoap } from './soapClient.js';
import { xmlToObj } from './parseDocumento.js';
import { env, tpAmb } from '../../config/env.js';
import { NotaFiscal } from '../../models/NotaFiscal.js';
import { consultarChave } from './distribuicaoDFe.js';
import { tagDocumento } from '../../utils/documento.js';

/**
 * Manifestacao do Destinatario - evento "Ciencia da Operacao" (210210).
 *
 * Quando a empresa e destinataria, a SEFAZ entrega primeiro so o RESUMO da nota (resNFe).
 * O XML completo so e liberado depois que a empresa manifesta ciencia. A ciencia apenas
 * registra que a empresa tomou conhecimento da nota; ela ainda pode depois confirmar,
 * desconhecer ou informar "operacao nao realizada".
 */
export const EVENTOS = {
  ciencia: { tpEvento: '210210', descricao: 'Ciencia da Operacao', situacao: 'ciencia' },
  confirmacao: { tpEvento: '210200', descricao: 'Confirmacao da Operacao', situacao: 'confirmada' },
  desconhecimento: { tpEvento: '210220', descricao: 'Desconhecimento da Operacao', situacao: 'desconhecida' },
  naoRealizada: { tpEvento: '210240', descricao: 'Operacao nao Realizada', situacao: 'nao_realizada', exigeJustificativa: true },
};

/** Prazo legal para a manifestacao conclusiva (confirmar/desconhecer/nao realizada): 180 dias da autorizacao. */
export const PRAZO_MANIFESTACAO_DIAS = 180;

export function prazoManifestacao(dataEmissao) {
  if (!dataEmissao) return null;
  return new Date(new Date(dataEmissao).getTime() + PRAZO_MANIFESTACAO_DIAS * 864e5);
}

function escaparXml(t) {
  return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const MAX_POR_EXECUCAO = 20;

/** Data/hora no formato da SEFAZ (AAAA-MM-DDThh:mm:ss-03:00), no fuso de Brasilia. */
function dataHoraSefaz(d = new Date()) {
  // Brasilia = UTC-3 (sem horario de verao desde 2019).
  const local = new Date(d.getTime() - 3 * 60 * 60 * 1000 - 60 * 1000); // 1 min antes: evita "data futura"
  return `${local.toISOString().slice(0, 19)}-03:00`;
}

/** Monta e assina o XML do evento. */
export function montarEventoAssinado({ cnpj, chave, evento = EVENTOS.ciencia, keyPem, certPem, data, justificativa }) {
  const nSeq = '1';
  const id = `ID${evento.tpEvento}${chave}${nSeq.padStart(2, '0')}`;

  const infEvento =
    `<infEvento Id="${id}">` +
    `<cOrgao>${C_ORGAO_AN}</cOrgao>` +
    `<tpAmb>${tpAmb()}</tpAmb>` +
    tagDocumento(cnpj) + // <CNPJ> ou <CPF> do destinatario que manifesta
    `<chNFe>${chave}</chNFe>` +
    `<dhEvento>${dataHoraSefaz(data)}</dhEvento>` +
    `<tpEvento>${evento.tpEvento}</tpEvento>` +
    `<nSeqEvento>${nSeq}</nSeqEvento>` +
    `<verEvento>1.00</verEvento>` +
    `<detEvento versao="1.00"><descEvento>${evento.descricao}</descEvento>` +
    (evento.exigeJustificativa ? `<xJust>${escaparXml(justificativa)}</xJust>` : '') +
    `</detEvento>` +
    `</infEvento>`;

  const xmlEvento = `<evento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">${infEvento}</evento>`;

  // Assinatura XMLDSig exigida pela SEFAZ: RSA-SHA1, C14N, enveloped, referencia ao Id.
  const sig = new SignedXml({
    privateKey: keyPem,
    publicCert: certPem,
    signatureAlgorithm: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
    canonicalizationAlgorithm: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
  });
  sig.addReference({
    xpath: "//*[local-name(.)='infEvento']",
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    ],
    digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1',
  });
  sig.computeSignature(xmlEvento, {
    location: { reference: "//*[local-name(.)='infEvento']", action: 'after' },
  });

  return sig.getSignedXml();
}

function montarEnvelope(eventoAssinado) {
  const idLote = String(Date.now()).slice(-15);
  const envEvento =
    `<envEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">` +
    `<idLote>${idLote}</idLote>` +
    eventoAssinado +
    `</envEvento>`;
  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ` +
    `xmlns:xsd="http://www.w3.org/2001/XMLSchema" ` +
    `xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">` +
    `<soap12:Body>` +
    `<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4">${envEvento}</nfeDadosMsg>` +
    `</soap12:Body>` +
    `</soap12:Envelope>`
  );
}

/** Le o retorno do envio do evento. */
export function lerRetornoEvento(respostaXml) {
  const resp = xmlToObj(respostaXml);
  const body = resp?.Envelope?.Body || {};
  // O nome do elemento de resultado varia por servidor: nfeResultMsg (SVRS, estados) ou
  // nfeRecepcaoEventoNFResult (Ambiente Nacional). Procura o retEnvEvento em qualquer um.
  let ret = body.retEnvEvento;
  if (!ret) {
    for (const filho of Object.values(body)) {
      if (filho && typeof filho === 'object' && filho.retEnvEvento) {
        ret = filho.retEnvEvento;
        break;
      }
    }
  }
  if (!ret) throw new Error(`Resposta inesperada da SEFAZ no evento: ${respostaXml.slice(0, 400)}`);

  const lote = { cStat: String(ret.cStat || ''), xMotivo: String(ret.xMotivo || '') };
  let retEvento = ret.retEvento;
  if (Array.isArray(retEvento)) retEvento = retEvento[0];
  const inf = retEvento?.infEvento;
  if (!inf) return { ...lote, ok: false };

  const cStat = String(inf.cStat || '');
  // 135 = registrado e vinculado; 136 = registrado sem vinculo; 573 = duplicidade (ja tinha ciencia)
  const ok = ['135', '136', '573'].includes(cStat);
  return { cStat, xMotivo: String(inf.xMotivo || ''), ok };
}

/** Envia a ciencia da operacao de UMA nota. */
export function enviarCiencia(empresa, certificado, chave) {
  return enviarEvento(empresa, certificado, chave, EVENTOS.ciencia);
}

/** Envia um evento de manifestacao do destinatario (ciencia, confirmacao, desconhecimento...). */
export async function enviarEvento(empresa, certificado, chave, evento, justificativa) {
  if (evento.exigeJustificativa) {
    const j = String(justificativa || '').trim();
    if (j.length < 15 || j.length > 255) throw new Error('A justificativa deve ter entre 15 e 255 caracteres.');
  }
  const eventoAssinado = montarEventoAssinado({
    cnpj: empresa.cnpj,
    chave,
    evento,
    justificativa: String(justificativa || '').trim(),
    keyPem: certificado.keyPem,
    certPem: certificado.certTitularPem || certificado.certPem,
  });
  const respostaXml = await postSoap({
    url: getEndpoints(env.sefazAmbiente).recepcaoEvento,
    soapAction: SOAP_ACTION.recepcaoEvento,
    xml: montarEnvelope(eventoAssinado),
    keyPem: certificado.keyPem,
    certPem: certificado.certPem,
  });
  return lerRetornoEvento(respostaXml);
}

/**
 * Da ciencia em uma nota (resumo) e tenta baixar o XML completo na sequencia.
 * Retorna { ok, baixou, mensagem }.
 */
export async function cienciaEDownload(empresa, certificado, nota) {
  const r = await enviarCiencia(empresa, certificado, nota.chave);
  if (!r.ok) {
    const mensagem = `Ciencia recusada pela SEFAZ: ${r.cStat} - ${r.xMotivo}`;
    await NotaFiscal.updateOne({ _id: nota._id }, { mensagemManifestacao: mensagem });
    return { ok: false, baixou: false, mensagem };
  }

  await NotaFiscal.updateOne(
    { _id: nota._id },
    { situacaoManifestacao: 'ciencia', mensagemManifestacao: `Ciencia registrada (${r.cStat}).` },
  );

  // A SEFAZ costuma liberar o XML em instantes; se ainda nao liberou, ele chega
  // automaticamente nas proximas capturas.
  await esperar(2000);
  try {
    const d = await consultarChave(empresa, certificado, nota.chave);
    if (d.atualizados > 0 || d.novos > 0) {
      return { ok: true, baixou: true, mensagem: 'Ciencia registrada e XML completo baixado.' };
    }
    const mensagem =
      `Ciencia registrada. O XML completo ainda nao foi liberado (${d.cStat} - ${d.xMotivo}); ` +
      'ele sera baixado automaticamente nas proximas capturas.';
    await NotaFiscal.updateOne({ _id: nota._id }, { mensagemManifestacao: mensagem });
    return { ok: true, baixou: false, mensagem };
  } catch (err) {
    return {
      ok: true,
      baixou: false,
      mensagem: `Ciencia registrada. O XML completo sera baixado nas proximas capturas (${err.message}).`,
    };
  }
}

/**
 * Manifestacao conclusiva de uma nota: confirmacao, desconhecimento ou operacao nao realizada.
 * Retorna { ok, mensagem }.
 */
export async function manifestarNota(empresa, certificado, nota, tipo, justificativa) {
  const evento = EVENTOS[tipo];
  if (!evento || tipo === 'ciencia') throw new Error('Tipo de manifestacao invalido.');
  const r = await enviarEvento(empresa, certificado, nota.chave, evento, justificativa);
  if (!r.ok) {
    const mensagem = `${evento.descricao} recusada pela SEFAZ: ${r.cStat} - ${r.xMotivo}`;
    await NotaFiscal.updateOne({ _id: nota._id }, { mensagemManifestacao: mensagem });
    return { ok: false, mensagem };
  }
  await NotaFiscal.updateOne(
    { _id: nota._id },
    { situacaoManifestacao: evento.situacao, mensagemManifestacao: `${evento.descricao} registrada (${r.cStat}).` },
  );
  let mensagem = `${evento.descricao} registrada na SEFAZ.`;
  // Confirmar tambem libera o XML completo de notas que so tinham resumo.
  if (tipo === 'confirmacao' && nota.resumo) {
    try {
      await esperar(2000);
      const d = await consultarChave(empresa, certificado, nota.chave);
      if (d.atualizados > 0 || d.novos > 0) mensagem += ' XML completo baixado.';
    } catch {
      // chega nas proximas capturas
    }
  }
  return { ok: true, mensagem };
}

/** Manifesta ciencia nas notas pendentes (resumos) da empresa. Usado na captura automatica. */
export async function manifestarPendentes(empresa, certificado, { limite = MAX_POR_EXECUCAO } = {}) {
  const pendentes = await NotaFiscal.find({
    empresa: empresa._id,
    resumo: true,
    tipo: { $in: ['nfe', 'nfce'] },
    situacaoManifestacao: 'pendente',
    cancelada: { $ne: true },
    chave: { $type: 'string', $ne: '' },
  })
    .sort('-dataEmissao')
    .limit(limite)
    .lean();

  let enviadas = 0;
  let baixadas = 0;
  let erros = 0;
  for (const nota of pendentes) {
    try {
      const r = await cienciaEDownload(empresa, certificado, nota);
      if (r.ok) enviadas += 1;
      else erros += 1;
      if (r.baixou) baixadas += 1;
    } catch (err) {
      erros += 1;
      await NotaFiscal.updateOne({ _id: nota._id }, { mensagemManifestacao: err.message });
    }
    await esperar(1500);
  }
  return { enviadas, baixadas, erros };
}

function esperar(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
