import { Router } from 'express';
import { requirePlataforma } from '../middleware/assinatura.js';
import { STATUS_CONTA } from '../models/Conta.js';
import { LISTA_PLANOS, TESTE, brl } from '../config/planos.js';
import { asaasConfigurado } from '../services/asaas.js';
import { listarContas, ajustarConta, criarContaCliente, mensagemContaCriada, SITUACOES_INICIAIS, obterEscritorio, donoParaAcesso } from '../services/plataforma.js';
import { env } from '../config/env.js';
import { listarMensagens, acaoMensagem } from '../services/contato.js';

/**
 * Painel do dono da plataforma: todas as contas de clientes, situacao da
 * assinatura, uso, receita mensal estimada e acoes manuais (liberar, suspender...).
 * So aparece para os e-mails de ADMIN_EMAIL / PLATAFORMA_ADMINS.
 */
const router = Router();
router.use(requirePlataforma);

router.get('/', async (req, res) => {
  const [dados, mensagens] = await Promise.all([listarContas(req.query), listarMensagens(req.query.msgs)]);
  res.render('plataforma', {
    mensagens,
    title: 'Plataforma',
    ...dados,
    planos: LISTA_PLANOS,
    STATUS: STATUS_CONTA,
    brl,
    asaasAtivo: asaasConfigurado(),
    asaasAmbiente: env.asaas.ambiente,
    situacoesIniciais: SITUACOES_INICIAIS,
    teste: TESTE,
  });
});

// Criar a conta de um novo cliente (o cadastro publico fica fechado)
router.post('/contas', async (req, res) => {
  try {
    const r = await criarContaCliente(req.body, { criadoPor: req.user.email });
    console.log(`[plataforma] ${req.user.email} criou a conta ${r.conta._id} (${r.user.email})`);
    req.session.flash = { type: 'ok', msg: mensagemContaCriada(r) };
  } catch (err) {
    req.session.flash = { type: 'erro', msg: `Não foi possível criar o escritório: ${err.message}` };
  }
  res.redirect('/plataforma');
});

// Chat com os escritorios (lista de conversas + conversa aberta, em tempo real)
router.get('/chat', async (req, res) => {
  const { nomeDoEscritorio } = await import('../services/chat.js');
  const conta = String(req.query.conta || '');
  res.render('plataforma-chat', { title: 'Chat dos escritórios', contaInicial: conta, nomeInicial: (await nomeDoEscritorio(conta)) || '' });
});

// Pagina de um escritorio: dados, plano, clientes, equipe, capturas e cobranca
router.get('/escritorios/:id', async (req, res, next) => {
  const dados = await obterEscritorio(req.params.id);
  if (!dados) return next();
  res.render('plataforma-escritorio', {
    title: `Escritorio: ${dados.conta.nome}`,
    ...dados,
    planos: LISTA_PLANOS,
    STATUS: STATUS_CONTA,
    brl,
  });
});

// Acessar o escritorio como suporte: o dono da plataforma passa a ver o sistema como o dono
// do escritorio. Uma faixa no topo mostra o acesso e o botao para voltar (POST /suporte/voltar).
router.post('/escritorios/:id/acessar', async (req, res) => {
  try {
    const { conta, dono } = await donoParaAcesso(req.params.id);
    console.log(`[plataforma] ${req.user.email} acessou o escritório ${conta._id} (${conta.nome}) como suporte`);
    req.session.acessoSuporte = { adminId: String(req.user._id), contaId: String(conta._id), nome: conta.nome, desde: new Date().toISOString() };
    req.session.userId = String(dono._id);
    req.session.save(() => res.redirect('/'));
  } catch (err) {
    req.session.flash = { type: 'erro', msg: err.message };
    res.redirect(`/plataforma/escritorios/${req.params.id}`);
  }
});

// Mensagens do formulario de contato do site
router.post('/mensagens/:id', async (req, res) => {
  try {
    req.session.flash = { type: 'ok', msg: await acaoMensagem(req.params.id, String(req.body.acao || '')) };
  } catch (err) {
    req.session.flash = { type: 'erro', msg: err.message };
  }
  res.redirect(req.get('referer') || '/plataforma#mensagens');
});

// Ajustes manuais de uma conta
router.post('/contas/:id', async (req, res) => {
  try {
    const conta = await ajustarConta(req.params.id, req.body, { por: req.user.email });
    console.log(`[plataforma] ${req.user.email} -> conta ${conta._id}: ${req.body.acao}`);
    req.session.flash = conta.aviso ? { type: 'erro', msg: conta.aviso } : { type: 'ok', msg: `Conta "${conta.nome}" atualizada.` };
  } catch (err) {
    req.session.flash = { type: 'erro', msg: err.message };
  }
  res.redirect(req.get('referer') || '/plataforma');
});

export default router;
