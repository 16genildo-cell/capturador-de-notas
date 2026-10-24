import PDFDocument from 'pdfkit';
import { gerarDanfeNfce } from './danfeNfce.js';
import { gerarDacte } from './dacte.js';
import bwipjs from 'bwip-js';
import { xmlToObj } from '../sefaz/parseDocumento.js';
import { formatarDocumento } from '../../utils/documento.js';
// DANFSe no layout oficial do Portal Nacional (NT 008/2026) - biblioteca MIT incorporada em src/vendor.
import danfseNacional from '../../vendor/danfse-nacional/src/index.js';
import { gerarDanfe } from './danfe.js';

/**
 * Gera o PDF (documento auxiliar) de uma nota capturada, a partir do XML guardado:
 *  - NF-e / NFC-e -> DANFE
 *  - NFS-e (padrao nacional) -> DANFSe
 *  - CT-e -> DACTE
 * O layout e uma representacao simplificada; o documento fiscal valido e o XML.
 */

const MARGEM = 28;
const LARGURA = 595.28 - MARGEM * 2; // A4
const COR_BORDA = '#9aa3b2';
const COR_LABEL = '#5b6475';

// ---------------------------------------------------------------- utilitarios

const lista = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
const txt = (v) => (v === undefined || v === null ? '' : String(v));

function moeda(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function numero(v, casas = 4) {
  const n = Number(v);
  if (!Number.isFinite(n)) return txt(v);
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: casas });
}

function dataHora(v) {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return txt(v);
  return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function dataSo(v) {
  if (!v) return '';
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})$/); // data sem hora: nao converter fuso
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return txt(v);
  return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function chaveFormatada(chave) {
  return txt(chave).replace(/(\d{4})(?=\d)/g, '$1 ');
}

function doc(pessoa) {
  if (!pessoa) return '';
  const d = pessoa.CNPJ || pessoa.CPF;
  return d ? formatarDocumento(d) : txt(pessoa.idEstrangeiro || pessoa.NIF);
}

function endereco(e) {
  if (!e) return '';
  const partes = [
    [e.xLgr, e.nro].filter(Boolean).join(', '),
    e.xCpl,
    e.xBairro,
    [e.xMun, e.UF].filter(Boolean).join(' - '),
    e.CEP ? `CEP ${e.CEP}` : '',
  ];
  return partes.filter(Boolean).join(' · ');
}

async function codigoBarras(texto) {
  if (!texto) return null;
  try {
    return await bwipjs.toBuffer({ bcid: 'code128', text: texto, scale: 2, height: 10, includetext: false });
  } catch {
    return null;
  }
}

// ------------------------------------------------------------ primitivas de desenho

class Pagina {
  constructor(doc) {
    this.doc = doc;
    this.y = MARGEM;
  }

  garantir(altura) {
    if (this.y + altura > this.doc.page.height - MARGEM - 24) {
      this.doc.addPage();
      this.y = MARGEM;
    }
  }

  titulo(texto, subtitulo) {
    const { doc } = this;
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#111').text(texto, MARGEM, this.y, { width: LARGURA });
    this.y = doc.y + 2;
    if (subtitulo) {
      doc.font('Helvetica').fontSize(8).fillColor(COR_LABEL).text(subtitulo, MARGEM, this.y, { width: LARGURA });
      this.y = doc.y + 6;
    }
  }

  secao(texto) {
    this.garantir(30);
    const { doc } = this;
    this.y += 4;
    doc.rect(MARGEM, this.y, LARGURA, 13).fill('#e8ebf1');
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#222').text(texto.toUpperCase(), MARGEM + 4, this.y + 3);
    this.y += 13;
  }

