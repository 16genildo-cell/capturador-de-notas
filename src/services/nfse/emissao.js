import zlib from 'node:zlib';
import { SignedXml } from 'xml-crypto';
import { requisicaoMtls } from '../sefaz/soapClient.js';
import { obterCertificadoEmpresa } from '../sefaz/distribuicaoDFe.js';
import { salvarDocumentoNfse } from './index.js';
import { resumirNfseNacional } from './parseNfseNacional.js';
import { Empresa } from '../../models/Empresa.js';
import { NotaFiscal } from '../../models/NotaFiscal.js';
import { EmissaoNfse } from '../../models/EmissaoNfse.js';
import { soDigitos, tipoPessoa, validarCPF, validarCNPJ } from '../../utils/documento.js';

/**
 * Emissao de NFS-e pelo EMISSOR NACIONAL (API Sefin Nacional, gratuita).
 *
 * Fluxo: monta a DPS (Declaracao de Prestacao de Servico, leiaute 1.01), assina
 * (XMLDSig RSA-SHA256), compacta em GZip+Base64 e envia por mTLS com o certificado
 * A1 do prestador. A Sefin devolve a NFS-e autorizada ou a lista de rejeicoes.
 *
 * Vale para todos os municipios que liberam a emissao pelo padrao nacional.
 */
export const SEFIN_URL = {
  producao: 'https://sefin.nfse.gov.br/SefinNacional',
  homologacao: 'https://sefin.producaorestrita.nfse.gov.br/SefinNacional',
};
export const ADN_URL = {
  producao: 'https://adn.nfse.gov.br',
  homologacao: 'https://adn.producaorestrita.nfse.gov.br',
};

const NS = 'http://www.sped.fazenda.gov.br/nfse';
const VERSAO = '1.01';
const VER_APLIC = 'CapturaTotal1.0';

const ALG_ASSINATURA = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
const ALG_DIGEST = 'http://www.w3.org/2001/04/xmlenc#sha256';
const ALG_C14N = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';
const ENVELOPED = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature';

// ------------------------------------------------------------------ utilitarios

