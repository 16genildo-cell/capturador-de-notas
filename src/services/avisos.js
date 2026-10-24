import mongoose from 'mongoose';
import { Aviso } from '../models/Aviso.js';

/**
 * Avisos da plataforma para os escritorios.
 * Duracao: horas/dias a partir do inicio, uma data/hora final, ou sem prazo (ate apagar).
 */
export const TIPOS_AVISO = { info: 'Informação', importante: 'Importante', manutencao: 'Manutenção programada' };
export const PUBLICOS_AVISO = { todos: 'Todos os escritórios', ativos: 'Só escritórios com acesso liberado', bloqueados: 'Só escritórios bloqueados (sem acesso)' };
const HORA = 36e5;

/** Le o formulario: { titulo, texto, tipo, inicio?, duracao: { horas } | { ate } | { semPrazo: true } } */
export function lerAviso(b = {}, agora = new Date()) {
  const titulo = String(b.titulo || '').trim();
  if (!titulo) throw new Error('Informe o título do aviso.');
  if (titulo.length > 120) throw new Error('Título muito longo (máximo 120 caracteres).');
  const texto = String(b.texto || '').trim();
  if (texto.length > 1000) throw new Error('Texto muito longo (máximo 1000 caracteres).');
  const tipo = TIPOS_AVISO[b.tipo] ? b.tipo : 'info';
  const para = PUBLICOS_AVISO[b.para] ? b.para : 'todos';
  let inicio = agora;
  if (b.inicio) {
    inicio = new Date(b.inicio);
    if (Number.isNaN(inicio.getTime())) throw new Error('Data de início inválida.');
  }
  let fim = null;
  const d = b.duracao || {};
  if (d.ate) {
    fim = new Date(d.ate);
    if (Number.isNaN(fim.getTime())) throw new Error('Data final inválida.');
  } else if (!d.semPrazo) {
    const horas = Number(d.horas);
    if (!(horas > 0 && horas <= 24 * 366)) throw new Error('Escolha por quanto tempo o aviso fica disponível.');
    fim = new Date(inicio.getTime() + horas * HORA);
  }
  if (fim && fim <= inicio) throw new Error('O fim do aviso precisa ser depois do início.');
  if (fim && fim <= agora) throw new Error('O fim do aviso já passou.');
  return { titulo, texto, tipo, para, inicio, fim };
}

/** Situacao do aviso agora: agendado | ativo | expirado. */
export function situacaoAviso(a, agora = new Date()) {
  if (new Date(a.inicio) > agora) return 'agendado';
  if (a.fim && new Date(a.fim) <= agora) return 'expirado';
  return 'ativo';
}

const publico = (a) => ({ id: String(a._id), titulo: a.titulo, texto: a.texto, tipo: a.tipo, para: a.para || 'todos', inicio: a.inicio, fim: a.fim });

/**
 * Avisos visiveis agora para um escritorio, mais importantes primeiro.
 * bloqueado: o escritorio esta sem acesso (ve os avisos "todos" e "bloqueados"; senao "todos" e "ativos").
 */
export async function avisosAtivos(agora = new Date(), { bloqueado = false } = {}) {
  const para = { $in: [null, 'todos', bloqueado ? 'bloqueados' : 'ativos'] };
  const lista = await Aviso.find({ inicio: { $lte: agora }, para, $or: [{ fim: null }, { fim: { $gt: agora } }] }).sort({ tipo: 1, inicio: -1 }).limit(10).lean();
  // importante e manutencao antes de informacao
  const peso = { importante: 0, manutencao: 1, info: 2 };
  return lista.sort((a, b) => peso[a.tipo] - peso[b.tipo] || new Date(b.inicio) - new Date(a.inicio)).map(publico);
}

/** Todos os avisos (painel da plataforma): ativos/agendados e os expirados recentes. */
export async function listarAvisos(agora = new Date()) {
  const lista = await Aviso.find({}).sort({ createdAt: -1 }).limit(100).lean();
  return lista.map((a) => ({ ...publico(a), criadoPor: a.criadoPor, criadoEm: a.createdAt, situacao: situacaoAviso(a, agora) }));
}

export async function criarAviso(b, { por } = {}) {
  const a = await Aviso.create({ ...lerAviso(b), criadoPor: por });
  return { ...publico(a), situacao: situacaoAviso(a) };
}

export async function apagarAviso(id) {
  if (!mongoose.isValidObjectId(id)) throw new Error('Aviso não encontrado.');
  const r = await Aviso.deleteOne({ _id: id });
  if (!r.deletedCount) throw new Error('Aviso não encontrado.');
}
