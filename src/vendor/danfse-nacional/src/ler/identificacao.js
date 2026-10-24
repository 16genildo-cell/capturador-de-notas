/** Cabeçalho e "Dados de Identificação da NFS-e" (NT 008, itens 2.1.1, 2.1.2 e 2.4.3). */
const f = require('../formatar');
const D = require('../dados/dominios');
const { municipio } = require('../dados/municipios');

/** chave = Id do infNFSe sem o prefixo "NFS" (50 dígitos). */
function chaveDe(INF) {
  const id = INF.attr('Id') || '';
  return id.replace(/^NFS/, '');
}

function identificacao(INF, DPS) {
  const chave = chaveDe(INF);
  const ufEmissor = INF('emit/enderNac/UF') || (municipio(DPS('cLocEmi')) || {}).uf;
  const dCompet = DPS('dCompet');
  return {
    chave: f.ou(chave),
    numero: f.ou(INF('nNFSe')),
    competencia: f.data(dCompet),
    anoCompetencia: dCompet ? Number(dCompet.slice(0, 4)) : null,
    emissaoNfse: f.dataHora(INF('dhProc')),
    numeroDps: f.ou(DPS('nDPS')),
    serieDps: f.ou(DPS('serie')),
    emissaoDps: f.dataHora(DPS('dhEmi')),
    emitente: f.limitar(f.descricao(D.tpEmit, DPS('tpEmit')), 37),
    situacao: f.limitar(f.descricao(D.cStat, INF('cStat')), 37),
    finalidade: f.limitar(f.descricao(D.finNFSe, DPS('IBSCBS/finNFSe')), 37),
    municipioEmissor: f.juntar([INF('xLocEmi'), ufEmissor], ' - '),
    // O portal nacional imprime o CÓDIGO (1/2), não a descrição.
    ambienteGerador: f.ou(INF('ambGer')),
    tipoAmbiente: f.ou(DPS('tpAmb')),
    homologacao: DPS('tpAmb') === '2',
  };
}

module.exports = { identificacao };
