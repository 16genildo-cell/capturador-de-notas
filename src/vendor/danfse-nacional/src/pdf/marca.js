/** Marca d'água de NFS-e cancelada ou substituída (NT 008, itens 2.5.1 e 2.5.2): diagonal, ≥ 50 pt, cinza K35. */
const M = require('./medidas');

const TEXTOS = { cancelada: 'CANCELADA', substituida: 'SUBSTITUÍDA' };

function marcaDagua(doc, situacao) {
  const texto = TEXTOS[situacao];
  if (!texto) return;
  const { largura, altura } = M.PAGINA;
  const angulo = -Math.atan(altura / largura) * 180 / Math.PI;
  doc.save();
  doc.rotate(angulo, { origin: [largura / 2, altura / 2] });
  // Por cima do conteúdo, com transparência, para os campos seguirem legíveis.
  doc.font('normal').fontSize(M.FONTE.marca).fillColor(M.COR.marca).fillOpacity(0.55);
  const w = doc.widthOfString(texto);
  doc.text(texto, largura / 2 - w / 2, altura / 2 - M.FONTE.marca / 2, { lineBreak: false });
  doc.restore();
}

module.exports = { marcaDagua, SITUACOES: Object.keys(TEXTOS) };
