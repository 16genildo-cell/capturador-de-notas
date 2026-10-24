import { Router } from 'express';
import { env } from '../config/env.js';
import { User, validarSenha, empresasPermitidas } from '../models/User.js';
import { Dispositivo } from '../models/Dispositivo.js';
import { PLANOS, TESTE, planosPublicos, FUNCIONALIDADES } from '../config/planos.js';
import { obterConta, ehPlataforma } from '../middleware/assinatura.js';
import { loginBloqueado, registrarFalhaLogin, limparFalhasLogin } from '../middleware/seguranca.js';
import { criarContaNova, pedirNovaSenha, redefinirSenha } from '../services/cadastro.js';
import { abrirSessao, renovarSessao, encerrarSessao, encerrarTodas, gerarTokenAcesso, lerTokenAcesso } from './tokens.js';
import { contaPublica } from './util.js';
import { registrarContato, FAIXAS_CLIENTES } from '../services/contato.js';
import recursos from './recursos.js';
import { restringirClienteApi } from '../middleware/perfilCliente.js';
import chatRoutes from '../routes/chat.js';
import { naoLidasEscritorio, naoLidasSuporte } from '../services/chat.js';

/**
 * API JSON (versao 1) para o frontend web (React) e o app (Flutter).
 * Autenticacao: "Authorization: Bearer <accessToken>". Erros: { erro, codigo? }.
 */
const api = Router();

// CORS: so as origens do frontend web (o app nao precisa de CORS)
api.use((req, res, next) => {
  const origem = req.get('origin');
  if (origem && env.corsOrigins.includes(origem.replace(/\/+$/, ''))) {
    res.set('Access-Control-Allow-Origin', origem);
    res.set('Vary', 'Origin');
    res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.set('Access-Control-Expose-Headers', 'Content-Disposition');
    res.set('Access-Control-Max-Age', '600');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  res.set('Cache-Control', 'no-store');
  next();
});

// ---------------- Publico ----------------
api.get('/planos', (req, res) => {
  res.json({ planos: planosPublicos(), funcionalidades: FUNCIONALIDADES, teste: TESTE, cadastroAberto: env.saas.cadastroAberto, nomeProduto: env.saas.nomeProduto, emailSuporte: env.saas.emailSuporte, faixasClientes: FAIXAS_CLIENTES });
});

// Formulario "Fale com a gente" da pagina inicial (site React)
api.post('/contato', async (req, res) => {
  try {
    await registrarContato(req.body || {}, { ip: req.ip, origem: 'web' });
    res.status(201).json({ ok: true, mensagem: 'Mensagem enviada! Vamos responder no seu e-mail em breve.' });
  } catch (err) {
    res.status(400).json({ erro: err.message });
  }
});

async function respostaLogin(req, user) {
  const tokens = await abrirSessao(user, { cliente: req.body?.cliente, ip: req.ip });
  await User.updateOne({ _id: user._id }, { ultimoLogin: new Date() });
  return { ...tokens, ...(await perfil(user)) };
}

async function perfil(user) {
  const contaId = user.conta || user._id;
  const conta = await obterConta(contaId);
  return {
    usuario: { id: String(user._id), nome: user.nome, email: user.email, role: user.role, plataforma: ehPlataforma(user), restrito: Boolean(empresasPermitidas(user)) },
    conta: contaPublica(conta),
    chat: {
      naoLidas: user.role === 'admin' ? await naoLidasEscritorio(contaId).catch(() => 0) : 0,
      suporteNaoLidas: ehPlataforma(user) ? await naoLidasSuporte().catch(() => 0) : 0,
    },
  };
}

api.post('/auth/login', async (req, res) => {
  const email = String(req.body.email || '').toLowerCase().trim();
  const minutos = loginBloqueado(req, email);
  if (minutos) return res.status(429).json({ erro: `Muitas tentativas. Tente novamente em ${minutos} minuto(s).` });
  const user = await User.findOne({ email });
  if (!user || !user.ativo || !(await user.verificarSenha(String(req.body.senha || '')))) {
    registrarFalhaLogin(req, email);
    return res.status(401).json({ erro: 'E-mail ou senha invalidos.' });
  }
  limparFalhasLogin(req, email);
  res.json(await respostaLogin(req, user));
});

api.post('/auth/registrar', async (req, res) => {
  try {
    const b = req.body || {};
    const user = await criarContaNova({ ...b, termos: b.termos === true || b.termos === 'on', ip: req.ip, robo: b.site });
    res.status(201).json(await respostaLogin(req, user));
  } catch (err) {
    res.status(400).json({ erro: err.message });
  }
});

api.post('/auth/renovar', async (req, res) => {
  const r = await renovarSessao(req.body?.refreshToken, req.ip);
  if (!r) return res.status(401).json({ erro: 'Sessão expirada. Entre novamente.', codigo: 'sessao' });
  const user = await User.findById(r.userId);
  if (!user || !user.ativo) return res.status(401).json({ erro: 'Usuário desativado.', codigo: 'sessao' });
  res.json({ accessToken: gerarTokenAcesso(user), refreshToken: r.refreshToken, expiraEmSegundos: 900 });
});

api.post('/auth/sair', async (req, res) => {
  await encerrarSessao(req.body?.refreshToken);
  if (req.body?.dispositivo) await Dispositivo.deleteOne({ token: String(req.body.dispositivo) });
  res.json({ ok: true });
});

api.post('/auth/esqueci-senha', async (req, res) => {
  try {
    await pedirNovaSenha(req.body?.email, req.ip);
    res.json({ ok: true, mensagem: 'Se o e-mail estiver cadastrado, enviamos um link para criar uma nova senha.' });
  } catch (err) {
    res.status(429).json({ erro: err.message });
  }
});

api.post('/auth/redefinir-senha', async (req, res) => {
  try {
    const user = await redefinirSenha(req.body?.token, req.body?.nova, req.body?.confirmar, req);
    await encerrarTodas(user._id);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ erro: err.message });
  }
});

