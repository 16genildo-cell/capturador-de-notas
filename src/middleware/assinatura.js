import { env } from '../config/env.js';
import { Conta } from '../models/Conta.js';
import { Empresa } from '../models/Empresa.js';
import { User } from '../models/User.js';
import { PLANOS, TODAS_FUNCIONALIDADES, nomeFuncionalidade } from '../config/planos.js';
import { contarNaoLidas } from '../services/contato.js';
import { naoLidasEscritorio, naoLidasSuporte } from '../services/chat.js';

/** O usuario e dono/administrador da plataforma (painel /plataforma)? */
export function ehPlataforma(user) {
  return Boolean(user && env.saas.plataformaAdmins.includes(String(user.email).toLowerCase()));
}

/**
 * Garante a Conta de um dono. Contas criadas antes do SaaS (sem documento na tabela
 * de contas) viram "cortesia": continuam funcionando como antes, sem cobranca.
 */
export async function obterConta(contaId) {
  let conta = await Conta.findById(contaId);
  if (!conta) {
    const dono = await User.findById(contaId).select('nome email').lean();
    conta = await Conta.findOneAndUpdate(
      { _id: contaId },
      { $setOnInsert: { nome: dono?.nome || 'Conta', emailCobranca: dono?.email, status: 'cortesia' } },
      { upsert: true, new: true },
    );
  }
  return conta;
}

/** Carrega a conta do usuario logado em req.contaSaas / res.locals.contaSaas. */
export async function carregarConta(req, res, next) {
  res.locals.contaSaas = null;
  res.locals.acessoConta = null;
  res.locals.ehPlataforma = false;
  if (!req.user) return next();
  try {
    req.contaSaas = await obterConta(req.conta);
    req.acessoConta = req.contaSaas.acesso();
    req.ehPlataforma = ehPlataforma(req.user);
    res.locals.contaSaas = req.contaSaas.toObject();
    res.locals.acessoConta = req.acessoConta;
    res.locals.ehPlataforma = req.ehPlataforma;
    res.locals.planoAtual = PLANOS[req.contaSaas.plano] || null;
    // Funcionalidades do plano (o menu esconde o que nao estiver liberado)
    res.locals.recursos = req.ehPlataforma ? TODAS_FUNCIONALIDADES : req.contaSaas.recursos();
    if (!res.locals.recursos.includes('chat_suporte') && chatLiberado(req)) res.locals.recursos = [...res.locals.recursos, 'chat_suporte'];
    // Mensagens novas do formulario do site (badge no menu "Plataforma")
    if (req.ehPlataforma && req.method === 'GET') res.locals.mensagensNovas = await contarNaoLidas().catch(() => 0);
    // Chat com o suporte: mensagens nao lidas (badge no menu)
    if (req.method === 'GET' && req.user.role === 'admin') res.locals.chatNaoLidas = await naoLidasEscritorio(req.conta).catch(() => 0);
    if (req.method === 'GET' && req.ehPlataforma) res.locals.chatSuporteNaoLidas = await naoLidasSuporte().catch(() => 0);
  } catch (err) {
    return next(err);
  }
  next();
}

