import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { xmlToObj } from '../sefaz/parseDocumento.js';
import { formatarDocumento } from '../../utils/documento.js';

/**
 * DANFE NFC-e: cupom de 80 mm para impressora termica, com QR Code de consulta.
 * Recebe o XML (nfeProc ou NFe) de uma NFC-e (modelo 65).
 */

const LARGURA = 226.77; // 80 mm
const M = 8;
const UTIL = LARGURA - 2 * M;
const PAGAMENTOS = {
  '01': 'Dinheiro', '02': 'Cheque', '03': 'Cartao de Credito', '04': 'Cartao de Debito', '05': 'Credito Loja',
  10: 'Vale Alimentacao', 11: 'Vale Refeicao', 12: 'Vale Presente', 13: 'Vale Combustivel', 15: 'Boleto Bancario',
  16: 'Deposito Bancario', 17: 'PIX', 18: 'Transferencia', 19: 'Fidelidade', 20: 'PIX', 90: 'Sem pagamento', 99: 'Outros',
};

const t = (v) => (v === undefined || v === null ? '' : String(v));
const lista = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
const moeda = (v) => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtd = (v) => Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 4 });
const dataHora = (v) => (v ? new Date(v).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '');

function desenhar(doc, d) {
  let y = M;
  const texto = (s, { size = 7, bold = false, align = 'center', gap = 1 } = {}) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size);
    doc.text(s, M, y, { width: UTIL, align });
    y = doc.y + gap;
  };
  const linha = () => {
    y += 2;
    doc.moveTo(M, y).lineTo(LARGURA - M, y).dash(1.5, { space: 1.5 }).lineWidth(0.5).stroke().undash();
    y += 4;
  };
  const par = (esq, dir, { bold = false, size = 7 } = {}) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size);
    const h = doc.heightOfString(esq, { width: UTIL * 0.65 });
    doc.text(esq, M, y, { width: UTIL * 0.65 });
    doc.text(dir, M + UTIL * 0.35, y, { width: UTIL * 0.65, align: 'right' });
    y += h + 1.5;
  };

  // Emitente
  texto(d.emitNome, { size: 8, bold: true });
  texto(`CNPJ: ${formatarDocumento(d.emitDoc)}  IE: ${d.emitIE}`);
  texto(d.emitEnd);
  linha();
  texto('Documento Auxiliar da Nota Fiscal de Consumidor Eletronica', { bold: true });
  if (d.homolog) texto('EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL', { bold: true, size: 7.5 });
  linha();

  // Itens
  doc.font('Helvetica-Bold').fontSize(6.5);
  doc.text('Codigo  Descricao', M, y, { width: UTIL * 0.6 });
  doc.text('Qtde UN x Vl Unit = Vl Total', M + UTIL * 0.3, y, { width: UTIL * 0.7, align: 'right' });
  y = doc.y + 2;
  d.itens.forEach((it, i) => {
    doc.font('Helvetica').fontSize(6.8);
    doc.text(`${String(i + 1).padStart(3, '0')} ${it.codigo} ${it.descricao}`, M, y, { width: UTIL });
    y = doc.y;
    doc.text(`${qtd(it.qtd)} ${it.un} x ${moeda(it.vUn)} = ${moeda(it.vProd)}`, M, y, { width: UTIL, align: 'right' });
    y = doc.y + (it.vDesc > 0 ? 0 : 1.5);
    if (it.vDesc > 0) {
      doc.text(`desconto -${moeda(it.vDesc)}`, M, y, { width: UTIL, align: 'right' });
      y = doc.y + 1.5;
    }
  });
  linha();

  // Totais e pagamento
  par('Qtde. total de itens', String(d.itens.length));
  par('Valor total R$', moeda(d.vProd));
  if (d.vDesc > 0) par('Descontos R$', moeda(d.vDesc));
  par('Valor a Pagar R$', moeda(d.vNF), { bold: true, size: 8 });
  y += 2;
  par('FORMA DE PAGAMENTO', 'VALOR PAGO R$', { bold: true });
  d.pagamentos.forEach((p) => par(p.forma, moeda(p.valor)));
  if (d.vTroco > 0) par('Troco R$', moeda(d.vTroco));
  linha();

  // Consulta
  texto('Consulte pela Chave de Acesso em', { bold: true });
  texto(d.urlChave);
  texto(d.chave.replace(/(\d{4})(?=\d)/g, '$1 '), { size: 7 });
  linha();

  // Consumidor
  texto(d.consumidor, { bold: !d.consumidorIdentificado });
  linha();

  texto(`NFC-e n ${String(d.nNF).padStart(9, '0')}  Serie ${String(d.serie).padStart(3, '0')}  ${dataHora(d.dhEmi)}`, { bold: true });
  if (d.protocolo) {
    texto(`Protocolo de autorizacao: ${d.protocolo}`);
    texto(`Data de autorizacao: ${dataHora(d.dhRecbto)}`);
  } else {
    texto('NFC-e ainda sem autorizacao da SEFAZ', { bold: true });
  }

  // QR Code
  if (d.qrPng) {
    const tam = 118;
    y += 4;
    doc.image(d.qrPng, (LARGURA - tam) / 2, y, { width: tam, height: tam });
    y += tam + 4;
  }

  if (d.vTotTrib > 0) {
    linha();
    texto(`Tributos Totais Incidentes (Lei Federal 12.741/2012): R$ ${moeda(d.vTotTrib)}`);
  }
  if (d.infCpl) {
    linha();
    texto(d.infCpl, { size: 6.2, align: 'left' });
  }
  if (d.cancelada) {
    linha();
    texto('NFC-e CANCELADA', { size: 11, bold: true });
  }
  return y + M;
}

