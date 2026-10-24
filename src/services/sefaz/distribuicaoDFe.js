import { cienciaAutomaticaDaConta } from '../contas.js';
import zlib from 'node:zlib';
import { getEndpoints, SOAP_ACTION, codigoUF } from './endpoints.js';
import { postSoap } from './soapClient.js';
import { xmlToObj, resumirDocumento } from './parseDocumento.js';
import { env, tpAmb } from '../../config/env.js';
import { materializarCertificado } from '../crypto/certificado.js';
import { NotaFiscal } from '../../models/NotaFiscal.js';
import { CapturaLog } from '../../models/CapturaLog.js';
import { Empresa } from '../../models/Empresa.js';
import { Certificado } from '../../models/Certificado.js';
import { tagDocumento, tipoPessoa, formatarDocumento } from '../../utils/documento.js';

/**
 * Codigos de retorno (cStat) da Distribuicao DF-e mais comuns:
 *  137 = Nenhum documento localizado (nada novo; aguardar 1h antes de consultar de novo)
 *  138 = Documento(s) localizado(s)
 *  656 = Consumo indevido (consultou demais; SEFAZ bloqueia por 1h)
 *  593 = CNPJ-Base do consultado difere do CNPJ-Base do certificado
 *  589 = NSU informado superior ao maior NSU da base
 *  632 = Solicitacao fora do prazo (nota com mais de 90 dias)
 *  640 = CNPJ/CPF do interessado nao tem permissao para consultar a chave
 *  653 = NF-e cancelada, arquivo indisponivel para download
 *  654 = NF-e denegada, arquivo indisponivel para download
 */
const MINUTOS_ESPERA_APOS_137 = 61;

/** Monta o envelope SOAP da consulta (por NSU incremental ou por chave de acesso). */
function montarEnvelope({ cnpj, uf, ultimoNSU, chave }) {
  const consulta = chave
    ? `<consChNFe><chNFe>${chave}</chNFe></consChNFe>`
    : `<distNSU><ultNSU>${String(ultimoNSU || '0').padStart(15, '0')}</ultNSU></distNSU>`;

  const distDFeInt =
    `<distDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01">` +
    `<tpAmb>${tpAmb()}</tpAmb>` +
    `<cUFAutor>${codigoUF(uf)}</cUFAutor>` +
    tagDocumento(cnpj) + // <CNPJ> para empresa, <CPF> para pessoa fisica
    consulta +
    `</distDFeInt>`;

  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ` +
    `xmlns:xsd="http://www.w3.org/2001/XMLSchema" ` +
    `xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">` +
    `<soap12:Body>` +
    `<nfeDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe">` +
    `<nfeDadosMsg>${distDFeInt}</nfeDadosMsg>` +
    `</nfeDistDFeInteresse>` +
    `</soap12:Body>` +
    `</soap12:Envelope>`
  );
}

/** Descompacta o conteudo base64+gzip de um <docZip>. */
function descompactarDocZip(base64) {
  const buf = Buffer.from(base64, 'base64');
  return zlib.gunzipSync(buf).toString('utf8');
}

/** Extrai o <retDistDFeInt> da resposta SOAP. */
export function lerRetorno(respostaXml) {
  const resp = xmlToObj(respostaXml);
  const result = resp?.Envelope?.Body?.nfeDistDFeInteresseResponse?.nfeDistDFeInteresseResult;
  const ret = result?.retDistDFeInt || result;
  if (!ret || ret.cStat === undefined) {
    const fault = resp?.Envelope?.Body?.Fault;
    const motivo = fault ? JSON.stringify(fault).slice(0, 300) : respostaXml.slice(0, 400);
    throw new Error(`Resposta inesperada da SEFAZ: ${motivo}`);
  }

  let docs = ret?.loteDistDFeInt?.docZip || [];
  if (!Array.isArray(docs)) docs = docs ? [docs] : [];

  return {
    cStat: String(ret.cStat || ''),
    xMotivo: String(ret.xMotivo || ''),
    ultNSU: ret.ultNSU !== undefined ? String(ret.ultNSU) : null,
    maxNSU: ret.maxNSU !== undefined ? String(ret.maxNSU) : null,
    docs: docs
      .map((d) => ({
        nsu: typeof d === 'string' ? '' : String(d['@_NSU'] || ''),
        conteudo: typeof d === 'string' ? d : d['#text'],
      }))
      .filter((d) => d.conteudo),
  };
}

