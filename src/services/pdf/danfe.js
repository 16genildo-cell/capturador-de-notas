import PDFDocument from 'pdfkit';
import bwipjs from 'bwip-js';
import { xmlToObj } from '../sefaz/parseDocumento.js';
import { formatarDocumento } from '../../utils/documento.js';

/**
 * DANFE (NF-e modelo 55) no leiaute retrato do Manual de Orientacao do Contribuinte:
 * canhoto, cabecalho (emitente / DANFE / chave + codigo de barras), natureza e protocolo,
 * destinatario, faturas, calculo do imposto, transportador/volumes, produtos,
 * ISSQN e dados adicionais. Paginas seguintes repetem cabecalho e tabela de produtos.
 */

const M = 14; // margem
const W = 595.28 - M * 2;
const H_PAGINA = 841.89;
const BORDA = '#000';
const ROTULO = 5.2;
const VALOR = 7.4;

const lista = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
const t = (v) => (v === undefined || v === null ? '' : String(v));
const n2 = (v) => {
  const x = Number(v);
  return Number.isFinite(x) ? x.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
};
const n4 = (v) => {
  const x = Number(v);
  return Number.isFinite(x) ? x.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 }) : '';
};
const doc = (p) => (p ? formatarDocumento(p.CNPJ || p.CPF || '') || t(p.idEstrangeiro) : '');
const data = (v) => {
  if (!v) return '';
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})$/); // data sem hora: nao converter fuso
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return new Date(v).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
};
const hora = (v) => (v && String(v).includes('T') ? new Date(v).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '');
const cep = (v) => t(v).replace(/^(\d{5})(\d{3})$/, '$1-$2');
const fone = (v) => t(v).replace(/^(\d{2})(\d{4,5})(\d{4})$/, '($1) $2-$3');
const chaveFmt = (c) => t(c).replace(/(\d{4})(?=\d)/g, '$1 ');

class Danfe {
  constructor(pdf) {
    this.pdf = pdf;
    this.y = M;
  }

  /** Caixa com rotulo pequeno no topo e valor. */
  caixa(x, y, w, h, rotulo, valor, { alinhar = 'left', tam = VALOR, negrito = false } = {}) {
    const { pdf } = this;
    pdf.lineWidth(0.5).strokeColor(BORDA).rect(x, y, w, h).stroke();
    if (rotulo) {
      pdf.font('Helvetica').fontSize(ROTULO).fillColor('#000').text(rotulo.toUpperCase(), x + 1.5, y + 1.2, { width: w - 3, height: ROTULO + 1, ellipsis: true });
    }
    if (valor !== undefined && valor !== null && valor !== '') {
      pdf.font(negrito ? 'Helvetica-Bold' : 'Helvetica').fontSize(tam).fillColor('#000')
        .text(t(valor), x + 1.5, y + (rotulo ? 7.5 : 2), { width: w - 3, height: h - (rotulo ? 8 : 3), align: alinhar, ellipsis: true });
    }
  }

  /** Linha de caixas com larguras proporcionais. */
  linha(campos, h = 17) {
    const total = campos.reduce((a, c) => a + (c.w || 1), 0);
    let x = M;
    for (const c of campos) {
      const w = (W * (c.w || 1)) / total;
      this.caixa(x, this.y, w, h, c.r, c.v, c);
      x += w;
    }
    this.y += h;
  }

  titulo(texto) {
    this.pdf.font('Helvetica-Bold').fontSize(6).fillColor('#000').text(texto.toUpperCase(), M, this.y + 2);
    this.y += 9;
  }
}

async function barras(chave) {
  try {
    return await bwipjs.toBuffer({ bcid: 'code128', text: chave, scale: 2, height: 9, includetext: false });
  } catch {
    return null;
  }
}

function infoIcms(imposto) {
  const grupo = imposto?.ICMS ? Object.values(imposto.ICMS)[0] || {} : {};
  return {
    cst: `${t(grupo.orig)}${t(grupo.CST ?? grupo.CSOSN)}`,
    vBC: grupo.vBC,
    vICMS: grupo.vICMS,
    pICMS: grupo.pICMS,
  };
}