  /** Linha de campos: [{ label, valor, peso }] */
  linha(campos, { altura = 24 } = {}) {
    const { doc } = this;
    const total = campos.reduce((a, c) => a + (c.peso || 1), 0);
    // Altura dinamica conforme o maior texto
    let alt = altura;
    for (const c of campos) {
      const w = (LARGURA * (c.peso || 1)) / total - 6;
      doc.font(c.negrito ? 'Helvetica-Bold' : 'Helvetica').fontSize(c.tamanho || 8.5);
      const h = doc.heightOfString(txt(c.valor) || ' ', { width: w }) + 13;
      if (h > alt) alt = h;
    }
    this.garantir(alt);
    let x = MARGEM;
    for (const c of campos) {
      const w = (LARGURA * (c.peso || 1)) / total;
      doc.lineWidth(0.5).strokeColor(COR_BORDA).rect(x, this.y, w, alt).stroke();
      doc.font('Helvetica').fontSize(6).fillColor(COR_LABEL).text(txt(c.label).toUpperCase(), x + 3, this.y + 2, {
        width: w - 6,
      });
      doc
        .font(c.negrito ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(c.tamanho || 8.5)
        .fillColor('#111')
        .text(txt(c.valor) || ' ', x + 3, this.y + 10, { width: w - 6, align: c.alinhar || 'left' });
      x += w;
    }
    this.y += alt;
  }

  /** Tabela simples: colunas [{ titulo, peso, alinhar }], linhas [[...]] */
  tabela(colunas, linhas) {
    const { doc } = this;
    const total = colunas.reduce((a, c) => a + (c.peso || 1), 0);
    const larg = colunas.map((c) => (LARGURA * (c.peso || 1)) / total);

    const cabecalho = () => {
      this.garantir(16);
      let x = MARGEM;
      doc.rect(MARGEM, this.y, LARGURA, 13).fill('#f2f4f8');
      colunas.forEach((c, i) => {
        doc.font('Helvetica-Bold').fontSize(6.5).fillColor('#333')
          .text(c.titulo, x + 2, this.y + 3, { width: larg[i] - 4, align: c.alinhar || 'left' });
        x += larg[i];
      });
      this.y += 13;
    };

    cabecalho();
    for (const l of linhas) {
      doc.font('Helvetica').fontSize(7);
      const alt = Math.max(...l.map((v, i) => doc.heightOfString(txt(v) || ' ', { width: larg[i] - 4 }))) + 5;
      if (this.y + alt > doc.page.height - MARGEM - 24) {
        doc.addPage();
        this.y = MARGEM;
        cabecalho();
      }
      let x = MARGEM;
      l.forEach((v, i) => {
        doc.font('Helvetica').fontSize(7).fillColor('#111')
          .text(txt(v), x + 2, this.y + 2.5, { width: larg[i] - 4, align: colunas[i].alinhar || 'left' });
        x += larg[i];
      });
      doc.lineWidth(0.3).strokeColor('#d5d9e1').moveTo(MARGEM, this.y + alt).lineTo(MARGEM + LARGURA, this.y + alt).stroke();
      this.y += alt;
    }
  }

  texto(conteudo) {
    if (!conteudo) return;
    const { doc } = this;
    doc.font('Helvetica').fontSize(7.5);
    const h = doc.heightOfString(conteudo, { width: LARGURA - 8 }) + 8;
    this.garantir(h);
    doc.lineWidth(0.5).strokeColor(COR_BORDA).rect(MARGEM, this.y, LARGURA, h).stroke();
    doc.fillColor('#111').text(conteudo, MARGEM + 4, this.y + 4, { width: LARGURA - 8 });
    this.y += h;
  }

  async chave(rotulo, chave) {
    if (!chave) return;
    const png = await codigoBarras(chave);
    const alt = png ? 52 : 26;
    this.garantir(alt);
    const { doc } = this;
    doc.lineWidth(0.5).strokeColor(COR_BORDA).rect(MARGEM, this.y, LARGURA, alt).stroke();
    if (png) doc.image(png, MARGEM + 6, this.y + 5, { height: 26, width: LARGURA * 0.47 });
    const xTexto = png ? MARGEM + LARGURA * 0.5 : MARGEM + 4;
    doc.font('Helvetica').fontSize(6).fillColor(COR_LABEL).text(rotulo.toUpperCase(), xTexto, this.y + 6);
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#111')
      .text(chaveFormatada(chave), xTexto, this.y + 15, { width: MARGEM + LARGURA - xTexto - 4 });
    this.y += alt;
  }

  aviso(texto, cor = '#b45309') {
    this.garantir(22);
    const { doc } = this;
    doc.rect(MARGEM, this.y, LARGURA, 18).fill(cor);
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#fff').text(texto, MARGEM, this.y + 5, { width: LARGURA, align: 'center' });
    this.y += 22;
  }
}

function rodape(doc, geradoEm) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    const y = doc.page.height - MARGEM - 10;
    doc.font('Helvetica').fontSize(6.5).fillColor('#7a8394').text(
      `Gerado pelo Captura Total em ${geradoEm}. Representacao simplificada; o documento fiscal valido e o arquivo XML. ` +
        `Pagina ${i + 1} de ${range.count}`,
      MARGEM,
      y,
      { width: LARGURA, align: 'center', lineBreak: false },
    );
  }
}

