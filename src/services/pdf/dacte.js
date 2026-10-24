import PDFDocument from 'pdfkit';
import bwipjs from 'bwip-js';
import { xmlToObj } from '../sefaz/parseDocumento.js';
import { formatarDocumento } from '../../utils/documento.js';

/**
 * DACTE (CT-e modelo 57) no leiaute retrato do Manual de Orientacao do Contribuinte do CT-e:
 * canhoto, cabecalho (emitente / DACTE / codigo de barras e chave), dados do CT-e,
 * prestacao, partes (remetente, destinatario, expedidor, recebedor, tomador), carga,
 * componentes do valor, ICMS, documentos originarios, observacoes e dados do modal.
 */

const M = 14;
const W = 595.28 - M * 2;
const H = 841.89;
const ROT = 5.2;
const VAL = 7.2;

const lista = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
const t = (v) => (v === undefined || v === null ? '' : String(v));
const n2 = (v) => {
  const x = Number(v);
  return v !== undefined && v !== '' && Number.isFinite(x) ? x.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
};
const n4 = (v) => {
  const x = Number(v);
  return Number.isFinite(x) ? x.toLocaleString('pt-BR', { maximumFractionDigits: 4 }) : '';
};
const docFmt = (p) => (p ? formatarDocumento(p.CNPJ || p.CPF || '') : '');
const dataHora = (v) => (v ? new Date(v).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '');
const cep = (v) => t(v).replace(/^(\d{5})(\d{3})$/, '$1-$2');
const fone = (v) => t(v).replace(/^(\d{2})(\d{4,5})(\d{4})$/, '($1) $2-$3');
const chaveFmt = (c) => t(c).replace(/(\d{4})(?=\d)/g, '$1 ');

const MODAL = { '01': 'RODOVIARIO', '02': 'AEREO', '03': 'AQUAVIARIO', '04': 'FERROVIARIO', '05': 'DUTOVIARIO', '06': 'MULTIMODAL' };
const TIPO_CTE = { 0: 'NORMAL', 1: 'COMPLEMENTAR', 2: 'ANULACAO', 3: 'SUBSTITUTO' };
const TIPO_SERV = { 0: 'NORMAL', 1: 'SUBCONTRATACAO', 2: 'REDESPACHO', 3: 'REDESP. INTERMEDIARIO', 4: 'SERV. VINC. MULTIMODAL' };
const TOMADOR = { 0: 'REMETENTE', 1: 'EXPEDIDOR', 2: 'RECEBEDOR', 3: 'DESTINATARIO', 4: 'OUTROS' };
const UNIDADE = { '00': 'M3', '01': 'KG', '02': 'TON', '03': 'UNIDADE', '04': 'LITROS', '05': 'MMBTU' };

class Folha {
  constructor(pdf) {
    this.pdf = pdf;
    this.y = M;
  }

  caixa(x, y, w, h, rotulo, valor, { alinhar = 'left', tam = VAL, negrito = false } = {}) {
    const { pdf } = this;
    pdf.lineWidth(0.5).strokeColor('#000').rect(x, y, w, h).stroke();
    if (rotulo) pdf.font('Helvetica').fontSize(ROT).fillColor('#000').text(rotulo.toUpperCase(), x + 1.5, y + 1.2, { width: w - 3, height: ROT + 1, ellipsis: true });
    if (valor !== undefined && valor !== null && valor !== '') {
      pdf.font(negrito ? 'Helvetica-Bold' : 'Helvetica').fontSize(tam).fillColor('#000')
        .text(t(valor), x + 1.5, y + (rotulo ? 7.5 : 2), { width: w - 3, height: h - (rotulo ? 8 : 3), align: alinhar, ellipsis: true });
    }
  }

  linha(campos, h = 17, x0 = M, largura = W) {
    const total = campos.reduce((a, c) => a + (c.w || 1), 0);
    let x = x0;
    for (const c of campos) {
      const w = (largura * (c.w || 1)) / total;
      this.caixa(x, this.y, w, h, c.r, c.v, c);
      x += w;
    }
    this.y += h;
  }

