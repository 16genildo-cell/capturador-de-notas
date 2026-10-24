/** Primitivas de desenho sobre o pdfkit: texto que cabe no quadro, campo (rótulo + conteúdo), título de bloco. */
const M = require('./medidas');

const RETICENCIAS = '...';
const PAD = 2;   // respiro interno do quadro, em pontos

/** Corta o texto para caber em UMA linha da largura dada, com reticências (NT 008, 2.1). */
function umaLinha(doc, texto, largura) {
  const t = String(texto);
  if (doc.widthOfString(t) <= largura) return t;
  let ini = 0, fim = t.length;
  while (ini < fim) {
    const meio = Math.ceil((ini + fim) / 2);
    if (doc.widthOfString(t.slice(0, meio) + RETICENCIAS) <= largura) ini = meio; else fim = meio - 1;
  }
  return t.slice(0, ini).trimEnd() + RETICENCIAS;
}

/** Corta o texto para caber na caixa (várias linhas), com reticências no fim. */
function caixa(doc, texto, largura, altura) {
  const t = String(texto);
  const cabe = s => doc.heightOfString(s, { width: largura }) <= altura;
  if (cabe(t)) return t;
  let ini = 0, fim = t.length;
  while (ini < fim) {
    const meio = Math.ceil((ini + fim) / 2);
    if (cabe(t.slice(0, meio) + RETICENCIAS)) ini = meio; else fim = meio - 1;
  }
  return t.slice(0, ini).trimEnd() + RETICENCIAS;
}

function sombra(doc, x, y, largura, altura) {
  doc.save().rect(x, y, largura, altura).fill(M.COR.sombra).restore();
}

function linha(doc, y) {
  doc.save().lineWidth(M.TRACO.bloco).moveTo(M.X0, y).lineTo(M.X0 + M.LARGURA, y).stroke(M.COR.texto).restore();
}

/** Texto numa posição, cortado em uma linha. */
function escrever(doc, texto, x, y, largura, { fonte = 'normal', tamanho = M.FONTE.conteudo, cor = M.COR.texto, alinhar = 'left' } = {}) {
  doc.font(fonte).fontSize(tamanho).fillColor(cor);
  doc.text(umaLinha(doc, texto, largura), x, y, { width: largura, align: alinhar, lineBreak: false });
}

/** Campo da grade: rótulo em cima (6 pt negrito) e conteúdo embaixo (7 pt). */
function campo(doc, { x, y, largura, rotulo, valor, rotuloGrande = false, sombreado = false, altura = M.LINHA }) {
  if (sombreado) sombra(doc, x, y, largura, altura);
  const w = largura - PAD * 2;
  if (rotulo) escrever(doc, rotulo, x + PAD, y + PAD, w, { fonte: 'negrito', tamanho: rotuloGrande ? M.FONTE.bloco : M.FONTE.rotulo });
  if (valor != null) escrever(doc, valor, x + PAD, y + PAD + (rotuloGrande ? 8.5 : 7.5), w);
}

/** Título do bloco na primeira coluna, sombreado, 7 pt negrito em caixa alta (NT 2.4.1). */
function tituloBloco(doc, titulo, y, altura = M.LINHA) {
  sombra(doc, M.COLUNAS[0], y, M.COLUNA, altura);
  escrever(doc, titulo.toUpperCase().replace(/NFS-E/g, 'NFS-e'), M.COLUNAS[0] + PAD, y + PAD, M.COLUNA - PAD * 2, { fonte: 'negrito', tamanho: M.FONTE.bloco });
}

/** Largura de um campo que ocupa `span` colunas. */
const largura = span => M.COLUNA * span + (M.COLUNAS[1] - M.COLUNAS[0] - M.COLUNA) * (span - 1);

module.exports = { umaLinha, caixa, sombra, linha, escrever, campo, tituloBloco, largura, PAD };