function marcaCancelada(doc) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    doc.save();
    doc.rotate(-35, { origin: [doc.page.width / 2, doc.page.height / 2] });
    doc.font('Helvetica-Bold').fontSize(80).fillColor('#dc2626').opacity(0.15)
      .text('CANCELADA', 0, doc.page.height / 2 - 40, { width: doc.page.width, align: 'center' });
    doc.restore();
    doc.opacity(1);
  }
}

// --------------------------------------------------------------------- NF-e

async function desenharNFe(p, nota) {
  const obj = xmlToObj(nota.xml);
  const nfe = obj?.nfeProc?.NFe || obj?.NFe;
  const prot = obj?.nfeProc?.protNFe?.infProt || {};

  if (!nfe) {
    // Apenas resumo (resNFe)
    const r = obj?.resNFe || {};
    p.titulo('Resumo de NF-e', 'O XML completo ainda nao foi liberado. Use "Baixar XML completo" para manifestar ciencia.');
    p.aviso('APENAS RESUMO - sem itens e sem dados completos');
    await p.chave('Chave de acesso', r.chNFe || nota.chave);
    p.linha([
      { label: 'Emitente', valor: r.xNome || nota.emitenteNome, peso: 3, negrito: true },
      { label: 'CNPJ/CPF', valor: formatarDocumento(r.CNPJ || r.CPF || nota.emitenteCnpjCpf), peso: 1.5 },
      { label: 'IE', valor: r.IE, peso: 1 },
    ]);
    p.linha([
      { label: 'Emissao', valor: dataHora(r.dhEmi) },
      { label: 'Tipo', valor: r.tpNF === '0' ? 'Entrada' : 'Saida' },
      { label: 'Valor total', valor: `R$ ${moeda(r.vNF)}`, negrito: true },
      { label: 'Protocolo', valor: r.nProt },
      { label: 'Situacao', valor: { 1: 'Autorizada', 2: 'Denegada', 3: 'Cancelada' }[r.cSitNFe] || r.cSitNFe },
    ]);
    return;
  }

  const inf = nfe.infNFe || {};
  const ide = inf.ide || {};
  const emit = inf.emit || {};
  const dest = inf.dest || {};
  const tot = inf.total?.ICMSTot || {};
  const modelo = txt(ide.mod) === '65' ? 'NFC-e' : 'NF-e';

  p.titulo(
    modelo === 'NFC-e' ? 'DANFE NFC-e - Documento Auxiliar da Nota Fiscal de Consumidor Eletronica' : 'DANFE - Documento Auxiliar da Nota Fiscal Eletronica',
    `${modelo} n. ${ide.nNF} · Serie ${ide.serie} · ${ide.tpNF === '0' ? 'Entrada' : 'Saida'} · ${ide.natOp || ''}`,
  );

  p.linha([
    { label: 'Emitente', valor: emit.xNome, peso: 3, negrito: true },
    { label: 'CNPJ/CPF', valor: doc(emit), peso: 1.4 },
    { label: 'Inscricao estadual', valor: emit.IE, peso: 1.1 },
  ]);
  p.linha([{ label: 'Endereco', valor: endereco(emit.enderEmit) }]);
  p.linha([
    { label: 'Numero', valor: ide.nNF },
    { label: 'Serie', valor: ide.serie },
    { label: 'Emissao', valor: dataHora(ide.dhEmi || ide.dEmi), peso: 1.6 },
    { label: 'Saida/Entrada', valor: dataHora(ide.dhSaiEnt), peso: 1.6 },
    { label: 'Protocolo de autorizacao', valor: [prot.nProt, dataHora(prot.dhRecbto)].filter(Boolean).join(' - '), peso: 2.6 },
  ]);
  await p.chave('Chave de acesso', txt(inf['@_Id']).replace(/^NFe/, '') || nota.chave);

  p.secao('Destinatario / remetente');
  p.linha([
    { label: 'Nome / razao social', valor: dest.xNome, peso: 3, negrito: true },
    { label: 'CNPJ/CPF', valor: doc(dest), peso: 1.4 },
    { label: 'Inscricao estadual', valor: dest.IE, peso: 1.1 },
  ]);
  if (dest.enderDest) p.linha([{ label: 'Endereco', valor: endereco(dest.enderDest) }]);

  p.secao('Calculo do imposto');
  p.linha([
    { label: 'Base calc. ICMS', valor: moeda(tot.vBC), alinhar: 'right' },
    { label: 'Valor ICMS', valor: moeda(tot.vICMS), alinhar: 'right' },
    { label: 'Base calc. ICMS ST', valor: moeda(tot.vBCST), alinhar: 'right' },
    { label: 'Valor ICMS ST', valor: moeda(tot.vST), alinhar: 'right' },
    { label: 'Valor dos produtos', valor: moeda(tot.vProd), alinhar: 'right' },
  ]);
  p.linha([
    { label: 'Frete', valor: moeda(tot.vFrete), alinhar: 'right' },
    { label: 'Seguro', valor: moeda(tot.vSeg), alinhar: 'right' },
    { label: 'Desconto', valor: moeda(tot.vDesc), alinhar: 'right' },
    { label: 'Outras despesas', valor: moeda(tot.vOutro), alinhar: 'right' },
    { label: 'Valor IPI', valor: moeda(tot.vIPI), alinhar: 'right' },
    { label: 'Valor total da nota', valor: moeda(tot.vNF), alinhar: 'right', negrito: true },
  ]);

  const transp = inf.transp || {};
  if (transp.transporta || transp.modFrete !== undefined) {
    p.secao('Transportador');
    const modFrete = { 0: 'Emitente', 1: 'Destinatario', 2: 'Terceiros', 3: 'Proprio rem.', 4: 'Proprio dest.', 9: 'Sem frete' };
    p.linha([
      { label: 'Razao social', valor: transp.transporta?.xNome, peso: 3 },
      { label: 'Frete por conta', valor: modFrete[transp.modFrete] || transp.modFrete, peso: 1.3 },
      { label: 'CNPJ/CPF', valor: doc(transp.transporta), peso: 1.5 },
    ]);
  }

  p.secao('Dados dos produtos / servicos');
  const itens = lista(inf.det).map((d) => {
    const pr = d.prod || {};
    return [pr.cProd, pr.xProd, pr.NCM, pr.CFOP, pr.uCom, numero(pr.qCom), moeda(pr.vUnCom), moeda(pr.vProd)];
  });
  p.tabela(
    [
      { titulo: 'Codigo', peso: 1.2 },
      { titulo: 'Descricao', peso: 4.2 },
      { titulo: 'NCM', peso: 1 },
      { titulo: 'CFOP', peso: 0.7 },
      { titulo: 'Un', peso: 0.6 },
      { titulo: 'Qtd', peso: 0.9, alinhar: 'right' },
      { titulo: 'Vl. unit.', peso: 1.1, alinhar: 'right' },
      { titulo: 'Vl. total', peso: 1.1, alinhar: 'right' },
    ],
    itens,
  );

  const infAdic = [inf.infAdic?.infCpl, inf.infAdic?.infAdFisco].filter(Boolean).join('\n');
  if (infAdic) {
    p.secao('Informacoes complementares');
    p.texto(infAdic);
  }
}

