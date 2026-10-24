import { Router } from 'express';
import { escopo, escopoDaEmpresa, restricaoEmpresas } from '../middleware/escopoEmpresa.js';
import mongoose from 'mongoose';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { Empresa } from '../models/Empresa.js';
import { ServicoNfse } from '../models/ServicoNfse.js';
import { servicoDoFormulario, validarServico, emitirServico } from '../services/nfse/servicos.js';

const router = Router();
router.use(requireAuth);

async function empresaDaConta(req, id) {
  if (!mongoose.isValidObjectId(id)) return null;
  if (req.empresaEscopo && String(id) !== String(req.empresaEscopo._id)) return null;
  return Empresa.findOne({ _id: id, owner: req.conta, ...restricaoEmpresas(req, '_id') });
}

// Lista de servicos cadastrados (por empresa)
router.get('/', async (req, res) => {
  const empresas = await Empresa.find({ owner: req.conta, ...escopoDaEmpresa(req) }).select('razaoSocial emissaoNfse municipioCodigo').sort('razaoSocial').lean();
  const empresaSel = empresas.find((e) => String(e._id) === String(req.query.empresa)) || empresas.find((e) => e.emissaoNfse?.ativa) || empresas[0];
  const servicos = empresaSel
    ? (await ServicoNfse.find({ owner: req.conta, empresa: empresaSel._id }).sort('nome')).map((s) => s.toObject())
    : [];
  res.render('emitir/servicos', { title: 'Servicos cadastrados', empresas, empresaSel, servicos });
});

function renderForm(res, { empresa, servico, titulo }) {
  res.render('emitir/servico-form', { title: titulo, empresa, s: servico });
}

router.get('/novo', requireAdmin, async (req, res) => {
  const empresa = await empresaDaConta(req, req.query.empresa);
  if (!empresa) return res.redirect(`${req.base}/emitir/servicos`);
  const cfg = empresa.emissaoNfse || {};
  renderForm(res, {
    empresa,
    titulo: 'Novo servico',
    servico: {
      cTribNac: cfg.cTribNac || '',
      cNBS: cfg.cNBS || '',
      descricao: cfg.descricaoPadrao || '',
      cLocPrestacao: empresa.municipioCodigo || '',
      tomador: { tipo: 'perguntar' },
      ativo: true,
    },
  });
});

router.get('/:id/editar', requireAdmin, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.redirect(`${req.base}/emitir/servicos`);
  const servico = await ServicoNfse.findOne({ _id: req.params.id, owner: req.conta, ...escopo(req) }).lean();
  if (!servico) return res.redirect(`${req.base}/emitir/servicos`);
  const empresa = await empresaDaConta(req, servico.empresa);
  renderForm(res, { empresa, servico, titulo: `Editar servico - ${servico.nome}` });
});

async function salvar(req, res, existente) {
  const empresaId = existente ? existente.empresa : req.body.empresa;
  const empresa = await empresaDaConta(req, empresaId);
  if (!empresa) {
    req.session.flash = { type: 'erro', msg: 'Empresa nao encontrada.' };
    return res.redirect(`${req.base}/emitir/servicos`);
  }
  const dados = servicoDoFormulario(req.body);
  try {
    validarServico(dados, empresa);
    if (existente) {
      Object.assign(existente, dados);
      await existente.save();
    } else {
      await ServicoNfse.create({ ...dados, owner: req.conta, empresa: empresa._id });
    }
    req.session.flash = { type: 'ok', msg: `Servico "${dados.nome}" salvo. Ele ja aparece como botao em Emitir NFS-e.` };
    res.redirect(req.base ? `${req.base}/emitir/servicos` : `/emitir/servicos?empresa=${empresa._id}`);
  } catch (err) {
    res.locals.flash = { type: 'erro', msg: err.lista ? err.lista.join(' ') : err.message };
    renderForm(res, { empresa, servico: { ...dados, _id: existente?._id }, titulo: existente ? `Editar servico - ${existente.nome}` : 'Novo servico' });
  }
}

router.post('/', requireAdmin, (req, res) => salvar(req, res, null));

router.post('/:id', requireAdmin, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.redirect(`${req.base}/emitir/servicos`);
  const servico = await ServicoNfse.findOne({ _id: req.params.id, owner: req.conta, ...escopo(req) });
  if (!servico) return res.redirect(`${req.base}/emitir/servicos`);
  return salvar(req, res, servico);
});

router.post('/:id/excluir', requireAdmin, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.redirect(`${req.base}/emitir/servicos`);
  const s = await ServicoNfse.findOneAndDelete({ _id: req.params.id, owner: req.conta, ...escopo(req) });
  req.session.flash = { type: 'ok', msg: s ? `Servico "${s.nome}" excluido.` : 'Servico nao encontrado.' };
  res.redirect(req.base ? `${req.base}/emitir/servicos` : `/emitir/servicos${s ? `?empresa=${s.empresa}` : ''}`);
});

// Emissao com um clique
router.post('/:id/emitir', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) throw new Error('Servico invalido.');
    const emissao = await emitirServico(req.params.id, req.conta, req.body, { usuarioId: req.user._id, empresa: req.empresaEscopo?._id || escopo(req).empresa });
    req.session.flash =
      emissao.status === 'autorizada'
        ? { type: 'ok', msg: `NFS-e autorizada${emissao.ambiente === 'homologacao' ? ' em PRODUCAO RESTRITA (teste, sem valor fiscal)' : ''}.` }
        : { type: 'erro', msg: emissao.status === 'rejeitada' ? 'A Sefin Nacional rejeitou a nota. Veja os motivos abaixo e ajuste o servico cadastrado.' : 'Sem resposta da Sefin Nacional.' };
    res.redirect(`${req.base}/emitir/${emissao._id}`);
  } catch (err) {
    req.session.flash = { type: 'erro', msg: err.lista ? err.lista.join(' ') : err.message };
    res.redirect(req.get('referer') || `${req.base}/emitir`);
  }
});

export default router;
