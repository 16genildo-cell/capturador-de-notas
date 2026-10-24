/**
 * Perfil "Cliente do escritorio" (role = 'cliente').
 *
 * E o login que o escritorio de contabilidade da ao proprio cliente: ele so CONSULTA
 * as notas dos CNPJs liberados para ele (lista, detalhe, XML, PDF, download em ZIP e
 * relatorios). Nao da ciencia, nao captura, nao emite, nao ve certificados, equipe,
 * outros clientes do escritorio nem a cobranca do escritorio.
 *
 * A restricao aos CNPJs fica em req.empresasPermitidas (ver models/User.js); aqui
 * bloqueamos tudo o que nao e consulta, por lista de caminhos PERMITIDOS.
 */
const ID = '[a-f0-9]{24}';

// Painel antigo (EJS)
const SITE_GET = [
  /^\/$/,
  /^\/notas(\/|$)/,
  /^\/relatorios(\/|$)/,
  /^\/empresas\/?$/,
  new RegExp(`^/empresas/${ID}/?$`),
  new RegExp(`^/empresas/${ID}/(notas|relatorios)(/|$)`),
  /^\/minha-senha$/,
  /^\/termos$/,
  /^\/privacidade$/,
  /^\/static\//,
  /^\/(login|esqueci-senha|redefinir-senha)(\/|$)/,
];
const SITE_POST = [/^\/logout$/, /^\/minha-senha$/, /^\/login$/];
// Download em lote (ZIP) das notas selecionadas
const LOTE = new RegExp(`^(/empresas/${ID})?/notas/lote$`);

export const ehCliente = (user) => user?.role === 'cliente';

const MSG_SEM_ACESSO = 'O acesso de consulta para clientes não está disponível no plano do seu escritório de contabilidade. Fale com ele.';
const acessoClientesNoPlano = (req) => !req.contaSaas || req.contaSaas.temRecurso('acesso_clientes');

export function restringirClienteSite(req, res, next) {
  if (!ehCliente(req.user)) return next();
  res.locals.ehCliente = true;
  const caminho = req.path;
  if (!acessoClientesNoPlano(req) && !SITE_POST.some((r) => r.test(caminho)) && !/^\/(static\/|login|termos|privacidade)/.test(caminho)) {
    return res.status(403).render('error', { title: 'Acesso indisponivel', message: MSG_SEM_ACESSO, status: 403 });
  }
  const permitido =
    ['GET', 'HEAD'].includes(req.method)
      ? SITE_GET.some((r) => r.test(caminho))
      : SITE_POST.some((r) => r.test(caminho)) || (LOTE.test(caminho) && req.body?.acao === 'baixar');
  if (permitido) return next();
  if (req.method === 'GET') {
    return res.status(403).render('error', {
      title: 'Acesso de consulta',
      message: 'Seu acesso e somente para consultar e baixar as suas notas. Para outras ações, fale com o seu escritório de contabilidade.',
      status: 403,
    });
  }
  req.session.flash = { type: 'erro', msg: 'Seu acesso e somente de consulta. Fale com o seu escritório de contabilidade.' };
  return res.redirect(req.get('referer') || '/');
}

// API (site React e app). Caminhos relativos a /api/v1, ja autenticados.
const API_GET = [
  /^\/me$/,
  /^\/avisos$/,
  /^\/painel$/,
  /^\/notas(\/|$)/,
  /^\/relatorios(\/|$)/,
  /^\/empresas\/?$/,
  new RegExp(`^/empresas/${ID}$`),
];
const API_POST = [/^\/me\/senha$/, /^\/dispositivos$/];

export function restringirClienteApi(req, res, next) {
  if (!ehCliente(req.user)) return next();
  // /me continua respondendo para o site mostrar o aviso.
  if (!acessoClientesNoPlano(req) && req.path !== '/me') return res.status(403).json({ erro: MSG_SEM_ACESSO, codigo: 'recurso', recurso: 'acesso_clientes' });
  const lista = req.method === 'GET' ? API_GET : req.method === 'POST' ? API_POST : [];
  if (lista.some((r) => r.test(req.path))) return next();
  return res.status(403).json({ erro: 'Seu acesso e somente de consulta. Fale com o seu escritório de contabilidade.', codigo: 'cliente' });
}