// --------------------------------------------------------------------- NFS-e

async function desenharNFSe(p, nota) {
  const obj = xmlToObj(nota.xml);
  const inf = obj?.NFSe?.infNFSe;

  if (!inf) {
    // Layout municipal desconhecido: mostra o que foi indexado.
    p.titulo('NFS-e - Nota Fiscal de Servico Eletronica');
    p.linha([
      { label: 'Numero', valor: nota.numero },
      { label: 'Emissao', valor: dataHora(nota.dataEmissao) },
      { label: 'Valor', valor: `R$ ${moeda(nota.valorTotal)}`, negrito: true },
    ]);
    p.linha([
      { label: 'Prestador', valor: nota.emitenteNome, peso: 2 },
      { label: 'CNPJ/CPF', valor: formatarDocumento(nota.emitenteCnpjCpf) },
    ]);
    p.linha([
      { label: 'Tomador', valor: nota.destinatarioNome, peso: 2 },
      { label: 'CNPJ/CPF', valor: formatarDocumento(nota.destinatarioCnpjCpf) },
    ]);
    return;
  }

  const dps = inf.DPS?.infDPS || {};
  const emit = inf.emit || {};
  const prest = dps.prest || {};
  const toma = dps.toma || {};
  const serv = dps.serv || {};
  const valores = inf.valores || {};
  const vDps = dps.valores || {};
  const trib = vDps.trib || {};
  const chave = txt(inf['@_Id']).replace(/^NFS/, '');

  p.titulo(
    'DANFSe - Documento Auxiliar da NFS-e',
    `NFS-e n. ${inf.nNFSe} · ${inf.xLocEmi ? `Emitida em ${inf.xLocEmi}` : ''} · Processada em ${dataHora(inf.dhProc)}`,
  );

  p.linha([
    { label: 'Numero da NFS-e', valor: inf.nNFSe, negrito: true },
    { label: 'Competencia', valor: dataSo(dps.dCompet) },
    { label: 'Emissao da DPS', valor: dataHora(dps.dhEmi), peso: 1.5 },
    { label: 'Serie / numero DPS', valor: [dps.serie, dps.nDPS].filter(Boolean).join(' / '), peso: 1.2 },
  ]);
  await p.chave('Chave de acesso da NFS-e', chave || nota.chave);

  p.secao('Prestador do servico');
  p.linha([
    { label: 'Nome / razao social', valor: emit.xNome || prest.xNome, peso: 3, negrito: true },
    { label: 'CNPJ/CPF', valor: doc(emit) || doc(prest), peso: 1.4 },
    { label: 'Inscricao municipal', valor: emit.IM || prest.IM, peso: 1.1 },
  ]);
  const endPrest = emit.enderNac || prest.end?.endNac;
  if (endPrest || emit.xLgr) p.linha([{ label: 'Endereco', valor: endereco({ ...endPrest, ...emit.enderNac }) }]);

  p.secao('Tomador do servico');
  p.linha([
    { label: 'Nome / razao social', valor: toma.xNome, peso: 3, negrito: true },
    { label: 'CNPJ/CPF', valor: doc(toma), peso: 1.4 },
    { label: 'E-mail', valor: toma.email, peso: 1.6 },
  ]);
  if (toma.end?.endNac || toma.end) {
    const e = toma.end || {};
    p.linha([{ label: 'Endereco', valor: endereco({ ...e, ...(e.endNac || {}) }) }]);
  }

  if (dps.interm) {
    p.secao('Intermediario');
    p.linha([
      { label: 'Nome', valor: dps.interm.xNome, peso: 3 },
      { label: 'CNPJ/CPF', valor: doc(dps.interm), peso: 1.4 },
    ]);
  }

  p.secao('Servico prestado');
  const cServ = serv.cServ || {};
  p.linha([
    { label: 'Codigo de tributacao nacional', valor: cServ.cTribNac, peso: 1.2 },
    { label: 'Codigo municipal', valor: cServ.cTribMun },
    { label: 'Local da prestacao', valor: inf.xLocPrestacao || serv.locPrest?.cLocPrestacao, peso: 1.6 },
    { label: 'Municipio de incidencia', valor: inf.xLocIncid, peso: 1.4 },
  ]);
  p.texto(cServ.xDescServ || inf.xTribNac || '');

  p.secao('Valores e tributos');
  const issqn = trib.tribMun || {};
  p.linha([
    { label: 'Valor do servico', valor: moeda(vDps.vServPrest?.vServ), alinhar: 'right', negrito: true },
    { label: 'Descontos', valor: moeda(Number(vDps.vDescCondIncond?.vDescIncond || 0) + Number(vDps.vDescCondIncond?.vDescCond || 0)), alinhar: 'right' },
    { label: 'Deducoes', valor: moeda(valores.vDR || vDps.vDedRed?.vDR), alinhar: 'right' },
    { label: 'Base de calculo', valor: moeda(valores.vBC), alinhar: 'right' },
  ]);
  p.linha([
    { label: 'Aliquota ISSQN', valor: valores.pAliqAplic ? `${numero(valores.pAliqAplic, 2)}%` : '', alinhar: 'right' },
    { label: 'Valor ISSQN', valor: moeda(valores.vISSQN), alinhar: 'right' },
    { label: 'ISSQN retido', valor: { 1: 'Nao retido', 2: 'Retido pelo tomador', 3: 'Retido pelo intermediario' }[issqn.tpRetISSQN] || '' },
    { label: 'Total retencoes', valor: moeda(valores.vTotalRet), alinhar: 'right' },
    { label: 'Valor liquido', valor: moeda(valores.vLiq), alinhar: 'right', negrito: true },
  ]);

  const infCompl = dps.infoCompl?.xInfComp || serv.infoCompl?.xInfComp;
  if (infCompl) {
    p.secao('Informacoes complementares');
    p.texto(infCompl);
  }
}

