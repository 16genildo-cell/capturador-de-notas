/**
 * danfse-nacional — DANFSe v2.0 (NT 008/2026 v1.02) a partir do XML da NFS-e Nacional.
 *
 *   const { gerarDanfse } = require('danfse-nacional');
 *   const pdf = await gerarDanfse(xml);                          // Buffer do PDF
 *   const pdf = await gerarDanfse(xml, { situacao: 'cancelada' });
 */
const { lerNota } = require('./ler/nota');
const { renderizar } = require('./pdf/danfse');
const { SITUACOES } = require('./pdf/marca');

/**
 * @param {string|Buffer} xml  XML da NFS-e (elemento raiz <NFSe>), assinado ou não.
 * @param {object} [opcoes]
 * @param {'normal'|'cancelada'|'substituida'} [opcoes.situacao='normal']  O XML não diz se a nota foi
 *        cancelada/substituída (isso é evento à parte) — informe aqui para sair a marca d'água.
 * @param {string|Buffer|false} [opcoes.logo]  Padrão: logomarca oficial da NFS-e (já incluída).
 *        Caminho/Buffer (PNG/JPG) troca a imagem; `false` escreve "NFS-e" em texto.
 * @param {boolean} [opcoes.canhoto=true]  Canhoto (bloco opcional da NT; o portal nacional sempre imprime).
 * @param {{normal?: string|Buffer, negrito?: string|Buffer}} [opcoes.fontes]  TTF próprios (padrão: Helvetica).
 * @returns {Promise<Buffer>}
 */
async function gerarDanfse(xml, opcoes = {}) {
  const situacao = opcoes.situacao || 'normal';
  if (situacao !== 'normal' && !SITUACOES.includes(situacao)) {
    throw new TypeError(`situacao inválida: "${situacao}". Use normal, ${SITUACOES.join(' ou ')}.`);
  }
  return renderizar(lerNota(xml), { ...opcoes, situacao, canhoto: opcoes.canhoto !== false });
}

module.exports = { gerarDanfse, lerNota };