function infoIpi(imposto) {
  const trib = imposto?.IPI?.IPITrib || {};
  return { vIPI: trib.vIPI, pIPI: trib.pIPI };
}

/** Cabecalho (emitente, quadro DANFE e chave). Usado na 1a e nas demais paginas. */
function cabecalho(d, ctx, pagina, totalPaginas) {
  const { pdf } = d;
  const { inf, ide, emit, chave, png, prot } = ctx;
  const h = 92;
  const wEmit = W * 0.4;
  const wDanfe = W * 0.18;
  const wChave = W - wEmit - wDanfe;
  const y0 = d.y;

  // Emitente
  pdf.lineWidth(0.5).rect(M, y0, wEmit, h).stroke();
  pdf.font('Helvetica').fontSize(ROTULO).text('IDENTIFICACAO DO EMITENTE', M + 2, y0 + 2);
  pdf.font('Helvetica-Bold').fontSize(9).text(t(emit.xNome), M + 4, y0 + 14, { width: wEmit - 8, align: 'center' });
  const e = emit.enderEmit || {};
  pdf.font('Helvetica').fontSize(7).text(
    [
      [e.xLgr, e.nro].filter(Boolean).join(', ') + (e.xCpl ? ` - ${e.xCpl}` : ''),
      [e.xBairro, cep(e.CEP)].filter(Boolean).join(' - '),
      [e.xMun, e.UF].filter(Boolean).join(' - '),
      e.fone ? `Fone: ${fone(e.fone)}` : '',
    ].filter(Boolean).join('\n'),
    M + 4,
    pdf.y + 4,
    { width: wEmit - 8, align: 'center' },
  );

  // Quadro DANFE
  const xD = M + wEmit;
  pdf.rect(xD, y0, wDanfe, h).stroke();
  pdf.font('Helvetica-Bold').fontSize(12).text('DANFE', xD, y0 + 4, { width: wDanfe, align: 'center' });
  pdf.font('Helvetica').fontSize(6).text('Documento Auxiliar da Nota Fiscal Eletronica', xD + 4, y0 + 18, { width: wDanfe - 8, align: 'center' });
  pdf.fontSize(6.5).text('0 - ENTRADA', xD + 6, y0 + 38).text('1 - SAIDA', xD + 6, y0 + 46);
  pdf.rect(xD + wDanfe - 22, y0 + 38, 14, 14).stroke();
  pdf.font('Helvetica-Bold').fontSize(10).text(t(ide.tpNF), xD + wDanfe - 22, y0 + 40.5, { width: 14, align: 'center' });
  const nNF = t(ide.nNF).padStart(9, '0').replace(/(\d{3})(\d{3})(\d{3})/, '$1.$2.$3');
  pdf.font('Helvetica-Bold').fontSize(7.5).text(`N. ${nNF}`, xD, y0 + 60, { width: wDanfe, align: 'center' })
    .text(`SERIE ${t(ide.serie).padStart(3, '0')}`, xD, y0 + 70, { width: wDanfe, align: 'center' });
  pdf.font('Helvetica').fontSize(6.5).text(`FOLHA ${pagina}/${totalPaginas}`, xD, y0 + 81, { width: wDanfe, align: 'center' });

  // Chave e codigo de barras
  const xC = xD + wDanfe;
  pdf.rect(xC, y0, wChave, h).stroke();
  if (png) pdf.image(png, xC + 8, y0 + 4, { width: wChave - 16, height: 30 });
  d.caixa(xC, y0 + 38, wChave, 20, 'Chave de acesso', chaveFmt(chave), { alinhar: 'center', tam: 7.6, negrito: true });
  pdf.font('Helvetica').fontSize(6.6).text(
    'Consulta de autenticidade no portal nacional da NF-e www.nfe.fazenda.gov.br/portal ou no site da Sefaz Autorizadora',
    xC + 4, y0 + 63, { width: wChave - 8, align: 'center' },
  );
  d.y = y0 + h;

  // Natureza / protocolo
  d.linha([
    { r: 'Natureza da operacao', v: ide.natOp, w: 1.4 },
    { r: 'Protocolo de autorizacao de uso', v: [prot.nProt, prot.dhRecbto ? `${data(prot.dhRecbto)} ${hora(prot.dhRecbto)}` : ''].filter(Boolean).join(' - '), w: 1, alinhar: 'center' },
  ]);
  d.linha([
    { r: 'Inscricao estadual', v: emit.IE },
    { r: 'Inscricao estadual do subst. trib.', v: emit.IEST },
    { r: 'CNPJ / CPF', v: doc(emit) },
  ]);
  return inf;
}

