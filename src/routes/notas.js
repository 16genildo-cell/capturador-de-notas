import { Router } from 'express';
import { escopo, escopoDaEmpresa, restricaoEmpresas } from '../middleware/escopoEmpresa.js';
import archiver from 'archiver';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { Empresa } from '../models/Empresa.js';
import { NotaFiscal } from '../models/NotaFiscal.js';
import { capturarEmpresa } from '../services/capturaService.js';
import { obterCertificadoEmpresa } from '../services/sefaz/distribuicaoDFe.js';
import { cienciaEDownload, manifestarNota, EVENTOS, prazoManifestacao } from '../services/sefaz/manifestacao.js';
import { detalharDocumento } from '../services/detalheNota.js';
import mongoose from 'mongoose';
import { montarFiltroNotas, queryString, CATEGORIAS } from '../services/filtroNotas.js';
import { gerarPdfNota, nomeArquivoNota } from '../services/pdf/documentoPdf.js';
import { formatarDocumento } from '../utils/documento.js';

import { exigirRecurso, recursoLiberado, mensagemRecurso } from '../middleware/assinatura.js';
import { marcarBaixadas, mensagemArquivoApagado } from '../services/retencao.js';

const router = Router();
router.use(requireAuth);

const LIMITE_EXPORTACAO_XML = 5000;
const LIMITE_EXPORTACAO_PDF = 1000;
const LIMITE_CIENCIA_LOTE = 30;

// Listagem com filtros + totais do filtro
router.get('/', async (req, res) => {
  const owner = req.conta;
  const { filtro, filtros } = montarFiltroNotas(req.query, owner, req.empresasPermitidas);

  const page = Math.max(1, Number(req.query.page) || 1);
  const porPagina = 25;

  const [notas, total, empresas, totais, anos] = await Promise.all([
    NotaFiscal.find(filtro)
      .select('-xml')
      .sort('-dataEmissao -createdAt')
      .skip((page - 1) * porPagina)
      .limit(porPagina)
      .populate('empresa', 'razaoSocial')
      .lean(),
    NotaFiscal.countDocuments(filtro),
    Empresa.find({ owner, ...escopoDaEmpresa(req) }).select('razaoSocial cnpj').sort('razaoSocial').lean(),
    NotaFiscal.aggregate([
      { $match: filtro },
      {
        $group: {
          _id: '$tipo',
          qtd: { $sum: 1 },
          valor: { $sum: { $cond: [{ $eq: ['$cancelada', true] }, 0, '$valorTotal'] } },
        },
      },
    ]),
    NotaFiscal.aggregate([
      { $match: { owner, ...escopo(req), dataEmissao: { $type: 'date' } } },
      { $group: { _id: { $year: { date: '$dataEmissao', timezone: '-03:00' } } } },
      { $sort: { _id: -1 } },
    ]),
  ]);

  const resumoTotais = { qtd: 0, valor: 0, porTipo: {} };
  for (const t of totais) {
    resumoTotais.qtd += t.qtd;
    resumoTotais.valor += t.valor;
    resumoTotais.porTipo[t._id] = t;
  }

  res.render('notas/lista', {
    title: 'Notas fiscais',
    notas,
    empresas,
    filtros,
    categorias: CATEGORIAS,
    anos: anos.map((a) => a._id).filter(Boolean),
    totais: resumoTotais,
    qs: (extra) => queryString(filtros, { ...(req.base ? { empresa: '' } : {}), ...extra }),
    paginacao: { page, total, porPagina, paginas: Math.ceil(total / porPagina) },
  });
});

