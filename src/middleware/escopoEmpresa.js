import mongoose from 'mongoose';
import { Empresa } from '../models/Empresa.js';
import { requireAuth } from './auth.js';

/**
 * Pagina propria de cada empresa: tudo o que fica em /empresas/:empresaId/... (notas, captura,
 * emissao, servicos, relatorios, importacao) enxerga somente aquela empresa.
 *
 * Define:
 *  - req.empresaEscopo / res.locals.empresaAtual: a empresa da pagina
 *  - req.base / res.locals.base: prefixo dos links ("/empresas/<id>"; vazio fora da empresa)
 *  - req.query.empresa e req.body.empresa: forcados para a empresa (filtros e formularios)
 */
export async function escopoEmpresa(req, res, next) {
  const id = req.params.empresaId;
  if (!mongoose.isValidObjectId(id)) return next('router');
  if (!req.user) return requireAuth(req, res, next);
  try {
    const empresa = await Empresa.findOne({ _id: id, owner: req.conta, ...restricaoEmpresas(req, '_id') }).populate('certificado', 'apelido validoAte titular');
    if (!empresa) return next('router');
    req.empresaEscopo = empresa.toObject();
    req.base = `/empresas/${empresa._id}`;
    res.locals.base = req.base;
    res.locals.empresaAtual = req.empresaEscopo;
    req.query.empresa = String(empresa._id);
    if (req.body && typeof req.body === 'object') req.body.empresa = String(empresa._id);
    next();
  } catch (err) {
    next(err);
  }
}

/** Valores padrao para as paginas gerais (sem empresa). */
export function semEscopo(req, res, next) {
  req.base = '';
  res.locals.base = '';
  res.locals.empresaAtual = null;
  next();
}

/**
 * Restricao do usuario logado: operador limitado a algumas empresas so enxerga essas.
 * Retorna {} para quem ve todas. `campo` = 'empresa' (notas, emissoes...) ou '_id' (empresas).
 */
export function restricaoEmpresas(req, campo = 'empresa') {
  return req.empresasPermitidas ? { [campo]: { $in: req.empresasPermitidas } } : {};
}

/** O usuario logado pode ver esta empresa? */
export function podeVerEmpresa(req, empresaId) {
  if (!req.empresasPermitidas) return true;
  return req.empresasPermitidas.some((id) => String(id) === String(empresaId));
}

/** Filtro extra do MongoDB: a empresa da pagina, quando houver; senao, as empresas permitidas ao usuario. */
export function escopo(req) {
  return req.empresaEscopo ? { empresa: req.empresaEscopo._id } : restricaoEmpresas(req, 'empresa');
}

/** Lista curta das empresas da conta para o menu lateral (atalho para a pagina de cada uma). */
export async function menuEmpresas(req, res, next) {
  res.locals.empresasMenu = [];
  if (!req.user || req.method !== 'GET') return next();
  try {
    res.locals.empresasMenu = await Empresa.find({ owner: req.conta, ...restricaoEmpresas(req, '_id') }).select('razaoSocial').sort('razaoSocial').limit(500).lean();
  } catch {
    // o menu e so um atalho; nunca impede a pagina de abrir
  }
  next();
}

/** Mesmo filtro, para consultas na propria colecao de empresas (campo _id). */
export function escopoDaEmpresa(req) {
  return req.empresaEscopo ? { _id: req.empresaEscopo._id } : restricaoEmpresas(req, '_id');
}
