/** "Valor Total da NFS-e" e "Informações Complementares" (NT 008, itens 2.1.11 e 2.1.12). */
const f = require('../formatar');
const { soma } = require('./tributos');

function totais(INF, DPS) {
  // Sem IBS/CBS o portal nacional imprime R$ 0,00 nos dois totais (não traço).
  const totalIbsCbs = soma('0', INF('IBSCBS/totCIBS/gIBS/vIBSTot'), INF('IBSCBS/totCIBS/gCBS/vCBS'));
  return {
    valorServico: f.reais(DPS('valores/vServPrest/vServ')),
    descontoIncond: f.reais(DPS('valores/vDescCondIncond/vDescIncond')),
    descontoCond: f.reais(DPS('valores/vDescCondIncond/vDescCond')),
    totalRetencoes: f.reais(INF('valores/vTotalRet')),
    valorLiquido: f.reais(INF('valores/vLiq')),
    totalIbsCbs: f.reais(totalIbsCbs),
    liquidoMaisIbsCbs: f.reais(INF('IBSCBS/totCIBS/vTotNF') || '0'),
  };
}

/**
 * Tributos aproximados da Lei 12.741/2012 (nota 10): R$ ou % por esfera, no formato do DANFSe do portal nacional.
 * Sem valor por esfera (ex.: só o % do Simples, pTotTribSN) → traço, como o portal. Linha nunca cortada.
 */
function tributosAproximados(DPS) {
  const T = c => DPS(`valores/trib/totTrib/${c}`);
  let fmt = () => f.VAZIO, esf = [];
  if (DPS.existe('valores/trib/totTrib/vTotTrib')) [fmt, esf] = [f.reais, ['vTotTrib/vTotTribFed', 'vTotTrib/vTotTribEst', 'vTotTrib/vTotTribMun']];
  else if (DPS.existe('valores/trib/totTrib/pTotTrib')) [fmt, esf] = [f.percentual, ['pTotTrib/pTotTribFed', 'pTotTrib/pTotTribEst', 'pTotTrib/pTotTribMun']];
  const [fed, est, mun] = [0, 1, 2].map(i => fmt(esf[i] ? T(esf[i]) : null));
  return `Totais aproximados dos Tributos cfe. Lei n° 12.741/2012: Federais: ${fed}; Estaduais: ${est}; Municipais: ${mun};`;
}

/** Ordem da NT: Inf. Cont.; NFS-e Subst.; Doc. Ref.; Cod. Obra; Insc. Imob.; Cod. Evt.; Doc. Tec.; Núm. Ped.; Item Ped.; Inf. A. T. Mun. */
function complementares(INF, DPS) {
  const C = c => DPS(`serv/infoCompl/${c}`);
  const itens = DPS.todos('serv/infoCompl/gItemPed/xItemPed').map(L => L.valor());
  const partes = [
    ['Inf. Cont.', C('xInfComp')],
    ['NFS-e Subst.', DPS('subst/chSubstda')],
    ['Doc. Ref.', C('docRef')],
    ['Cod. Obra', DPS('serv/obra/cObra')],
    ['Insc. Imob.', DPS('IBSCBS/imovel/inscImobFisc')],
    ['Cod. Evt.', DPS('serv/atvEvento/idAtvEvt')],
    ['Doc. Tec.', C('idDocTec')],
    ['Núm. Ped.', C('xPed')],
    ['Item Ped.', itens.filter(f.temValor).join(', ')],
    ['Inf. A. T. Mun.', INF('xOutInf')],
  ].filter(([, v]) => f.temValor(v)).map(([rot, v]) => `${rot}: ${String(v).trim()}`);
  return { texto: f.limitar(partes.join(' | '), 1997), tributosAproximados: tributosAproximados(DPS) };
}

module.exports = { totais, complementares };
