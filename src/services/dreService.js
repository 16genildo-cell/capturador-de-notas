import { NotaFiscal } from '../models/NotaFiscal.js';

/**
 * Monta o Demonstrativo de Resultado do Exercício (DRE Gerencial)
 * a partir das notas fiscais e documentos capturados.
 * Pode ser executado via consulta no banco (passando owner, empresaId, inicio, fim)
 * ou a partir de arrays em memória (para testes e cálculos locais).
 */
export async function calcularDre(params = {}) {
  const { owner, empresaId, inicio, fim, notasEmitidas, notasEntrada, vendasEmissao } = params;

  // Modo em memória / teste
  if (notasEmitidas || notasEntrada || vendasEmissao) {
    let receitaBruta = 0;
    let impostos = 0;
    const listaEmitidas = notasEmitidas || [];
    const listaEntradas = notasEntrada || [];
    const listaVendas = vendasEmissao || [];

    for (const n of listaEmitidas) {
      const v = Number(n.valorTotal || n.totais?.valorTotal || 0);
      receitaBruta += v;
      impostos += Number(n.totais?.icms || 0) + Number(n.totais?.pis || 0) + Number(n.totais?.cofins || 0);
    }
    for (const v of listaVendas) {
      receitaBruta += Number(v.valorTotal || 0);
    }

    let cmv = 0;
    for (const e of listaEntradas) {
      cmv += Number(e.valorTotal || e.totais?.valorTotal || 0);
    }

    const deducoes = impostos;
    const receitaLiquida = Math.max(0, receitaBruta - deducoes);
    const lucroBruto = receitaLiquida - cmv;
    const margemBruta = receitaLiquida > 0 ? (lucroBruto / receitaLiquida) * 100 : 0;
    const despesasOperacionais = 0;
    const resultadoOperacional = lucroBruto - despesasOperacionais;
    const margemOperacional = receitaLiquida > 0 ? (resultadoOperacional / receitaLiquida) * 100 : 0;

    return {
      receitaBruta,
      receitaProdutos: receitaBruta,
      receitaServicos: 0,
      deducoes,
      totalCancelamentos: 0,
      impostos,
      receitaLiquida,
      cmv,
      custoMercadorias: cmv,
      lucroBruto,
      margemBruta,
      despesasOperacionais,
      despesaFrete: 0,
      despesaServicos: 0,
      resultadoOperacional,
      lucroLiquido: resultadoOperacional,
      margemOperacional,
    };
  }

  const filtroBase = {
    owner,
    ...(empresaId ? { empresa: empresaId } : {}),
    dataEmissao: { $gte: inicio, $lte: fim },
  };

  const [emitidas, canceladas, compras, transportes, servicosTomados] = await Promise.all([
    // 1. Receita Bruta (Notas emitidas autorizadas)
    NotaFiscal.aggregate([
      { $match: { ...filtroBase, papel: 'emitente', cancelada: { $ne: true } } },
      { $group: { _id: '$tipo', total: { $sum: '$valorTotal' }, qtd: { $sum: 1 } } },
    ]),
    // 2. Deduções (Notas canceladas emitidas)
    NotaFiscal.aggregate([
      { $match: { ...filtroBase, papel: 'emitente', cancelada: true } },
      { $group: { _id: null, total: { $sum: '$valorTotal' }, qtd: { $sum: 1 } } },
    ]),
    // 3. Custos / Compras de mercadorias (Entradas de produtos)
    NotaFiscal.aggregate([
      { $match: { ...filtroBase, papel: 'destinatario', tipo: { $in: ['nfe', 'nfce'] }, cancelada: { $ne: true } } },
      { $group: { _id: null, total: { $sum: '$valorTotal' }, qtd: { $sum: 1 } } },
    ]),
    // 4. Despesas com Transporte (CT-e tomado)
    NotaFiscal.aggregate([
      { $match: { ...filtroBase, papel: 'destinatario', tipo: 'cte', cancelada: { $ne: true } } },
      { $group: { _id: null, total: { $sum: '$valorTotal' }, qtd: { $sum: 1 } } },
    ]),
    // 5. Despesas com Serviços Tomados (NFS-e tomada)
    NotaFiscal.aggregate([
      { $match: { ...filtroBase, papel: 'destinatario', tipo: 'nfse', cancelada: { $ne: true } } },
      { $group: { _id: null, total: { $sum: '$valorTotal' }, qtd: { $sum: 1 } } },
    ]),
  ]);

  let receitaProdutos = 0;
  let receitaServicos = 0;
  for (const item of emitidas) {
    if (['nfe', 'nfce'].includes(item._id)) receitaProdutos += item.total;
    if (item._id === 'nfse') receitaServicos += item.total;
  }
  const receitaBruta = receitaProdutos + receitaServicos;

  const totalCancelamentos = canceladas[0]?.total || 0;
  const deducoes = totalCancelamentos;
  const receitaLiquida = Math.max(0, receitaBruta - deducoes);

  const cmv = compras[0]?.total || 0;
  const lucroBruto = receitaLiquida - cmv;
  const margemBruta = receitaLiquida > 0 ? (lucroBruto / receitaLiquida) * 100 : 0;

  const despesaFrete = transportes[0]?.total || 0;
  const despesaServicos = servicosTomados[0]?.total || 0;
  const despesasOperacionais = despesaFrete + despesaServicos;

  const resultadoOperacional = lucroBruto - despesasOperacionais;
  const margemOperacional = receitaLiquida > 0 ? (resultadoOperacional / receitaLiquida) * 100 : 0;

  return {
    receitaBruta,
    receitaProdutos,
    receitaServicos,
    deducoes,
    totalCancelamentos,
    impostos: deducoes,
    receitaLiquida,
    cmv,
    custoMercadorias: cmv,
    lucroBruto,
    margemBruta,
    despesasOperacionais,
    despesaFrete,
    despesaServicos,
    resultadoOperacional,
    lucroLiquido: resultadoOperacional,
    margemOperacional,
  };
}