const MANIFESTACAO_POR_EVENTO = {
  210200: 'confirmada',
  210210: 'ciencia',
  210220: 'desconhecida',
  210240: 'nao_realizada',
};

/**
 * Grava um documento recebido da SEFAZ.
 *  - Nota nova: cria.
 *  - Ja existia so o RESUMO e agora chegou o XML COMPLETO: substitui.
 *  - Eventos: gravados a parte (por NSU) e refletidos na nota (cancelamento, manifestacao).
 * Retorna 'novo', 'atualizado' ou 'duplicado'.
 */
export async function salvarDocumento(empresa, { nsu, xml, origem = 'sefaz-distdfe' }) {
  const dados = resumirDocumento(xml, empresa.cnpj);
  const base = {
    empresa: empresa._id,
    owner: empresa.owner,
    origem,
    ...dados,
  };
  if (nsu) base.nsu = nsu;

  if (dados.tipo === 'evento') {
    if (dados.chaveNota) {
      if (dados.tpEvento === '110111') {
        await NotaFiscal.updateOne({ empresa: empresa._id, chave: dados.chaveNota }, { cancelada: true });
      }
      const situacao = MANIFESTACAO_POR_EVENTO[dados.tpEvento];
      if (situacao) {
        await NotaFiscal.updateOne(
          { empresa: empresa._id, chave: dados.chaveNota },
          { situacaoManifestacao: situacao },
        );
      }
    }
    if (!nsu) return 'duplicado'; // evento sem NSU: nao ha como evitar duplicata
    try {
      await NotaFiscal.create(base);
      return 'novo';
    } catch (err) {
      if (err.code === 11000) return 'duplicado';
      throw err;
    }
  }

  if (dados.chave) {
    const existente = await NotaFiscal.findOne({ empresa: empresa._id, chave: dados.chave })
      .select('_id resumo situacaoManifestacao')
      .lean();
    if (existente) {
      if (existente.resumo && !dados.resumo) {
        // Chegou o XML completo de uma nota que so tinha resumo.
        const atualizacao = { ...base, resumo: false, mensagemManifestacao: '', arquivoEm: new Date() };
        if (existente.situacaoManifestacao !== 'nao_aplicavel') {
          atualizacao.situacaoManifestacao =
            existente.situacaoManifestacao === 'pendente' ? 'ciencia' : existente.situacaoManifestacao;
        }
        await NotaFiscal.updateOne({ _id: existente._id }, atualizacao);
        return 'atualizado';
      }
      return 'duplicado';
    }
  }

  try {
    await NotaFiscal.create(base);
    return 'novo';
  } catch (err) {
    if (err.code === 11000) return 'duplicado';
    throw err;
  }
}

/** Chama o web service de distribuicao e grava os documentos retornados. */
async function chamarDistribuicao(empresa, certificado, consulta) {
  const endpoints = getEndpoints(env.sefazAmbiente);
  const xml = montarEnvelope({ cnpj: empresa.cnpj, uf: empresa.uf, ...consulta });

  const respostaXml = await postSoap({
    url: endpoints.distribuicaoDFe,
    soapAction: SOAP_ACTION.distribuicaoDFe,
    xml,
    keyPem: certificado.keyPem,
    certPem: certificado.certPem,
  });

  const ret = lerRetorno(respostaXml);

  let novos = 0;
  let atualizados = 0;
  for (const doc of ret.docs) {
    let xmlDoc;
    try {
      xmlDoc = descompactarDocZip(doc.conteudo);
    } catch {
      continue;
    }
    const r = await salvarDocumento(empresa, { nsu: doc.nsu, xml: xmlDoc });
    if (r === 'novo') novos += 1;
    if (r === 'atualizado') atualizados += 1;
  }

  return { ...ret, novos, atualizados, totalDocs: ret.docs.length };
}

/**
 * Executa UMA consulta incremental (distNSU) e atualiza o ponteiro de NSU da empresa.
 * A SEFAZ entrega ate 50 documentos por chamada; o campo maxNSU indica se ha mais.
 */