  titulo(texto) {
    const { pdf } = this;
    pdf.rect(M, this.y, W, 9).fillAndStroke('#e8e8e8', '#000');
    pdf.fillColor('#000').font('Helvetica-Bold').fontSize(6).text(texto.toUpperCase(), M, this.y + 2, { width: W, align: 'center' });
    this.y += 9;
  }

  /** Garante espaco; senao abre nova pagina. */
  espaco(h) {
    if (this.y + h > H - M) {
      this.pdf.addPage();
      this.y = M;
    }
  }
}

/** Bloco de uma parte (remetente, destinatario, expedidor...) em meia largura. */
function parte(f, x, y, w, titulo, p, enderTag) {
  const h = 52;
  const { pdf } = f;
  pdf.lineWidth(0.5).rect(x, y, w, h).stroke();
  pdf.font('Helvetica-Bold').fontSize(ROT + 0.6).text(titulo.toUpperCase(), x + 2, y + 2);
  if (!p) return h;
  const e = p[enderTag] || {};
  const linhas = [
    ['', t(p.xNome)],
    ['Endereco', [[e.xLgr, e.nro].filter(Boolean).join(', '), e.xCpl, e.xBairro].filter(Boolean).join(' - ')],
    ['Municipio', `${t(e.xMun)}${e.UF ? ` - ${e.UF}` : ''}${e.CEP ? `   CEP ${cep(e.CEP)}` : ''}`],
    ['CNPJ/CPF', `${docFmt(p)}${p.IE ? `   IE ${t(p.IE)}` : ''}${p.fone || e.fone ? `   Fone ${fone(p.fone || e.fone)}` : ''}`],
  ];
  let yy = y + 10;
  linhas.forEach(([r, v], i) => {
    pdf.font(i === 0 ? 'Helvetica-Bold' : 'Helvetica').fontSize(i === 0 ? 7.2 : 6.6).fillColor('#000')
      .text(r ? `${r}: ${v}` : v, x + 3, yy, { width: w - 6, height: 9, ellipsis: true });
    yy += i === 0 ? 10 : 9.5;
  });
  return h;
}

async function barras(chave) {
  try {
    return await bwipjs.toBuffer({ bcid: 'code128', text: chave, scale: 2, height: 9, includetext: false });
  } catch {
    return null;
  }
}

function dadosIcms(imp) {
  const g = imp?.ICMS ? Object.entries(imp.ICMS)[0] : null;
  if (!g) return {};
  const [nome, v] = g;
  const sit = {
    ICMS00: '00 - Tributacao normal', ICMS20: '20 - Com reducao de BC', ICMS45: `${t(v?.CST)} - Isento / nao tributado / diferido`,
    ICMS60: '60 - ICMS cobrado por ST', ICMS90: '90 - Outros', ICMSOutraUF: '90 - ICMS outra UF', ICMSSN: 'Simples Nacional',
  }[nome] || t(v?.CST);
  return {
    sit,
    vBC: v?.vBC || v?.vBCOutraUF || v?.vBCSTRet,
    pICMS: v?.pICMS || v?.pICMSOutraUF || v?.pICMSSTRet,
    vICMS: v?.vICMS || v?.vICMSOutraUF || v?.vICMSSTRet,
    pRedBC: v?.pRedBC || v?.pRedBCOutraUF,
    vICMSST: v?.vICMSSTRet,
  };
}

