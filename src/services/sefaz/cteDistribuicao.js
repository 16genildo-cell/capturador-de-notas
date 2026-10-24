import zlib from 'node:zlib';
import { codigoUF } from './endpoints.js';
import { postSoap } from './soapClient.js';
import { xmlToObj } from './parseDocumento.js';
import { obterCertificadoEmpresa } from './distribuicaoDFe.js';
import { env, tpAmb } from '../../config/env.js';
import { tagDocumento, soDigitos } from '../../utils/documento.js';
import { NotaFiscal } from '../../models/NotaFiscal.js';
import { CapturaLog } from '../../models/CapturaLog.js';
import { Empresa } from '../../models/Empresa.js';

/**
 * Captura de CT-e (Conhecimento de Transporte Eletronico) pelo web service nacional
 * CTeDistribuicaoDFe. Entrega os CT-e em que o CNPJ/CPF aparece como emitente, tomador,
 * remetente, destinatario, expedidor ou recebedor. O XML ja vem completo.
 * Mesmas regras da NF-e: 137 = nada novo (esperar 1h); 656 = bloqueio por excesso.
 */
export const CTE_ENDPOINTS = {
  producao: 'https://www1.cte.fazenda.gov.br/CTeDistribuicaoDFe/CTeDistribuicaoDFe.asmx',
  homologacao: 'https://hom1.cte.fazenda.gov.br/CTeDistribuicaoDFe/CTeDistribuicaoDFe.asmx',
};
const SOAP_ACTION = 'http://www.portalfiscal.inf.br/cte/wsdl/CTeDistribuicaoDFe/cteDistDFeInteresse';
const MINUTOS_ESPERA = 61;

function montarEnvelope({ doc, uf, ultimoNSU }) {
  const dist =
    `<distDFeInt xmlns="http://www.portalfiscal.inf.br/cte" versao="1.00">` +
    `<tpAmb>${tpAmb()}</tpAmb>` +
    `<cUFAutor>${codigoUF(uf)}</cUFAutor>` +
    tagDocumento(doc) +
    `<distNSU><ultNSU>${String(ultimoNSU || '0').padStart(15, '0')}</ultNSU></distNSU>` +
    `</distDFeInt>`;
  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ` +
    `xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">` +
    `<soap12:Body><cteDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/cte/wsdl/CTeDistribuicaoDFe">` +
    `<cteDadosMsg>${dist}</cteDadosMsg></cteDistDFeInteresse></soap12:Body></soap12:Envelope>`
  );
}

export function lerRetornoCte(respostaXml) {
  const resp = xmlToObj(respostaXml);
  const result = resp?.Envelope?.Body?.cteDistDFeInteresseResponse?.cteDistDFeInteresseResult;
  const ret = result?.retDistDFeInt || result;
  if (!ret || ret.cStat === undefined) {
    throw new Error(`Resposta inesperada da SEFAZ (CT-e): ${respostaXml.slice(0, 400)}`);
  }
  let docs = ret?.loteDistDFeInt?.docZip || [];
  if (!Array.isArray(docs)) docs = docs ? [docs] : [];
  return {
    cStat: String(ret.cStat),
    xMotivo: String(ret.xMotivo || ''),
    ultNSU: ret.ultNSU !== undefined ? String(ret.ultNSU) : null,
    maxNSU: ret.maxNSU !== undefined ? String(ret.maxNSU) : null,
    docs: docs
      .map((d) => ({ nsu: typeof d === 'string' ? '' : String(d['@_NSU'] || ''), conteudo: typeof d === 'string' ? d : d['#text'] }))
      .filter((d) => d.conteudo),
  };
}

function docDe(p) {
  return p ? String(p.CNPJ || p.CPF || '') : '';
}

/** Extrai o resumo indexavel de um CT-e / CT-e OS / evento de CT-e. */
export function resumirCte(xml, docContribuinte) {
  const obj = xmlToObj(xml);
  const meu = soDigitos(docContribuinte);
  const cte = obj?.cteProc?.CTe || obj?.CTe || obj?.cteOSProc?.CTeOS || obj?.CTeOS;

  if (cte) {
    const inf = cte.infCte || cte.infCTe || {};
    const ide = inf.ide || {};
    const emit = inf.emit || {};
    const tomaCod = String(ide.toma3?.toma ?? ide.toma ?? ide.toma4?.toma ?? '');
    const tomador =
      { 0: inf.rem, 1: inf.exped, 2: inf.receb, 3: inf.dest }[tomaCod] || ide.toma4 || inf.toma || {};
    const participantes = [inf.rem, inf.dest, inf.exped, inf.receb, tomador].map(docDe).map(soDigitos);

    let papel = 'desconhecido';
    if (meu && soDigitos(docDe(emit)) === meu) papel = 'emitente';
    else if (meu && participantes.includes(meu)) papel = 'destinatario';

    return {
      tipo: 'cte',
      xml,
      resumo: false,
      chave: String(inf['@_Id'] || '').replace(/^CTe/, ''),
      modelo: String(ide.mod || '57'),
      numero: String(ide.nCT || ''),
      serie: String(ide.serie || ''),
      emitenteCnpjCpf: docDe(emit),
      emitenteNome: String(emit.xNome || ''),
      destinatarioCnpjCpf: docDe(tomador),
      destinatarioNome: String(tomador.xNome || ''),
      valorTotal: Number(inf.vPrest?.vTPrest) || 0,
      dataEmissao: ide.dhEmi ? new Date(ide.dhEmi) : undefined,
      papel,
      origem: 'sefaz-cte-distdfe',
    };
  }

  const ev = obj?.procEventoCTe?.eventoCTe?.infEvento || obj?.eventoCTe?.infEvento;
  return {
    tipo: 'evento',
    xml,
    resumo: false,
    chaveNota: String(ev?.chCTe || ''),
    tpEvento: String(ev?.tpEvento || ''),
    numero: String(ev?.tpEvento || ''),
    dataEmissao: ev?.dhEvento ? new Date(ev.dhEvento) : undefined,
    origem: 'sefaz-cte-distdfe',
  };
}