const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const el = (nome, conteudo) => `<${nome}>${conteudo}</${nome}>`;
const txt = (nome, valor) => (valor === undefined || valor === null || valor === '' ? '' : el(nome, esc(valor)));
const dinheiro = (v) => Number(v).toFixed(2);
const limparTexto = (t) => String(t ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();

/** Data/hora no fuso de Brasilia, formato da Sefin (AAAA-MM-DDThh:mm:ss-03:00). */
export function dataHoraBrasilia(data = new Date()) {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(data).reduce((a, x) => ({ ...a, [x.type]: x.value }), {});
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}-03:00`;
}

export const gzipB64 = (xml) => zlib.gzipSync(Buffer.from(xml, 'utf8')).toString('base64');
export const gunzipB64 = (b64) => zlib.gunzipSync(Buffer.from(b64, 'base64'), { maxOutputLength: 50 * 1024 * 1024 }).toString('utf8');

/** Mensagens de erro/alerta da Sefin em texto ("E0014 - Descricao (complemento)"). */
export function mensagensSefin(body, chave = 'erros') {
  if (!body || typeof body !== 'object') return [];
  const lista = body[chave] ?? body[chave.charAt(0).toUpperCase() + chave.slice(1)] ?? [];
  return (Array.isArray(lista) ? lista : [lista]).map((e) => {
    if (typeof e !== 'object' || !e) return String(e);
    const cod = e.Codigo ?? e.codigo ?? '';
    const desc = e.Descricao ?? e.descricao ?? e.Mensagem ?? e.mensagem ?? '';
    const comp = e.Complemento ?? e.complemento ?? '';
    return [cod, desc].filter(Boolean).join(' - ') + (comp ? ` (${comp})` : '');
  });
}

// ------------------------------------------------------------------ validacao

/**
 * Normaliza e valida os dados do formulario de emissao. Lanca Error com a lista
 * de problemas (em portugues) quando algo estiver errado.
 */
export function validarDados(dados, cfg, empresa) {
  const erros = [];
  const d = {
    tomador: { ...(dados.tomador || {}) },
    cTribNac: soDigitos(dados.cTribNac),
    cNBS: soDigitos(dados.cNBS),
    descricao: limparTexto(dados.descricao),
    cLocPrestacao: soDigitos(dados.cLocPrestacao || empresa.municipioCodigo),
    competencia: String(dados.competencia || '').slice(0, 10),
    valor: Number(String(dados.valor ?? '').replace(/\./g, '').replace(',', '.')) || Number(dados.valor) || 0,
    desconto: Number(String(dados.desconto ?? '').replace(/\./g, '').replace(',', '.')) || 0,
    issRetido: dados.issRetido === true || dados.issRetido === 'on' || dados.issRetido === '2',
    naoIncidencia: dados.naoIncidencia === true || dados.naoIncidencia === 'on',
    aliquota: dados.aliquota === '' || dados.aliquota === undefined ? null : Number(String(dados.aliquota).replace(',', '.')),
    infoComplementar: limparTexto(dados.infoComplementar),
  };

  if (!/^\d{7}$/.test(soDigitos(empresa.municipioCodigo))) {
    erros.push('Cadastre o codigo IBGE do municipio do prestador (7 digitos) na empresa.');
  }
  if (!/^\d{6}$/.test(d.cTribNac)) erros.push('Codigo de tributacao nacional deve ter 6 digitos (ex.: 01.07.01 -> 010701).');
  if (d.cNBS && !/^\d{9}$/.test(d.cNBS)) erros.push('Codigo NBS deve ter 9 digitos (ou deixe em branco).');
  if (d.descricao.length < 1) erros.push('Descreva o servico prestado.');
  if (d.descricao.length > 2000) erros.push('A descricao do servico pode ter no maximo 2000 caracteres.');
  if (!/^\d{7}$/.test(d.cLocPrestacao)) erros.push('Informe o codigo IBGE (7 digitos) do municipio onde o servico foi prestado.');
  if (!(d.valor > 0)) erros.push('Informe o valor do servico.');
  if (d.desconto < 0 || d.desconto >= d.valor) erros.push('O desconto deve ser menor que o valor do servico.');

  const hoje = dataHoraBrasilia().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.competencia)) d.competencia = hoje;
  if (d.competencia > hoje) erros.push('A competencia nao pode ser posterior a hoje.');

  if (d.aliquota !== null) {
    if (cfg.opSimpNac !== '3') d.aliquota = null; // so ME/EPP informa aliquota; os demais usam a do municipio
    else if (!(d.aliquota > 0 && d.aliquota < 10)) erros.push('Aliquota do ISS deve estar entre 0,01 e 9,99%.');
  }

  // Tomador
  const t = d.tomador;
  t.tipo = t.tipo || 'nenhum';
  if (t.tipo !== 'nenhum') {
    t.documento = soDigitos(t.documento);
    t.nome = limparTexto(t.nome);
    if (t.tipo === 'cpf' && !validarCPF(t.documento)) erros.push('CPF do tomador invalido.');
    if (t.tipo === 'cnpj' && !validarCNPJ(t.documento)) erros.push('CNPJ do tomador invalido.');
    if (!t.nome) erros.push('Informe o nome do tomador.');
    t.email = String(t.email || '').trim();
    if (t.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t.email)) erros.push('E-mail do tomador invalido.');
    t.cep = soDigitos(t.cep);
    t.cMun = soDigitos(t.cMun);
    const temEndereco = t.cep || t.logradouro || t.cMun;
    if (temEndereco) {
      if (!/^\d{8}$/.test(t.cep)) erros.push('CEP do tomador deve ter 8 digitos.');
      if (!/^\d{7}$/.test(t.cMun)) erros.push('Codigo IBGE do municipio do tomador deve ter 7 digitos (preenchido pelo CEP).');
      if (!limparTexto(t.logradouro)) erros.push('Informe o logradouro do tomador.');
      if (!limparTexto(t.bairro)) erros.push('Informe o bairro do tomador.');
    }
    t.temEndereco = Boolean(temEndereco);
  }

  if (cfg.opSimpNac === '3' && !(Number(cfg.pTotTribSN) >= 0)) erros.push('Configure o % aproximado de tributos do Simples.');

  if (erros.length) {
    const e = new Error(erros.join(' '));
    e.lista = erros;
    throw e;
  }
  return d;
}

// ------------------------------------------------------------------ DPS

/** Id da DPS: "DPS" + municipio(7) + tipo inscricao(1=CPF, 2=CNPJ) + inscricao(14) + serie(5) + numero(15). */
export function idDps(codMunicipio, documento, serie, nDPS) {
  const doc = soDigitos(documento);
  return (
    'DPS' +
    soDigitos(codMunicipio).padStart(7, '0') +
    (doc.length === 14 ? '2' : '1') +
    doc.padStart(14, '0') +
    soDigitos(serie).padStart(5, '0') +
    String(nDPS).padStart(15, '0')
  );
}

/** Monta o XML (sem assinatura) da DPS. */
export function montarDps({ empresa, cfg, d, nDPS, ambiente, dhEmi = dataHoraBrasilia(new Date(Date.now() - 60_000)) }) {
  const doc = soDigitos(empresa.cnpj);
  const id = idDps(empresa.municipioCodigo, doc, cfg.serie, nDPS);
  const docTag = tipoPessoa(doc) === 'PF' ? 'CPF' : 'CNPJ';

  const regTrib = el(
    'regTrib',
    txt('opSimpNac', cfg.opSimpNac) +
      (cfg.opSimpNac === '3' ? txt('regApTribSN', cfg.regApTribSN || '1') : '') +
      txt('regEspTrib', cfg.regEspTrib || '0'),
  );
  // Emitente = prestador: nome e endereco vem do cadastro nacional (nao enviar - E0121).
  const prest = el('prest', txt(docTag, doc) + regTrib);

  let toma = '';
  const t = d.tomador;
  if (t.tipo !== 'nenhum') {
    const end = t.temEndereco
      ? el(
          'end',
          el('endNac', txt('cMun', t.cMun) + txt('CEP', t.cep)) +
            txt('xLgr', limparTexto(t.logradouro).slice(0, 255)) +
            txt('nro', limparTexto(t.numero).slice(0, 60) || 'S/N') +
            txt('xCpl', limparTexto(t.complemento).slice(0, 156)) +
            txt('xBairro', limparTexto(t.bairro).slice(0, 60)),
        )
      : '';
    toma = el(
      'toma',
      txt(t.tipo === 'cpf' ? 'CPF' : 'CNPJ', t.documento) +
        txt('xNome', t.nome.slice(0, 300)) +
        end +
        txt('fone', soDigitos(t.fone).slice(0, 20)) +
        txt('email', t.email.slice(0, 80)),
    );
  }

  const serv = el(
    'serv',
    el('locPrest', txt('cLocPrestacao', d.cLocPrestacao)) +
      el('cServ', txt('cTribNac', d.cTribNac) + txt('xDescServ', d.descricao) + txt('cNBS', d.cNBS)) +
      (d.infoComplementar ? el('infoCompl', txt('xInfComp', d.infoComplementar.slice(0, 2000))) : ''),
  );

  const tribMun = el(
    'tribMun',
    txt('tribISSQN', d.naoIncidencia ? '4' : '1') +
      txt('tpRetISSQN', d.issRetido && !d.naoIncidencia ? '2' : '1') +
      (d.aliquota !== null && !d.naoIncidencia ? txt('pAliq', dinheiro(d.aliquota)) : ''),
  );
  const totTrib =
    cfg.opSimpNac === '3'
      ? el('totTrib', txt('pTotTribSN', dinheiro(cfg.pTotTribSN || 0)))
      : el('totTrib', txt('indTotTrib', '0'));

  const valores = el(
    'valores',
    el('vServPrest', txt('vServ', dinheiro(d.valor))) +
      (d.desconto > 0 ? el('vDescCondIncond', txt('vDescIncond', dinheiro(d.desconto))) : '') +
      el('trib', tribMun + totTrib),
  );

  const infDPS =
    `<infDPS Id="${id}">` +
    txt('tpAmb', ambiente === 'producao' ? '1' : '2') +
    txt('dhEmi', dhEmi) +
    txt('verAplic', VER_APLIC) +
    txt('serie', soDigitos(cfg.serie)) +
    txt('nDPS', String(nDPS)) +
    txt('dCompet', d.competencia > dhEmi.slice(0, 10) ? dhEmi.slice(0, 10) : d.competencia) +
    txt('tpEmit', '1') +
    txt('cLocEmi', soDigitos(empresa.municipioCodigo)) +
    prest +
    toma +
    serv +
    valores +
    `</infDPS>`;

  return { id, xml: `<DPS xmlns="${NS}" versao="${VERSAO}">${infDPS}</DPS>` };
}

/** Assina (XMLDSig enveloped) o elemento `local` que tem o Id `ref`. */
export function assinar(xml, ref, local, certificado) {
  const xpath = `//*[local-name(.)='${local}']`;
  const sig = new SignedXml({
    privateKey: certificado.keyPem,
    publicCert: certificado.certTitularPem || certificado.certPem,
    signatureAlgorithm: ALG_ASSINATURA,
    canonicalizationAlgorithm: ALG_C14N,
  });
  sig.addReference({ xpath, transforms: [ENVELOPED, ALG_C14N], digestAlgorithm: ALG_DIGEST, uri: `#${ref}` });
  sig.computeSignature(xml, { location: { reference: xpath, action: 'after' } });
  return `<?xml version="1.0" encoding="UTF-8"?>${sig.getSignedXml()}`;
}

