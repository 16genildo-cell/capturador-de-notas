import mongoose from 'mongoose';
import { SignedXml } from 'xml-crypto';
import { Empresa } from '../../models/Empresa.js';
import { EmissaoNfe } from '../../models/EmissaoNfe.js';
import { ProdutoNfe } from '../../models/ProdutoNfe.js';
import { NotaFiscal } from '../../models/NotaFiscal.js';
import { postSoap } from '../sefaz/soapClient.js';
import { xmlToObj } from '../sefaz/parseDocumento.js';
import { codigoUF } from '../sefaz/endpoints.js';
import { obterCertificadoEmpresa, salvarDocumento } from '../sefaz/distribuicaoDFe.js';
import { dataHoraBrasilia } from '../nfse/emissao.js';
import { soDigitos } from '../../utils/documento.js';
import { abaterEstoqueVenda, estornarEstoqueVenda } from '../estoqueService.js';
import {
  NS, VERSAO, validarVenda, montarNFe, assinarNFe, montarQrCode, incluirQrCode, webservices, textoSefaz, esc,
} from './xml.js';

/**
 * Emissao de NF-e (55) e NFC-e (65) direto nos web services da SEFAZ (gratuitos),
 * com o certificado A1 da empresa: autorizacao sincrona, recibo, consulta de protocolo,
 * cancelamento e carta de correcao.
 */

const WSDL = 'http://www.portalfiscal.inf.br/nfe/wsdl';
const SERVICOS = {
  autorizacao: ['NFeAutorizacao4', 'nfeAutorizacaoLote'],
  retAutorizacao: ['NFeRetAutorizacao4', 'nfeRetAutorizacaoLote'],
  consultaProtocolo: ['NFeConsultaProtocolo4', 'nfeConsultaNF'],
  recepcaoEvento: ['NFeRecepcaoEvento4', 'nfeRecepcaoEvento'],
  statusServico: ['NFeStatusServico4', 'nfeStatusServicoNF'],
};

export const AUTORIZADA = ['100', '150'];
export const DENEGADA = ['110', '301', '302', '303'];
export const COND_USO_CCE =
  'A Carta de Correcao e disciplinada pelo paragrafo 1o-A do art. 7o do Convenio S/N, de 15 de dezembro de 1970 e pode ser utilizada para regularizacao de erro ocorrido na emissao de documento fiscal, desde que o erro nao esteja relacionado com: I - as variaveis que determinam o valor do imposto tais como: base de calculo, aliquota, diferenca de preco, quantidade, valor da operacao ou da prestacao; II - a correcao de dados cadastrais que implique mudanca do remetente ou do destinatario; III - a data de emissao ou de saida.';

// Permite trocar o envio nos testes (servidor falso), sem rede.
let transporte = postSoap;
export function _definirTransporte(fn) {
  transporte = fn || postSoap;
}

function envelope(servico, corpo) {
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">' +
    `<soap12:Body><nfeDadosMsg xmlns="${WSDL}/${SERVICOS[servico][0]}">${corpo}</nfeDadosMsg></soap12:Body></soap12:Envelope>`
  );
}

/** Chama um servico e devolve { xml (conteudo de nfeResultMsg), obj }. */
async function chamar(ws, servico, corpo, certificado, timeoutMs = 60000) {
  const url = ws[servico];
  if (!url) throw new Error(`Servico ${servico} nao disponivel para esta UF.`);
  const [nome, metodo] = SERVICOS[servico];
  const resposta = await transporte({
    url,
    soapAction: `${WSDL}/${nome}/${metodo}`,
    xml: envelope(servico, corpo),
    keyPem: certificado.keyPem,
    certPem: certificado.certPem,
    timeoutMs,
  });
  const m = resposta.match(/<(?:[\w-]+:)?nfeResultMsg[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?nfeResultMsg>/);
  const xml = m ? m[1] : resposta;
  return { xml, obj: xmlToObj(xml) };
}

const lista = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms));

