/** "Tributação Municipal (ISSQN)" e "Tributação Federal (exceto CBS)" — NT 008, itens 2.1.8 e 2.1.9. */
const f = require('../formatar');
const D = require('../dados/dominios');
const { municipio } = require('../dados/municipios');

/** Soma de valores do XML; nenhum presente → null. */
function soma(...valores) {
  const cheios = valores.filter(f.temValor).map(Number);
  return cheios.length ? cheios.reduce((a, b) => a + b, 0).toFixed(2) : null;
}

function issqn(INF, DPS) {
  const T = c => DPS(`valores/trib/tribMun/${c}`);
  const trib = T('tribISSQN');
  const cLoc = INF('cLocIncid');
  const m = municipio(cLoc);
  const bruto = {
    regimeEspecial: DPS('prest/regTrib/regEspTrib'), imunidade: T('tpImunidade'),
    suspensao: T('exigSusp/tpSusp'), processo: T('exigSusp/nProcesso'),
    beneficio: INF('valores/tpBM'), calculoBM: INF('valores/vCalcBM') || T('BM/vRedBCBM'),
    deducoes: soma(INF('valores/vCalcDR') || DPS('valores/vDedRed/vDR'), INF('IBSCBS/valores/vCalcReeRepRes')),
    descontoIncond: DPS('valores/vDescCondIncond/vDescIncond'),
  };
  return {
    // Nota 4: sem ISSQN (grupo ausente ou "Não Incidência") → bloco resumido.
    sujeito: !!trib && trib !== '4',
    tipoTributacao: f.descricao(D.tribISSQN, trib),
    municipioIncidencia: f.compor([INF('xLocIncid') || (m && m.nome), m && m.uf, T('cPaisResult')]),
    regimeEspecial: f.descricao(D.regEspTrib, bruto.regimeEspecial),
    imunidade: f.descricao(D.tpImunidade, bruto.imunidade),
    suspensao: f.descricao(D.tpSusp, bruto.suspensao),
    processo: f.ou(bruto.processo),
    beneficio: f.descricao(D.tpBM, bruto.beneficio),
    calculoBM: f.reais(bruto.calculoBM),
    deducoes: f.reais(bruto.deducoes),
    descontoIncond: f.reais(bruto.descontoIncond),
    baseCalculo: f.reais(INF('valores/vBC')),
    aliquota: f.percentual(INF('valores/pAliqAplic')),
    retencao: f.descricao(D.tpRetISSQN, T('tpRetISSQN')),
    apurado: f.reais(INF('valores/vISSQN')),
    // Nota 5: as linhas marcadas com ** somem quando TODOS os campos delas estão vazios no XML.
    // Regime especial "0 - Nenhum" conta como vazio (o portal nacional omite a linha).
    linhaRegimeVazia: ![bruto.regimeEspecial === '0' ? null : bruto.regimeEspecial, bruto.imunidade, bruto.suspensao, bruto.processo].some(f.temValor),
    linhaBeneficioVazia: ![bruto.beneficio, bruto.calculoBM, bruto.deducoes, bruto.descontoIncond].some(f.temValor),
  };
}

function federal(DPS) {
  const F = c => DPS(`valores/trib/tribFed/${c}`);
  const tpRet = F('piscofins/tpRetPisCofins');
  const retido = tpRet === '1';   // NT 008 v1.02: PIS/COFINS retidos entram em "Contribuições Sociais - Retidas"
  return {
    irrf: f.reais(F('vRetIRRF')),
    previdenciaria: f.reais(F('vRetCP')),
    sociaisRetidas: f.reais(retido ? soma(F('vRetCSLL'), F('piscofins/vPis'), F('piscofins/vCofins')) : F('vRetCSLL')),
    pis: retido ? f.reais('0') : f.reais(F('piscofins/vPis')),
    cofins: retido ? f.reais('0') : f.reais(F('piscofins/vCofins')),
    descricaoSociais: f.descricao(D.tpRetPisCofins, tpRet),
  };
}

module.exports = { issqn, federal, soma };