// ------------------------------------------------------------------ comunicacao

async function chamarSefin(ambiente, certificado, metodo, caminho, corpo) {
  const { status, body } = await requisicaoMtls({
    method: metodo,
    url: `${SEFIN_URL[ambiente]}${caminho}`,
    headers: corpo ? { 'Content-Type': 'application/json', Accept: 'application/json' } : { Accept: 'application/json' },
    body: corpo ? JSON.stringify(corpo) : undefined,
    keyPem: certificado.keyPem,
    certPem: certificado.certPem,
  });
  let json = null;
  try {
    json = body ? JSON.parse(body) : null;
  } catch {
    json = null;
  }
  if (!json && (status === 401 || status === 403)) {
    throw new Error(`A Sefin Nacional recusou o certificado (HTTP ${status}). Use o certificado A1 do prestador.`);
  }
  return { status, json, texto: body };
}

/** Situacao do municipio no convenio nacional (adesao e emissor nacional). */
export async function consultarConvenio(empresa, ambiente) {
  const certificado = await obterCertificadoEmpresa(empresa);
  const cMun = soDigitos(empresa.municipioCodigo);
  if (!/^\d{7}$/.test(cMun)) throw new Error('Cadastre o codigo IBGE do municipio na empresa.');
  const { status, body } = await requisicaoMtls({
    method: 'GET',
    url: `${ADN_URL[ambiente]}/parametrizacao/${cMun}/convenio`,
    headers: { Accept: 'application/json' },
    keyPem: certificado.keyPem,
    certPem: certificado.certPem,
  });
  let json = null;
  try {
    json = JSON.parse(body);
  } catch {
    // resposta nao-JSON
  }
  if (status >= 400 || !json) {
    return { ok: false, mensagem: json?.mensagem || `Nao foi possivel consultar o convenio (HTTP ${status}).` };
  }
  const p = json.parametrosConvenio || {};
  return {
    ok: true,
    aderenteAmbienteNacional: p.aderenteAmbienteNacional === 1,
    aderenteEmissorNacional: p.aderenteEmissorNacional === 1,
    mensagem: json.mensagem || '',
    bruto: p,
  };
}

