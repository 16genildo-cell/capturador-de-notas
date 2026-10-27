import PDFDocument from 'pdfkit';
import { formatarDocumento } from '../../utils/documento.js';

/**
 * Gera um PDF oficial estruturado para Certidões Negativas emitidas pelos canais gratuitos.
 */
export function gerarPdfCertidao({
  esfera = 'federal',
  orgao = 'REPÚBLICA FEDERATIVA DO BRASIL',
  subOrgao = 'MINISTÉRIO DA FAZENDA / RECEITA FEDERAL DO BRASIL',
  titulo = 'CERTIDÃO NEGATIVA DE DÉBITOS',
  documento = '',
  razaoSocial = '',
  situacao = 'negativa',
  codigoControle = '',
  dataEmissao = new Date(),
  dataValidade = new Date(),
  mensagem = '',
}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: titulo, Author: 'Captura Total' } });
    const chunks = [];

    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const docFormatado = formatarDocumento(documento);
    const dEmissao = dataEmissao instanceof Date ? dataEmissao : new Date(dataEmissao);
    const dValidade = dataValidade instanceof Date ? dataValidade : new Date(dataValidade);

    const dataFmt = (d) =>
      d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' });
    const horaFmt = (d) =>
      d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit' });

    // Cabeçalho Oficial
    doc
      .fontSize(11)
      .font('Helvetica-Bold')
      .text(orgao.toUpperCase(), { align: 'center' })
      .fontSize(9)
      .font('Helvetica')
      .text(subOrgao.toUpperCase(), { align: 'center' });

    doc.moveDown(1);
    doc
      .fontSize(12)
      .font('Helvetica-Bold')
      .text(titulo.toUpperCase(), { align: 'center' });

    doc.moveDown(1.5);

    // Box de Identificação do Contribuinte
    const boxTop = doc.y;
    doc.rect(40, boxTop, 515, 60).lineWidth(1).stroke('#334155');

    doc
      .fontSize(8)
      .font('Helvetica-Bold')
      .text('NOME / RAZÃO SOCIAL:', 50, boxTop + 10)
      .font('Helvetica')
      .text(razaoSocial || 'NÃO INFORMADO', 160, boxTop + 10);

    doc
      .font('Helvetica-Bold')
      .text('INSCRIÇÃO (CNPJ/CPF):', 50, boxTop + 25)
      .font('Helvetica')
      .text(docFormatado || documento, 160, boxTop + 25);

    doc
      .font('Helvetica-Bold')
      .text('SITUAÇÃO DA CERTIDÃO:', 50, boxTop + 40)
      .font('Helvetica-Bold')
      .fillColor(situacao === 'negativa' ? '#15803d' : '#b91c1c')
      .text(situacao === 'negativa' ? 'NEGATIVA (REGULAR)' : situacao.toUpperCase(), 160, boxTop + 40)
      .fillColor('#000000');

    doc.y = boxTop + 75;

    // Texto de Certificação conforme esfera
    doc.fontSize(10).font('Helvetica');
    if (esfera === 'trabalhista') {
      doc.text(
        `Certifica-se que ${razaoSocial.toUpperCase()}, inscrição no CNPJ/CPF nº ${docFormatado}, ` +
          `NÃO CONSTA como devedora no Banco Nacional de Devedores Trabalhistas (BNDT), expedida com base no art. 642-A da Consolidação das Leis do Trabalho, ` +
          `acrescentado pela Lei nº 12.440, de 7 de julho de 2011, e na Resolução Administrativa nº 1470/2011 do Tribunal Superior do Trabalho.`,
        { align: 'justify', lineGap: 4 },
      );
    } else {
      doc.text(
        `Certifica-se que não constam pendências em nome do contribuinte acima identificado relativamente a débitos e créditos tributários administrados ` +
          `pela Secretaria Especial da Receita Federal do Brasil e Procuradoria-Geral da Fazenda Nacional. ` +
          `Esta certidão é válida para o estabelecimento matriz e suas filiais e abrange inclusive as contribuições sociais previstas nas alíneas 'a' a 'd' do parágrafo único do art. 11 da Lei nº 8.212, de 24 de julho de 1991.`,
        { align: 'justify', lineGap: 4 },
      );
    }

    doc.moveDown(1.5);

    // Box de Validade e Controle
    const validadeTop = doc.y;
    doc.rect(40, validadeTop, 515, 75).lineWidth(1).stroke('#cbd5e1');

    doc
      .fontSize(9)
      .font('Helvetica-Bold')
      .text('INFORMAÇÕES DE CONTROLE E VALIDADE:', 50, validadeTop + 10)
      .font('Helvetica')
      .text(`Emitida às: ${horaFmt(dEmissao)} do dia ${dataFmt(dEmissao)} (horário oficial de Brasília)`, 50, validadeTop + 25)
      .font('Helvetica-Bold')
      .text(`VÁLIDA ATÉ: ${dataFmt(dValidade)}`, 50, validadeTop + 40)
      .font('Helvetica')
      .text(`Código de Controle: ${codigoControle || 'GERADO-DIGITALMENTE'}`, 50, validadeTop + 55);

    doc.y = validadeTop + 90;

    // Rodapé legal
    doc
      .fontSize(8)
      .font('Helvetica-Oblique')
      .fillColor('#64748b')
      .text(
        'Documento emitido e conferido automaticamente pelo módulo de auditoria de regularidade fiscal Captura Total. ' +
          'A autenticidade desta certidão pode ser confirmada nos respectivos portais oficiais dos órgãos emissores.',
        { align: 'center', lineGap: 2 },
      );

    doc.end();
  });
}
