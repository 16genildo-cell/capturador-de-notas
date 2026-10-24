/**
 * Monta a página do DANFSe: cabeçalho → blocos de grade → serviço → tributos → totais → informações → canhoto.
 * Os blocos de grade têm altura fixa; a sobra da página vai para a descrição do serviço e as informações
 * complementares (NT 2.3), sempre em UMA página A4 retrato (NT 2.2).
 */
const PDFDocument = require('pdfkit');
const M = require('./medidas');
const B = require('./blocos');
const { bloco, blocoResumido } = require('./grade');
const T = require('./textos');
const { cabecalho } = require('./cabecalho');
const { marcaDagua } = require('./marca');

function registrarFontes(doc, fontes = {}) {
  doc.registerFont('normal', fontes.normal || 'Helvetica');
  doc.registerFont('negrito', fontes.negrito || 'Helvetica-Bold');
}

const altura = b => (b.resumo ? M.LINHA_RESUMIDA : b.linhas.length * M.LINHA);
const desenhar = (doc, y, b) => (b.resumo ? blocoResumido(doc, y, b.resumo) : bloco(doc, y, b.titulo, b.linhas));

/** Divide a sobra entre descrição e informações: cada um recebe o que precisa; faltando, divide proporcional. */
function repartir(sobra, quer) {
  if (quer.descricao + quer.info <= sobra) return { descricao: quer.descricao, info: sobra - quer.descricao };
  const descricao = Math.max(M.cm(0.9), Math.min(quer.descricao, sobra * quer.descricao / (quer.descricao + quer.info)));
  return { descricao, info: sobra - descricao };
}

function desenharPagina(doc, nota, opcoes) {
  doc.save().lineWidth(M.TRACO.borda).rect(M.BORDA.x, M.BORDA.y, M.BORDA.largura, M.BORDA.altura).stroke().restore();
  let y = cabecalho(doc, nota, opcoes);

  const antes = [B.prestador(nota), B.tomador(nota), B.destinatario(nota), B.intermediario(nota)];
  const depois = [B.issqn(nota), B.federal(nota), B.ibscbs(nota), B.valorTotal(nota)];
  const fixo = [...antes, ...depois].reduce((s, b) => s + altura(b), 0) + T.fixoServico() + T.fixoInfo(opcoes.canhoto);
  const fundo = M.FUNDO - (opcoes.canhoto ? T.CANHOTO : 0);
  const partes = repartir(fundo - y - fixo, T.necessidade(doc, nota));

  for (const b of antes) y = desenhar(doc, y, b);
  y = T.servico(doc, nota, y, partes.descricao);
  for (const b of depois) y = desenhar(doc, y, b);
  T.informacoes(doc, nota, y, partes.info);
  if (opcoes.canhoto) T.canhoto(doc, nota, fundo);
  marcaDagua(doc, opcoes.situacao);
}

/** Desenha e devolve o PDF inteiro num Buffer. */
function renderizar(nota, opcoes = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4', layout: 'portrait', margin: 0, autoFirstPage: true,
      info: { Title: `DANFSe ${nota.identificacao.numero}`, Subject: `NFS-e ${nota.identificacao.chave}`, Creator: 'danfse-nacional' },
    });
    const partes = [];
    doc.on('data', p => partes.push(p));
    doc.on('end', () => resolve(Buffer.concat(partes)));
    doc.on('error', reject);
    try {
      registrarFontes(doc, opcoes.fontes);
      desenharPagina(doc, nota, opcoes);
      doc.end();
    } catch (err) { reject(err); }
  });
}

module.exports = { renderizar };
