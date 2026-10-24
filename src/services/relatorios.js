import ExcelJS from 'exceljs';
import { NotaFiscal } from '../models/NotaFiscal.js';
import { xmlToObj } from './sefaz/parseDocumento.js';
import { formatarDocumento } from '../utils/documento.js';

/**
 * Relatorios fiscais a partir das notas capturadas/importadas.
 * Todas as funcoes recebem o filtro do MongoDB montado por montarFiltroNotas().
 * Notas canceladas nao entram nos valores.
 */
const TZ = '-03:00';
const LIMITE_ITENS = 5000; // notas lidas para o resumo por CFOP/NCM

const lista = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
const semCanceladas = (filtro) => ({ ...filtro, cancelada: { $ne: true } });

/** Entradas x saidas por mes. */
export async function resumoMensal(filtro) {
  const linhas = await NotaFiscal.aggregate([
    { $match: { ...semCanceladas(filtro), dataEmissao: { ...(filtro.dataEmissao || {}), $type: 'date' } } },
    {
      $group: {
        _id: { mes: { $dateToString: { format: '%Y-%m', date: '$dataEmissao', timezone: TZ } }, papel: '$papel', tipo: '$tipo' },
        qtd: { $sum: 1 },
        valor: { $sum: '$valorTotal' },
      },
    },
    { $sort: { '_id.mes': 1 } },
  ]);
  const meses = new Map();
  for (const l of linhas) {
    const m = meses.get(l._id.mes) || {
      mes: l._id.mes,
      entradas: { qtd: 0, valor: 0 },
      saidas: { qtd: 0, valor: 0 },
      produtos: 0,
      servicos: 0,
      transporte: 0,
    };
    const lado = l._id.papel === 'emitente' ? m.saidas : m.entradas;
    lado.qtd += l.qtd;
    lado.valor += l.valor;
    if (['nfe', 'nfce'].includes(l._id.tipo)) m.produtos += l.valor;
    if (l._id.tipo === 'nfse') m.servicos += l.valor;
    if (l._id.tipo === 'cte') m.transporte += l.valor;
    meses.set(l._id.mes, m);
  }
  return [...meses.values()];
}

/** Maiores parceiros: fornecedores/prestadores (entradas) ou clientes/tomadores (saidas). */
export async function porParceiro(filtro, papel, limite = 20) {
  const ehEntrada = papel === 'destinatario';
  const doc = ehEntrada ? '$emitenteCnpjCpf' : '$destinatarioCnpjCpf';
  const nome = ehEntrada ? '$emitenteNome' : '$destinatarioNome';
  const linhas = await NotaFiscal.aggregate([
    { $match: { ...semCanceladas(filtro), papel } },
    { $group: { _id: doc, nome: { $first: nome }, qtd: { $sum: 1 }, valor: { $sum: '$valorTotal' } } },
    { $sort: { valor: -1 } },
    { $limit: limite },
  ]);
  return linhas.map((l) => ({ documento: formatarDocumento(l._id || ''), nome: l.nome || '-', qtd: l.qtd, valor: l.valor }));
}

/** Soma dos itens das NF-e completas por CFOP e por NCM (le os XMLs). */
export async function porCfopNcm(filtro) {
  const cfop = new Map();
  const ncm = new Map();
  let notasLidas = 0;
  const cursor = NotaFiscal.find({ ...semCanceladas(filtro), tipo: { $in: ['nfe', 'nfce'] }, resumo: { $ne: true } })
    .select('xml papel')
    .limit(LIMITE_ITENS)
    .lean()
    .cursor();
  for await (const nota of cursor) {
    notasLidas += 1;
    let det;
    try {
      const o = xmlToObj(nota.xml);
      det = lista((o?.nfeProc?.NFe || o?.NFe)?.infNFe?.det);
    } catch {
      continue;
    }
    for (const item of det) {
      const p = item.prod || {};
      const v = Number(p.vProd) || 0;
      const lado = nota.papel === 'emitente' ? 'saida' : 'entrada';
      const c = cfop.get(p.CFOP) || { cfop: String(p.CFOP || '-'), itens: 0, valor: 0, lado };
      c.itens += 1;
      c.valor += v;
      cfop.set(p.CFOP, c);
      const n = ncm.get(p.NCM) || { ncm: String(p.NCM || '-'), descricao: String(p.xProd || ''), itens: 0, valor: 0 };
      n.itens += 1;
      n.valor += v;
      ncm.set(p.NCM, n);
    }
  }
  const ordenar = (m) => [...m.values()].sort((a, b) => b.valor - a.valor);
  return { cfop: ordenar(cfop), ncm: ordenar(ncm).slice(0, 50), notasLidas, limitado: notasLidas >= LIMITE_ITENS };
}