export async function gerarDanfeNfce(xml, { cancelada = false } = {}) {
  const obj = xmlToObj(xml);
  const nfe = obj?.nfeProc?.NFe || obj?.NFe;
  if (!nfe) return null;
  const inf = nfe.infNFe || {};
  const ide = inf.ide || {};
  if (t(ide.mod) !== '65') return null;
  const emit = inf.emit || {};
  const ee = emit.enderEmit || {};
  const dest = inf.dest;
  const tot = inf.total?.ICMSTot || {};
  const prot = obj?.nfeProc?.protNFe?.infProt || {};
  const supl = nfe.infNFeSupl || {};
  const chave = t(inf['@_Id']).replace(/^NFe/, '');
  const docDest = t(dest?.CNPJ || dest?.CPF);

  const d = {
    emitNome: t(emit.xNome),
    emitDoc: t(emit.CNPJ || emit.CPF),
    emitIE: t(emit.IE),
    emitEnd: [t(ee.xLgr), t(ee.nro), t(ee.xCpl), t(ee.xBairro), `${t(ee.xMun)} - ${t(ee.UF)}`].filter(Boolean).join(', '),
    homolog: t(ide.tpAmb) === '2',
    itens: lista(inf.det).map((dt) => ({
      codigo: t(dt.prod?.cProd),
      descricao: t(dt.prod?.xProd),
      qtd: Number(dt.prod?.qCom || 0),
      un: t(dt.prod?.uCom),
      vUn: Number(dt.prod?.vUnCom || 0),
      vProd: Number(dt.prod?.vProd || 0),
      vDesc: Number(dt.prod?.vDesc || 0),
    })),
    vProd: Number(tot.vProd || 0),
    vDesc: Number(tot.vDesc || 0),
    vNF: Number(tot.vNF || 0),
    vTotTrib: Number(tot.vTotTrib || 0),
    pagamentos: lista(inf.pag?.detPag).map((p) => ({ forma: PAGAMENTOS[t(p.tPag)] || `Forma ${t(p.tPag)}`, valor: Number(p.vPag || 0) })),
    vTroco: Number(inf.pag?.vTroco || 0),
    urlChave: t(supl.urlChave),
    chave,
    consumidorIdentificado: Boolean(docDest),
    consumidor: docDest
      ? `CONSUMIDOR - ${docDest.length === 11 ? 'CPF' : 'CNPJ'} ${formatarDocumento(docDest)}${dest?.xNome ? ` - ${t(dest.xNome)}` : ''}`
      : 'CONSUMIDOR NAO IDENTIFICADO',
    nNF: t(ide.nNF),
    serie: t(ide.serie),
    dhEmi: t(ide.dhEmi),
    protocolo: t(prot.nProt),
    dhRecbto: t(prot.dhRecbto),
    infCpl: t(inf.infAdic?.infCpl),
    cancelada,
    qrPng: supl.qrCode ? await QRCode.toBuffer(t(supl.qrCode), { errorCorrectionLevel: 'M', margin: 0, width: 300 }) : null,
  };

  // 1a passada mede a altura; a 2a desenha no tamanho exato do cupom.
  const medidor = new PDFDocument({ size: [LARGURA, 5000], margin: 0 });
  const altura = Math.ceil(desenhar(medidor, d));
  medidor.end();

  const doc = new PDFDocument({ size: [LARGURA, Math.max(altura, 200)], margin: 0, info: { Title: `NFC-e ${d.nNF}` } });
  const partes = [];
  doc.on('data', (c) => partes.push(c));
  const fim = new Promise((ok) => doc.on('end', ok));
  desenhar(doc, d);
  doc.end();
  await fim;
  return Buffer.concat(partes);
}
