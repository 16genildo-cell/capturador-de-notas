/**
 * XML da NFS-e Nacional → objeto com os textos do DANFSe já formatados. PURO (não desenha nada).
 * Aceita o XML oficial (com assinatura) e XML sem assinatura: o DANFSe só representa os dados.
 */
const { parse, leitor, nomeLocal } = require('./xml');
const { identificacao } = require('./identificacao');
const { pessoa, prestador } = require('./pessoa');
const { servico } = require('./servico');
const { issqn, federal } = require('./tributos');
const { ibscbs } = require('./ibscbs');
const { totais, complementares } = require('./totais');
const f = require('../formatar');
const D = require('../dados/dominios');

function lerNota(xml) {
  const raiz = parse(xml);
  if (nomeLocal(raiz) !== 'NFSe') throw new TypeError(`Esperado o elemento <NFSe>, veio <${nomeLocal(raiz)}>. Informe o XML da NFS-e (não o da DPS nem de evento).`);
  const INF = leitor(raiz).no('infNFSe');
  const DPS = INF && INF.no('DPS/infDPS');
  if (!INF || !DPS) throw new TypeError('XML sem infNFSe/DPS/infDPS: não é uma NFS-e do padrão nacional.');

  // Destinatário: indDest = 0 → é o próprio tomador (item 2.3.2).
  const destinatarioEhTomador = DPS('IBSCBS/indDest') === '0' || !DPS.existe('IBSCBS/dest');
  return {
    identificacao: identificacao(INF, DPS),
    prestador: prestador(DPS.no('prest'), INF.no('emit'), DPS('tpEmit') === '1' || !DPS('tpEmit')),
    prestadorSimples: simples(DPS),
    tomador: pessoa(DPS.no('toma')),
    destinatario: destinatarioEhTomador ? null : pessoa(DPS.no('IBSCBS/dest')),
    destinatarioEhTomador: DPS('IBSCBS/indDest') === '0',
    intermediario: pessoa(DPS.no('interm')),
    servico: servico(INF, DPS),
    issqn: issqn(INF, DPS),
    federal: federal(DPS),
    ibscbs: ibscbs(INF, DPS),
    totais: totais(INF, DPS),
    complementares: complementares(INF, DPS),
  };
}

function simples(DPS) {
  return {
    situacao: f.limitar(f.descricao(D.opSimpNac, DPS('prest/regTrib/opSimpNac')), 37),
    regimeApuracao: f.limitar(f.descricao(D.regApTribSN, DPS('prest/regTrib/regApTribSN')), 77),
  };
}

module.exports = { lerNota };