// --------------------------------------------------------------------- CT-e

async function desenharCTe(p, nota) {
  const obj = xmlToObj(nota.xml);
  const cte = obj?.cteProc?.CTe || obj?.CTe || obj?.cteOSProc?.CTeOS || obj?.CTeOS;
  const prot = (obj?.cteProc || obj?.cteOSProc)?.protCTe?.infProt || {};

  if (!cte) {
    p.titulo('CT-e - Conhecimento de Transporte Eletronico');
    p.linha([
      { label: 'Numero', valor: nota.numero },
      { label: 'Emissao', valor: dataHora(nota.dataEmissao) },
      { label: 'Valor', valor: `R$ ${moeda(nota.valorTotal)}`, negrito: true },
    ]);
    await p.chave('Chave de acesso', nota.chave);
    return;
  }

  const inf = cte.infCte || cte.infCTe || {};
  const ide = inf.ide || {};
  const emit = inf.emit || {};
  const vPrest = inf.vPrest || {};
  const norm = inf.infCTeNorm || {};
  const carga = norm.infCarga || {};
  const modal = { '01': 'Rodoviario', '02': 'Aereo', '03': 'Aquaviario', '04': 'Ferroviario', '05': 'Dutoviario', '06': 'Multimodal' };
  const tomaCod = txt(ide.toma3?.toma ?? ide.toma ?? ide.toma4?.toma);
  const tomaNome = { 0: 'Remetente', 1: 'Expedidor', 2: 'Recebedor', 3: 'Destinatario', 4: 'Outros' }[tomaCod] || '';

  p.titulo(
    'DACTE - Documento Auxiliar do Conhecimento de Transporte Eletronico',
    `CT-e n. ${ide.nCT} · Serie ${ide.serie} · Modal ${modal[txt(ide.modal).padStart(2, '0')] || ide.modal || ''} · ${ide.natOp || ''}`,
  );

  p.linha([
    { label: 'Emitente (transportador)', valor: emit.xNome, peso: 3, negrito: true },
    { label: 'CNPJ/CPF', valor: doc(emit), peso: 1.4 },
    { label: 'Inscricao estadual', valor: emit.IE, peso: 1.1 },
  ]);
  p.linha([
    { label: 'Numero', valor: ide.nCT },
    { label: 'Serie', valor: ide.serie },
    { label: 'Emissao', valor: dataHora(ide.dhEmi), peso: 1.6 },
    { label: 'CFOP', valor: ide.CFOP },
    { label: 'Protocolo', valor: [prot.nProt, dataHora(prot.dhRecbto)].filter(Boolean).join(' - '), peso: 2.4 },
  ]);
  await p.chave('Chave de acesso', txt(inf['@_Id']).replace(/^CTe/, '') || nota.chave);

  p.linha([
    { label: 'Inicio da prestacao', valor: [ide.xMunIni, ide.UFIni].filter(Boolean).join(' - ') },
    { label: 'Termino da prestacao', valor: [ide.xMunFim, ide.UFFim].filter(Boolean).join(' - ') },
    { label: 'Tomador do servico', valor: tomaNome || doc(ide.toma4) },
  ]);

  const partes = [
    ['Remetente', inf.rem],
    ['Destinatario', inf.dest],
    ['Expedidor', inf.exped],
    ['Recebedor', inf.receb],
  ].filter(([, v]) => v);
  if (partes.length) {
    p.secao('Participantes');
    for (const [rotulo, v] of partes) {
      p.linha([
        { label: rotulo, valor: v.xNome, peso: 3 },
        { label: 'CNPJ/CPF', valor: doc(v), peso: 1.4 },
        { label: 'Municipio', valor: [(v.enderReme || v.enderDest || v.enderExped || v.enderReceb || {}).xMun, (v.enderReme || v.enderDest || v.enderExped || v.enderReceb || {}).UF].filter(Boolean).join(' - '), peso: 1.4 },
      ]);
    }
  }

  if (carga.proPred || carga.vCarga) {
    p.secao('Carga');
    p.linha([
      { label: 'Produto predominante', valor: carga.proPred, peso: 2 },
      { label: 'Outras caracteristicas', valor: carga.xOutCat, peso: 1.4 },
      { label: 'Valor da carga', valor: moeda(carga.vCarga), alinhar: 'right' },
    ]);
  }

  p.secao('Componentes do valor da prestacao');
  const comps = lista(vPrest.Comp).map((c) => [c.xNome, moeda(c.vComp)]);
  if (comps.length) p.tabela([{ titulo: 'Componente', peso: 4 }, { titulo: 'Valor', peso: 1, alinhar: 'right' }], comps);
  p.linha([
    { label: 'Valor total da prestacao', valor: moeda(vPrest.vTPrest), alinhar: 'right', negrito: true },
    { label: 'Valor a receber', valor: moeda(vPrest.vRec), alinhar: 'right' },
  ]);

  const docsNFe = lista(norm.infDoc?.infNFe).map((d) => d.chave).filter(Boolean);
  if (docsNFe.length) {
    p.secao('Documentos originarios (NF-e)');
    p.texto(docsNFe.map(chaveFormatada).join('\n'));
  }
  if (inf.compl?.xObs) {
    p.secao('Observacoes');
    p.texto(inf.compl.xObs);
  }
}