// ------------------------------------------------------------------ emissao

const travas = new Set();

/** Grava a NFS-e autorizada na lista de notas (somente producao) e devolve o id. */
async function gravarNota(empresa, ambiente, nfseXml) {
  if (ambiente !== 'producao') return null;
  await salvarDocumentoNfse(empresa, { xml: nfseXml, origem: 'emissao' });
  const { chave } = resumirNfseNacional(nfseXml, empresa.cnpj);
  const nota = await NotaFiscal.findOne({ empresa: empresa._id, chave }).select('_id').lean();
  return nota?._id || null;
}

async function avancarNumeracao(empresa, ambiente, nDPS) {
  const atual = Number(empresa.emissaoNfse?.numeracao?.[ambiente] || 0);
  if (nDPS > atual) {
    await Empresa.updateOne({ _id: empresa._id }, { [`emissaoNfse.numeracao.${ambiente}`]: nDPS });
  }
}

/**
 * Emite uma NFS-e. Retorna o registro de EmissaoNfse (status autorizada, rejeitada ou sem_resposta).
 * O numero da DPS so avanca quando a Sefin aceita; reenviar o mesmo numero e seguro
 * (duplicata -> E0014 -> o sistema recupera a nota ja gerada).
 */
export async function emitirNfse(empresaId, dados, { usuarioId } = {}) {
  const empresa = await Empresa.findById(empresaId).populate('certificado');
  if (!empresa) throw new Error('Empresa nao encontrada.');
  const cfg = empresa.emissaoNfse?.toObject?.() || empresa.emissaoNfse || {};
  if (!cfg.ativa) throw new Error('A emissao de NFS-e nao esta configurada para esta empresa.');
  const ambiente = cfg.ambiente === 'producao' ? 'producao' : 'homologacao';

  const d = validarDados(dados, cfg, empresa);
  const certificado = await obterCertificadoEmpresa(empresa);

  const chaveTrava = String(empresa._id);
  if (travas.has(chaveTrava)) throw new Error('Ja existe uma emissao em andamento para esta empresa. Aguarde.');
  travas.add(chaveTrava);
  try {
    const nDPS = Number(cfg.numeracao?.[ambiente] || 0) + 1;
    const { id, xml } = montarDps({ empresa, cfg, d, nDPS, ambiente });
    const assinado = assinar(xml, id, 'infDPS', certificado);

    const base = {
      owner: empresa.owner,
      empresa: empresa._id,
      usuario: usuarioId,
      ambiente,
      serie: soDigitos(cfg.serie),
      nDPS,
      dpsId: id,
      tomadorNome: d.tomador.tipo === 'nenhum' ? '' : d.tomador.nome,
      tomadorDocumento: d.tomador.documento || '',
      descricao: d.descricao.slice(0, 300),
      valor: d.valor,
      competencia: d.competencia,
      dpsXml: assinado,
      dados,
    };

    let resposta;
    try {
      resposta = await chamarSefin(ambiente, certificado, 'POST', '/nfse', { dpsXmlGZipB64: gzipB64(assinado) });
    } catch (err) {
      return EmissaoNfse.create({
        ...base,
        status: 'sem_resposta',
        erros: [
          `Sem resposta da Sefin: ${err.message}`,
          `Tente emitir de novo: o mesmo numero (DPS ${nDPS}) sera usado; se a nota ja tiver sido gerada, o sistema a recupera.`,
        ],
      });
    }

    const { status, json } = resposta;
    const nfseB64 = json?.nfseXmlGZipB64 ?? json?.NfseXmlGZipB64;
    if (status >= 200 && status < 300 && nfseB64) {
      const nfseXml = gunzipB64(nfseB64);
      await avancarNumeracao(empresa, ambiente, nDPS);
      const nota = await gravarNota(empresa, ambiente, nfseXml);
      return EmissaoNfse.create({
        ...base,
        status: 'autorizada',
        chaveAcesso: json.chaveAcesso || resumirNfseNacional(nfseXml, empresa.cnpj).chave,
        nfseXml,
        nota,
        alertas: mensagensSefin(json, 'alertas'),
      });
    }

    const erros = mensagensSefin(json);
    // DPS ja processada antes (ex.: emissao anterior sem resposta): recupera a nota existente.
    if (erros.some((e) => e.startsWith('E0014'))) {
      try {
        const dps = await chamarSefin(ambiente, certificado, 'GET', `/dps/${id}`);
        const chave = dps.json?.chaveAcesso;
        if (chave) {
          const n = await chamarSefin(ambiente, certificado, 'GET', `/nfse/${chave}`);
          const b64 = n.json?.nfseXmlGZipB64;
          if (b64) {
            const nfseXml = gunzipB64(b64);
            await avancarNumeracao(empresa, ambiente, nDPS);
            const nota = await gravarNota(empresa, ambiente, nfseXml);
            const ja = await EmissaoNfse.findOne({ empresa: empresa._id, chaveAcesso: chave, status: 'autorizada' });
            if (ja) return ja;
            return EmissaoNfse.create({ ...base, status: 'autorizada', chaveAcesso: chave, nfseXml, nota, alertas: ['Nota recuperada: esta DPS ja havia sido autorizada antes.'] });
          }
        }
      } catch {
        // segue como rejeitada
      }
      await avancarNumeracao(empresa, ambiente, nDPS); // numero ja usado na Sefin
    }

    return EmissaoNfse.create({
      ...base,
      status: 'rejeitada',
      erros: erros.length ? erros : [`A Sefin respondeu HTTP ${status} sem detalhes.`],
    });
  } finally {
    travas.delete(chaveTrava);
  }
}