/** protNFe "cru" da resposta (para montar o nfeProc). Refaz a partir do objeto se vier com prefixo. */
function protNFeXml(xmlResposta, prot) {
  const m = xmlResposta.match(/<protNFe[\s>][\s\S]*?<\/protNFe>/);
  if (m) return m[0].startsWith('<protNFe xmlns') ? m[0] : m[0].replace('<protNFe', `<protNFe xmlns="${NS}"`);
  const i = prot.infProt || {};
  const campos = ['tpAmb', 'verAplic', 'chNFe', 'dhRecbto', 'nProt', 'digVal', 'cStat', 'xMotivo'];
  return (
    `<protNFe xmlns="${NS}" versao="${prot['@_versao'] || VERSAO}"><infProt${i['@_Id'] ? ` Id="${i['@_Id']}"` : ''}>` +
    campos.map((c) => (i[c] ? `<${c}>${esc(i[c])}</${c}>` : '')).join('') +
    '</infProt></protNFe>'
  );
}

function lerProt(prot) {
  const i = prot?.infProt || {};
  return {
    cStat: String(i.cStat || ''),
    xMotivo: String(i.xMotivo || ''),
    protocolo: String(i.nProt || ''),
    dhRecbto: i.dhRecbto ? new Date(i.dhRecbto) : null,
    chave: String(i.chNFe || ''),
  };
}

/** Consulta a situacao de uma NF-e/NFC-e pela chave. */
export async function consultarProtocolo({ uf, modelo, ambiente, chave, certificado }) {
  const ws = webservices(uf, modelo, ambiente);
  const corpo =
    `<consSitNFe xmlns="${NS}" versao="${VERSAO}"><tpAmb>${ambiente === 'producao' ? '1' : '2'}</tpAmb>` +
    `<xServ>CONSULTAR</xServ><chNFe>${chave}</chNFe></consSitNFe>`;
  const { xml, obj } = await chamar(ws, 'consultaProtocolo', corpo, certificado);
  const ret = obj.retConsSitNFe || {};
  const prot = ret.protNFe ? lerProt(ret.protNFe) : null;
  const cancelada = lista(ret.procEventoNFe).some((p) => String(p?.evento?.infEvento?.tpEvento) === '110111' && ['135', '155'].includes(String(p?.retEvento?.infEvento?.cStat)));
  return {
    cStat: String(ret.cStat || ''),
    xMotivo: String(ret.xMotivo || ''),
    prot,
    protXml: ret.protNFe ? protNFeXml(xml, ret.protNFe) : null,
    cancelada,
  };
}

/** Testa a comunicacao com a SEFAZ (status do servico) usando o certificado da empresa. */
export async function statusServico(empresaId, modelo = '55') {
  const empresa = await Empresa.findById(empresaId).populate('certificado');
  if (!empresa) throw new Error('Empresa nao encontrada.');
  const cfg = empresa.emissaoNfe || {};
  const ambiente = cfg.ambiente === 'producao' ? 'producao' : 'homologacao';
  const certificado = await obterCertificadoEmpresa(empresa);
  const ws = webservices(empresa.uf, modelo, ambiente);
  const corpo =
    `<consStatServ xmlns="${NS}" versao="${VERSAO}"><tpAmb>${ambiente === 'producao' ? '1' : '2'}</tpAmb>` +
    `<cUF>${codigoUF(empresa.uf)}</cUF><xServ>STATUS</xServ></consStatServ>`;
  const { obj } = await chamar(ws, 'statusServico', corpo, certificado, 30000);
  const r = obj.retConsStatServ || {};
  return { ok: String(r.cStat) === '107', cStat: String(r.cStat || ''), xMotivo: String(r.xMotivo || ''), ambiente, modelo };
}