/** Gera o DACTE retrato. Retorna null se o XML nao for um CT-e (modelo 57). */
export async function gerarDacte(xml, { cancelada = false } = {}) {
  const obj = xmlToObj(xml);
  const cte = obj?.cteProc?.CTe || obj?.CTe;
  if (!cte?.infCte) return null;
  const inf = cte.infCte;
  const ide = inf.ide || {};
  if (ide.mod && t(ide.mod) !== '57') return null;
  const emit = inf.emit || {};
  const prot = obj?.cteProc?.protCTe?.infProt || {};
  const chave = t(inf['@_Id']).replace(/^CTe/, '');
  const norm = inf.infCTeNorm || {};
  const carga = norm.infCarga || {};
  const vPrest = inf.vPrest || {};
  const png = chave.length === 44 ? await barras(chave) : null;

  const pdf = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true, info: { Title: `DACTE ${t(ide.nCT)}` } });
  const partes = [];
  pdf.on('data', (c) => partes.push(c));
  const fim = new Promise((ok) => pdf.on('end', ok));
  const f = new Folha(pdf);

  // ---- Canhoto
  f.caixa(M, f.y, W, 10, '', 'DECLARO QUE RECEBI OS VOLUMES DESTE CONHECIMENTO EM PERFEITO ESTADO PELO QUE DOU POR CUMPRIDO O PRESENTE CONTRATO DE TRANSPORTE', { tam: 5.6 });
  f.y += 10;
  f.linha([
    { r: 'Nome', w: 2 }, { r: 'RG', w: 1 }, { r: 'Assinatura / carimbo', w: 2 },
    { r: 'Chegada data/hora', w: 1.1 }, { r: 'Saida data/hora', w: 1.1 },
    { r: 'CT-e', v: `N. ${t(ide.nCT)}  Serie ${t(ide.serie)}`, w: 1.3, negrito: true },
  ], 18);
  pdf.lineWidth(0.5).dash(2, { space: 2 }).moveTo(M, f.y + 4).lineTo(M + W, f.y + 4).stroke().undash();
  f.y += 9;

  // ---- Cabecalho
  const y0 = f.y;
  const hCab = 84;
  const wEmit = W * 0.42;
  const wMeio = W * 0.2;
  const wDir = W - wEmit - wMeio;
  pdf.lineWidth(0.5).rect(M, y0, wEmit, hCab).stroke();
  pdf.font('Helvetica-Bold').fontSize(9).text(t(emit.xNome), M + 4, y0 + 6, { width: wEmit - 8, align: 'center' });
  const ee = emit.enderEmit || {};
  pdf.font('Helvetica').fontSize(6.8).text(
    [
      [[ee.xLgr, ee.nro].filter(Boolean).join(', '), ee.xCpl].filter(Boolean).join(' - '),
      [ee.xBairro, cep(ee.CEP)].filter(Boolean).join(' - '),
      [ee.xMun, ee.UF].filter(Boolean).join(' - '),
      `CNPJ/CPF: ${docFmt(emit)}   IE: ${t(emit.IE)}`,
      ee.fone ? `Fone: ${fone(ee.fone)}` : '',
    ].filter(Boolean).join('\n'),
    M + 4, pdf.y + 3, { width: wEmit - 8, align: 'center' },
  );
  const xMeio = M + wEmit;
  pdf.rect(xMeio, y0, wMeio, hCab).stroke();
  pdf.font('Helvetica-Bold').fontSize(13).text('DACTE', xMeio, y0 + 6, { width: wMeio, align: 'center' });
  pdf.font('Helvetica').fontSize(5.8).text('Documento Auxiliar do Conhecimento de Transporte Eletronico', xMeio + 4, y0 + 22, { width: wMeio - 8, align: 'center' });
  f.caixa(xMeio, y0 + 48, wMeio, 18, 'Modal', MODAL[t(ide.modal)] || t(ide.modal), { alinhar: 'center', negrito: true });
  f.caixa(xMeio, y0 + 66, wMeio, 18, 'Tipo do CT-e', TIPO_CTE[t(ide.tpCTe)] || 'NORMAL', { alinhar: 'center' });
  const xDir = xMeio + wMeio;
  pdf.rect(xDir, y0, wDir, hCab).stroke();
  if (png) pdf.image(png, xDir + 8, y0 + 4, { width: wDir - 16, height: 28 });
  f.caixa(xDir, y0 + 36, wDir, 18, 'Chave de acesso', chaveFmt(chave), { alinhar: 'center', tam: 7.4, negrito: true });
  f.caixa(xDir, y0 + 54, wDir, 30, 'Protocolo de autorizacao de uso',
    `${t(prot.nProt)}${prot.dhRecbto ? `  -  ${dataHora(prot.dhRecbto)}` : ''}\nConsulta: www.cte.fazenda.gov.br/portal`,
    { alinhar: 'center', tam: 6.6 });
  f.y = y0 + hCab;

  f.linha([
    { r: 'Modelo', v: t(ide.mod || '57'), w: 0.6, alinhar: 'center' },
    { r: 'Serie', v: t(ide.serie), w: 0.6, alinhar: 'center' },
    { r: 'Numero', v: t(ide.nCT), w: 1, alinhar: 'center', negrito: true },
    { r: 'Data e hora de emissao', v: dataHora(ide.dhEmi), w: 1.5, alinhar: 'center' },
    { r: 'Tipo do servico', v: TIPO_SERV[t(ide.tpServ)] || 'NORMAL', w: 1.3 },
    { r: 'Tomador do servico', v: TOMADOR[t(ide.toma3?.toma ?? ide.toma4?.toma ?? ide.toma03?.toma)] || '', w: 1.2 },
  ]);
  f.linha([{ r: 'CFOP - Natureza da prestacao', v: `${t(ide.CFOP)} - ${t(ide.natOp)}` }]);
  f.linha([
    { r: 'Inicio da prestacao', v: `${t(ide.xMunIni)} - ${t(ide.UFIni)}` },
    { r: 'Termino da prestacao', v: `${t(ide.xMunFim)} - ${t(ide.UFFim)}` },
  ]);

  // ---- Partes
  const meia = W / 2;
  let h = parte(f, M, f.y, meia, 'Remetente', inf.rem, 'enderReme');
  parte(f, M + meia, f.y, meia, 'Destinatario', inf.dest, 'enderDest');
  f.y += h;
  h = parte(f, M, f.y, meia, 'Expedidor', inf.exped, 'enderExped');
  parte(f, M + meia, f.y, meia, 'Recebedor', inf.receb, 'enderReceb');
  f.y += h;
  const codToma = t(ide.toma3?.toma ?? ide.toma4?.toma ?? '');
  const tomador = ide.toma4 && codToma === '4'
    ? { ...ide.toma4, enderToma: ide.toma4.enderToma }
    : { 0: inf.rem, 1: inf.exped, 2: inf.receb, 3: inf.dest }[codToma];
  const enderTomaTag = ide.toma4 && codToma === '4' ? 'enderToma' : { 0: 'enderReme', 1: 'enderExped', 2: 'enderReceb', 3: 'enderDest' }[codToma];
  h = parte(f, M, f.y, W, `Tomador do servico${TOMADOR[codToma] ? ` (${TOMADOR[codToma]})` : ''}`, tomador, enderTomaTag || 'enderToma');
  f.y += h;

  // ---- Carga
  f.linha([
    { r: 'Produto predominante', v: carga.proPred, w: 2 },
    { r: 'Outras caracteristicas da carga', v: carga.xOutCat, w: 1.6 },
    { r: 'Valor total da carga', v: n2(carga.vCarga), w: 1, alinhar: 'right' },
  ]);
  const qtds = lista(carga.infQ).slice(0, 5);
  if (qtds.length) {
    f.linha(qtds.map((q) => ({ r: `${t(q.tpMed) || 'Quantidade'} (${UNIDADE[t(q.cUnid)] || t(q.cUnid)})`, v: n4(q.qCarga), alinhar: 'right' })));
  }

  // ---- Componentes do valor
  f.titulo('Componentes do valor da prestacao do servico');
  const comps = lista(vPrest.Comp);
  const porLinha = 4;
  const linhasComp = Math.max(1, Math.ceil(comps.length / porLinha));
  for (let i = 0; i < linhasComp; i += 1) {
    const grupo = comps.slice(i * porLinha, (i + 1) * porLinha);
    while (grupo.length < porLinha) grupo.push(null);
    f.linha(grupo.map((c) => ({ r: c ? t(c.xNome) : '', v: c ? n2(c.vComp) : '', alinhar: 'right' })), 16);
  }
  f.linha([
    { r: 'Valor total do servico', v: n2(vPrest.vTPrest), alinhar: 'right', negrito: true, tam: 8 },
    { r: 'Valor a receber', v: n2(vPrest.vRec), alinhar: 'right', negrito: true, tam: 8 },
  ]);

  // ---- Imposto
  const icms = dadosIcms(inf.imp);
  f.titulo('Informacoes relativas ao imposto');
  f.linha([
    { r: 'Situacao tributaria', v: icms.sit, w: 2 },
    { r: 'Base de calculo', v: n2(icms.vBC), alinhar: 'right' },
    { r: 'Aliq. ICMS', v: n2(icms.pICMS), alinhar: 'right', w: 0.7 },
    { r: 'Valor ICMS', v: n2(icms.vICMS), alinhar: 'right' },
    { r: '% Red. BC', v: n2(icms.pRedBC), alinhar: 'right', w: 0.7 },
    { r: 'ICMS ST', v: n2(icms.vICMSST), alinhar: 'right' },
  ]);

  // ---- Documentos originarios
  const docs = [
    ...lista(norm.infDoc?.infNFe).map((d) => ['NF-e', chaveFmt(d.chave)]),
    ...lista(norm.infDoc?.infNF).map((d) => ['NF', `Serie ${t(d.serie)}  N. ${t(d.nDoc)}  ${docFmt(inf.rem)}`]),
    ...lista(norm.infDoc?.infOutros).map((d) => [t(d.descOutros) || 'Outros', t(d.nDoc)]),
    ...lista(norm.docAnt?.emiDocAnt).flatMap((e) => lista(e.idDocAnt).flatMap((i) => lista(i.idDocAntEle).map((x) => ['CT-e anterior', chaveFmt(x.chCTe)]))),
  ];
  if (docs.length) {
    f.titulo('Documentos originarios');
    for (let i = 0; i < docs.length; i += 2) {
      f.espaco(14);
      const a = docs[i];
      const b = docs[i + 1];
      f.linha([
        { r: 'Tipo', v: a[0], w: 0.5 }, { r: 'Documento', v: a[1], w: 2.2 },
        { r: 'Tipo', v: b ? b[0] : '', w: 0.5 }, { r: 'Documento', v: b ? b[1] : '', w: 2.2 },
      ], 14);
    }
  }

  // ---- Observacoes
  const obs = [
    t(inf.compl?.xObs),
    ...lista(inf.compl?.ObsCont).map((o) => `${t(o['@_xCampo'])}: ${t(o.xTexto)}`),
    t(inf.imp?.infAdFisco),
    inf.imp?.vTotTrib ? `Valor aproximado dos tributos: R$ ${n2(inf.imp.vTotTrib)}` : '',
  ].filter(Boolean).join('\n');
  f.espaco(60);
  f.titulo('Observacoes');
  pdf.font('Helvetica').fontSize(6.6);
  const hObs = Math.max(30, Math.min(pdf.heightOfString(obs || ' ', { width: W - 6 }) + 6, H - M - f.y - 40));
  pdf.lineWidth(0.5).rect(M, f.y, W, hObs).stroke();
  pdf.text(obs, M + 3, f.y + 3, { width: W - 6, height: hObs - 4, ellipsis: true });
  f.y += hObs;

  // ---- Modal
  const rodo = norm.infModal?.rodo;
  if (rodo) {
    f.espaco(30);
    f.titulo('Informacoes especificas do modal rodoviario');
    f.linha([
      { r: 'RNTRC da empresa', v: rodo.RNTRC },
      { r: 'CIOT', v: lista(rodo.infCIOT || rodo.CIOT).map((c) => t(c.CIOT || c)).join(', ') },
      { r: 'Previsao de entrega', v: '' },
      { r: 'Lotacao', v: rodo.lota === '1' ? 'SIM' : 'NAO' },
    ]);
    pdf.font('Helvetica').fontSize(5.6).text('ESTE CONHECIMENTO DE TRANSPORTE ATENDE A LEGISLACAO DE TRANSPORTE RODOVIARIO EM VIGOR', M, f.y + 2, { width: W, align: 'center' });
  }

  // ---- Avisos (homologacao / cancelado)
  const total = pdf.bufferedPageRange().count;
  for (let p = 0; p < total; p += 1) {
    pdf.switchToPage(p);
    const avisos = [];
    if (t(ide.tpAmb) === '2') avisos.push('SEM VALOR FISCAL - HOMOLOGACAO');
    if (cancelada) avisos.push('CANCELADO');
    if (avisos.length) {
      pdf.save();
      pdf.rotate(-35, { origin: [595.28 / 2, H / 2] });
      pdf.font('Helvetica-Bold').fontSize(58).fillColor('#dc2626').opacity(0.14).text(avisos.join('\n'), 0, H / 2 - 40, { width: 595.28, align: 'center' });
      pdf.restore();
      pdf.opacity(1).fillColor('#000');
    }
  }

  pdf.end();
  await fim;
  return Buffer.concat(partes);
}