/** Planilha Excel com a lista de notas e os resumos. */
export async function gerarExcel(filtro) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Captura Total';
  wb.created = new Date();
  const moeda = '#,##0.00';
  const estiloCabecalho = (ws) => {
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } };
  };

  // Notas
  const wsN = wb.addWorksheet('Notas');
  wsN.columns = [
    { header: 'Tipo', key: 'tipo', width: 8 },
    { header: 'Numero', key: 'numero', width: 12 },
    { header: 'Serie', key: 'serie', width: 7 },
    { header: 'Emissao', key: 'emissao', width: 12, style: { numFmt: 'dd/mm/yyyy' } },
    { header: 'Emitente / prestador', key: 'emitente', width: 36 },
    { header: 'CNPJ/CPF emitente', key: 'docEmit', width: 20 },
    { header: 'Destinatario / tomador', key: 'dest', width: 36 },
    { header: 'CNPJ/CPF destinatario', key: 'docDest', width: 20 },
    { header: 'Valor', key: 'valor', width: 14, style: { numFmt: moeda } },
    { header: 'Papel', key: 'papel', width: 16 },
    { header: 'Situacao', key: 'situacao', width: 12 },
    { header: 'Chave', key: 'chave', width: 52 },
    { header: 'Empresa', key: 'empresa', width: 30 },
  ];
  const cursor = NotaFiscal.find(filtro).select('-xml').sort('dataEmissao').populate('empresa', 'razaoSocial').lean().cursor();
  for await (const n of cursor) {
    wsN.addRow({
      tipo: n.tipo.toUpperCase(),
      numero: n.numero,
      serie: n.serie,
      emissao: n.dataEmissao ? new Date(new Date(n.dataEmissao).getTime() - 3 * 3600e3) : null,
      emitente: n.emitenteNome,
      docEmit: formatarDocumento(n.emitenteCnpjCpf),
      dest: n.destinatarioNome,
      docDest: formatarDocumento(n.destinatarioCnpjCpf),
      valor: n.valorTotal || 0,
      papel: { emitente: 'Emitida/prestada', destinatario: 'Recebida/tomada' }[n.papel] || '',
      situacao: n.cancelada ? 'Cancelada' : n.resumo ? 'Resumo' : 'Autorizada',
      chave: n.chave || n.chaveNota,
      empresa: n.empresa?.razaoSocial,
    });
  }
  estiloCabecalho(wsN);

  // Resumo mensal
  const wsM = wb.addWorksheet('Resumo mensal');
  wsM.columns = [
    { header: 'Mes', key: 'mes', width: 10 },
    { header: 'Entradas (qtd)', key: 'eq', width: 14 },
    { header: 'Entradas (R$)', key: 'ev', width: 16, style: { numFmt: moeda } },
    { header: 'Saidas (qtd)', key: 'sq', width: 12 },
    { header: 'Saidas (R$)', key: 'sv', width: 16, style: { numFmt: moeda } },
    { header: 'Produtos (R$)', key: 'p', width: 16, style: { numFmt: moeda } },
    { header: 'Servicos (R$)', key: 's', width: 16, style: { numFmt: moeda } },
    { header: 'Transporte (R$)', key: 't', width: 16, style: { numFmt: moeda } },
  ];
  for (const m of await resumoMensal(filtro)) {
    wsM.addRow({ mes: m.mes, eq: m.entradas.qtd, ev: m.entradas.valor, sq: m.saidas.qtd, sv: m.saidas.valor, p: m.produtos, s: m.servicos, t: m.transporte });
  }
  estiloCabecalho(wsM);

  // Parceiros
  for (const [nome, papel] of [['Fornecedores', 'destinatario'], ['Clientes', 'emitente']]) {
    const ws = wb.addWorksheet(nome);
    ws.columns = [
      { header: 'CNPJ/CPF', key: 'documento', width: 20 },
      { header: 'Nome', key: 'nome', width: 40 },
      { header: 'Notas', key: 'qtd', width: 8 },
      { header: 'Valor (R$)', key: 'valor', width: 16, style: { numFmt: moeda } },
    ];
    for (const l of await porParceiro(filtro, papel, 500)) ws.addRow(l);
    estiloCabecalho(ws);
  }

  // CFOP / NCM
  const itens = await porCfopNcm(filtro);
  const wsC = wb.addWorksheet('Por CFOP');
  wsC.columns = [
    { header: 'CFOP', key: 'cfop', width: 8 },
    { header: 'Itens', key: 'itens', width: 8 },
    { header: 'Valor dos produtos (R$)', key: 'valor', width: 22, style: { numFmt: moeda } },
  ];
  itens.cfop.forEach((l) => wsC.addRow(l));
  estiloCabecalho(wsC);
  const wsNcm = wb.addWorksheet('Por NCM');
  wsNcm.columns = [
    { header: 'NCM', key: 'ncm', width: 12 },
    { header: 'Exemplo de produto', key: 'descricao', width: 44 },
    { header: 'Itens', key: 'itens', width: 8 },
    { header: 'Valor (R$)', key: 'valor', width: 16, style: { numFmt: moeda } },
  ];
  itens.ncm.forEach((l) => wsNcm.addRow(l));
  estiloCabecalho(wsNcm);

  return wb.xlsx.writeBuffer();
}
