import { env } from '../config/env.js';
import { Conta } from '../models/Conta.js';
import { User } from '../models/User.js';

/** A conta quer Ciencia da Operacao automatica? (padrao: SEFAZ_CIENCIA_AUTOMATICA) */
export async function cienciaAutomaticaDaConta(ownerId) {
  if (!ownerId) return env.cienciaAutomatica;
  const c = await Conta.findById(ownerId);
  if (c?.temRecurso && !c.temRecurso('manifestacao')) return false;
  return c?.config?.cienciaAutomatica ?? env.cienciaAutomatica;
}

/** E-mails que recebem os alertas de uma conta: os configurados ou os administradores dela. */
export async function destinatariosDaConta(ownerId) {
  const c = await Conta.findById(ownerId).select('config').lean();
  if (c?.config?.alertasPara?.length) return c.config.alertasPara;
  const admins = await User.find({ role: 'admin', ativo: true, $or: [{ _id: ownerId }, { conta: ownerId }] })
    .select('email')
    .lean();
  return admins.map((a) => a.email);
}
