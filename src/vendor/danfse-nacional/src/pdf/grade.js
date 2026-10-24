/**
 * Blocos de grade do DANFSe: o título ocupa a 1ª coluna da 1ª linha e os campos se encaixam nas 4 colunas.
 * Um bloco é descrito como DADOS (lista de linhas de campos) — quem desenha é sempre `bloco()`.
 */
const M = require('./medidas');
const { campo, tituloBloco, escrever, linha, largura, PAD } = require('./desenho');

/** Campo: coluna inicial, quantas colunas ocupa, rótulo e conteúdo. */
const c = (coluna, rotulo, valor, span = 1, extra = {}) => ({ coluna, rotulo, valor, span, ...extra });

/** Desenha um bloco e devolve o Y do fim. `linhas` = [[campo...], ...]; a linha 0 começa na coluna 1. */
function bloco(doc, y, titulo, linhas) {
  tituloBloco(doc, titulo, y);
  linhas.forEach((cols, i) => {
    const yl = y + i * M.LINHA;
    for (const k of cols) {
      campo(doc, { x: M.COLUNAS[k.coluna], y: yl, largura: largura(k.span), rotulo: k.rotulo, valor: k.valor, sombreado: !!k.sombreado, rotuloGrande: !!k.rotuloGrande });
    }
  });
  const fim = y + linhas.length * M.LINHA;
  linha(doc, fim);
  return fim;
}

/** Bloco suprimido (notas 2, 3 e 4 da NT): uma linha só, com a frase oficial. */
function blocoResumido(doc, y, frase) {
  escrever(doc, frase, M.X0 + PAD, y + (M.LINHA_RESUMIDA - M.FONTE.bloco) / 2, M.LARGURA - PAD * 2, { tamanho: M.FONTE.bloco, alinhar: 'center' });
  const fim = y + M.LINHA_RESUMIDA;
  linha(doc, fim);
  return fim;
}

module.exports = { c, bloco, blocoResumido };