/** Gera e envia um ZIP com XML e/ou PDF das notas do filtro, mais a relacao em CSV. */
export async function enviarZip(res, filtro, formato) {
  const comPdf = formato !== 'xml';
  const agora = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  res.attachment(`notas-${formato}-${agora}.zip`);
  const zip = archiver('zip', { zlib: { level: 6 } });
  zip.on('warning', (err) => console.warn('[exportar]', err.message));
  zip.on('error', (err) => {
    console.error('[exportar]', err);
    res.destroy(err);
  });
  zip.pipe(res);

  const pasta = { nfe: 'Produtos', nfce: 'Produtos', nfse: 'Serviços', cte: 'CTe', evento: 'Eventos' };
  const linhasCsv = [
    ['Tipo', 'Número', 'Serie', 'Emissão', 'Emitente/Prestador', 'CNPJ/CPF emitente', 'Destinatario/Tomador',
      'CNPJ/CPF destinatário', 'Valor', 'Papel', 'Situação', 'Chave', 'Empresa'].join(';'),
  ];
  const csv = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

  const cursor = NotaFiscal.find(filtro).sort('dataEmissao').populate('empresa', 'razaoSocial').lean().cursor();
  const comXml = [];
  for await (const nota of cursor) {
    const mes = nota.dataEmissao
      ? new Date(nota.dataEmissao).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }).slice(0, 7)
      : 'sem-data';
    const base = `${pasta[nota.tipo] || 'Outros'}/${mes}/${nomeArquivoNota(nota)}`;
    // Arquivo ja apagado pela regra do plano: entra so na planilha.
    if (!nota.xml) {
      linhasCsv.push([nota.tipo.toUpperCase(), nota.numero, nota.serie, '', nota.emitenteNome, formatarDocumento(nota.emitenteCnpjCpf), nota.destinatarioNome,
        formatarDocumento(nota.destinatarioCnpjCpf), (nota.valorTotal || 0).toFixed(2).replace('.', ','), '', 'Arquivo apagado do sistema', nota.chave || nota.chaveNota, nota.empresa?.razaoSocial].map(csv).join(';'));
      continue;
    }
    if (formato !== 'pdf') {
      zip.append(nota.xml, { name: `${base}.xml` });
      comXml.push(nota._id);
    }
    if (comPdf) {
      try {
        zip.append(await gerarPdfNota(nota), { name: `${base}.pdf` });
      } catch (err) {
        zip.append(`Falha ao gerar PDF: ${err.message}`, { name: `${base}.ERRO.txt` });
      }
    }
    linhasCsv.push(
      [
        nota.tipo.toUpperCase(),
        nota.numero,
        nota.serie,
        nota.dataEmissao ? new Date(nota.dataEmissao).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '',
        nota.emitenteNome,
        formatarDocumento(nota.emitenteCnpjCpf),
        nota.destinatarioNome,
        formatarDocumento(nota.destinatarioCnpjCpf),
        (nota.valorTotal || 0).toFixed(2).replace('.', ','),
        { emitente: 'Emitida/prestada', destinatario: 'Recebida/tomada' }[nota.papel] || '',
        nota.cancelada ? 'Cancelada' : nota.resumo ? 'Resumo' : 'Autorizada',
        nota.chave || nota.chaveNota,
        nota.empresa?.razaoSocial,
      ]
        .map(csv)
        .join(';'),
    );
  }
  // Planilha (abre no Excel) com a relacao das notas exportadas.
  zip.append(`\ufeff${linhasCsv.join('\r\n')}`, { name: 'relacao-de-notas.csv' });
  // Conta para a regra "apagar quando o escritorio baixar" do plano.
  if (comXml.length) await marcarBaixadas({ _id: { $in: comXml } }).catch((err) => console.error('[armazenamento]', err.message));
  await zip.finalize();
}

// Download em lote (ZIP) do resultado filtrado: ?formato=xml | pdf | ambos
router.get('/exportar', exigirRecurso('download_lote'), async (req, res) => {
  const owner = req.conta;
  const { filtro } = montarFiltroNotas(req.query, owner, req.empresasPermitidas);
  filtro.xmlApagadoEm = null; // so as notas que ainda tem o arquivo guardado
  const formato = ['xml', 'pdf', 'ambos'].includes(req.query.formato) ? req.query.formato : 'xml';
  const comPdf = formato !== 'xml';
  const limite = comPdf ? LIMITE_EXPORTACAO_PDF : LIMITE_EXPORTACAO_XML;

  const total = await NotaFiscal.countDocuments(filtro);
  if (total === 0) {
    req.session.flash = { type: 'info', msg: 'Nenhuma nota encontrada com esses filtros para exportar.' };
    return res.redirect(`${req.base}/notas?${queryString(req.query, { formato: '', empresa: req.base ? '' : req.query.empresa })}`);
  }
  if (total > limite) {
    req.session.flash = {
      type: 'erro',
      msg: `O filtro tem ${total} notas; o limite por download ${comPdf ? 'com PDF' : 'de XML'} e ${limite}. Use um período menor (mês ou ano).`,
    };
    return res.redirect(`${req.base}/notas?${queryString(req.query, { formato: '', empresa: req.base ? '' : req.query.empresa })}`);
  }

  await enviarZip(res, filtro, formato);
});

