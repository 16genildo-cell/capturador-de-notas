import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { SignedXml } from 'xml-crypto';
import { codigoUF } from '../sefaz/endpoints.js';
import { soDigitos } from '../../utils/documento.js';

/**
 * Montagem do XML da NF-e (modelo 55) e da NFC-e (modelo 65), leiaute 4.00 (PL_010),
 * para emitentes do Simples Nacional (CRT 1) e MEI (CRT 4).
 *
 * Fluxo: validarVenda() -> montarNFe() -> assinarNFe() -> (NFC-e) incluirQrCode().
 */

const require = createRequire(import.meta.url);
export const WEBSERVICES = require('./webservices.json');

export const NS = 'http://www.portalfiscal.inf.br/nfe';
export const VERSAO = '4.00';
export const VER_PROC = 'CapturaTotal 1.0';
export const TEXTO_HOMOLOGACAO_DEST = 'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL';
export const TEXTO_HOMOLOGACAO_ITEM = 'NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL';

export const FORMAS_PAGAMENTO = {
  '01': 'Dinheiro',
  '03': 'Cartao de credito',
  '04': 'Cartao de debito',
  '17': 'PIX',
  '05': 'Credito loja (crediario)',
  '15': 'Boleto bancario',
  '16': 'Deposito bancario',
  '90': 'Sem pagamento',
};
// Pagamentos com cartao/PIX: o grupo <card> e informado com tpIntegra=2 (sem integracao com a maquininha)
const PAGAMENTO_COM_CARD = ['03', '04', '17'];

export const CSOSN = {
  101: 'Tributada com permissao de credito',
  102: 'Tributada sem permissao de credito',
  103: 'Isencao do ICMS para faixa de receita bruta',
  300: 'Imune',
  400: 'Nao tributada',
  500: 'ICMS cobrado anteriormente por substituicao tributaria',
  900: 'Outros',
};

export const PRESENCA = {
  1: 'Presencial',
  2: 'Internet',
  3: 'Teleatendimento',
  4: 'Entrega em domicilio (NFC-e)',
  9: 'Outros',
};

// CFOPs aceitos na NFC-e (venda a consumidor dentro do estado)
const CFOP_NFCE = ['5101', '5102', '5103', '5104', '5115', '5405', '5656', '5667', '5933'];

// ---------------------------------------------------------------- utilidades

/** Texto aceito pela SEFAZ: sem espacos nas pontas, sem caracteres de controle e so ate Latin-1. */
export function textoSefaz(v, max = 0) {
  let s = String(v ?? '')
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/…/g, '...')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/[^ -ÿ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (max && s.length > max) s = s.slice(0, max).trim();
  return s;
}

