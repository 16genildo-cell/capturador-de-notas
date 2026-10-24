import { Router } from 'express';
import { Empresa } from '../models/Empresa.js';
import { Certificado } from '../models/Certificado.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { normalizarDocumento } from '../utils/documento.js';
import { verificarLimiteEmpresas } from '../middleware/assinatura.js';
import { restricaoEmpresas } from '../middleware/escopoEmpresa.js';

const router = Router();
// O escritorio ve "Clientes"; o cliente do escritorio ve as proprias empresas.
const locals_titulo = (req) => (req.user?.role === 'cliente' ? 'Minhas empresas' : 'Clientes');
router.use(requireAuth);

router.get('/', async (req, res) => {
  const empresas = await Empresa.find({ owner: req.conta, ...restricaoEmpresas(req, '_id') }).populate('certificado').sort('razaoSocial');
  // toObject() inclui os campos virtuais (ex.: cnpjFormatado), que .lean() nao traz.
  res.render('empresas/lista', { title: locals_titulo(req), empresas: empresas.map((e) => e.toObject()) });
});

router.get('/nova', requireAdmin, async (req, res) => {
  try {
    await verificarLimiteEmpresas(req);
  } catch (err) {
    req.session.flash = { type: 'erro', msg: err.message };
    return res.redirect('/assinatura');
  }
  const certificados = await Certificado.find({ owner: req.conta, ativo: true }).lean();
  const empresa = {};
  const cert = req.query.certificado && certificados.find((c) => String(c._id) === String(req.query.certificado));
  if (cert) {
    // Titular no padrao ICP-Brasil: "RAZAO SOCIAL:CNPJ" (e-CNPJ) ou "NOME:CPF" (e-CPF)
    empresa.certificado = cert._id;
    empresa.razaoSocial = String(cert.titular || '').replace(/:\d{11,14}$/, '');
    if ([11, 14].includes(String(cert.cnpjCpf || '').length)) empresa.cnpj = cert.cnpjCpf;
  }
  res.render('empresas/form', { title: 'Novo cliente', empresa, certificados });
});

router.post('/', requireAdmin, async (req, res) => {
  try {
    await verificarLimiteEmpresas(req);
    const dados = extrairDados(req);
    dados.owner = req.conta;
    const nova = await Empresa.create(dados);
    req.session.flash = { type: 'ok', msg: 'Empresa cadastrada. Esta é a página dela: daqui você captura, consulta, emite e configura tudo.' };
    res.redirect(`/empresas/${nova._id}`);
  } catch (err) {
    req.session.flash = { type: 'erro', msg: `Erro: ${err.message}` };
    res.redirect('/empresas/nova');
  }
});

router.get('/:id/editar', requireAdmin, async (req, res) => {
  const empresa = await Empresa.findOne({ _id: req.params.id, owner: req.conta }).lean();
  if (!empresa) return res.redirect('/empresas');
  const certificados = await Certificado.find({ owner: req.conta, ativo: true }).lean();
  res.render('empresas/form', { title: 'Editar cliente', empresa, certificados });
});

router.post('/:id', requireAdmin, async (req, res) => {
  try {
    const dados = extrairDados(req);
    await Empresa.updateOne({ _id: req.params.id, owner: req.conta }, dados);
    req.session.flash = { type: 'ok', msg: 'Empresa atualizada.' };
    res.redirect(`/empresas/${req.params.id}`);
  } catch (err) {
    req.session.flash = { type: 'erro', msg: `Erro: ${err.message}` };
    res.redirect(`/empresas/${req.params.id}/editar`);
  }
});

router.post('/:id/excluir', requireAdmin, async (req, res) => {
  await Empresa.deleteOne({ _id: req.params.id, owner: req.conta });
  req.session.flash = { type: 'ok', msg: 'Empresa removida.' };
  res.redirect('/empresas');
});

export function extrairDados(req) {
  const b = req.body;
  return {
    razaoSocial: b.razaoSocial?.trim(),
    nomeFantasia: b.nomeFantasia?.trim(),
    cnpj: normalizarDocumento(b.cnpj),
    inscricaoEstadual: b.inscricaoEstadual?.trim(),
    inscricaoMunicipal: b.inscricaoMunicipal?.trim(),
    uf: b.uf?.trim().toUpperCase(),
    municipioCodigo: b.municipioCodigo?.trim(),
    municipioNome: b.municipioNome?.trim(),
    certificado: b.certificado || undefined,
    'nfseMunicipal.provedor': b.nfseProvedor?.trim(),
    'captura.nfe': b.capturaNfe === 'on',
    'captura.nfse': b.capturaNfse === 'on',
    'captura.cte': b.capturaCte === 'on',
  };
}

export default router;