// Caminhos que continuam abertos mesmo com a assinatura bloqueada.
const LIVRES = [/^\/assinatura/, /^\/logout/, /^\/suporte\//, /^\/chat/, /^\/minha-senha/, /^\/plataforma/, /^\/static\//, /^\/webhooks\//, /^\/termos/, /^\/privacidade/];

/** Bloqueia o uso do sistema quando o teste acabou ou o pagamento venceu. */
export function exigirAssinatura(req, res, next) {
  // O dono da plataforma acessando como suporte ve o escritorio mesmo com a assinatura bloqueada.
  if (!req.user || !req.acessoConta || req.acessoConta.liberado || req.ehPlataforma || req.acessoSuporte) return next();
  if (LIVRES.some((r) => r.test(req.path))) return next();
  // O cliente do escritorio nao ve a cobranca: so avisa que o acesso esta suspenso.
  if (req.user.role === 'cliente') {
    return res.status(402).render('error', {
      title: 'Acesso suspenso',
      message: 'O acesso ao sistema está temporariamente suspenso. Fale com o seu escritório de contabilidade.',
      status: 402,
    });
  }
  const mensagens = {
    'teste-encerrado': 'Seu período de teste terminou. Fale com a nossa equipe para contratar.',
    vencida: 'A assinatura venceu. Regularize o pagamento para continuar.',
    inadimplente: 'Pagamento em atraso: o acesso foi bloqueado. Regularize para continuar.',
    cancelada: 'A assinatura foi cancelada. Fale com a nossa equipe para voltar a usar.',
    suspensa: 'Conta bloqueada. Fale com o suporte.',
    pausada: 'Sua assinatura está pausada. Fale com a nossa equipe para retomar.',
  };
  req.session.flash = { type: 'erro', msg: mensagens[req.acessoConta.motivo] || 'Assinatura inativa.' };
  return res.redirect('/assinatura');
}

// ---------------------------------------------------------------- funcionalidades do plano
/** A conta do usuario logado pode usar a funcionalidade? (dono da plataforma: sempre) */
export function recursoLiberado(req, id) {
  if (req.ehPlataforma || !req.contaSaas) return true;
  return req.contaSaas.temRecurso(id);
}

/**
 * Chat com o suporte: liberado se o plano incluir, e SEMPRE que a conta estiver sem acesso
 * (bloqueada, pausada, vencida, teste encerrado...) ou sem plano: e o canal para regularizar.
 */
export function chatLiberado(req) {
  if (recursoLiberado(req, 'chat_suporte')) return true;
  const conta = req.contaSaas;
  return Boolean(conta && (!conta.plano || !conta.acesso().liberado));
}

export const mensagemRecurso = (id) => `O seu plano não inclui: ${nomeFuncionalidade(id)}. Fale com a nossa equipe para mudar de plano.`;

/** Painel antigo (EJS): bloqueia a rota se o plano nao tiver a funcionalidade. */
export function exigirRecurso(id) {
  return (req, res, next) => {
    if (!req.user || recursoLiberado(req, id)) return next();
    if (req.method === 'GET') {
      return res.status(403).render('error', { title: 'Não incluído no plano', message: mensagemRecurso(id), status: 403 });
    }
    req.session.flash = { type: 'erro', msg: mensagemRecurso(id) };
    return res.redirect(req.get('referer') || '/');
  };
}

/** API JSON: responde 403 { codigo: 'recurso' } se o plano nao tiver a funcionalidade. */
export function exigirRecursoApi(id) {
  return (req, res, next) => {
    if (recursoLiberado(req, id)) return next();
    return res.status(403).json({ erro: mensagemRecurso(id), codigo: 'recurso', recurso: id });
  };
}

// ---------------------------------------------------------------- limites
const daConta = (conta) => ({ $or: [{ _id: conta }, { conta }] });

/** Usuarios da equipe (administradores + equipe) ativos. O cliente do escritorio nao conta. */
export function contarEquipe(contaId) {
  return User.countDocuments({ ...daConta(contaId), role: { $ne: 'cliente' }, ativo: { $ne: false } });
}

/**
 * Lanca erro se a conta ja esta no limite de usuarios da equipe do plano.
 * Use antes de criar, reativar ou promover (cliente -> equipe) um usuario.
 */
export async function verificarLimiteUsuarios(req) {
  if (req.ehPlataforma) return;
  const conta = req.contaSaas || (await obterConta(req.conta));
  const limite = conta.limiteUsuarios();
  if (limite === Infinity) return;
  const usados = await contarEquipe(req.conta);
  if (usados >= limite) {
    const err = new Error(`Seu plano permite ${limite} usuário(s) na equipe e você já tem ${usados}. Desative alguém ou fale com a nossa equipe para mudar de plano.`);
    err.limite = true;
    throw err;
  }
}

/** Lanca erro se a conta ja usa todas as empresas do plano. */
export async function verificarLimiteEmpresas(req) {
  const conta = req.contaSaas || (await obterConta(req.conta));
  const limite = conta.limiteEmpresas();
  if (limite === Infinity) return;
  const usadas = await Empresa.countDocuments({ owner: req.conta });
  if (usadas >= limite) {
    const origem = conta.limiteEmpresasManual != null
      ? 'O limite combinado para o seu escritório é de'
      : conta.planoAtual() ? `O plano ${conta.planoAtual().nome} permite` : 'Sem um plano contratado, o teste grátis permite';
    const err = new Error(`${origem} ${limite} cliente(s) e você já tem ${usadas}. Fale com a nossa equipe para mudar de plano e cadastrar mais.`);
    err.limite = true;
    throw err;
  }
}

/** Exige o dono/administrador da plataforma. */
export function requirePlataforma(req, res, next) {
  if (req.user && req.ehPlataforma) return next();
  return res.status(404).render('error', { title: 'Não encontrado', message: 'Página não encontrada.', status: 404 });
}