// ------------------------------------------------------------------ cancelamento

export const MOTIVOS_CANCELAMENTO = { 1: 'Erro na emissao', 2: 'Servico nao prestado', 9: 'Outros' };

/** Monta o pedido de registro do evento de cancelamento (101101). */
export function montarCancelamento({ empresa, chave, ambiente, cMotivo, xMotivo, dhEvento = dataHoraBrasilia(new Date(Date.now() - 60_000)) }) {
  const doc = soDigitos(empresa.cnpj);
  const id = `PRE${chave}101101`;
  const xml =
    `<pedRegEvento xmlns="${NS}" versao="${VERSAO}"><infPedReg Id="${id}">` +
    txt('tpAmb', ambiente === 'producao' ? '1' : '2') +
    txt('verAplic', VER_APLIC) +
    txt('dhEvento', dhEvento) +
    txt(tipoPessoa(doc) === 'PF' ? 'CPFAutor' : 'CNPJAutor', doc) +
    txt('chNFSe', chave) +
    el('e101101', txt('xDesc', 'Cancelamento de NFS-e') + txt('cMotivo', String(cMotivo)) + txt('xMotivo', xMotivo)) +
    `</infPedReg></pedRegEvento>`;
  return { id, xml };
}

/** Cancela uma NFS-e emitida pelo sistema. Retorna { ok, mensagem }. */
export async function cancelarNfse(emissaoId, owner, { cMotivo, xMotivo }) {
  const emissao = await EmissaoNfse.findOne({ _id: emissaoId, owner });
  if (!emissao) throw new Error('Emissao nao encontrada.');
  if (emissao.status !== 'autorizada' || !emissao.chaveAcesso) throw new Error('So notas autorizadas podem ser canceladas.');
  if (!MOTIVOS_CANCELAMENTO[cMotivo]) throw new Error('Escolha o motivo do cancelamento.');
  const motivo = limparTexto(xMotivo);
  if (motivo.length < 15 || motivo.length > 255) throw new Error('Descreva o motivo com 15 a 255 caracteres.');

  const empresa = await Empresa.findById(emissao.empresa).populate('certificado');
  const certificado = await obterCertificadoEmpresa(empresa);
  const { id, xml } = montarCancelamento({ empresa, chave: emissao.chaveAcesso, ambiente: emissao.ambiente, cMotivo, xMotivo: motivo });
  const assinado = assinar(xml, id, 'infPedReg', certificado);

  const { status, json } = await chamarSefin(emissao.ambiente, certificado, 'POST', `/nfse/${emissao.chaveAcesso}/eventos`, {
    pedRegXmlGZipB64: gzipB64(assinado),
  });
  if (status < 200 || status >= 300) {
    const erros = mensagensSefin(json);
    return { ok: false, mensagem: `Cancelamento recusado: ${erros.join('; ') || `HTTP ${status}`}` };
  }
  const eventoB64 = json?.eventoXmlGZipB64 ?? json?.EventoXmlGZipB64;
  const eventoXml = eventoB64 ? gunzipB64(eventoB64) : assinado;
  emissao.status = 'cancelada';
  emissao.eventoCancelamentoXml = eventoXml;
  await emissao.save();
  if (emissao.ambiente === 'producao') {
    await NotaFiscal.updateOne({ empresa: empresa._id, chave: emissao.chaveAcesso }, { cancelada: true });
    if (eventoB64) await salvarDocumentoNfse(empresa, { xml: eventoXml, nsu: `cancel-${emissao.chaveAcesso}`, origem: 'emissao' });
  }
  return { ok: true, mensagem: 'NFS-e cancelada na Sefin Nacional.' };
}
