/**
 * Medidas do DANFSe em pontos PDF, a partir dos centímetros da NT 008 (item 2.4.5 e Anexo I).
 * Página A4 retrato; corpo com 20,40 cm de largura começando a 0,30 cm da borda; grade de 4 colunas.
 */
const cm = v => v * 72 / 2.54;

const PAGINA = { largura: cm(21), altura: cm(29.7) };

module.exports = {
  cm,
  PAGINA,
  // Borda da página (1 pt) a 0,20 cm da folha — NT 2.2.2: margem entre 0,15 e 0,20 cm.
  BORDA: { x: cm(0.2), y: cm(0.2), largura: PAGINA.largura - cm(0.4), altura: PAGINA.altura - cm(0.4) },
  X0: cm(0.3),
  LARGURA: cm(20.4),
  FUNDO: PAGINA.altura - cm(0.3),
  COLUNAS: [cm(0.3), cm(5.41), cm(10.51), cm(15.62)],
  COLUNA: cm(5.09),
  LINHA: cm(0.64),              // altura de uma linha de campos (rótulo 6 pt + conteúdo 7 pt)
  LINHA_RESUMIDA: cm(0.36),     // bloco suprimido (notas 2, 3 e 4: mínimo 0,32 cm)
  CABECALHO: { y: cm(0.3), altura: cm(1.16), logoLargura: cm(4) },
  IDENT: { y: cm(1.48), chaveAltura: cm(0.79), linhaAltura: cm(0.69), largura: cm(15.3) },
  QR: { x: cm(17.48), y: cm(1.67), lado: cm(1.52), textoX: cm(15.8), textoY: cm(3.36), textoLargura: cm(4.72) },
  INICIO_BLOCOS: cm(4.34),
  FONTE: { bloco: 7, rotulo: 6, conteudo: 7, titulo: 9, municipio: 8, pequeno: 6, marca: 90 },
  COR: {
    texto: '#000000',
    sombra: '#F2F2F2',          // cinza claro 5% (NT 2.2.3)
    homologacao: '#FF0000',     // vermelho sólido M100/Y100
    marca: '#A6A6A6',           // cinza K35 (NT 2.5.1)
  },
  TRACO: { bloco: 0.5, borda: 1 },
};