/** Envia o lote (1 nota, sincrono) e devolve o resultado da autorizacao. */
async function autorizar({ ws, nfeAssinada, ambiente, certificado }) {
  const idLote = String(Date.now()).slice(-15);
  const corpo = `<enviNFe xmlns="${NS}" versao="${VERSAO}"><idLote>${idLote}</idLote><indSinc>1</indSinc>${nfeAssinada}</enviNFe>`;
  const { xml, obj } = await chamar(ws, 'autorizacao', corpo, certificado, 90000);
  const ret = obj.retEnviNFe || {};
  const cStatLote = String(ret.cStat || '');

  if (ret.protNFe) return { lote: cStatLote, prot: lerProt(ret.protNFe), protXml: protNFeXml(xml, ret.protNFe) };

  if (cStatLote === '103') {
    // Processamento assincrono: consulta o recibo
    const nRec = String(ret.infRec?.nRec || '');
    for (let i = 1; i <= 6; i += 1) {
      await esperar(1500 * i);
      const c = await chamar(
        ws,
        'retAutorizacao',
        `<consReciNFe xmlns="${NS}" versao="${VERSAO}"><tpAmb>${ambiente === 'producao' ? '1' : '2'}</tpAmb><nRec>${nRec}</nRec></consReciNFe>`,
        certificado,
      );
      const r = c.obj.retConsReciNFe || {};
      if (String(r.cStat) === '105') continue; // em processamento
      const prot = lista(r.protNFe)[0];
      if (prot) return { lote: String(r.cStat), prot: lerProt(prot), protXml: protNFeXml(c.xml, prot) };
      return { lote: String(r.cStat || ''), prot: { cStat: String(r.cStat || ''), xMotivo: String(r.xMotivo || '') } };
    }
    return { lote: '105', semResposta: true, prot: { cStat: '105', xMotivo: 'Lote ainda em processamento na SEFAZ.' } };
  }
  // Rejeicao do lote inteiro (ex.: 225 falha no schema)
  return { lote: cStatLote, prot: { cStat: cStatLote, xMotivo: String(ret.xMotivo || 'Resposta inesperada da SEFAZ.') } };
}

function montarNfeProc(nfeAssinada, protXml) {
  return `<?xml version="1.0" encoding="UTF-8"?><nfeProc xmlns="${NS}" versao="${VERSAO}">${nfeAssinada.replace(/^<\?xml[^>]*>/, '')}${protXml}</nfeProc>`;
}

const travas = new Set();

function chaveNumeracao(ambiente, modelo) {
  return `emissaoNfe.numeracao.${ambiente}.${modelo}`;
}

async function avancarNumeracao(empresa, ambiente, modelo, numero) {
  const atual = Number(empresa.emissaoNfe?.numeracao?.[ambiente]?.[modelo] || 0);
  if (numero > atual) await Empresa.updateOne({ _id: empresa._id }, { [chaveNumeracao(ambiente, modelo)]: numero });
}

/** Grava a nota autorizada na lista de notas da empresa (so producao) e devolve o id. */
async function gravarNota(empresa, ambiente, nfeProc, chave) {
  if (ambiente !== 'producao') return null;
  await salvarDocumento(empresa, { xml: nfeProc, origem: 'emissao' });
  const n = await NotaFiscal.findOne({ empresa: empresa._id, chave }).select('_id').lean();
  return n?._id || null;
}

/** Carrega os produtos dos itens digitados ({ produtoId, quantidade, valorUnitario, desconto }). */
export async function carregarItens(empresaId, itens) {
  const ids = (itens || []).map((i) => i.produtoId).filter((id) => mongoose.isValidObjectId(id));
  const produtos = await ProdutoNfe.find({ _id: { $in: ids }, empresa: empresaId }).lean();
  const porId = new Map(produtos.map((p) => [String(p._id), p]));
  return (itens || [])
    .filter((i) => porId.has(String(i.produtoId)))
    .map((i) => ({ ...i, produto: porId.get(String(i.produtoId)) }));
}

/**
 * Emite uma NF-e ou NFC-e.
 * entrada = { modelo, dest, itens: [{ produtoId, quantidade, valorUnitario, desconto }], pagamento, presenca, infComplementar }
 * Devolve o registro EmissaoNfe (status autorizada | rejeitada | denegada | sem_resposta).
 */