// --------------------------------------------------------------------- entrada

/** NFS-e do padrao nacional: DANFSe no layout oficial do Portal Nacional (NT 008). */
async function danfseOficial(nota) {
  if (nota.tipo !== 'nfse' || !/<infNFSe[\s>]/.test(nota.xml || '')) return null;
  try {
    return await danfseNacional.gerarDanfse(Buffer.from(nota.xml, 'utf8'), {
      situacao: nota.cancelada ? 'cancelada' : 'normal',
      canhoto: false,
    });
  } catch (err) {
    console.warn(`[pdf] DANFSe oficial falhou para ${nota.chave || nota._id}: ${err.message}. Usando layout simplificado.`);
    return null;
  }
}

/** NF-e modelo 55 completa: DANFE no leiaute retrato oficial. */
async function danfeOficial(nota) {
  if (nota.tipo !== 'nfe' || nota.resumo) return null;
  try {
    return await gerarDanfe(nota.xml, { cancelada: nota.cancelada });
  } catch (err) {
    console.warn(`[pdf] DANFE falhou para ${nota.chave || nota._id}: ${err.message}. Usando layout simplificado.`);
    return null;
  }
}

/** NFC-e (modelo 65) completa: cupom de 80 mm com QR Code. */
async function danfeNfceOficial(nota) {
  if (nota.tipo !== 'nfce' || nota.resumo) return null;
  try {
    return await gerarDanfeNfce(nota.xml, { cancelada: nota.cancelada });
  } catch (err) {
    console.warn(`[pdf] DANFE NFC-e falhou para ${nota.chave || nota._id}: ${err.message}. Usando layout simplificado.`);
    return null;
  }
}

