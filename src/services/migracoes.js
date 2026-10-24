import { NotaFiscal } from '../models/NotaFiscal.js';
import { CapturaLog } from '../models/CapturaLog.js';
import { Certificado } from '../models/Certificado.js';
import { User } from '../models/User.js';
import { Conta } from '../models/Conta.js';
import { EventoCobranca } from '../models/EventoCobranca.js';
import { SessaoApi } from '../models/SessaoApi.js';
import { Dispositivo } from '../models/Dispositivo.js';
import { garantirPlanosPadrao, carregarPlanos } from './planos.js';
import { migrarAtendimentos } from './chat.js';
import { Atendimento } from '../models/Atendimento.js';
import { Aviso } from '../models/Aviso.js';
import { ChatMensagem } from '../models/ChatMensagem.js';

/**
 * Ajustes de banco executados ao iniciar o sistema.
 * Versoes antigas gravavam eventos com o campo "chave" igual ao da nota, o que
 * bloqueava a gravacao da propria nota (indice unico empresa+chave).
 */
export async function executarMigracoes() {
  await migrarContasSaas();
  // Planos ficam no banco (Plataforma > Planos): grava os padrao na 1a vez e carrega o cache.
  await garantirPlanosPadrao();
  await carregarPlanos();
  // Chat: conversas antigas viram atendimentos numerados (uma vez)
  await Atendimento.syncIndexes();
  await migrarAtendimentos();
  const r = await NotaFiscal.updateMany({ tipo: 'evento', chave: { $exists: true } }, [
    { $set: { chaveNota: '$chave', tpEvento: '$numero' } },
    { $unset: 'chave' },
  ]);
  if (r.modifiedCount > 0) {
    console.log(`[migracao] ${r.modifiedCount} evento(s) ajustado(s).`);
  }
  // Cria/atualiza os indices (deixa listagens e relatorios rapidos com muitas notas)
  await Promise.all([Aviso.syncIndexes(), Atendimento.syncIndexes(), ChatMensagem.syncIndexes(), NotaFiscal.syncIndexes(), CapturaLog.syncIndexes(), Certificado.syncIndexes(), User.syncIndexes(), Conta.syncIndexes(), EventoCobranca.syncIndexes(), SessaoApi.syncIndexes(), Dispositivo.syncIndexes()]);
}

/** SaaS: toda conta que ja existia antes vira "cortesia" (continua funcionando, sem cobranca). */
export async function migrarContasSaas() {
  const donos = await User.find({ conta: null }).select('nome email').lean();
  const existentes = new Set((await Conta.find({ _id: { $in: donos.map((d) => d._id) } }).select('_id').lean()).map((c) => String(c._id)));
  const novas = donos.filter((d) => !existentes.has(String(d._id)));
  if (novas.length) {
    await Conta.insertMany(novas.map((d) => ({ _id: d._id, nome: d.nome, emailCobranca: d.email, status: 'cortesia' })), { ordered: false });
    console.log(`[migracao] ${novas.length} conta(s) existente(s) marcada(s) como cortesia.`);
  }

}