const COLUNAS = [
  { r: 'Codigo', w: 1.15 },
  { r: 'Descricao do produto / servico', w: 4.2 },
  { r: 'NCM/SH', w: 0.95 },
  { r: 'O/CST', w: 0.6 },
  { r: 'CFOP', w: 0.6 },
  { r: 'UN', w: 0.5 },
  { r: 'Quant.', w: 0.85, a: 'right' },
  { r: 'Valor unit.', w: 0.95, a: 'right' },
  { r: 'Valor total', w: 0.95, a: 'right' },
  { r: 'B.calc ICMS', w: 0.9, a: 'right' },
  { r: 'Valor ICMS', w: 0.85, a: 'right' },
  { r: 'Valor IPI', w: 0.75, a: 'right' },
  { r: 'Aliq. ICMS', w: 0.6, a: 'right' },
  { r: 'Aliq. IPI', w: 0.55, a: 'right' },
];
const SOMA_COL = COLUNAS.reduce((a, c) => a + c.w, 0);
const LARG_COL = COLUNAS.map((c) => (W * c.w) / SOMA_COL);

function cabecalhoTabela(d) {
  const { pdf } = d;
  let x = M;
  const h = 14;
  COLUNAS.forEach((c, i) => {
    pdf.lineWidth(0.5).rect(x, d.y, LARG_COL[i], h).stroke();
    pdf.font('Helvetica-Bold').fontSize(5.2).text(c.r.toUpperCase(), x + 1, d.y + 2, { width: LARG_COL[i] - 2, align: 'center' });
    x += LARG_COL[i];
  });
  d.y += h;
}

function linhasItens(pdf, det) {
  return det.map((item) => {
    const p = item.prod || {};
    const icms = infoIcms(item.imposto);
    const ipi = infoIpi(item.imposto);
    const desc = t(p.xProd) + (item.infAdProd ? `\n${t(item.infAdProd)}` : '');
    const valores = [
      t(p.cProd), desc, t(p.NCM), icms.cst, t(p.CFOP), t(p.uCom), n4(p.qCom), n4(p.vUnCom), n2(p.vProd),
      n2(icms.vBC), n2(icms.vICMS), n2(ipi.vIPI), icms.pICMS ? n2(icms.pICMS) : '', ipi.pIPI ? n2(ipi.pIPI) : '',
    ];
    pdf.font('Helvetica').fontSize(6.2);
    const alt = Math.max(...valores.map((v, i) => pdf.heightOfString(v || ' ', { width: LARG_COL[i] - 2 }))) + 3;
    return { valores, alt };
  });
}

function desenharItem(d, linha) {
  const { pdf } = d;
  let x = M;
  linha.valores.forEach((v, i) => {
    pdf.font('Helvetica').fontSize(6.2).fillColor('#000')
      .text(v, x + 1, d.y + 1.5, { width: LARG_COL[i] - 2, align: COLUNAS[i].a || (i === 1 ? 'left' : 'center') });
    pdf.lineWidth(0.3).moveTo(x, d.y).lineTo(x, d.y + linha.alt).stroke();
    x += LARG_COL[i];
  });
  pdf.moveTo(M + W, d.y).lineTo(M + W, d.y + linha.alt).stroke();
  d.y += linha.alt;
  pdf.lineWidth(0.2).strokeColor('#999').moveTo(M, d.y).lineTo(M + W, d.y).stroke().strokeColor(BORDA);
}