export async function consultarLote(empresa, certificado) {
  const r = await chamarDistribuicao(empresa, certificado, { ultimoNSU: empresa.ultimoNSU });

  if (r.cStat === '137' || r.cStat === '138') {
    const ultNSU = r.ultNSU || empresa.ultimoNSU;
    const maxNSU = r.maxNSU || empresa.maxNSU;
    await Empresa.updateOne({ _id: empresa._id }, { ultimoNSU: ultNSU, maxNSU });
    empresa.ultimoNSU = ultNSU;
    empresa.maxNSU = maxNSU;
  }
  return r;
}

/**
 * Baixa um documento especifico pela chave de acesso (consChNFe).
 * Usado depois da Ciencia da Operacao para obter o XML completo.
 */
export async function consultarChave(empresa, certificado, chave) {
  return chamarDistribuicao(empresa, certificado, { chave });
}

/** Carrega e descriptografa o certificado, conferindo se pertence ao mesmo CNPJ/CPF cadastrado. */
export async function obterCertificadoEmpresa(empresa) {
  if (!empresa.certificado) {
    throw new Error('A empresa nao tem certificado digital vinculado.');
  }
  const certDoc = empresa.certificado.pfxCriptografado
    ? empresa.certificado
    : await Certificado.findById(empresa.certificado);
  if (!certDoc) throw new Error('Certificado digital nao encontrado.');

  const certificado = materializarCertificado(certDoc);

  // Regras da SEFAZ:
  //  - e-CNPJ consulta apenas CNPJs da mesma raiz (8 primeiros digitos);
  //  - pessoa fisica (CPF) so pode ser consultada com o e-CPF dela mesma.
  const docCert = String(certificado.cnpjCpf || '').replace(/\D/g, '');
  const docCad = String(empresa.cnpj || '');
  const tipoCert = tipoPessoa(docCert);
  const tipoCad = tipoPessoa(docCad);

  if (tipoCad === 'PF') {
    if (tipoCert === 'PJ') {
      throw new Error(
        `Para consultar notas do CPF ${formatarDocumento(docCad)} e preciso o e-CPF dessa pessoa. ` +
          `O certificado vinculado e um e-CNPJ (${formatarDocumento(docCert)}).`,
      );
    }
    if (tipoCert === 'PF' && docCert !== docCad) {
      throw new Error(
        `O e-CPF vinculado e do CPF ${formatarDocumento(docCert)}, mas o cadastro e do CPF ${formatarDocumento(docCad)}. ` +
          'Cada pessoa fisica so pode consultar as proprias notas.',
      );
    }
  } else if (tipoCad === 'PJ') {
    if (tipoCert === 'PF') {
      throw new Error(
        `O certificado vinculado e um e-CPF (${formatarDocumento(docCert)}); para consultar o CNPJ ` +
          `${formatarDocumento(docCad)} e preciso o e-CNPJ da empresa.`,
      );
    }
    if (tipoCert === 'PJ' && docCert.slice(0, 8) !== docCad.slice(0, 8)) {
      throw new Error(
        `O certificado e do CNPJ ${formatarDocumento(docCert)}, mas a empresa esta cadastrada com o CNPJ ` +
          `${formatarDocumento(docCad)}. A SEFAZ so permite consultar CNPJs da mesma raiz do certificado.`,
      );
    }
  }
  return certificado;
}

/** Explica os cStat de erro mais comuns em portugues claro. */
function explicarCStat(cStat, xMotivo) {
  const dicas = {
    656: 'A SEFAZ bloqueou consultas deste CNPJ/CPF por 1 hora por excesso de consultas. Aguarde e tente de novo.',
    593: 'O CNPJ da empresa nao e da mesma raiz do CNPJ do certificado.',
    589: 'O ponteiro de NSU ficou a frente da SEFAZ; ele foi zerado e sera recapturado na proxima vez.',
    215: 'Falha de schema no pedido enviado.',
    252: 'Ambiente informado difere do ambiente do web service.',
  };
  const dica = dicas[cStat] ? ` ${dicas[cStat]}` : '';
  return `${cStat} - ${xMotivo}.${dica}`;
}

/**
 * Captura COMPLETA de NF-e: repete a consulta ate alcancar o maxNSU (ou um limite de
 * seguranca), respeitando as regras de uso da SEFAZ.
 */
