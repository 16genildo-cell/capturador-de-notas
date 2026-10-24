import mongoose from 'mongoose';
import { Empresa } from '../models/Empresa.js';

/**
 * Acesso por empresa dos usuarios de uma conta (operadores).
 *
 * Le do formulario (site ou API) se o usuario ve todas as empresas ou so algumas,
 * e valida que as empresas escolhidas sao da propria conta.
 *  - todasEmpresas: true/'todas' (padrao) ou false/'algumas'
 *  - empresas: id ou lista de ids
 * @returns {Promise<{ todasEmpresas: boolean, empresas: mongoose.Types.ObjectId[] }>}
 */
export async function lerAcessoEmpresas(conta, { todasEmpresas, empresas } = {}) {
  const restrito = [false, 'false', 'algumas', '0', 0].includes(todasEmpresas);
  if (!restrito) return { todasEmpresas: true, empresas: [] };
  const ids = [].concat(empresas || []).map(String).filter((id) => mongoose.isValidObjectId(id));
  const validas = ids.length ? await Empresa.find({ owner: conta, _id: { $in: ids } }).distinct('_id') : [];
  if (!validas.length) throw new Error('Escolha ao menos um cliente (CNPJ) para este usuário (ou marque "todos os clientes").');
  return { todasEmpresas: false, empresas: validas };
}

/** Perfis de usuario de um escritorio. */
export const PERFIS = ['admin', 'operador', 'cliente'];
export const ROTULO_PERFIL = { admin: 'Administrador', operador: 'Equipe', cliente: 'Cliente do escritório' };

export function lerPerfil(valor) {
  return PERFIS.includes(valor) ? valor : 'operador';
}

/** Acesso aos clientes (empresas) conforme o perfil: admin ve todos; cliente so os marcados. */
export async function acessoParaPerfil(conta, role, body = {}) {
  if (role === 'admin') return { todasEmpresas: true, empresas: [] };
  if (role === 'cliente') return lerAcessoEmpresas(conta, { ...body, todasEmpresas: 'algumas' });
  return lerAcessoEmpresas(conta, body);
}

/** Troca o perfil de um usuario existente (o cliente do escritorio precisa ter CNPJs marcados). */
export function aplicarPerfil(u, role) {
  if (role === 'cliente') {
    if (!u.empresas?.length) {
      throw new Error('Marque primeiro os clientes (CNPJs) que este usuário pode ver em "Escolher clientes" e depois mude o perfil para Cliente do escritório.');
    }
    u.todasEmpresas = false;
  }
  u.role = role;
}

/** O corpo da requisicao traz alguma alteracao de acesso por empresa? */
export function temAcessoNoCorpo(body = {}) {
  return body.todasEmpresas !== undefined || body.empresas !== undefined;
}
