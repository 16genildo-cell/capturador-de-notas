import { Conta } from '../models/Conta.js';
import { User } from '../models/User.js';

/** E-mails que recebem os alertas de uma conta: os configurados ou os administradores dela. */
export async function destinatariosDaConta(ownerId) {
  const c = await Conta.findById(ownerId).select('config').lean();
  if (c?.config?.alertasPara?.length) return c.config.alertasPara;
  const admins = await User.find({ role: 'admin', ativo: true, $or: [{ _id: ownerId }, { conta: ownerId }] })
    .select('email')
    .lean();
  return admins.map((a) => a.email);
}