export async function capturarNFe(empresa, { origem = 'manual', maxLotes = 50 } = {}) {
  const inicio = Date.now();

  // Regra da SEFAZ: depois de um 137 (nada novo) ou 656 (bloqueio), so consultar de novo
  // apos 1 hora. Consultar antes gera bloqueio (656) e atrasa ainda mais a captura.
  // A regra vale por ambiente: um 137 de homologacao nao bloqueia a producao.
  const ambiente = env.sefazAmbiente;
  const ultimoLog = await CapturaLog.findOne({ empresa: empresa._id, tipo: 'nfe', ambiente, cStat: { $in: ['137', '656'] } })
    .sort('-createdAt')
    .lean();
  const ultimaComNovidade = await CapturaLog.findOne({ empresa: empresa._id, tipo: 'nfe', ambiente, cStat: '138' })
    .sort('-createdAt')
    .lean();
  if (
    ultimoLog &&
    (!ultimaComNovidade || ultimoLog.createdAt > ultimaComNovidade.createdAt) &&
    Date.now() - new Date(ultimoLog.createdAt).getTime() < MINUTOS_ESPERA_APOS_137 * 60 * 1000
  ) {
    const liberaEm = new Date(new Date(ultimoLog.createdAt).getTime() + MINUTOS_ESPERA_APOS_137 * 60 * 1000);
    const hora = liberaEm.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    return {
      status: 'sucesso',
      novos: 0,
      total: 0,
      mensagem: `Nada novo na ultima consulta. Pela regra da SEFAZ, a proxima consulta so pode ser feita apos ${hora}.`,
    };
  }

  let totalNovos = 0;
  let totalAtualizados = 0;
  let totalDocs = 0;
  let ultResultado = null;
  let status = 'sucesso';
  let mensagem = '';
  let cStat = '';

  try {
    const certificado = await obterCertificadoEmpresa(empresa);

    for (let i = 0; i < maxLotes; i += 1) {
      const r = await consultarLote(empresa, certificado);
      ultResultado = r;
      cStat = r.cStat;
      totalNovos += r.novos;
      totalAtualizados += r.atualizados;
      totalDocs += r.totalDocs;

      if (r.cStat === '589') {
        await Empresa.updateOne({ _id: empresa._id }, { ultimoNSU: '000000000000000' });
      }
      if (r.cStat !== '137' && r.cStat !== '138') {
        throw new Error(explicarCStat(r.cStat, r.xMotivo));
      }
      // 137 = nada novo; ou chegou ao fim do que esta disponivel.
      if (r.cStat === '137' || r.totalDocs === 0) break;
      if (Number(r.ultNSU) >= Number(r.maxNSU)) break;

      // Intervalo entre consultas consecutivas.
      await esperar(1500);
    }

    mensagem = ultResultado ? `${ultResultado.cStat} - ${ultResultado.xMotivo}` : 'Sem resposta';
    if (totalAtualizados > 0) mensagem += ` (${totalAtualizados} resumo(s) trocado(s) pelo XML completo)`;

    // Como no vFisco: da ciencia nas notas que vieram so como resumo para liberar o XML completo.
    if (await cienciaAutomaticaDaConta(empresa.owner)) {
      const { manifestarPendentes } = await import('./manifestacao.js');
      const m = await manifestarPendentes(empresa, certificado);
      if (m.enviadas > 0 || m.erros > 0) {
        mensagem += ` | Ciencia enviada para ${m.enviadas} nota(s)`;
        if (m.erros > 0) mensagem += `, ${m.erros} com erro`;
        if (m.baixadas > 0) mensagem += `, ${m.baixadas} XML(s) completo(s) baixado(s)`;
      }
    }
  } catch (err) {
    status = totalNovos > 0 ? 'parcial' : 'erro';
    mensagem = err.message;
  }

  await CapturaLog.create({
    empresa: empresa._id,
    tipo: 'nfe',
    origem,
    status,
    cStat,
    ambiente: env.sefazAmbiente,
    novos: totalNovos,
    totalProcessado: totalDocs,
    ultimoNSU: empresa.ultimoNSU,
    maxNSU: empresa.maxNSU,
    mensagem,
    duracaoMs: Date.now() - inicio,
  });

  return { status, novos: totalNovos, total: totalDocs, mensagem };
}

function esperar(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
