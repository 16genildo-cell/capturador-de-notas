/** Cabeçalho, identificação da NFS-e e QR Code (NT 008, itens 2.1.2 e 2.4.3). */
const path = require('node:path');
const QRCode = require('qrcode');
const M = require('./medidas');
const { campo, escrever, sombra, linha, largura } = require('./desenho');

const URL_CONSULTA = 'https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave=';
const TEXTO_QR = 'A autenticidade desta NFS-e pode ser verificada pela leitura deste código QR ou pela consulta da chave de acesso no portal nacional da NFS-e';

// Logomarca oficial (horizontal), publicada pelo Comitê Gestor em gov.br/nfse — ver assets/LEIAME.md.
const LOGO_OFICIAL = path.join(__dirname, '..', '..', 'assets', 'logo-nfse.png');

/** `imagem`: undefined → logomarca oficial; caminho/Buffer → a informada; false → nome em texto. */
function logo(doc, imagem) {
  const { y, altura, logoLargura } = M.CABECALHO;
  const arquivo = imagem === undefined ? LOGO_OFICIAL : imagem;
  if (arquivo) {
    doc.image(arquivo, M.X0 + 2, y + 2, { fit: [logoLargura - 4, altura - 4], valign: 'center' });
    return;
  }
  escrever(doc, 'NFS-e', M.X0 + 4, y + 6, logoLargura, { fonte: 'negrito', tamanho: 16 });
  escrever(doc, 'Nota Fiscal de Serviço eletrônica', M.X0 + 4, y + 24, logoLargura, { tamanho: M.FONTE.pequeno });
}

function topo(doc, id, opcoes) {
  const { y, altura } = M.CABECALHO;
  sombra(doc, M.X0, y, M.LARGURA, altura);
  logo(doc, opcoes.logo);
  const centroX = M.COLUNAS[1], centroL = largura(2);
  const topoTitulo = id.homologacao ? y + 2 : y + 6;   // 3 linhas de 9 pt precisam caber nos 1,16 cm
  const titulo = { fonte: 'negrito', tamanho: M.FONTE.titulo, alinhar: 'center' };
  escrever(doc, 'DANFSe v2.0', centroX, topoTitulo, centroL, titulo);
  escrever(doc, 'Documento Auxiliar da NFS-e', centroX, topoTitulo + 10.5, centroL, titulo);
  if (id.homologacao) {
    escrever(doc, 'NFS-e SEM VALIDADE JURÍDICA', centroX, topoTitulo + 21, centroL, { ...titulo, cor: M.COR.homologacao });
  }
  const dirX = M.COLUNAS[3] + 2, dirL = M.COLUNA - 4;
  escrever(doc, `Município: ${id.municipioEmissor}`, dirX, y + 4, dirL, { tamanho: M.FONTE.municipio });
  escrever(doc, `Ambiente Gerador: ${id.ambienteGerador}`, dirX, y + 16, dirL, { tamanho: M.FONTE.pequeno });
  escrever(doc, `Tipo de Ambiente: ${id.tipoAmbiente}`, dirX, y + 24, dirL, { tamanho: M.FONTE.pequeno });
  linha(doc, y + altura);
}

/** QR Code vetorial (nítido em qualquer impressora), sem margem, no ponto fixado pela NT. */
function qrcode(doc, chave) {
  const qr = QRCode.create(URL_CONSULTA + chave, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size, modulo = M.QR.lado / n;
  doc.save().fillColor(M.COR.texto);
  for (let l = 0; l < n; l++) {
    for (let c = 0; c < n; c++) if (qr.modules.get(l, c)) doc.rect(M.QR.x + c * modulo, M.QR.y + l * modulo, modulo, modulo);
  }
  doc.fill().restore();
  doc.font('normal').fontSize(M.FONTE.pequeno).fillColor(M.COR.texto)
    .text(TEXTO_QR, M.QR.textoX, M.QR.textoY, { width: M.QR.textoLargura, align: 'center', lineGap: -0.5 });
}

function identificacao(doc, id) {
  const { y, chaveAltura, linhaAltura } = M.IDENT;
  const L = largura(1), C = M.COLUNAS;
  const grande = { rotuloGrande: true, altura: linhaAltura };
  campo(doc, { x: C[0], y, largura: M.IDENT.largura, rotulo: 'CHAVE DE ACESSO DA NFS-e', valor: id.chave, rotuloGrande: true, altura: chaveAltura });
  const linhas = [
    [['NÚMERO DA NFS-e', id.numero], ['COMPETÊNCIA DA NFS-e', id.competencia], ['DATA E HORA DA EMISSÃO DA NFS-e', id.emissaoNfse]],
    [['NÚMERO DA DPS', id.numeroDps], ['SÉRIE DA DPS', id.serieDps], ['DATA E HORA DA EMISSÃO DA DPS', id.emissaoDps]],
    [['EMITENTE DA NFS-e', id.emitente], ['SITUAÇÃO DA NFS-e', id.situacao], ['FINALIDADE', id.finalidade]],
  ];
  linhas.forEach((cols, i) => {
    const yl = y + chaveAltura + i * linhaAltura;
    cols.forEach(([rotulo, valor], c) => campo(doc, { x: C[c], y: yl, largura: L, rotulo, valor, sombreado: i === 2 && c === 0, ...grande }));
  });
  return y + chaveAltura + linhas.length * linhaAltura;
}

/** Desenha o topo inteiro e devolve o Y onde começam os blocos. */
function cabecalho(doc, nota, opcoes) {
  topo(doc, nota.identificacao, opcoes);
  const fim = identificacao(doc, nota.identificacao);
  qrcode(doc, nota.identificacao.chave);
  const y = Math.max(fim, M.INICIO_BLOCOS);
  linha(doc, y);
  return y;
}

module.exports = { cabecalho, URL_CONSULTA };
