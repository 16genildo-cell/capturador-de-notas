import { Router } from 'express';
import mongoose from 'mongoose';
import { User, validarSenha } from '../models/User.js';
import { Empresa } from '../models/Empresa.js';
import { requireAdmin } from '../middleware/auth.js';
import { acessoParaPerfil, aplicarPerfil, lerPerfil, ROTULO_PERFIL } from '../services/permissoes.js';
import { verificarLimiteUsuarios, recursoLiberado, mensagemRecurso } from '../middleware/assinatura.js';

/** O plano permite este perfil? (cliente do escritorio: funcionalidade; equipe: limite de usuarios) */
async function checarPerfilNoPlano(req, role) {
  if (role === 'cliente') {
    if (!recursoLiberado(req, 'acesso_clientes')) throw new Error(mensagemRecurso('acesso_clientes'));
    return;
  }
  await verificarLimiteUsuarios(req);
}

const router = Router();
router.use(requireAdmin);

/** Usuarios da mesma conta do administrador logado. */
function daConta(req) {
  return { $or: [{ _id: req.conta }, { conta: req.conta }] };
}

router.get('/', async (req, res) => {
  const [usuarios, empresas] = await Promise.all([
    User.find(daConta(req)).select('-senhaHash').sort('nome').lean(),
    Empresa.find({ owner: req.conta }).select('razaoSocial cnpj').sort('razaoSocial').lean(),
  ]);
  const nomes = new Map(empresas.map((e) => [String(e._id), e.razaoSocial]));
  res.render('usuarios/lista', {
    title: 'Usuários',
    usuarios: usuarios.map((u) => ({
      ...u,
      empresasIds: (u.empresas || []).map(String),
      empresasNomes: (u.empresas || []).map((id) => nomes.get(String(id))).filter(Boolean),
    })),
    empresas,
    rotuloPerfil: ROTULO_PERFIL,
    eu: String(req.user._id),
    dono: String(req.conta),
  });
});

router.post('/', async (req, res) => {
  try {
    const nome = String(req.body.nome || '').trim();
    const email = String(req.body.email || '').toLowerCase().trim();
    const role = lerPerfil(req.body.role);
    if (!nome || !email) throw new Error('Informe nome e e-mail.');
    validarSenha(req.body.senha);
    if (await User.exists({ email })) throw new Error('Já existe um usuário com esse e-mail.');
    await checarPerfilNoPlano(req, role);
    // Acesso aos clientes: administradores veem todos; o cliente do escritorio so os marcados.
    const acesso = await acessoParaPerfil(req.conta, role, req.body);
    await User.criar({ nome, email, senha: req.body.senha, role, conta: req.conta, ...acesso });
    req.session.flash = { type: 'ok', msg: `Usuário ${email} criado. Passe a senha a ele com seguranca.` };
  } catch (err) {
    req.session.flash = { type: 'erro', msg: err.message };
  }
  res.redirect('/usuarios');
});

async function alvo(req) {
  if (!mongoose.isValidObjectId(req.params.id)) throw new Error('Usuário inválido.');
  const u = await User.findOne({ _id: req.params.id, ...daConta(req) });
  if (!u) throw new Error('Usuário não encontrado.');
  return u;
}

router.post('/:id/perfil', async (req, res) => {
  try {
    const u = await alvo(req);
    if (String(u._id) === String(req.conta)) throw new Error('O dono da conta e sempre administrador.');
    if (String(u._id) === String(req.user._id)) throw new Error('Você não pode mudar o próprio perfil.');
    const novo = lerPerfil(req.body.role);
    // Sair de "cliente" para a equipe ocupa uma vaga; virar "cliente" depende do plano.
    if (novo === 'cliente' || (u.role === 'cliente' && u.ativo)) await checarPerfilNoPlano(req, novo);
    aplicarPerfil(u, novo);
    await u.save();
    req.session.flash = { type: 'ok', msg: `Perfil de ${u.nome} alterado para ${ROTULO_PERFIL[u.role]}.` };
  } catch (err) {
    req.session.flash = { type: 'erro', msg: err.message };
  }
  res.redirect('/usuarios');
});

// Empresas que o usuario (operador) pode ver
router.post('/:id/empresas', async (req, res) => {
  try {
    const u = await alvo(req);
    if (String(u._id) === String(req.conta)) throw new Error('O dono da conta ve todas as empresas.');
    if (u.role === 'admin') throw new Error('Administradores veem todos os clientes. Mude o perfil para restringir.');
    const acesso = await acessoParaPerfil(req.conta, u.role, req.body);
    u.todasEmpresas = acesso.todasEmpresas;
    u.empresas = acesso.empresas;
    await u.save();
    req.session.flash = {
      type: 'ok',
      msg: acesso.todasEmpresas ? `${u.nome} agora ve todos os clientes.` : `${u.nome} agora ve ${acesso.empresas.length} cliente(s).`,
    };
  } catch (err) {
    req.session.flash = { type: 'erro', msg: err.message };
  }
  res.redirect('/usuarios');
});

router.post('/:id/ativo', async (req, res) => {
  try {
    const u = await alvo(req);
    if (String(u._id) === String(req.user._id)) throw new Error('Você não pode desativar o próprio usuário.');
    if (String(u._id) === String(req.conta)) throw new Error('O dono da conta não pode ser desativado.');
    if (!u.ativo) await checarPerfilNoPlano(req, u.role); // reativar ocupa uma vaga
    u.ativo = !u.ativo;
    await u.save();
    req.session.flash = { type: 'ok', msg: `${u.nome} ${u.ativo ? 'reativado' : 'desativado'}.` };
  } catch (err) {
    req.session.flash = { type: 'erro', msg: err.message };
  }
  res.redirect('/usuarios');
});

router.post('/:id/senha', async (req, res) => {
  try {
    const u = await alvo(req);
    validarSenha(req.body.senha);
    u.senhaHash = await User.hashSenha(req.body.senha);
    await u.save();
    req.session.flash = { type: 'ok', msg: `Senha de ${u.nome} redefinida.` };
  } catch (err) {
    req.session.flash = { type: 'erro', msg: err.message };
  }
  res.redirect('/usuarios');
});

router.post('/:id/excluir', async (req, res) => {
  try {
    const u = await alvo(req);
    if (String(u._id) === String(req.user._id)) throw new Error('Você não pode excluir o próprio usuário.');
    if (String(u._id) === String(req.conta)) throw new Error('O dono da conta não pode ser excluído.');
    await User.deleteOne({ _id: u._id });
    req.session.flash = { type: 'ok', msg: `Usuário ${u.email} excluído.` };
  } catch (err) {
    req.session.flash = { type: 'erro', msg: err.message };
  }
  res.redirect('/usuarios');
});

export default router;