/** Gera o DANFE retrato. Retorna null se o XML nao for uma NF-e (modelo 55) completa. */
export async function gerarDanfe(xml, { cancelada = false } = {}) {
  const obj = xmlToObj(xml);
  const nfe = obj?.nfeProc?.NFe || obj?.NFe;
  if (!nfe) return null;
  const inf = nfe.infNFe || {};
  const ide = inf.ide || {};
  if (t(ide.mod) === '65') return null; // NFC-e tem leiaute proprio (cupom)

  const pdf = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true, info: { Title: `DANFE ${ide.nNF}` } });
  const partes = [];
  pdf.on('data', (c) => partes.push(c));
  const fim = new Promise((ok) => pdf.on('end', ok));

  const emit = inf.emit || {};
  const dest = inf.dest || {};
  const tot = inf.total?.ICMSTot || {};
  const issqn = inf.total?.ISSQNtot;
  const transp = inf.transp || {};
  const chave = t(inf['@_Id']).replace(/^NFe/, '');
  const prot = obj?.nfeProc?.protNFe?.infProt || {};
  const ctx = { inf, ide, emit, chave, prot, png: await barras(chave) };
  const det = lista(inf.det);
  const d = new Danfe(pdf);

  // ---- Canhoto
  const hC = 40;
  const wNum = W * 0.18;
  pdf.lineWidth(0.5).rect(M, d.y, W - wNum, hC).stroke();
  pdf.font('Helvetica').fontSize(6).text(
    `RECEBEMOS DE ${t(emit.xNome).toUpperCase()} OS PRODUTOS E/OU SERVICOS CONSTANTES DA NOTA FISCAL ELETRONICA INDICADA AO LADO. ` +
      `EMISSAO: ${data(ide.dhEmi || ide.dEmi)} VALOR TOTAL: R$ ${n2(tot.vNF)} DESTINATARIO: ${t(dest.xNome).toUpperCase()}`,
    M + 2, d.y + 2, { width: W - wNum - 4, height: 18 },
  );
  d.caixa(M, d.y + 20, (W - wNum) * 0.3, hC - 20, 'Data de recebimento', '');
  d.caixa(M + (W - wNum) * 0.3, d.y + 20, (W - wNum) * 0.7, hC - 20, 'Identificacao e assinatura do recebedor', '');
  pdf.rect(M + W - wNum, d.y, wNum, hC).stroke();
  pdf.font('Helvetica-Bold').fontSize(10).text('NF-e', M + W - wNum, d.y + 5, { width: wNum, align: 'center' });
  pdf.fontSize(8).text(`N. ${t(ide.nNF).padStart(9, '0').replace(/(\d{3})(\d{3})(\d{3})/, '$1.$2.$3')}`, M + W - wNum, d.y + 18, { width: wNum, align: 'center' })
    .text(`SERIE ${t(ide.serie).padStart(3, '0')}`, M + W - wNum, d.y + 28, { width: wNum, align: 'center' });
  d.y += hC + 3;
  pdf.lineWidth(0.5).dash(2, { space: 2 }).moveTo(M, d.y).lineTo(M + W, d.y).stroke().undash();
  d.y += 4;

  // ---- Cabecalho (pagina 1; total de paginas e ajustado no final)
  const yCabecalho = d.y;
  cabecalho(d, ctx, 1, 1);

  // ---- Destinatario
  const de = dest.enderDest || {};
  d.titulo('Destinatario / remetente');
  d.linha([
    { r: 'Nome / razao social', v: dest.xNome, w: 3.2 },
    { r: 'CNPJ / CPF', v: doc(dest), w: 1.3 },
    { r: 'Data da emissao', v: data(ide.dhEmi || ide.dEmi), w: 0.9, alinhar: 'center' },
  ]);
  d.linha([
    { r: 'Endereco', v: [de.xLgr, de.nro].filter(Boolean).join(', ') + (de.xCpl ? ` - ${de.xCpl}` : ''), w: 2.4 },
    { r: 'Bairro / distrito', v: de.xBairro, w: 1.3 },
    { r: 'CEP', v: cep(de.CEP), w: 0.8, alinhar: 'center' },
    { r: 'Data da saida/entrada', v: data(ide.dhSaiEnt || ide.dSaiEnt), w: 0.9, alinhar: 'center' },
  ]);
  d.linha([
    { r: 'Municipio', v: de.xMun, w: 2 },
    { r: 'Fone / fax', v: fone(de.fone), w: 1.1 },
    { r: 'UF', v: de.UF, w: 0.4, alinhar: 'center' },
    { r: 'Inscricao estadual', v: dest.IE, w: 1 },
    { r: 'Hora da saida/entrada', v: hora(ide.dhSaiEnt), w: 0.9, alinhar: 'center' },
  ]);

  // ---- Fatura / duplicatas
  const dups = lista(inf.cobr?.dup);
  if (dups.length || inf.cobr?.fat) {
    d.titulo('Fatura / duplicatas');
    const porLinha = 6;
    for (let i = 0; i < Math.max(dups.length, 1); i += porLinha) {
      const grupo = dups.slice(i, i + porLinha);
      if (!grupo.length && inf.cobr?.fat) {
        const f = inf.cobr.fat;
        d.linha([{ r: 'Fatura', v: `N. ${t(f.nFat)}  Valor original R$ ${n2(f.vOrig)}  Desconto R$ ${n2(f.vDesc)}  Liquido R$ ${n2(f.vLiq)}` }]);
        break;
      }
      d.linha(
        Array.from({ length: porLinha }, (_, k) => {
          const dp = grupo[k];
          return { r: dp ? `Dup. ${t(dp.nDup)}` : '', v: dp ? `Venc. ${data(dp.dVenc)}  R$ ${n2(dp.vDup)}` : '', tam: 6.6 };
        }),
      );
    }
  }

  // ---- Calculo do imposto
  d.titulo('Calculo do imposto');
  const r = (rotulo, v, extra = {}) => ({ r: rotulo, v: n2(v || 0), alinhar: 'right', ...extra });
  d.linha([
    r('Base de calc. do ICMS', tot.vBC), r('Valor do ICMS', tot.vICMS), r('Base de calc. ICMS S.T.', tot.vBCST),
    r('Valor do ICMS subst.', tot.vST), r('V. imp. importacao', tot.vII), r('V. ICMS UF remet.', tot.vICMSUFRemet),
    r('V. FCP UF dest.', tot.vFCPUFDest), r('Valor do PIS', tot.vPIS), r('V. total produtos', tot.vProd, { w: 1.15 }),
  ]);
  d.linha([
    r('Valor do frete', tot.vFrete), r('Valor do seguro', tot.vSeg), r('Desconto', tot.vDesc),
    r('Outras despesas', tot.vOutro), r('Valor total IPI', tot.vIPI), r('V. ICMS UF dest.', tot.vICMSUFDest),
    r('V. tot. tributos', tot.vTotTrib), r('Valor da COFINS', tot.vCOFINS), r('V. total da nota', tot.vNF, { w: 1.15, negrito: true }),
  ]);

  // ---- Transportador / volumes
  const tr = transp.transporta || {};
  const veic = transp.veicTransp || {};
  const vol = lista(transp.vol)[0] || {};
  const modFrete = {
    0: '0-Por conta do remet.', 1: '1-Por conta do dest.', 2: '2-Por conta de terceiros',
    3: '3-Proprio remet.', 4: '4-Proprio dest.', 9: '9-Sem transporte',
  };
  d.titulo('Transportador / volumes transportados');
  d.linha([
    { r: 'Nome / razao social', v: tr.xNome, w: 2.6 },
    { r: 'Frete', v: modFrete[t(transp.modFrete)] || t(transp.modFrete), w: 1.3 },
    { r: 'Codigo ANTT', v: veic.RNTC, w: 0.8 },
    { r: 'Placa do veiculo', v: veic.placa, w: 0.8 },
    { r: 'UF', v: veic.UF, w: 0.35 },
    { r: 'CNPJ / CPF', v: doc(tr), w: 1.2 },
  ]);
  d.linha([
    { r: 'Endereco', v: tr.xEnder, w: 2.8 },
    { r: 'Municipio', v: tr.xMun, w: 1.6 },
    { r: 'UF', v: tr.UF, w: 0.35 },
    { r: 'Inscricao estadual', v: tr.IE, w: 1.2 },
  ]);
  d.linha([
    { r: 'Quantidade', v: vol.qVol, alinhar: 'right' },
    { r: 'Especie', v: vol.esp },
    { r: 'Marca', v: vol.marca },
    { r: 'Numeracao', v: vol.nVol },
    { r: 'Peso bruto', v: vol.pesoB ? n4(vol.pesoB) : '', alinhar: 'right' },
    { r: 'Peso liquido', v: vol.pesoL ? n4(vol.pesoL) : '', alinhar: 'right' },
  ]);

  // ---- Produtos (com quebra de pagina)
  d.titulo('Dados do produto / servico');
  const linhas = linhasItens(pdf, det);
  const adicionais = [t(inf.infAdic?.infCpl), t(inf.infAdic?.infAdFisco) ? `Fisco: ${t(inf.infAdic.infAdFisco)}` : '']
    .filter(Boolean).join('\n');
  pdf.font('Helvetica').fontSize(6.5);
  const hAdic = Math.max(48, Math.min(170, pdf.heightOfString(adicionais || ' ', { width: W * 0.65 - 4 }) + 14));
  const hIssqn = issqn ? 26 : 0;
  const reservaRodape = hAdic + hIssqn + 22;

  cabecalhoTabela(d);
  const paginasCabecalho = [{ y: yCabecalho }];
  let i = 0;
  while (i < linhas.length) {
    const ehUltimo = (j) => j === linhas.length - 1;
    const limite = H_PAGINA - M - (ehUltimo(i) ? reservaRodape : 0);
    if (d.y + linhas[i].alt > limite) {
      // fecha a pagina e abre outra com cabecalho
      pdf.lineWidth(0.5).moveTo(M, d.y).lineTo(M + W, d.y).stroke();
      pdf.addPage();
      d.y = M;
      paginasCabecalho.push({ y: d.y });
      cabecalho(d, ctx, paginasCabecalho.length, 1);
      d.titulo('Dados do produto / servico (continuacao)');
      cabecalhoTabela(d);
      continue;
    }
    desenharItem(d, linhas[i]);
    i += 1;
  }
  pdf.lineWidth(0.5).moveTo(M, d.y).lineTo(M + W, d.y).stroke();
  if (d.y + reservaRodape > H_PAGINA - M) {
    pdf.addPage();
    d.y = M;
    paginasCabecalho.push({ y: d.y });
    cabecalho(d, ctx, paginasCabecalho.length, 1);
  }

  // ---- ISSQN
  if (issqn) {
    d.titulo('Calculo do ISSQN');
    d.linha([
      { r: 'Inscricao municipal', v: emit.IM },
      { r: 'Valor total dos servicos', v: n2(issqn.vServ), alinhar: 'right' },
      { r: 'Base de calculo do ISSQN', v: n2(issqn.vBC), alinhar: 'right' },
      { r: 'Valor do ISSQN', v: n2(issqn.vISS), alinhar: 'right' },
    ]);
  }

  // ---- Dados adicionais
  d.titulo('Dados adicionais');
  d.caixa(M, d.y, W * 0.65, hAdic, 'Informacoes complementares', adicionais, { tam: 6.5 });
  d.caixa(M + W * 0.65, d.y, W * 0.35, hAdic, 'Reservado ao fisco', '');
  d.y += hAdic;

  // ---- Ajustes finais: "FOLHA x/y", homologacao, cancelada
  const total = pdf.bufferedPageRange().count;
  for (let p = 0; p < total; p += 1) {
    pdf.switchToPage(p);
    const yC = paginasCabecalho[p]?.y;
    if (yC !== undefined) {
      const xD = M + W * 0.4;
      pdf.rect(xD + 1, yC + 80, W * 0.18 - 2, 10).fill('#fff');
      pdf.fillColor('#000').font('Helvetica').fontSize(6.5).text(`FOLHA ${p + 1}/${total}`, xD, yC + 81, { width: W * 0.18, align: 'center' });
    }
    const avisos = [];
    if (t(ide.tpAmb) === '2') avisos.push('SEM VALOR FISCAL - HOMOLOGACAO');
    if (cancelada) avisos.push('CANCELADA');
    if (avisos.length) {
      pdf.save();
      pdf.rotate(-35, { origin: [595.28 / 2, H_PAGINA / 2] });
      pdf.font('Helvetica-Bold').fontSize(60).fillColor('#dc2626').opacity(0.14)
        .text(avisos.join('\n'), 0, H_PAGINA / 2 - 40, { width: 595.28, align: 'center' });
      pdf.restore();
      pdf.opacity(1).fillColor('#000');
    }
  }

  pdf.end();
  await fim;
  return Buffer.concat(partes);
}
