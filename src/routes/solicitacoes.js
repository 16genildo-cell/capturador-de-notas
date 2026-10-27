import { Router } from 'express';
import mongoose from 'mongoose';
import multer from 'multer';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { escopo, escopoDaEmpresa, restricaoEmpresas } from '../middleware/escopoEmpresa.js';
import { Empresa } from '../models/Empresa.js';
import { SolicitacaoDocumento } from '../models/SolicitacaoDocumento.js';

const router = Router();
router.use(requireAuth);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
});

router.get('/', async (req, res) => {
  const empresas = await Empresa.find({ owner: req.conta, ...escopoDaEmpresa(req) })
    .select('razaoSocial')
    .sort('razaoSocial')
    .lean();

  const filtro = { owner: req.conta, ...escopo(req) };
  if (req.query.empresa && mongoose.isValidObjectId(req.query.empresa)) {
    filtro.empresa = req.query.empresa;
  }
  if (req.query.status) {
    filtro.status = req.query.status;
  }

  const solicitacoes = await SolicitacaoDocumento.find(filtro)
    .populate('empresa', 'razaoSocial cnpj')
    .populate('solicitadoPor', 'nome email')
    .sort('-createdAt')
    .lean();

  res.render('solicitacoes', {
    title: 'Solicitação de Documentos & Tarefas',
    solicitacoes,
    empresas,
    filtros: { empresa: req.query.empresa || '', status: req.query.status || '' },
  });
});

router.post('/', requireAdmin, async (req, res) => {
  try {
    const { empresa, titulo, descricao, prazo } = req.body;
    if (!mongoose.isValidObjectId(empresa)) throw new Error('Selecione um cliente.');
    if (!titulo || !titulo.trim()) throw new Error('Informe o título do documento solicitado.');

    await SolicitacaoDocumento.create({
      owner: req.conta,
      empresa,
      titulo: titulo.trim(),
      descricao: (descricao || '').trim(),
      prazo: prazo ? new Date(prazo) : null,
      solicitadoPor: req.user._id,
      status: 'pendente',
    });

    req.session.flash = { type: 'ok', msg: 'Solicitação criada com sucesso.' };
  } catch (err) {
    req.session.flash = { type: 'erro', msg: err.message };
  }
  res.redirect(`${req.base}/solicitacoes`);
});

router.post('/:id/enviar', upload.single('arquivo'), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) throw new Error('Solicitação inválida.');
    const sol = await SolicitacaoDocumento.findOne({ _id: req.params.id, owner: req.conta, ...escopo(req) });
    if (!sol) throw new Error('Solicitação não encontrada.');

    if (!req.file) throw new Error('Selecione o arquivo para enviar.');

    sol.arquivo = {
      nome: req.file.originalname,
      mimetype: req.file.mimetype,
      tamanho: req.file.size,
      conteudoBase64: req.file.buffer.toString('base64'),
      enviadoEm: new Date(),
    };
    sol.status = 'enviado';
    if (req.body.observacao) sol.observacao = req.body.observacao.trim();
    await sol.save();

    req.session.flash = { type: 'ok', msg: 'Documento enviado com sucesso para o escritório!' };
  } catch (err) {
    req.session.flash = { type: 'erro', msg: err.message };
  }
  res.redirect(`${req.base}/solicitacoes`);
});

router.post('/:id/status', requireAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['aprovado', 'rejeitado', 'pendente'].includes(status)) throw new Error('Status inválido.');
    const sol = await SolicitacaoDocumento.findOne({ _id: req.params.id, owner: req.conta, ...escopo(req) });
    if (!sol) throw new Error('Solicitação não encontrada.');

    sol.status = status;
    await sol.save();
    req.session.flash = { type: 'ok', msg: `Status atualizado para "${status}".` };
  } catch (err) {
    req.session.flash = { type: 'erro', msg: err.message };
  }
  res.redirect(`${req.base}/solicitacoes`);
});

router.get('/:id/download', async (req, res) => {
  const sol = await SolicitacaoDocumento.findOne({ _id: req.params.id, owner: req.conta, ...escopo(req) });
  if (!sol || !sol.arquivo || !sol.arquivo.conteudoBase64) return res.status(404).send('Arquivo não encontrado.');

  const buf = Buffer.from(sol.arquivo.conteudoBase64, 'base64');
  res.type(sol.arquivo.mimetype || 'application/octet-stream');
  res.set('Content-Disposition', `attachment; filename="${encodeURIComponent(sol.arquivo.nome || 'documento')}"`);
  res.send(buf);
});

router.post('/:id/excluir', requireAdmin, async (req, res) => {
  try {
    await SolicitacaoDocumento.findOneAndDelete({ _id: req.params.id, owner: req.conta, ...escopo(req) });
    req.session.flash = { type: 'ok', msg: 'Solicitação removida.' };
  } catch (err) {
    req.session.flash = { type: 'erro', msg: err.message };
  }
  res.redirect(`${req.base}/solicitacoes`);
});

export default router;