export async function emitirNfe(empresaId, entrada, { usuarioId } = {}) {
  const empresa = await Empresa.findById(empresaId).populate('certificado');
  if (!empresa) throw new Error('Empresa nao encontrada.');
  const cfg = empresa.emissaoNfe?.toObject?.() || empresa.emissaoNfe || {};
  if (!cfg.ativa) throw new Error('A emissao de NF-e / NFC-e nao esta ativada para esta empresa. Configure primeiro.');
  const ambiente = cfg.ambiente === 'producao' ? 'producao' : 'homologacao';

  const itens = await carregarItens(empresa._id, entrada.itens);
  const venda = validarVenda({ ...entrada, itens }, cfg, empresa);
  const modelo = venda.modelo;
  const certificado = await obterCertificadoEmpresa(empresa);
  const ws = webservices(empresa.uf, modelo, ambiente);
  const serie = String(Number(modelo === '65' ? cfg.serieNfce : cfg.serieNfe) || 1);

  const trava = `${empresa._id}:${modelo}`;
  if (travas.has(trava)) throw new Error('Ja existe uma emissao em andamento para esta empresa. Aguarde alguns segundos.');
  travas.add(trava);
  try {
    let numero = Number(cfg.numeracao?.[ambiente]?.[modelo] || 0) + 1;

    // Uma tentativa anterior ficou sem resposta com este numero? Descobre se ela foi autorizada.
    const pendente = await EmissaoNfe.findOne({ empresa: empresa._id, ambiente, modelo, serie, numero, status: 'sem_resposta' });
    if (pendente?.chave) {
      try {
        const c = await consultarProtocolo({ uf: empresa.uf, modelo, ambiente, chave: pendente.chave, certificado });
        if (c.prot && AUTORIZADA.includes(c.prot.cStat)) {
          const nfeProc = montarNfeProc(pendente.xml, c.protXml);
          pendente.set({ status: 'autorizada', cStat: c.prot.cStat, xMotivo: c.prot.xMotivo, protocolo: c.prot.protocolo, dataAutorizacao: c.prot.dhRecbto, xml: nfeProc });
          pendente.nota = await gravarNota(empresa, ambiente, nfeProc, pendente.chave);
          await pendente.save();
          await avancarNumeracao(empresa, ambiente, modelo, numero);
          numero += 1;
        }
      } catch (err) {
        console.warn(`[nfe] consulta da pendente ${pendente.chave} falhou: ${err.message}`);
      }
    }

    const dhEmi = dataHoraBrasilia(new Date(Date.now() - 30 * 1000));
    const { xml, chave } = montarNFe({ empresa, cfg, venda, numero, serie, ambiente, dhEmi });
    let nfeAssinada = assinarNFe(xml, certificado);
    if (modelo === '65') {
      const qr = montarQrCode({ chave, ambiente, uf: empresa.uf, versao: cfg.versaoQrCode, csc: cfg.csc?.[ambiente] });
      nfeAssinada = incluirQrCode(nfeAssinada, qr);
    }

    const registro = new EmissaoNfe({
      owner: empresa.owner,
      empresa: empresa._id,
      usuario: usuarioId,
      modelo,
      ambiente,
      serie,
      numero,
      chave,
      status: 'sem_resposta',
      destNome: venda.dest?.nome || '',
      destDocumento: venda.dest?.documento || '',
      valor: venda.totais.total,
      qtdItens: venda.itens.length,
      xml: nfeAssinada,
      dados: { ...entrada, itens: (entrada.itens || []).map(({ produtoId, quantidade, valorUnitario, desconto }) => ({ produtoId, quantidade, valorUnitario, desconto })) },
    });

    if (venda.contingencia) {
      registro.status = 'contingencia';
      registro.xMotivo = 'Emitida em contingência offline. Pendente de transmissão para a SEFAZ.';
      await registro.save();
      await avancarNumeracao(empresa, ambiente, modelo, numero);
      await abaterEstoqueVenda(registro);
      return registro;
    }

    let r;
    try {
      r = await autorizar({ ws, nfeAssinada, ambiente, certificado });
    } catch (err) {
      // Pode ter chegado na SEFAZ: confere pela chave antes de desistir.
      registro.erros = [err.message];
      try {
        const c = await consultarProtocolo({ uf: empresa.uf, modelo, ambiente, chave, certificado });
        if (c.prot && AUTORIZADA.includes(c.prot.cStat)) r = { prot: c.prot, protXml: c.protXml };
      } catch {
        // continua sem resposta
      }
      if (!r) {
        registro.xMotivo = `Sem resposta da SEFAZ: ${err.message}`;
        await registro.save();
        return registro;
      }
    }

    let { prot } = r;
    let protXml = r.protXml;

    // 204 = duplicidade (a mesma chave ja foi autorizada): recupera o protocolo
    if (prot.cStat === '204') {
      const c = await consultarProtocolo({ uf: empresa.uf, modelo, ambiente, chave, certificado }).catch(() => null);
      if (c?.prot && AUTORIZADA.includes(c.prot.cStat)) {
        prot = c.prot;
        protXml = c.protXml;
      }
    }

    registro.cStat = prot.cStat;
    registro.xMotivo = prot.xMotivo;
    if (AUTORIZADA.includes(prot.cStat)) {
      const nfeProc = montarNfeProc(nfeAssinada, protXml);
      registro.set({ status: 'autorizada', protocolo: prot.protocolo, dataAutorizacao: prot.dhRecbto, xml: nfeProc });
      await avancarNumeracao(empresa, ambiente, modelo, numero);
      registro.nota = await gravarNota(empresa, ambiente, nfeProc, chave);
      await Promise.all(
        venda.itens.map((it) => (it.produtoId ? ProdutoNfe.updateOne({ _id: it.produtoId }, { $inc: { totalVendido: it.quantidade } }) : null)),
      );
      await abaterEstoqueVenda(registro);
    } else if (DENEGADA.includes(prot.cStat)) {
      registro.set({ status: 'denegada', protocolo: prot.protocolo, dataAutorizacao: prot.dhRecbto, xml: protXml ? montarNfeProc(nfeAssinada, protXml) : nfeAssinada });
      await avancarNumeracao(empresa, ambiente, modelo, numero); // numero denegado nao pode ser reutilizado
    } else if (r.semResposta) {
      registro.status = 'sem_resposta';
    } else {
      registro.status = 'rejeitada';
      registro.erros = [`${prot.cStat} - ${prot.xMotivo}`];
      // 539: este numero ja foi usado por outra nota (chave diferente). Pula o numero.
      if (prot.cStat === '539') await avancarNumeracao(empresa, ambiente, modelo, numero);
    }
    await registro.save();
    return registro;
  } finally {
    travas.delete(trava);
  }
}

