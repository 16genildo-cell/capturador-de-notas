/** "Serviço Prestado" (NT 008, item 2.1.7). */
const f = require('../formatar');
const { municipio } = require('../dados/municipios');

function servico(INF, DPS) {
  const cLoc = DPS('serv/locPrest/cLocPrestacao');
  const m = municipio(cLoc);
  return {
    codigoTributacao: f.compor([DPS('serv/cServ/cTribNac') && f.codTribNac(DPS('serv/cServ/cTribNac')), DPS('serv/cServ/cTribMun')]),
    nbs: f.nbs(DPS('serv/cServ/cNBS')),
    localPrestacao: f.compor([INF('xLocPrestacao') || (m && m.nome), m && m.uf, DPS('serv/locPrest/cPaisPrestacao')]),
    // SE xTribMun <> "" ENTÃO descrição municipal SENÃO nacional (NT 008, 2.4.5)
    descricaoCodigo: f.limitar(f.ou(INF('xTribMun') || INF('xTribNac')), 167),
    descricao: f.limitar(f.ou(DPS('serv/cServ/xDescServ')), 1297),
  };
}

module.exports = { servico };