// ---------------- Autenticado ----------------
api.use(async (req, res, next) => {
  // O navegador nao manda cabecalho nas conexoes de tempo real (EventSource): nelas o token vem em ?token=
  const token = String(req.get('authorization') || '').replace(/^Bearer\s+/i, '') || (req.path.endsWith('/eventos') ? String(req.query.token || '') : '');
  const id = lerTokenAcesso(token);
  if (!id) return res.status(401).json({ erro: 'Sessão expirada. Entre novamente.', codigo: 'token' });
  const user = await User.findById(id).select('-senhaHash').lean();
  if (!user || !user.ativo) return res.status(401).json({ erro: 'Usuário desativado.', codigo: 'sessao' });
  req.user = user;
  req.conta = user.conta || user._id;
  req.empresasPermitidas = empresasPermitidas(user);
  req.contaSaas = await obterConta(req.conta);
  req.acessoConta = req.contaSaas.acesso();
  req.ehPlataforma = ehPlataforma(user);
  next();
});

api.get('/me', async (req, res) => res.json(await perfil(req.user)));

api.post('/me/senha', async (req, res) => {
  const user = await User.findById(req.user._id);
  if (!(await user.verificarSenha(String(req.body.atual || '')))) return res.status(400).json({ erro: 'Senha atual incorreta.' });
  try {
    validarSenha(req.body.nova);
  } catch (err) {
    return res.status(400).json({ erro: err.message });
  }
  user.senhaHash = await User.hashSenha(req.body.nova);
  await user.save();
  res.json({ ok: true });
});

// Celular para notificacoes push
api.post('/dispositivos', async (req, res) => {
  const token = String(req.body.token || '').trim();
  if (!token) return res.status(400).json({ erro: 'Token do dispositivo ausente.' });
  const plataforma = ['android', 'ios', 'web'].includes(req.body.plataforma) ? req.body.plataforma : 'android';
  await Dispositivo.updateOne({ token }, { token, user: req.user._id, conta: req.conta, plataforma }, { upsert: true });
  res.json({ ok: true });
});

// Cliente do escritorio: somente consulta (notas, relatorios, painel)
api.use(restringirClienteApi);

// Teste encerrado / pagamento vencido: so as rotas da conta continuam respondendo
const LIVRES = [/^\/conta/, /^\/me/, /^\/dispositivos/, /^\/plataforma/, /^\/chat/, /^\/avisos$/];
api.use((req, res, next) => {
  if (req.acessoConta.liberado || req.ehPlataforma || LIVRES.some((r) => r.test(req.path))) return next();
  res.status(402).json({ erro: 'Assinatura inativa. Fale com a nossa equipe para contratar ou regularize o pagamento.', codigo: 'assinatura', motivo: req.acessoConta.motivo });
});

// Chat interno com o suporte (tempo real)
api.use('/chat', chatRoutes);

api.use('/', recursos);

api.use((req, res) => res.status(404).json({ erro: 'Rota não encontrada.' }));
// eslint-disable-next-line no-unused-vars
api.use((err, req, res, next) => {
  const status = err.status || (err.name === 'CastError' ? 404 : 500);
  if (status >= 500) console.error('[api]', err);
  res.status(status).json({ erro: status >= 500 && env.isProd ? 'Erro interno.' : err.message, codigo: err.codigo });
});

export { PLANOS };
export default api;