// ---------------------------------------------------------------- eventos

export function montarEvento({ cOrgao, ambiente, cnpj, chave, tpEvento, nSeq, detEvento, dhEvento, certificado }) {
  const id = `ID${tpEvento}${chave}${String(nSeq).padStart(2, '0')}`;
  const doc = soDigitos(cnpj);
  const xml =
    `<evento xmlns="${NS}" versao="1.00"><infEvento Id="${id}"><cOrgao>${cOrgao}</cOrgao><tpAmb>${ambiente === 'producao' ? '1' : '2'}</tpAmb>` +
    (doc.length === 11 ? `<CPF>${doc}</CPF>` : `<CNPJ>${doc}</CNPJ>`) +
    `<chNFe>${chave}</chNFe><dhEvento>${dhEvento}</dhEvento><tpEvento>${tpEvento}</tpEvento><nSeqEvento>${nSeq}</nSeqEvento>` +
    `<verEvento>1.00</verEvento><detEvento versao="1.00">${detEvento}</detEvento></infEvento></evento>`;
  const sig = new SignedXml({
    privateKey: certificado.keyPem,
    publicCert: certificado.certTitularPem || certificado.certPem,
    signatureAlgorithm: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
    canonicalizationAlgorithm: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
  });
  sig.addReference({
    xpath: "//*[local-name(.)='infEvento']",
    transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315'],
    digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1',
  });
  sig.computeSignature(xml, { location: { reference: "//*[local-name(.)='infEvento']", action: 'after' } });
  return { id, xml: sig.getSignedXml() };
}