/** CT-e completo: DACTE no leiaute retrato oficial. */
async function dacteOficial(nota) {
  if (nota.tipo !== 'cte' || nota.resumo) return null;
  try {
    return await gerarDacte(nota.xml, { cancelada: nota.cancelada });
  } catch (err) {
    console.warn(`[pdf] DACTE falhou para ${nota.chave || nota._id}: ${err.message}. Usando layout simplificado.`);
    return null;
  }
}

/** Gera o PDF da nota e devolve um Buffer. */
export async function gerarPdfNota(nota) {
  const oficial = (await danfseOficial(nota)) || (await danfeOficial(nota)) || (await danfeNfceOficial(nota)) || (await dacteOficial(nota));
  if (oficial) return oficial;

  const doc = new PDFDocument({ size: 'A4', margin: MARGEM, bufferPages: true, info: { Title: `${nota.tipo} ${nota.numero || nota.chave || ''}` } });
  const partes = [];
  doc.on('data', (c) => partes.push(c));
  const fim = new Promise((ok) => doc.on('end', ok));

  const p = new Pagina(doc);
  if (nota.tipo === 'nfse') await desenharNFSe(p, nota);
  else if (nota.tipo === 'cte') await desenharCTe(p, nota);
  else if (nota.tipo === 'nfe' || nota.tipo === 'nfce') await desenharNFe(p, nota);
  else {
    p.titulo('Evento de documento fiscal');
    p.linha([
      { label: 'Tipo do evento', valor: nota.tpEvento || nota.numero },
      { label: 'Data', valor: dataHora(nota.dataEmissao) },
    ]);
    await p.chave('Chave do documento', nota.chaveNota);
  }

  if (nota.cancelada) marcaCancelada(doc);
  rodape(doc, new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }));
  doc.end();
  await fim;
  return Buffer.concat(partes);
}

/** Nome de arquivo amigavel para a nota (sem extensao). */
export function nomeArquivoNota(nota) {
  const tipo = { nfe: 'NFe', nfce: 'NFCe', nfse: 'NFSe', cte: 'CTe', evento: 'Evento' }[nota.tipo] || 'Doc';
  const id = nota.chave || nota.chaveNota || String(nota._id);
  return `${tipo}_${nota.numero ? `${nota.numero}_` : ''}${id}`.replace(/[^\w.-]/g, '_');
}
