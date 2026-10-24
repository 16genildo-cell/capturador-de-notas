import { NotaFiscal } from '../models/NotaFiscal.js';
import { Conta } from '../models/Conta.js';
import { LISTA_PLANOS } from '../config/planos.js';

/**
 * Armazenamento das notas conforme o plano do escritorio.
 *
 * O dono da plataforma define em cada plano:
 *  - por quantos dias o XML fica guardado depois de capturado (vazio = sempre);
 *  - se o XML e apagado depois que o escritorio baixa.
 * Uma tarefa de hora em hora (scheduler) apaga os XMLs vencidos. Os dados basicos da nota
 * (chave, numero, emitente, valor, data, situacao) ficam no sistema: servem para nao baixar
 * a mesma nota de novo da SEFAZ, para a lista e para os prazos de manifestacao.
 * Notas que ainda estao so como resumo (sem XML completo) nao sao apagadas.
 */
const DIA = 864e5;
/** Depois do download, o arquivo ainda fica 1 hora (para baixar de novo se o download falhar). */
export const MARGEM_APOS_DOWNLOAD_MS = 60 * 60 * 1000;

const SO_ARQUIVOS_COMPLETOS = { xmlApagadoEm: null, resumo: { $ne: true } };

/** Marca o 1o download do XML (so as notas ainda nao marcadas). */
export async function marcarBaixadas(filtro) {
  const r = await NotaFiscal.updateMany({ ...filtro, ...SO_ARQUIVOS_COMPLETOS, baixadaEm: null }, { $set: { baixadaEm: new Date() } });
  return r.modifiedCount || 0;
}

/**
 * Situacao do arquivo de uma nota: { disponivel, apagadoEm, ate }.
 * ate = quando o XML deve ser apagado (null = nao tem data, fica ate a regra mudar).
 */
export function situacaoArquivo(nota, regra) {
  if (nota.xmlApagadoEm) return { disponivel: false, apagadoEm: nota.xmlApagadoEm, ate: null };
  if (nota.resumo || !regra) return { disponivel: true, apagadoEm: null, ate: null };
  const datas = [];
  if (regra.dias != null) datas.push(new Date(nota.arquivoEm || nota.createdAt).getTime() + regra.dias * DIA);
  if (regra.apagarAoBaixar && nota.baixadaEm) datas.push(new Date(nota.baixadaEm).getTime() + MARGEM_APOS_DOWNLOAD_MS);
  return { disponivel: true, apagadoEm: null, ate: datas.length ? new Date(Math.min(...datas)) : null };
}

/** Filtro das notas de uma conta cujo XML ja deve ser apagado pela regra. */
export function filtroVencidas(owner, regra, agora = new Date()) {
  const ou = [];
  if (regra.dias != null) {
    const limite = new Date(agora.getTime() - regra.dias * DIA);
    ou.push({ arquivoEm: { $lt: limite } }, { arquivoEm: null, createdAt: { $lt: limite } });
  }
  if (regra.apagarAoBaixar) ou.push({ baixadaEm: { $lt: new Date(agora.getTime() - MARGEM_APOS_DOWNLOAD_MS) } });
  if (!ou.length) return null;
  return { owner, ...SO_ARQUIVOS_COMPLETOS, $or: ou };
}

/** Apaga o XML (mantendo os dados basicos) das notas vencidas de todas as contas. */
export async function limparArquivos(agora = new Date()) {
  const planosComRegra = LISTA_PLANOS.filter((p) => p.armazenamento.dias != null || p.armazenamento.apagarAoBaixar).map((p) => p.id);
  if (!planosComRegra.length) return { contas: 0, apagadas: 0 };
  const contas = await Conta.find({ plano: { $in: planosComRegra } }).select('_id plano limiteEmpresasManual limiteUsuariosManual status');
  let apagadas = 0;
  for (const conta of contas) {
    const filtro = filtroVencidas(conta._id, conta.armazenamento(), agora);
    if (!filtro) continue;
    const r = await NotaFiscal.updateMany(filtro, { $unset: { xml: 1 }, $set: { xmlApagadoEm: agora } });
    apagadas += r.modifiedCount || 0;
  }
  if (apagadas) console.log(`[armazenamento] ${apagadas} arquivo(s) de nota apagado(s) conforme o plano.`);
  return { contas: contas.length, apagadas };
}

export const mensagemArquivoApagado = (nota) =>
  `O arquivo desta nota não está mais guardado no sistema (apagado em ${new Date(nota.xmlApagadoEm).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}, conforme o plano do escritório). Use o arquivo que você baixou ou consulte a nota pela chave no portal da SEFAZ.`;
