/**
 * Blocos de texto livre — "Serviço Prestado" (descrição) e "Informações Complementares" — e o canhoto.
 * São os únicos de altura variável: dividem entre si o espaço que sobra na página (NT 2.3.1 a 2.3.3),
 * porque o DANFSe tem de caber em UMA página (NT 2.2). O que não couber termina em reticências.
 */
const M = require('./medidas');
const { campo, caixa, escrever, tituloBloco, linha, largura, PAD } = require('./desenho');
const { c } = require('./grade');

const ROTULO = M.FONTE.rotulo + 3;       // altura da linha de rótulo acima do texto livre
const MIN_TEXTO = M.cm(0.9);
const CODIGO = M.cm(0.4);                // linha da descrição do código de tributação
const TITULO_INFO = M.cm(0.4);
const CANHOTO = M.cm(0.9);

const W = M.LARGURA - PAD * 2;

function alturaTexto(doc, texto) {
  doc.font('normal').fontSize(M.FONTE.conteudo);
  return texto ? doc.heightOfString(texto, { width: W }) : 0;
}

/** Quanto os blocos de texto querem ocupar (sem limite de página). */
function necessidade(doc, nota) {
  const info = [nota.complementares.texto, nota.complementares.tributosAproximados].filter(Boolean).join('\n');
  return {
    descricao: Math.max(MIN_TEXTO, alturaTexto(doc, nota.servico.descricao) + PAD),
    info: Math.max(MIN_TEXTO, alturaTexto(doc, info) + PAD),
  };
}

/** Altura fixa do bloco de serviço, fora a área da descrição. */
const fixoServico = () => M.LINHA + CODIGO + ROTULO;
const fixoInfo = canhoto => TITULO_INFO + (canhoto ? CANHOTO : 0);

function textoLivre(doc, texto, y, altura) {
  doc.font('normal').fontSize(M.FONTE.conteudo).fillColor(M.COR.texto);
  doc.text(caixa(doc, texto, W, altura), M.X0 + PAD, y, { width: W, height: altura, ellipsis: false });
}

function servico(doc, nota, y, alturaDescricao) {
  const s = nota.servico;
  tituloBloco(doc, 'Serviço Prestado', y);
  for (const k of [c(1, 'Código de Tributação Nacional/Municipal', s.codigoTributacao), c(2, 'Código da NBS', s.nbs), c(3, 'Local da Prestação / Sigla UF / País', s.localPrestacao)]) {
    campo(doc, { x: M.COLUNAS[k.coluna], y, largura: largura(k.span), rotulo: k.rotulo, valor: k.valor });
  }
  let yl = y + M.LINHA;
  escrever(doc, s.descricaoCodigo, M.X0 + PAD, yl + 2, W);   // sem rótulo (NT 2.4.5)
  yl += CODIGO;
  escrever(doc, 'Descrição do Serviço', M.X0 + PAD, yl, W, { fonte: 'negrito', tamanho: M.FONTE.rotulo });
  yl += ROTULO;
  textoLivre(doc, s.descricao, yl, alturaDescricao);
  const fim = yl + alturaDescricao;
  linha(doc, fim);
  return fim;
}

/** Informações complementares: texto (cortável) + linha fixa dos tributos aproximados (nota 10). */
function informacoes(doc, nota, y, altura) {
  tituloBloco(doc, 'Informações Complementares', y, TITULO_INFO);
  let yl = y + TITULO_INFO + 1;
  const { texto, tributosAproximados: trib } = nota.complementares;
  doc.font('normal').fontSize(M.FONTE.conteudo).fillColor(M.COR.texto);
  const hTrib = doc.heightOfString(trib, { width: W });
  if (texto) {
    const cortado = caixa(doc, texto, W, Math.max(0, altura - hTrib - 2));
    if (cortado.replace(/\.+$/, '')) {
      doc.text(cortado, M.X0 + PAD, yl, { width: W });
      yl += doc.heightOfString(cortado, { width: W }) + 1;
    }
  }
  doc.text(trib, M.X0 + PAD, yl, { width: W });
}

function canhoto(doc, nota, y) {
  const id = nota.identificacao;
  doc.save().lineWidth(M.TRACO.bloco).rect(M.X0 + 2, y + 2, M.LARGURA - 4, CANHOTO - 4).stroke().restore();
  const linhaY = y + 4;
  campo(doc, { x: M.COLUNAS[0] + 2, y: linhaY, largura: M.COLUNA, rotulo: 'DATA CIENTIFICAÇÃO:', valor: null, rotuloGrande: true });
  campo(doc, { x: M.COLUNAS[1], y: linhaY, largura: M.COLUNA, rotulo: 'IDENTIFICAÇÃO E ASSINATURA', valor: null, rotuloGrande: true });
  campo(doc, { x: M.COLUNAS[2], y: linhaY, largura: largura(2) - 4, rotulo: 'N° NFS-e / CHAVE NFS-e', valor: `${id.numero} / ${id.chave}`, rotuloGrande: true });
  for (const x of [M.COLUNAS[1], M.COLUNAS[2]]) doc.save().lineWidth(M.TRACO.bloco).moveTo(x, y + 2).lineTo(x, y + CANHOTO - 2).stroke().restore();
}

module.exports = { necessidade, fixoServico, fixoInfo, servico, informacoes, canhoto, CANHOTO };