export async function salvarCte(empresa, { nsu, xml, origem }) {
  const dados = resumirCte(xml, empresa.cnpj);
  const base = { empresa: empresa._id, owner: empresa.owner, ...dados };
  if (origem) base.origem = origem;
  if (nsu) base.nsu = `cte:${nsu}`;

  if (dados.tipo === 'evento' && dados.tpEvento === '110111' && dados.chaveNota) {
    await NotaFiscal.updateOne({ empresa: empresa._id, chave: dados.chaveNota }, { cancelada: true });
  }
  if (dados.chave && (await NotaFiscal.exists({ empresa: empresa._id, chave: dados.chave }))) return 'duplicado';
  try {
    await NotaFiscal.create(base);
    return 'novo';
  } catch (err) {
    if (err.code === 11000) return 'duplicado';
    throw err;
  }
}

/** Captura incremental de CT-e da empresa/pessoa. */
export async function capturarCTe(empresa, { origem = 'manual', maxLotes = 30 } = {}) {
  const inicio = Date.now();
  const ambiente = env.sefazAmbiente;

  const ultimo = await CapturaLog.findOne({ empresa: empresa._id, tipo: 'cte', ambiente }).sort('-createdAt').lean();
  if (
    ultimo &&
    ['137', '656'].includes(ultimo.cStat) &&
    Date.now() - new Date(ultimo.createdAt).getTime() < MINUTOS_ESPERA * 60 * 1000
  ) {
    const libera = new Date(new Date(ultimo.createdAt).getTime() + MINUTOS_ESPERA * 60 * 1000);
    return {
      status: 'sucesso',
      novos: 0,
      mensagem: `Nada novo na ultima consulta. Proxima consulta de CT-e liberada apos ${libera.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })}.`,
    };
  }

  let novos = 0;
  let total = 0;
  let cStat = '';
  let status = 'sucesso';
  let mensagem = '';

  try {
    const certificado = await obterCertificadoEmpresa(empresa);
    const url = ambiente === 'producao' ? CTE_ENDPOINTS.producao : CTE_ENDPOINTS.homologacao;

    for (let i = 0; i < maxLotes; i += 1) {
      const resposta = await postSoap({
        url,
        soapAction: SOAP_ACTION,
        xml: montarEnvelope({ doc: empresa.cnpj, uf: empresa.uf, ultimoNSU: empresa.ultimoNSUCte }),
        keyPem: certificado.keyPem,
        certPem: certificado.certPem,
      });
      const r = lerRetornoCte(resposta);
      cStat = r.cStat;
      mensagem = `${r.cStat} - ${r.xMotivo}`;

      if (r.cStat === '656') throw new Error(`${mensagem}. A SEFAZ bloqueou consultas por 1 hora.`);
      if (r.cStat !== '137' && r.cStat !== '138') throw new Error(mensagem);

      for (const d of r.docs) {
        let xml;
        try {
          xml = zlib.gunzipSync(Buffer.from(d.conteudo, 'base64')).toString('utf8');
        } catch {
          continue;
        }
        total += 1;
        if ((await salvarCte(empresa, { nsu: d.nsu, xml })) === 'novo') novos += 1;
      }

      if (r.ultNSU) {
        empresa.ultimoNSUCte = r.ultNSU;
        await Empresa.updateOne({ _id: empresa._id }, { ultimoNSUCte: r.ultNSU });
      }
      if (r.cStat === '137' || r.docs.length === 0) break;
      if (Number(r.ultNSU) >= Number(r.maxNSU)) break;
      await new Promise((ok) => setTimeout(ok, 1500));
    }
  } catch (err) {
    status = novos > 0 ? 'parcial' : 'erro';
    mensagem = err.message;
  }

  await CapturaLog.create({
    empresa: empresa._id,
    tipo: 'cte',
    origem,
    status,
    cStat,
    ambiente,
    novos,
    totalProcessado: total,
    ultimoNSU: empresa.ultimoNSUCte,
    mensagem,
    duracaoMs: Date.now() - inicio,
  });

  return { status, novos, mensagem };
}
