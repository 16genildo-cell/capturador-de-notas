import { Router } from 'express';
import { User, validarSenha } from '../models/User.js';
import { ehPlataforma } from '../middleware/assinatura.js';
import { requireAuth } from '../middleware/auth.js';
import { loginBloqueado, registrarFalhaLogin, limparFalhasLogin } from '../middleware/seguranca.js';
import { env } from '../config/env.js';
import { TESTE } from '../config/planos.js';
import { emailConfigurado } from '../services/email.js';
import { criarContaNova, pedirNovaSenha, usuarioDoTokenSenha, redefinirSenha } from '../services/cadastro.js';

const router = Router();

router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('login', { title: 'Entrar', layout: 'layout-auth' });
});

router.post('/login', async (req, res) => {
  const email = String(req.body.email || '').toLowerCase().trim();
  const senha = String(req.body.senha || '');

  const minutos = loginBloqueado(req, email);
  if (minutos) {
    req.session.flash = { type: 'erro', msg: `Muitas tentativas. Tente novamente em ${minutos} minuto(s).` };
    return res.redirect('/login');
  }

  const user = await User.findOne({ email });
  if (!user || !user.ativo || !(await user.verificarSenha(senha))) {
    registrarFalhaLogin(req, email);
    req.session.flash = { type: 'erro', msg: 'E-mail ou senha invalidos.' };
    return res.redirect('/login');
  }

  limparFalhasLogin(req, email);
  await User.updateOne({ _id: user._id }, { ultimoLogin: new Date() });
  // Nova sessao a cada login (evita fixacao de sessao).
  req.session.regenerate((err) => {
    if (err) {
      req.session.flash = { type: 'erro', msg: 'Erro ao iniciar a sessão. Tente novamente.' };
      return res.redirect('/login');
    }
    req.session.userId = user._id.toString();
    res.redirect('/');
  });
});

// ---------------------------------------------------------------
// Cadastro publico: cria o usuario dono + a conta em periodo de teste
// ---------------------------------------------------------------
router.get('/registrar', (req, res) => {
  if (req.user) return res.redirect('/');
  if (!env.saas.cadastroAberto) {
    req.session.flash = { type: 'info', msg: 'Cadastro de novas contas fechado no momento.' };
    return res.redirect('/login');
  }
  res.render('registrar', { title: 'Criar conta', layout: 'layout-auth', form: {}, teste: TESTE, plano: req.query.plano || '' });
});

router.post('/registrar', async (req, res) => {
  if (!env.saas.cadastroAberto) return res.redirect('/login');
  const form = {
    nome: String(req.body.nome || '').trim(),
    email: String(req.body.email || '').toLowerCase().trim(),
    conta: String(req.body.conta || '').trim(),
    documento: String(req.body.documento || '').trim(),
    telefone: String(req.body.telefone || '').trim(),
  };
  try {
    const user = await criarContaNova({ ...form, senha: req.body.senha, confirmar: req.body.confirmar, termos: req.body.termos === 'on', ip: req.ip, robo: req.body.site });
    req.session.regenerate((err) => {
      if (err) return res.redirect('/login');
      req.session.userId = user._id.toString();
      req.session.flash = { type: 'ok', msg: `Conta criada! Você tem ${TESTE.dias} dias de teste grátis. Comece enviando o certificado digital.` };
      res.redirect(req.body.plano ? `/assinatura?plano=${encodeURIComponent(req.body.plano)}` : '/');
    });
  } catch (err) {
    res.status(400).render('registrar', { title: 'Criar conta', layout: 'layout-auth', form, teste: TESTE, plano: req.body.plano || '', flash: { type: 'erro', msg: err.message } });
  }
});

// ---------------------------------------------------------------
// Esqueci a senha: link de uso unico por e-mail, valido por 1 hora
// ---------------------------------------------------------------
router.get('/esqueci-senha', (req, res) => {
  res.render('esqueci-senha', { title: 'Recuperar senha', layout: 'layout-auth', emailAtivo: emailConfigurado() });
});

router.post('/esqueci-senha', async (req, res) => {
  try {
    await pedirNovaSenha(req.body.email, req.ip);
    req.session.flash = { type: 'ok', msg: 'Se o e-mail estiver cadastrado, enviamos um link para criar uma nova senha. Confira também o spam.' };
  } catch (err) {
    req.session.flash = { type: 'erro', msg: err.message };
  }
  res.redirect('/login');
});

router.get('/redefinir-senha/:token', async (req, res) => {
  if (!(await usuarioDoTokenSenha(req.params.token))) {
    req.session.flash = { type: 'erro', msg: 'Link inválido ou expirado. Peca um novo.' };
    return res.redirect('/esqueci-senha');
  }
  res.render('redefinir-senha', { title: 'Nova senha', layout: 'layout-auth', token: req.params.token });
});

router.post('/redefinir-senha/:token', async (req, res) => {
  try {
    await redefinirSenha(req.params.token, req.body.nova, req.body.confirmar, req);
    req.session.flash = { type: 'ok', msg: 'Senha criada. Entre com a nova senha.' };
    res.redirect('/login');
  } catch (err) {
    req.session.flash = { type: 'erro', msg: err.message };
    res.redirect(/expirado/.test(err.message) ? '/esqueci-senha' : `/redefinir-senha/${req.params.token}`);
  }
});

// Trocar a propria senha
router.get('/minha-senha', requireAuth, (req, res) => {
  res.render('minha-senha', { title: 'Trocar senha' });
});

router.post('/minha-senha', requireAuth, async (req, res) => {
  try {
    const { atual, nova, confirmar } = req.body;
    const user = await User.findById(req.user._id);
    if (!(await user.verificarSenha(String(atual || '')))) throw new Error('Senha atual incorreta.');
    validarSenha(nova);
    if (nova !== confirmar) throw new Error('A confirmacao não confere com a nova senha.');
    user.senhaHash = await User.hashSenha(nova);
    await user.save();
    req.session.flash = { type: 'ok', msg: 'Senha alterada.' };
    res.redirect('/');
  } catch (err) {
    req.session.flash = { type: 'erro', msg: err.message };
    res.redirect('/minha-senha');
  }
});

// Fim do acesso de suporte: volta para o usuario do dono da plataforma.
router.post('/suporte/voltar', async (req, res) => {
  const a = req.session.acessoSuporte;
  if (!a) return res.redirect('/');
  const admin = await User.findById(a.adminId).select('email ativo').lean();
  delete req.session.acessoSuporte;
  if (!admin || !admin.ativo || !ehPlataforma(admin)) {
    return req.session.destroy(() => res.redirect('/login'));
  }
  req.session.userId = String(a.adminId);
  req.session.flash = { type: 'ok', msg: `Acesso ao escritório "${a.nome}" encerrado.` };
  req.session.save(() => res.redirect(`/plataforma/escritorios/${a.contaId}`));
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

export default router;