async function enviarEvento({ empresa, emissao, tpEvento, nSeq, detEvento, certificado }) {
  const ws = webservices(empresa.uf, emissao.modelo, emissao.ambiente);
  const { xml: eventoXml } = montarEvento({
    cOrgao: codigoUF(empresa.uf),
    ambiente: emissao.ambiente,
    cnpj: empresa.cnpj,
    chave: emissao.chave,
    tpEvento,
    nSeq,
    detEvento,
    dhEvento: dataHoraBrasilia(new Date(Date.now() - 30 * 1000)),
    certificado,
  });
  const corpo = `<envEvento xmlns="${NS}" versao="1.00"><idLote>${String(Date.now()).slice(-15)}</idLote>${eventoXml}</envEvento>`;
  const { xml, obj } = await chamar(ws, 'recepcaoEvento', corpo, certificado);
  const ret = obj.retEnvEvento || {};
  const inf = lista(ret.retEvento)[0]?.infEvento || {};
  const cStat = String(inf.cStat || ret.cStat || '');
  const retXml = (xml.match(/<retEvento[\s>][\s\S]*?<\/retEvento>/) || [''])[0];
  return {
    ok: ['135', '136', '155'].includes(cStat),
    cStat,
    xMotivo: String(inf.xMotivo || ret.xMotivo || ''),
    protocolo: String(inf.nProt || ''),
    xml: retXml ? `<procEventoNFe xmlns="${NS}" versao="1.00">${eventoXml}${retXml.startsWith('<retEvento xmlns') ? retXml : retXml.replace('<retEvento', `<retEvento xmlns="${NS}"`)}</procEventoNFe>` : eventoXml,
  };
}

async function carregarParaEvento(emissaoId, owner, filtroExtra = {}) {
  if (!mongoose.isValidObjectId(emissaoId)) throw new Error('Emissao invalida.');
  const emissao = await EmissaoNfe.findOne({ _id: emissaoId, owner, ...filtroExtra });
  if (!emissao) throw new Error('Emissao nao encontrada.');
  if (emissao.status !== 'autorizada') throw new Error('So notas autorizadas podem receber este evento.');
  const empresa = await Empresa.findById(emissao.empresa).populate('certificado');
  const certificado = await obterCertificadoEmpresa(empresa);
  return { emissao, empresa, certificado };
}

/** Cancela a NF-e / NFC-e (evento 110111). */
export async function cancelarNfe(emissaoId, owner, { justificativa }, filtroExtra = {}) {
  const xJust = textoSefaz(justificativa, 255);
  if (xJust.length < 15) throw new Error('A justificativa do cancelamento deve ter de 15 a 255 caracteres.');
  const { emissao, empresa, certificado } = await carregarParaEvento(emissaoId, owner, filtroExtra);
  const r = await enviarEvento({
    empresa,
    emissao,
    tpEvento: '110111',
    nSeq: 1,
    certificado,
    detEvento: `<descEvento>Cancelamento</descEvento><nProt>${emissao.protocolo}</nProt><xJust>${esc(xJust)}</xJust>`,
  });
  emissao.eventos.push({ tipo: '110111', seq: 1, texto: xJust, protocolo: r.protocolo, cStat: r.cStat, xMotivo: r.xMotivo, xml: r.xml });
  if (r.ok) {
    emissao.status = 'cancelada';
    if (emissao.ambiente === 'producao') await NotaFiscal.updateOne({ empresa: empresa._id, chave: emissao.chave }, { cancelada: true });
    await estornarEstoqueVenda(emissao, 'Cancelamento de nota na SEFAZ');
  }
  await emissao.save();
  return { ok: r.ok, mensagem: r.ok ? 'Nota cancelada na SEFAZ.' : `SEFAZ recusou o cancelamento: ${r.cStat} - ${r.xMotivo}` };
}

/** Carta de correcao (evento 110110) - so NF-e modelo 55. */
export async function cartaCorrecao(emissaoId, owner, { texto }, filtroExtra = {}) {
  const xCorrecao = textoSefaz(texto, 1000);
  if (xCorrecao.length < 15) throw new Error('A correcao deve ter de 15 a 1000 caracteres.');
  const { emissao, empresa, certificado } = await carregarParaEvento(emissaoId, owner, filtroExtra);
  if (emissao.modelo !== '55') throw new Error('Carta de correcao so existe para NF-e (modelo 55).');
  const nSeq = emissao.eventos.filter((e) => e.tipo === '110110' && ['135', '136'].includes(e.cStat)).length + 1;
  if (nSeq > 20) throw new Error('Limite de 20 cartas de correcao por nota.');
  const r = await enviarEvento({
    empresa,
    emissao,
    tpEvento: '110110',
    nSeq,
    certificado,
    detEvento: `<descEvento>Carta de Correcao</descEvento><xCorrecao>${esc(xCorrecao)}</xCorrecao><xCondUso>${COND_USO_CCE}</xCondUso>`,
  });
  emissao.eventos.push({ tipo: '110110', seq: nSeq, texto: xCorrecao, protocolo: r.protocolo, cStat: r.cStat, xMotivo: r.xMotivo, xml: r.xml });
  await emissao.save();
  return { ok: r.ok, mensagem: r.ok ? `Carta de correcao n ${nSeq} registrada.` : `SEFAZ recusou a carta de correcao: ${r.cStat} - ${r.xMotivo}` };
}