export function esc(v) {
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const t = (tag, v) => (v === undefined || v === null || v === '' ? '' : `<${tag}>${esc(v)}</${tag}>`);
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const f2 = (n) => r2(n).toFixed(2);
const f4 = (n) => (Math.round((Number(n) + Number.EPSILON) * 10000) / 10000).toFixed(4);

/** Numero digitado ("1.234,56", "1234.56", 10) -> Number (NaN se invalido; null se vazio). */
export function numeroBr(v) {
  if (v === undefined || v === null || String(v).trim() === '') return null;
  if (typeof v === 'number') return v;
  let s = String(v).trim().replace(/\s/g, '').replace(/^R\$/i, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/** Digito verificador da chave de acesso (modulo 11, pesos 2 a 9). */
export function digitoChave(chave43) {
  let soma = 0;
  let peso = 2;
  for (let i = chave43.length - 1; i >= 0; i -= 1) {
    soma += Number(chave43[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

export function montarChave({ cUF, aamm, documento, modelo, serie, numero, tpEmis = 1, cNF }) {
  const base =
    String(cUF).padStart(2, '0') +
    aamm +
    soDigitos(documento).padStart(14, '0') +
    modelo +
    String(serie).padStart(3, '0') +
    String(numero).padStart(9, '0') +
    String(tpEmis) +
    String(cNF).padStart(8, '0');
  return base + digitoChave(base);
}

/** Codigo numerico aleatorio da chave (8 digitos, diferente do numero da nota). */
export function codigoNumerico(numero) {
  for (;;) {
    const c = String(crypto.randomInt(10000000, 99999999));
    if (c !== String(numero).padStart(8, '0')) return c;
  }
}

export function webservices(uf, modelo, ambiente) {
  const reg = WEBSERVICES[modelo]?.[String(uf || '').toUpperCase()];
  const ws = reg?.[ambiente];
  if (!ws?.autorizacao) throw new Error(`Nao ha web service de ${modelo === '65' ? 'NFC-e' : 'NF-e'} cadastrado para a UF ${uf}.`);
  return ws;
}

// ---------------------------------------------------------------- validacao

function erroLista(lista) {
  return Object.assign(new Error(lista.join(' ')), { lista });
}

/**
 * Confere e normaliza a venda digitada. Lanca erro com .lista (mensagens em portugues).
 * venda = { modelo, dest, itens: [{ produto, quantidade, valorUnitario, desconto }], pagamento, presenca, infComplementar }
 */
export function validarVenda(venda, cfg, empresa) {
  const erros = [];
  const modelo = venda.modelo === '65' ? '65' : '55';
  const end = empresa.endereco || {};

  // Emitente
  if (!['1', '4'].includes(String(cfg.crt || '1'))) erros.push('Por enquanto a emissao atende Simples Nacional (CRT 1) e MEI (CRT 4).');
  if (!soDigitos(empresa.inscricaoEstadual)) erros.push('Cadastre a Inscricao Estadual da empresa.');
  if (soDigitos(empresa.municipioCodigo).length !== 7) erros.push('Cadastre o codigo IBGE do municipio da empresa (7 digitos).');
  if (!empresa.municipioNome) erros.push('Cadastre o nome do municipio da empresa.');
  if (!end.logradouro || !end.numero || !end.bairro) erros.push('Cadastre o endereco completo da empresa (logradouro, numero e bairro).');
  if (soDigitos(end.cep).length !== 8) erros.push('Cadastre o CEP da empresa (8 digitos).');

  // Destinatario
  const d = venda.dest || {};
  const docDest = soDigitos(d.documento);
  let dest = null;
  if (modelo === '55' || docDest) {
    const tipo = docDest.length === 14 ? 'cnpj' : docDest.length === 11 ? 'cpf' : null;
    if (!tipo) erros.push(modelo === '55' ? 'Informe o CPF ou CNPJ do cliente (11 ou 14 digitos).' : 'CPF/CNPJ do consumidor invalido (11 ou 14 digitos).');
    dest = {
      tipo,
      documento: docDest,
      nome: textoSefaz(d.nome, 60),
      email: textoSefaz(d.email, 60),
      fone: soDigitos(d.fone),
      ie: soDigitos(d.ie),
      indIEDest: tipo === 'cpf' ? '9' : ['1', '2', '9'].includes(String(d.indIEDest)) ? String(d.indIEDest) : soDigitos(d.ie) ? '1' : '9',
      cep: soDigitos(d.cep),
      logradouro: textoSefaz(d.logradouro, 60),
      numero: textoSefaz(d.numero, 60) || 'S/N',
      complemento: textoSefaz(d.complemento, 60),
      bairro: textoSefaz(d.bairro, 60),
      cMun: soDigitos(d.cMun),
      cidade: textoSefaz(d.cidade, 60),
      uf: String(d.uf || '').toUpperCase().trim(),
    };
    if (modelo === '55') {
      if (!dest.nome) erros.push('Informe o nome / razao social do cliente.');
      if (!dest.logradouro || !dest.bairro) erros.push('Informe o endereco do cliente (logradouro e bairro).');
      if (dest.cep.length !== 8) erros.push('Informe o CEP do cliente (8 digitos).');
      if (dest.cMun.length !== 7 || !dest.cidade || dest.uf.length !== 2) erros.push('Cidade do cliente invalida: preencha o CEP para buscar o municipio (codigo IBGE).');
      if (dest.indIEDest === '1' && !dest.ie) erros.push('Cliente contribuinte do ICMS: informe a Inscricao Estadual (ou marque isento / nao contribuinte).');
    }
  }

  // Itens
  const itens = [];
  (venda.itens || []).forEach((it, i) => {
    const p = it.produto;
    if (!p) return;
    const n = i + 1;
    const qtd = numeroBr(it.quantidade);
    const vUn = numeroBr(it.valorUnitario ?? p.preco);
    const desc = numeroBr(it.desconto) || 0;
    if (!(qtd > 0)) erros.push(`Item ${n}: quantidade invalida.`);
    if (!(vUn > 0)) erros.push(`Item ${n}: valor unitario invalido.`);
    if (Number.isNaN(desc) || desc < 0) erros.push(`Item ${n}: desconto invalido.`);
    const ncm = soDigitos(p.ncm);
    if (ncm.length !== 8) erros.push(`Item ${n} (${p.descricao}): NCM deve ter 8 digitos.`);
    const cfop = soDigitos(p.cfop);
    if (cfop.length !== 4 || !['5', '6'].includes(cfop[0])) erros.push(`Item ${n}: CFOP invalido (use o de venda dentro do estado, ex.: 5102).`);
    if (!CSOSN[p.csosn]) erros.push(`Item ${n}: CSOSN ${p.csosn} nao suportado.`);
    if (modelo === '65' && !CFOP_NFCE.includes(cfop.replace(/^6/, '5'))) erros.push(`Item ${n}: CFOP ${cfop} nao e aceito na NFC-e.`);
    const vProd = r2((qtd || 0) * (vUn || 0));
    if (desc >= vProd && vProd > 0) erros.push(`Item ${n}: desconto maior ou igual ao valor do item.`);
    const gtin = soDigitos(p.gtin);
    itens.push({
      codigo: textoSefaz(p.codigo, 60) || String(n),
      descricao: textoSefaz(p.descricao, 120),
      gtin: [8, 12, 13, 14].includes(gtin.length) ? gtin : 'SEM GTIN',
      ncm,
      cest: soDigitos(p.cest),
      cfop,
      unidade: textoSefaz(p.unidade || 'UN', 6) || 'UN',
      quantidade: qtd,
      valorUnitario: vUn,
      vProd,
      desconto: r2(desc || 0),
      origem: String(p.origem ?? '0'),
      csosn: String(p.csosn || '102'),
      pTotTrib: Number(p.pTotTrib) || 0,
      produtoId: p._id,
    });
  });
  if (itens.length === 0) erros.push('Inclua ao menos um produto.');
  if (itens.length > 990) erros.push('Maximo de 990 itens por nota.');

  // Pagamento
  const pg = venda.pagamento || {};
  const tPag = FORMAS_PAGAMENTO[pg.tPag] ? pg.tPag : '01';
  if (modelo === '65' && tPag === '90') erros.push('NFC-e precisa de forma de pagamento.');
  const valorRecebido = numeroBr(pg.valorRecebido);

  const presenca = PRESENCA[venda.presenca] ? String(venda.presenca) : '1';
  if (modelo === '55' && presenca === '4') erros.push('Presenca "entrega em domicilio" e so para NFC-e.');

  if (erros.length) throw erroLista(erros);

  const totalProdutos = r2(itens.reduce((a, x) => a + x.vProd, 0));
  const totalDesconto = r2(itens.reduce((a, x) => a + x.desconto, 0));
  const total = r2(totalProdutos - totalDesconto);
  if (Number.isNaN(valorRecebido)) throw erroLista(['Valor recebido invalido.']);
  if (valorRecebido !== null && valorRecebido < total && tPag === '01') throw erroLista(['Valor recebido menor que o total da nota.']);

  return {
    modelo,
    dest,
    itens,
    pagamento: { tPag, valorRecebido: valorRecebido ?? total },
    presenca,
    consumidorFinal: modelo === '65' || !dest || dest.indIEDest === '9' || venda.consumidorFinal === true || venda.consumidorFinal === 'on',
    infComplementar: textoSefaz(venda.infComplementar, 4000),
    contingencia: Boolean(venda.contingencia),
    xJustCont: textoSefaz(venda.xJustCont || 'Indisponibilidade tecnica momentanea da SEFAZ', 255),
    dhCont: venda.dhCont || null,
    totais: { produtos: totalProdutos, desconto: totalDesconto, total },
  };
}

// ---------------------------------------------------------------- XML

// CFOP de venda interna (5xxx) -> equivalente interestadual (6xxx). Alguns nao seguem o mesmo final.
const CFOP_INTERESTADUAL = { 5405: '6404', 5656: '6656', 5667: '6667' };
export function cfopDaOperacao(cfop, interestadual) {
  const interno = `5${String(cfop).slice(1)}`;
  if (!interestadual) return interno;
  return CFOP_INTERESTADUAL[interno] || `6${interno.slice(1)}`;
}


function tagDoc(doc) {
  const d = soDigitos(doc);
  return d.length === 11 ? `<CPF>${d}</CPF>` : `<CNPJ>${d}</CNPJ>`;
}

function icmsSimples(item, cfg) {
  const orig = `<orig>${item.origem}</orig>`;
  switch (item.csosn) {
    case '101': {
      const p = Number(cfg.pCredSN) || 0;
      const base = item.vProd - item.desconto;
      return `<ICMSSN101>${orig}<CSOSN>101</CSOSN><pCredSN>${f4(p)}</pCredSN><vCredICMSSN>${f2((base * p) / 100)}</vCredICMSSN></ICMSSN101>`;
    }
    case '500':
      return `<ICMSSN500>${orig}<CSOSN>500</CSOSN></ICMSSN500>`;
    case '900':
      return `<ICMSSN900>${orig}<CSOSN>900</CSOSN></ICMSSN900>`;
    default:
      return `<ICMSSN102>${orig}<CSOSN>${item.csosn}</CSOSN></ICMSSN102>`;
  }
}

function pisCofins(cst) {
  if (['07', '08', '04', '05', '06', '09'].includes(cst)) {
    return `<PIS><PISNT><CST>${cst}</CST></PISNT></PIS><COFINS><COFINSNT><CST>${cst}</CST></COFINSNT></COFINS>`;
  }
  const c = ['49', '99'].includes(cst) ? cst : '49';
  return (
    `<PIS><PISOutr><CST>${c}</CST><vBC>0.00</vBC><pPIS>0.0000</pPIS><vPIS>0.00</vPIS></PISOutr></PIS>` +
    `<COFINS><COFINSOutr><CST>${c}</CST><vBC>0.00</vBC><pCOFINS>0.0000</pCOFINS><vCOFINS>0.00</vCOFINS></COFINSOutr></COFINS>`
  );
}

/** Texto obrigatorio do Simples Nacional (e do credito de ICMS, quando houver CSOSN 101). */
function textoSimples(v, cfg) {
  const partes = ['DOCUMENTO EMITIDO POR ME OU EPP OPTANTE PELO SIMPLES NACIONAL. NAO GERA DIREITO A CREDITO FISCAL DE IPI.'];
  const comCredito = v.itens.filter((i) => i.csosn === '101');
  if (comCredito.length && Number(cfg.pCredSN) > 0) {
    const credito = comCredito.reduce((a, i) => a + ((i.vProd - i.desconto) * Number(cfg.pCredSN)) / 100, 0);
    partes.push(
      `PERMITE O APROVEITAMENTO DO CREDITO DE ICMS NO VALOR DE R$ ${f2(credito).replace('.', ',')}; ` +
        `CORRESPONDENTE A ALIQUOTA DE ${String(cfg.pCredSN).replace('.', ',')}%, NOS TERMOS DO ART. 23 DA LEI COMPLEMENTAR N 123, DE 2006.`,
    );
  }
  return partes.join(' ');
}

/**
 * Monta o XML <NFe> (sem assinatura).
 * Retorna { xml, chave, id, totais, dhEmi }.
 */
export function montarNFe({ empresa, cfg, venda, numero, serie, ambiente, dhEmi, cNF }) {
  const v = venda;
  const modelo = v.modelo;
  const tpAmb = ambiente === 'producao' ? '1' : '2';
  const homolog = tpAmb === '2';
  const uf = String(empresa.uf).toUpperCase();
  const cUF = codigoUF(uf);
  const aamm = dhEmi.slice(2, 4) + dhEmi.slice(5, 7);
  const codNum = cNF || codigoNumerico(numero);
  const tpEmis = v.contingencia ? 9 : 1;
  const chave = montarChave({ cUF, aamm, documento: empresa.cnpj, modelo, serie, numero, tpEmis, cNF: codNum });
  const id = `NFe${chave}`;
  const interestadual = modelo === '55' && v.dest && v.dest.uf && v.dest.uf !== uf;
  const idDest = interestadual ? '2' : '1';
  const end = empresa.endereco || {};
  const dhCont = v.dhCont || dhEmi;
  const xJustCont = v.xJustCont || 'Indisponibilidade tecnica momentanea da SEFAZ';

  const ide =
    `<ide><cUF>${cUF}</cUF><cNF>${codNum}</cNF>${t('natOp', textoSefaz(cfg.naturezaOperacao || 'Venda de mercadoria', 60))}` +
    `<mod>${modelo}</mod><serie>${Number(serie)}</serie><nNF>${numero}</nNF><dhEmi>${dhEmi}</dhEmi>` +
    (modelo === '55' ? `<dhSaiEnt>${dhEmi}</dhSaiEnt>` : '') +
    `<tpNF>1</tpNF><idDest>${idDest}</idDest><cMunFG>${soDigitos(empresa.municipioCodigo)}</cMunFG>` +
    `<tpImp>${modelo === '65' ? '4' : '1'}</tpImp><tpEmis>${tpEmis}</tpEmis><cDV>${chave.slice(-1)}</cDV><tpAmb>${tpAmb}</tpAmb>` +
    `<finNFe>1</finNFe><indFinal>${v.consumidorFinal ? '1' : '0'}</indFinal><indPres>${v.presenca}</indPres>` +
    (['2', '3', '4', '9'].includes(v.presenca) ? '<indIntermed>0</indIntermed>' : '') +
    `<procEmi>0</procEmi><verProc>${VER_PROC}</verProc>` +
    (tpEmis === 9 ? `<dhCont>${dhCont}</dhCont><xJust>${esc(xJustCont)}</xJust>` : '') +
    `</ide>`;

  const emit =
    `<emit>${tagDoc(empresa.cnpj)}${t('xNome', textoSefaz(empresa.razaoSocial, 60))}${t('xFant', textoSefaz(empresa.nomeFantasia, 60))}` +
    `<enderEmit>${t('xLgr', textoSefaz(end.logradouro, 60))}${t('nro', textoSefaz(end.numero, 60))}${t('xCpl', textoSefaz(end.complemento, 60))}` +
    `${t('xBairro', textoSefaz(end.bairro, 60))}<cMun>${soDigitos(empresa.municipioCodigo)}</cMun>${t('xMun', textoSefaz(empresa.municipioNome, 60))}` +
    `<UF>${uf}</UF><CEP>${soDigitos(end.cep)}</CEP><cPais>1058</cPais><xPais>Brasil</xPais>` +
    (soDigitos(end.fone).length >= 6 ? `<fone>${soDigitos(end.fone).slice(0, 14)}</fone>` : '') +
    `</enderEmit><IE>${soDigitos(empresa.inscricaoEstadual)}</IE><CRT>${cfg.crt || '1'}</CRT></emit>`;

  let dest = '';
  if (v.dest) {
    const d = v.dest;
    const nome = homolog ? TEXTO_HOMOLOGACAO_DEST : d.nome;
    const enderDest =
      d.logradouro && d.cMun
        ? `<enderDest>${t('xLgr', d.logradouro)}${t('nro', d.numero)}${t('xCpl', d.complemento)}${t('xBairro', d.bairro)}` +
          `<cMun>${d.cMun}</cMun>${t('xMun', d.cidade)}<UF>${d.uf}</UF>${t('CEP', d.cep)}<cPais>1058</cPais><xPais>Brasil</xPais>` +
          (d.fone.length >= 6 ? `<fone>${d.fone.slice(0, 14)}</fone>` : '') +
          `</enderDest>`
        : '';
    dest =
      `<dest>${tagDoc(d.documento)}${t('xNome', nome)}${modelo === '55' ? enderDest : ''}` +
      `<indIEDest>${modelo === '65' ? '9' : d.indIEDest}</indIEDest>` +
      (modelo === '55' && d.indIEDest === '1' ? `<IE>${d.ie}</IE>` : '') +
      `${t('email', d.email)}</dest>`;
  }

  let vTotTrib = 0;
  const det = v.itens
    .map((it, i) => {
      const cfop = cfopDaOperacao(it.cfop, interestadual);
      const xProd = homolog && modelo === '65' && i === 0 ? TEXTO_HOMOLOGACAO_ITEM : it.descricao;
      const base = it.vProd - it.desconto;
      const trib = it.pTotTrib > 0 ? r2((base * it.pTotTrib) / 100) : 0;
      vTotTrib += trib;
      return (
        `<det nItem="${i + 1}"><prod>${t('cProd', it.codigo)}<cEAN>${it.gtin}</cEAN>${t('xProd', xProd)}<NCM>${it.ncm}</NCM>` +
        (it.cest.length === 7 ? `<CEST>${it.cest}</CEST>` : '') +
        `<CFOP>${cfop}</CFOP>${t('uCom', it.unidade)}<qCom>${f4(it.quantidade)}</qCom><vUnCom>${it.valorUnitario.toFixed(4)}</vUnCom>` +
        `<vProd>${f2(it.vProd)}</vProd><cEANTrib>${it.gtin}</cEANTrib>${t('uTrib', it.unidade)}<qTrib>${f4(it.quantidade)}</qTrib>` +
        `<vUnTrib>${it.valorUnitario.toFixed(4)}</vUnTrib>` +
        (it.desconto > 0 ? `<vDesc>${f2(it.desconto)}</vDesc>` : '') +
        `<indTot>1</indTot></prod>` +
        `<imposto>${trib > 0 ? `<vTotTrib>${f2(trib)}</vTotTrib>` : ''}<ICMS>${icmsSimples(it, cfg)}</ICMS>${pisCofins(cfg.cstPisCofins || '49')}</imposto>` +
        `</det>`
      );
    })
    .join('');
  vTotTrib = r2(vTotTrib);

  const tot = v.totais;
  const total =
    `<total><ICMSTot><vBC>0.00</vBC><vICMS>0.00</vICMS><vICMSDeson>0.00</vICMSDeson><vFCP>0.00</vFCP>` +
    `<vBCST>0.00</vBCST><vST>0.00</vST><vFCPST>0.00</vFCPST><vFCPSTRet>0.00</vFCPSTRet>` +
    `<vProd>${f2(tot.produtos)}</vProd><vFrete>0.00</vFrete><vSeg>0.00</vSeg><vDesc>${f2(tot.desconto)}</vDesc>` +
    `<vII>0.00</vII><vIPI>0.00</vIPI><vIPIDevol>0.00</vIPIDevol><vPIS>0.00</vPIS><vCOFINS>0.00</vCOFINS><vOutro>0.00</vOutro>` +
    `<vNF>${f2(tot.total)}</vNF>${vTotTrib > 0 ? `<vTotTrib>${f2(vTotTrib)}</vTotTrib>` : ''}</ICMSTot></total>`;

  const transp = '<transp><modFrete>9</modFrete></transp>';

  const pg = v.pagamento;
  const vPag = pg.tPag === '90' ? 0 : pg.tPag === '01' ? Math.max(pg.valorRecebido, tot.total) : tot.total;
  const troco = pg.tPag === '01' ? r2(vPag - tot.total) : 0;
  const pag =
    `<pag><detPag>${pg.tPag === '05' || pg.tPag === '15' ? '<indPag>1</indPag>' : ''}<tPag>${pg.tPag}</tPag><vPag>${f2(vPag)}</vPag>` +
    (PAGAMENTO_COM_CARD.includes(pg.tPag) ? '<card><tpIntegra>2</tpIntegra></card>' : '') +
    `</detPag>${troco > 0 ? `<vTroco>${f2(troco)}</vTroco>` : ''}</pag>`;

  const infCpl = [
    textoSimples(v, cfg),
    vTotTrib > 0 ? `Valor aproximado dos tributos: R$ ${f2(vTotTrib).replace('.', ',')} (Lei 12.741/2012).` : '',
    textoSefaz(cfg.infComplementarPadrao, 1000),
    v.infComplementar,
  ]
    .filter(Boolean)
    .join(' ');
  const infAdic = `<infAdic>${t('infCpl', textoSefaz(infCpl, 5000))}</infAdic>`;

  const rt = cfg.respTec || {};
  const infRespTec =
    soDigitos(rt.cnpj).length === 14 && rt.contato && rt.email && soDigitos(rt.fone).length >= 6
      ? `<infRespTec><CNPJ>${soDigitos(rt.cnpj)}</CNPJ>${t('xContato', textoSefaz(rt.contato, 60))}${t('email', textoSefaz(rt.email, 60))}<fone>${soDigitos(rt.fone).slice(0, 14)}</fone></infRespTec>`
      : '';

  const xml =
    `<NFe xmlns="${NS}"><infNFe versao="${VERSAO}" Id="${id}">` +
    ide + emit + dest + det + total + transp + pag + infAdic + infRespTec +
    `</infNFe></NFe>`;

  return { xml, chave, id, dhEmi, totais: { ...tot, vTotTrib, troco, vPag } };
}

/** Assina a NF-e (RSA-SHA1, C14N, enveloped) como exige o leiaute 4.00. */
export function assinarNFe(xml, certificado) {
  const sig = new SignedXml({
    privateKey: certificado.keyPem,
    publicCert: certificado.certTitularPem || certificado.certPem,
    signatureAlgorithm: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
    canonicalizationAlgorithm: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
  });
  sig.addReference({
    xpath: "//*[local-name(.)='infNFe']",
    transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315'],
    digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1',
  });
  sig.computeSignature(xml, { location: { reference: "//*[local-name(.)='infNFe']", action: 'after' } });
  return sig.getSignedXml();
}

/**
 * QR Code da NFC-e.
 *  - versao 2 (com CSC): url?p=chave|2|tpAmb|idCSC|SHA1(chave|2|tpAmb|idCSC + CSC)
 *  - versao 3 (NT 2025.001, emissao on-line): url?p=chave|3|tpAmb
 */
export function montarQrCode({ chave, ambiente, uf, versao, csc }) {
  const ws = webservices(uf, '65', ambiente);
  const tpAmb = ambiente === 'producao' ? '1' : '2';
  const ver = String(versao || (ws.qrCode?.versao === '300' ? '3' : '2'));
  const url = ws.qrCode?.url;
  if (!url) throw new Error(`Endereco do QR Code da NFC-e nao cadastrado para ${uf}.`);
  const base = url.includes('?p=') ? url : `${url}?p=`;
  if (ver === '3') return { qrCode: `${base}${chave}|3|${tpAmb}`, urlChave: ws.urlChave, versao: '3' };
  const idCsc = String(Number(soDigitos(csc?.id) || 0));
  const token = String(csc?.token || '').trim();
  if (!token || idCsc === '0') {
    throw new Error('Informe o CSC (codigo de seguranca) e o ID do CSC da NFC-e em Configurar NF-e / NFC-e. Eles sao gerados no portal da SEFAZ.');
  }
  const seq = `${chave}|2|${tpAmb}|${idCsc}`;
  const hash = crypto.createHash('sha1').update(seq + token).digest('hex').toUpperCase();
  return { qrCode: `${base}${seq}|${hash}`, urlChave: ws.urlChave, versao: '2' };
}

/** Coloca <infNFeSupl> (QR Code) entre </infNFe> e <Signature>, como pede o leiaute da NFC-e. */
export function incluirQrCode(xmlAssinado, { qrCode, urlChave }) {
  const supl = `<infNFeSupl><qrCode>${esc(qrCode)}</qrCode><urlChave>${esc(urlChave)}</urlChave></infNFeSupl>`;
  return xmlAssinado.replace('</infNFe><Signature', `</infNFe>${supl}<Signature`);
}
