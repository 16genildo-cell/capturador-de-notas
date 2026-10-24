import { User, contaDoUsuario, empresasPermitidas } from '../models/User.js';

/**
 * Carrega o usuario da sessao em req.user / res.locals.user e define req.conta
 * (id do dono dos dados, compartilhado por todos os usuarios da mesma conta).
 */
export async function attachUser(req, res, next) {
  // Garante que as views sempre tenham a variavel `user` (null quando deslogado).
  res.locals.user = null;
  try {
    if (req.session.userId) {
      const user = await User.findById(req.session.userId).select('-senhaHash').lean();
      if (user && user.ativo) {
        req.user = user;
        req.conta = contaDoUsuario(user);
        // Operador restrito a algumas empresas: lista de ids permitidos (null = todas).
        req.empresasPermitidas = empresasPermitidas(user);
        res.locals.acessoRestrito = Boolean(req.empresasPermitidas);
        // Dono da plataforma acessando um escritorio como suporte (faixa no topo + "Voltar")
        req.acessoSuporte = req.session.acessoSuporte || null;
        res.locals.acessoSuporte = req.acessoSuporte;
        res.locals.user = user;
        res.locals.ehAdmin = user.role === 'admin';
      } else {
        req.session.destroy(() => {});
      }
    }
  } catch (err) {
    console.error('[auth] erro ao carregar usuário:', err.message);
  }
  next();
}

/** Exige usuario logado; senao redireciona para /login. */
export function requireAuth(req, res, next) {
  if (!req.user) {
    req.session.flash = { type: 'erro', msg: 'Faca login para continuar.' };
    return res.redirect('/login');
  }
  next();
}

/** Exige perfil administrador. */
export function requireAdmin(req, res, next) {
  if (!req.user) return requireAuth(req, res, next);
  if (req.user.role !== 'admin') {
    if (req.method === 'GET') {
      return res.status(403).render('error', {
        title: 'Acesso restrito',
        message: 'Esta área é exclusiva de administradores.',
        status: 403,
      });
    }
    req.session.flash = { type: 'erro', msg: 'Ação permitida apenas para administradores.' };
    return res.redirect(req.get('referer') || '/');
  }
  next();
}