/** Reconsulta uma emissao que ficou sem resposta. */
export async function reconsultarNfe(emissaoId, owner, filtroExtra = {}) {
  if (!mongoose.isValidObjectId(emissaoId)) throw new Error('Emissao invalida.');
  const emissao = await EmissaoNfe.findOne({ _id: emissaoId, owner, ...filtroExtra });
  if (!emissao) throw new Error('Emissao nao encontrada.');
  const empresa = await Empresa.findById(emissao.empresa).populate('certificado');
  const certificado = await obterCertificadoEmpresa(empresa);
  const c = await consultarProtocolo({ uf: empresa.uf, modelo: emissao.modelo, ambiente: emissao.ambiente, chave: emissao.chave, certificado });
  if (c.prot && AUTORIZADA.includes(c.prot.cStat) && emissao.status !== 'autorizada' && emissao.status !== 'cancelada') {
    const nfeProc = montarNfeProc(emissao.xml, c.protXml);
    emissao.set({ status: c.cancelada ? 'cancelada' : 'autorizada', cStat: c.prot.cStat, xMotivo: c.prot.xMotivo, protocolo: c.prot.protocolo, dataAutorizacao: c.prot.dhRecbto, xml: nfeProc });
    await avancarNumeracao(empresa, emissao.ambiente, emissao.modelo, emissao.numero);
    emissao.nota = await gravarNota(empresa, emissao.ambiente, nfeProc, emissao.chave);
    await emissao.save();
    return { ok: true, mensagem: 'A SEFAZ confirmou: nota autorizada.' };
  }
  return { ok: false, mensagem: `SEFAZ: ${c.cStat} - ${c.xMotivo}` };
}

/**
 * Transmite para a SEFAZ todas as notas que foram emitidas em contingência offline (tpEmis 9).
 */
export async function sincronizarContingencias(empresaId, owner) {
  const pendentes = await EmissaoNfe.find({ empresa: empresaId, owner, status: 'contingencia' });
  if (!pendentes.length) return { total: 0, sincronizadas: 0, erros: [] };

  const empresa = await Empresa.findById(empresaId).populate('certificado');
  if (!empresa) throw new Error('Empresa não encontrada.');
  const certificado = await obterCertificadoEmpresa(empresa);

  let sincronizadas = 0;
  const erros = [];

  for (const nota of pendentes) {
    try {
      const ws = webservices(empresa.uf, nota.modelo, nota.ambiente);
      const r = await autorizar({ ws, nfeAssinada: nota.xml, ambiente: nota.ambiente, certificado });
      const prot = r.prot;
      if (prot && AUTORIZADA.includes(prot.cStat)) {
        const nfeProc = montarNfeProc(nota.xml, r.protXml);
        nota.set({
          status: 'autorizada',
          protocolo: prot.protocolo,
          dataAutorizacao: prot.dhRecbto || new Date(),
          cStat: prot.cStat,
          xMotivo: prot.xMotivo,
          xml: nfeProc,
        });
        nota.nota = await gravarNota(empresa, nota.ambiente, nfeProc, nota.chave);
        await nota.save();
        sincronizadas += 1;
      } else if (prot && DENEGADA.includes(prot.cStat)) {
        nota.set({ status: 'denegada', cStat: prot.cStat, xMotivo: prot.xMotivo });
        await nota.save();
      } else {
        erros.push(`Nota ${nota.numero}: ${prot?.xMotivo || 'Não autorizada'}`);
      }
    } catch (err) {
      erros.push(`Nota ${nota.numero}: ${err.message}`);
    }
  }

  return { total: pendentes.length, sincronizadas, erros };
}