// Acoes em lote sobre as notas selecionadas na lista
router.post('/lote', async (req, res) => {
  const ids = [].concat(req.body.ids || []).filter((id) => mongoose.isValidObjectId(id)).slice(0, LIMITE_EXPORTACAO_PDF);
  const voltar = req.get('referer') || `${req.base}/notas`;
  if (ids.length === 0) {
    req.session.flash = { type: 'info', msg: 'Selecione ao menos uma nota.' };
    return res.redirect(voltar);
  }
  const filtro = { owner: req.conta, ...escopo(req), _id: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) } };

  const recurso = { baixar: 'download_lote', ciencia: 'manifestacao' }[req.body.acao];
  if (recurso && !recursoLiberado(req, recurso)) {
    req.session.flash = { type: 'erro', msg: mensagemRecurso(recurso) };
    return res.redirect(voltar);
  }

  if (req.body.acao === 'baixar') return enviarZip(res, filtro, 'ambos');

  if (req.body.acao === 'ciencia') {
    const notas = await NotaFiscal.find({ ...filtro, resumo: true, tipo: { $in: ['nfe', 'nfce'] }, cancelada: { $ne: true } })
      .limit(LIMITE_CIENCIA_LOTE)
      .lean();
    let ok = 0;
    let baixadas = 0;
    const erros = [];
    const certs = new Map();
    for (const nota of notas) {
      try {
        const empresa = await Empresa.findById(nota.empresa).populate('certificado');
        if (!certs.has(String(empresa._id))) certs.set(String(empresa._id), await obterCertificadoEmpresa(empresa));
        const r = await cienciaEDownload(empresa, certs.get(String(empresa._id)), nota);
        if (r.ok) ok += 1;
        else erros.push(r.mensagem);
        if (r.baixou) baixadas += 1;
      } catch (err) {
        erros.push(err.message);
      }
    }
    const ignoradas = ids.length - notas.length;
    req.session.flash = {
      type: erros.length ? 'erro' : 'ok',
      msg:
        `Ciência enviada em ${ok} nota(s); ${baixadas} XML(s) completo(s) baixado(s).` +
        (ignoradas > 0 ? ` ${ignoradas} selecionada(s) já tinham XML completo ou não se aplicam.` : '') +
        (notas.length >= LIMITE_CIENCIA_LOTE ? ` Limite de ${LIMITE_CIENCIA_LOTE} por vez.` : '') +
        (erros.length ? ` Erros: ${[...new Set(erros)].slice(0, 3).join(' | ')}` : ''),
    };
    return res.redirect(voltar);
  }

  req.session.flash = { type: 'erro', msg: 'Ação inválida.' };
  res.redirect(voltar);
});

// Detalhe da nota: dados, itens, eventos e acoes
router.get('/:id', async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.id)) return next();
  const nota = await NotaFiscal.findOne({ _id: req.params.id, owner: req.conta, ...escopo(req) }).populate('empresa', 'razaoSocial cnpj').lean();
  if (!nota) return next();
  const eventos = nota.chave
    ? await NotaFiscal.find({ owner: req.conta, tipo: 'evento', chaveNota: nota.chave }).select('-xml').sort('dataEmissao').lean()
    : [];
  res.render('notas/detalhe', {
    title: `${{ nfe: 'NF-e', nfce: 'NFC-e', nfse: 'NFS-e', cte: 'CT-e', evento: 'Evento' }[nota.tipo] || 'Documento'} ${nota.numero || ''}`,
    nota,
    detalhe: detalharDocumento(nota),
    eventos,
    prazo: ['nfe'].includes(nota.tipo) && nota.papel === 'destinatario' ? prazoManifestacao(nota.dataEmissao) : null,
    EVENTOS,
  });
});

// Ver/baixar XML
router.get('/:id/xml', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).send('Nota não encontrada.');
  const nota = await NotaFiscal.findOne({ _id: req.params.id, owner: req.conta, ...escopo(req) }).lean();
  if (!nota) return res.status(404).send('Nota não encontrada.');
  if (!nota.xml) {
    req.session.flash = { type: 'erro', msg: mensagemArquivoApagado(nota) };
    return res.redirect(req.get('referer') || `${req.base}/notas/${nota._id}`);
  }
  res.set('Content-Type', 'application/xml; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${nomeArquivoNota(nota)}.xml"`);
  res.send(nota.xml);
  marcarBaixadas({ _id: nota._id }).catch(() => {});
});

