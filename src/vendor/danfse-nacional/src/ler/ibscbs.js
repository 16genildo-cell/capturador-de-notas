/** "Tributação IBS / CBS" (NT 008, item 2.1.10). Nota sem o grupo IBSCBS → todos os campos com traço. */
const f = require('../formatar');
const { municipio } = require('../dados/municipios');
const { soma } = require('./tributos');

function ibscbs(INF, DPS) {
  const I = c => INF(`IBSCBS/${c}`);
  const V = c => I(`valores/${c}`);
  const T = c => I(`totCIBS/${c}`);
  const G = c => DPS(`IBSCBS/valores/trib/gIBSCBS/${c}`);
  const presente = INF.existe('IBSCBS');
  const cLoc = I('cLocalidadeIncid');
  const m = municipio(cLoc);
  const pct = c => (V(c) ? f.percentual(V(c)) : null);
  return {
    presente,
    cstClassTrib: f.compor([G('CST'), G('cClassTrib')]),
    indicadorIncidencia: f.compor([DPS('IBSCBS/cIndOp'), cLoc, I('xLocalidadeIncid') || (m && m.nome), m && m.uf]),
    // Somatório definido na NT: desconto incondicionado + reembolso/repasse + ISSQN + PIS + COFINS (0,00 sem nada).
    exclusoes: f.reais(soma(
      '0', DPS('valores/vDescCondIncond/vDescIncond'), V('vCalcReeRepRes'), INF('valores/vISSQN'),
      DPS('valores/trib/tribFed/piscofins/vPis'), DPS('valores/trib/tribFed/piscofins/vCofins'),
    )),
    baseCalculo: f.reais(V('vBC')),
    reducaoAliquotas: f.compor([pct('uf/pRedAliqUF'), pct('mun/pRedAliqMun'), pct('fed/pRedAliqCBS')]),
    aliquotasIBS: f.compor([pct('uf/pIBSUF'), pct('mun/pIBSMun')]),
    aliqEfetivaMun: f.percentual(V('mun/pAliqEfetMun')),
    valorMun: f.reais(T('gIBS/gIBSMunTot/vIBSMun')),
    aliqEfetivaUF: f.percentual(V('uf/pAliqEfetUF')),
    valorUF: f.reais(T('gIBS/gIBSUFTot/vIBSUF')),
    totalIBS: f.reais(T('gIBS/vIBSTot')),
    aliquotaCBS: f.percentual(V('fed/pCBS')),
    aliqEfetivaCBS: f.percentual(V('fed/pAliqEfetCBS')),
    totalCBS: f.reais(T('gCBS/vCBS')),
  };
}

module.exports = { ibscbs };