// PDF (DANFE / DANFSe / DACTE). ?baixar=1 forca o download; sem ele abre no navegador.
router.get('/:id/pdf', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).send('Nota não encontrada.');
    const nota = await NotaFiscal.findOne({ _id: req.params.id, owner: req.conta, ...escopo(req) }).lean();
    if (!nota) return res.status(404).send('Nota não encontrada.');
    if (!nota.xml) {
      req.session.flash = { type: 'erro', msg: mensagemArquivoApagado(nota) };
      return res.redirect(req.get('referer') || `${req.base}/notas/${nota._id}`);
    }
    const pdf = await gerarPdfNota(nota);
    res.set('Content-Type', 'application/pdf');
    res.set(
      'Content-Disposition',
      `${req.query.baixar ? 'attachment' : 'inline'}; filename="${nomeArquivoNota(nota)}.pdf"`,
    );
    res.send(pdf);
  } catch (err) {
    next(err);
  }
});

// Ciencia da operacao + download do XML completo de uma nota que veio so como resumo
router.post('/:id/ciencia', exigirRecurso('manifestacao'), async (req, res) => {
  try {
    const nota = await NotaFiscal.findOne({ _id: req.params.id, owner: req.conta, ...escopo(req) }).lean();
    if (!nota) throw new Error('Nota não encontrada.');
    if (!nota.resumo) throw new Error('Esta nota já tem o XML completo.');
    const empresa = await Empresa.findById(nota.empresa).populate('certificado');
    const certificado = await obterCertificadoEmpresa(empresa);
    const r = await cienciaEDownload(empresa, certificado, nota);
    req.session.flash = { type: r.ok ? (r.baixou ? 'ok' : 'info') : 'erro', msg: r.mensagem };
  } catch (err) {
    req.session.flash = { type: 'erro', msg: `Erro ao manifestar ciência: ${err.message}` };
  }
  res.redirect(req.get('referer') || `${req.base}/notas`);
});

// Manifestacao conclusiva (confirmar / desconhecer / operacao nao realizada) - so administrador
router.post('/:id/manifestar', requireAdmin, exigirRecurso('manifestacao'), async (req, res) => {
  const voltar = req.get('referer') || `${req.base}/notas/${req.params.id}`;
  try {
    const tipo = String(req.body.tipo || '');
    if (!EVENTOS[tipo] || tipo === 'ciencia') throw new Error('Escolha o tipo de manifestação.');
    const nota = await NotaFiscal.findOne({ _id: req.params.id, owner: req.conta, ...escopo(req) }).lean();
    if (!nota) throw new Error('Nota não encontrada.');
    if (!['nfe', 'nfce'].includes(nota.tipo) || !nota.chave) throw new Error('Manifestação só se aplica a NF-e recebidas.');
    const empresa = await Empresa.findById(nota.empresa).populate('certificado');
    const certificado = await obterCertificadoEmpresa(empresa);
    const r = await manifestarNota(empresa, certificado, nota, tipo, req.body.justificativa);
    req.session.flash = { type: r.ok ? 'ok' : 'erro', msg: r.mensagem };
  } catch (err) {
    req.session.flash = { type: 'erro', msg: `Erro na manifestação: ${err.message}` };
  }
  res.redirect(voltar);
});

// Disparar captura manual de uma empresa
router.post('/capturar/:empresaId', async (req, res) => {
  try {
    const empresa = await Empresa.findOne({ _id: req.params.empresaId, owner: req.conta, ...restricaoEmpresas(req, '_id') });
    if (!empresa) throw new Error('Empresa não encontrada.');
    const r = await capturarEmpresa(empresa._id, { origem: 'manual' });
    const novos = (r.nfe?.novos || 0) + (r.nfse?.novos || 0) + (r.cte?.novos || 0);
    const houveErro = [r.nfe, r.nfse, r.cte].some((x) => x?.status === 'erro');
    req.session.flash = {
      type: houveErro ? 'erro' : novos > 0 ? 'ok' : 'info',
      msg:
        `Captura concluída para ${empresa.razaoSocial}. ` +
        [
          r.nfe && `NF-e: ${r.nfe.mensagem}`,
          r.nfse && `NFS-e: ${r.nfse.mensagem}`,
          r.cte && `CT-e: ${r.cte.mensagem}`,
        ]
          .filter(Boolean)
          .join(' | '),
    };
  } catch (err) {
    req.session.flash = { type: 'erro', msg: `Erro na captura: ${err.message}` };
  }
  const voltar = req.get('referer') || `${req.base}/notas`;
  // Vindo da pagina Captura, volta direto para a lista de notas capturadas.
  res.redirect(voltar.includes('/captura') ? '/captura#notas-capturadas' : voltar);
});

export default router;
