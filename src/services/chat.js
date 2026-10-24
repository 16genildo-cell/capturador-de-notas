import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { ChatMensagem } from '../models/ChatMensagem.js';
import { ChatAnexo } from '../models/ChatAnexo.js';
import { Atendimento } from '../models/Atendimento.js';
import { Contador } from '../models/Contador.js';
import { Conta } from '../models/Conta.js';
import { dentroDoLimite } from '../middleware/seguranca.js';
import { enviarEmail, montarHtml } from './email.js';
import { destinatariosDaConta } from './contas.js';

/**
 * Chat interno em tempo real entre o escritorio e a equipe da plataforma, organizado em
 * atendimentos numerados (#1, #2...).
 *  - Cada escritorio tem no maximo um atendimento aberto. A primeira mensagem sem atendimento
 *    aberto (de qualquer lado) abre um novo, com o proximo numero.
 *  - A equipe da plataforma encerra o atendimento: a conversa fica arquivada (so leitura).
 *  - Um atendimento encerrado pode ser reaberto (pelo escritorio ou pela plataforma), desde que
 *    o escritorio nao tenha outro aberto.
 *  - Mensagens podem levar um anexo: PDF ou imagem (PNG, JPEG, GIF, WEBP) de ate 10 MB.
 *
 * Tempo real por Server-Sent Events (SSE): cada navegador com o chat aberto mantem uma
 * conexao GET aberta e recebe as mensagens novas na hora. Os ouvintes ficam em memoria,
 * o que funciona com uma instancia do servidor (como no render.yaml: numInstances 1).
 */
export const LIMITE_TEXTO = 2000;
export const LIMITE_ANEXO = 10 * 1024 * 1024;
const POR_PAGINA = 50;

// ---------------------------------------------------------------- tempo real (SSE)
const ouvintes = { escritorio: new Map(), suporte: new Set() };

function enviarEvento(res, evento, dados) {
  res.write(`event: ${evento}\ndata: ${JSON.stringify(dados)}\n\n`);
}

/** Abre a conexao SSE. canal: { tipo: 'escritorio', conta } ou { tipo: 'suporte' }. */
export function abrirEventos(req, res, canal) {
  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // proxies (Nginx/Render) nao segurarem as mensagens
  });
  res.flushHeaders?.();
  res.write('retry: 3000\n\n');
  enviarEvento(res, 'pronto', { ok: true });

  let lista;
  if (canal.tipo === 'suporte') {
    lista = ouvintes.suporte;
  } else {
    const k = String(canal.conta);
    if (!ouvintes.escritorio.has(k)) ouvintes.escritorio.set(k, new Set());
    lista = ouvintes.escritorio.get(k);
  }
  lista.add(res);
  const pulso = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(pulso);
    lista.delete(res);
    if (canal.tipo !== 'suporte' && lista.size === 0) ouvintes.escritorio.delete(String(canal.conta));
  });
}

/** Envia um evento para o escritorio da conta e para a equipe da plataforma. */
function transmitir(conta, evento, dados) {
  for (const res of ouvintes.escritorio.get(String(conta)) || []) enviarEvento(res, evento, dados);
  for (const res of ouvintes.suporte) enviarEvento(res, evento, dados);
}

export const suporteOnline = () => ouvintes.suporte.size > 0;
export const escritorioOnline = (conta) => (ouvintes.escritorio.get(String(conta))?.size || 0) > 0;

/** Para testes: limpa os ouvintes. */
export function _limparOuvintes() {
  ouvintes.escritorio.clear();
  ouvintes.suporte.clear();
}

// ---------------------------------------------------------------- formatos publicos
function publica(m) {
  return {
    _id: String(m._id),
    conta: String(m.conta),
    atendimento: m.atendimento ? String(m.atendimento) : null,
    numeroAtendimento: m.numeroAtendimento ?? null,
    autorNome: m.autorNome,
    deSuporte: Boolean(m.deSuporte),
    sistema: Boolean(m.sistema),
    texto: m.texto || '',
    anexo: m.anexo?.id ? { id: String(m.anexo.id), nome: m.anexo.nome, tipo: m.anexo.tipo, tamanho: m.anexo.tamanho } : null,
    lidaPeloEscritorio: Boolean(m.lidaPeloEscritorio),
    lidaPeloSuporte: Boolean(m.lidaPeloSuporte),
    createdAt: m.createdAt,
  };
}

export function publicaAtendimento(a) {
  if (!a) return null;
  return {
    id: String(a._id),
    numero: a.numero,
    conta: String(a.conta),
    status: a.status,
    abertoEm: a.createdAt,
    encerradoEm: a.encerradoEm || null,
    encerradoPor: a.encerradoPor || null,
    reabertoEm: a.reabertoEm || null,
    ultimaMensagemEm: a.ultimaMensagemEm || a.createdAt,
  };
}

// ---------------------------------------------------------------- anexos
const ASSINATURAS = [
  { tipo: 'application/pdf', ext: 'pdf', confere: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
  { tipo: 'image/png', ext: 'png', confere: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { tipo: 'image/jpeg', ext: 'jpg', confere: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { tipo: 'image/gif', ext: 'gif', confere: (b) => /^GIF8[79]a/.test(b.subarray(0, 6).toString('latin1')) },
  { tipo: 'image/webp', ext: 'webp', confere: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
];

/**
 * Confere o arquivo pelo conteudo (nao confia na extensao nem no tipo informado pelo navegador).
 * @returns {{ tipo: string, nome: string, tamanho: number }}
 */
export function validarAnexo(buffer, nomeOriginal) {
  if (!buffer?.length) throw new Error('Arquivo vazio.');
  if (buffer.length > LIMITE_ANEXO) throw new Error('O arquivo pode ter no máximo 10 MB.');
  const a = ASSINATURAS.find((x) => x.confere(buffer));
  if (!a) throw new Error('Envie um PDF ou uma imagem (PNG, JPG, GIF ou WEBP).');
  let nome = String(nomeOriginal || '')
    .split(/[\\/]/)
    .pop()
    .replace(/[\u0000-\u001f\u007f"<>|*?:]/g, '')
    .trim()
    .slice(0, 120);
  if (!nome) nome = `arquivo.${a.ext}`;
  if (!new RegExp(`\\.${a.ext === 'jpg' ? 'jpe?g' : a.ext}$`, 'i').test(nome)) nome = `${nome.replace(/\.[a-z0-9]{1,5}$/i, '')}.${a.ext}`;
  return { tipo: a.tipo, nome, tamanho: buffer.length };
}

/** Anexo para download: o escritorio so ve os dele; a plataforma ve todos. */
export async function obterAnexo(id, { conta, plataforma = false } = {}) {
  if (!mongoose.isValidObjectId(id)) return null;
  const a = await ChatAnexo.findById(id);
  if (!a) return null;
  if (!plataforma && String(a.conta) !== String(conta)) return null;
  return a;
}

// ---------------------------------------------------------------- atendimentos
export function atendimentoAberto(conta) {
  return Atendimento.findOne({ conta, status: 'aberto' });
}

/** Atendimento aberto do escritorio; se nao houver, abre um novo com o proximo numero. */
export async function garantirAtendimento(conta, { por } = {}) {
  const aberto = await atendimentoAberto(conta);
  if (aberto) return aberto;
  try {
    return await Atendimento.create({ numero: await Contador.proximo('atendimento'), conta, status: 'aberto', abertoPor: por });
  } catch (err) {
    // Duas mensagens ao mesmo tempo: o outro pedido ja abriu.
    if (err.code === 11000) {
      const a = await atendimentoAberto(conta);
      if (a) return a;
    }
    throw err;
  }
}

async function mensagemSistema(atendimento, texto) {
  const m = await ChatMensagem.create({
    conta: atendimento.conta,
    atendimento: atendimento._id,
    numeroAtendimento: atendimento.numero,
    autorNome: 'Sistema',
    sistema: true,
    texto,
    lidaPeloEscritorio: true,
    lidaPeloSuporte: true,
  });
  transmitir(atendimento.conta, 'mensagem', publica(m));
}

/** Encerra o atendimento (so a plataforma): a conversa fica arquivada. */
export async function encerrarAtendimento(id, { por } = {}) {
  if (!mongoose.isValidObjectId(id)) throw new Error('Atendimento inválido.');
  const a = await Atendimento.findById(id);
  if (!a) throw new Error('Atendimento não encontrado.');
  if (a.status === 'encerrado') throw new Error(`O atendimento #${a.numero} já está encerrado.`);
  a.status = 'encerrado';
  a.encerradoEm = new Date();
  a.encerradoPor = por || 'suporte';
  await a.save();
  await mensagemSistema(a, `Atendimento #${a.numero} encerrado por ${a.encerradoPor}. A conversa foi arquivada.`);
  transmitir(a.conta, 'atendimento', publicaAtendimento(a));
  return a;
}

/**
 * Reabre um atendimento encerrado. conta: quando quem pede e o escritorio (so os dele).
 * Recusa se o escritorio ja tiver outro atendimento aberto.
 */
export async function reabrirAtendimento(id, { por, conta } = {}) {
  if (!mongoose.isValidObjectId(id)) throw new Error('Atendimento inválido.');
  const a = await Atendimento.findById(id);
  if (!a || (conta && String(a.conta) !== String(conta))) throw new Error('Atendimento não encontrado.');
  if (a.status === 'aberto') throw new Error(`O atendimento #${a.numero} já está aberto.`);
  const outro = await atendimentoAberto(a.conta);
  if (outro) throw new Error(`Já existe o atendimento #${outro.numero} aberto para este escritório. Continue nele ou encerre-o antes.`);
  a.status = 'aberto';
  a.reabertoEm = new Date();
  a.encerradoEm = undefined;
  a.encerradoPor = undefined;
  try {
    await a.save();
  } catch (err) {
    if (err.code === 11000) throw new Error('Já existe outro atendimento aberto para este escritório.');
    throw err;
  }
  await mensagemSistema(a, `Atendimento #${a.numero} reaberto por ${por || 'escritorio'}.`);
  transmitir(a.conta, 'atendimento', publicaAtendimento(a));
  return a;
}

/** Atendimentos de um escritorio (mais recentes primeiro). */
export async function listarAtendimentosDaConta(conta) {
  if (!mongoose.isValidObjectId(conta)) throw new Error('Conversa inválida.');
  const lista = await Atendimento.find({ conta }).sort({ numero: -1 }).limit(200).lean();
  return lista.map(publicaAtendimento);
}

/**
 * Atendimentos para a equipe da plataforma: status 'abertos' | 'encerrados' | 'todos',
 * busca por nome do escritorio ou numero, com nao lidas e a ultima mensagem.
 */
export async function listarAtendimentos({ status = 'abertos', q = '' } = {}) {
  const filtro = {};
  if (status === 'abertos') filtro.status = 'aberto';
  if (status === 'encerrados') filtro.status = 'encerrado';
  const busca = String(q || '').trim().replace(/^#/, '');
  if (busca) {
    if (/^\d+$/.test(busca)) filtro.numero = Number(busca);
    else {
      const rx = new RegExp(busca.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filtro.conta = { $in: (await Conta.find({ nome: rx }).select('_id').limit(200).lean()).map((c) => c._id) };
    }
  }
  const lista = await Atendimento.find(filtro).sort({ status: 1, ultimaMensagemEm: -1 }).limit(300).lean();
  const ids = lista.map((a) => a._id);
  const [contas, naoLidas, ultimas] = await Promise.all([
    Conta.find({ _id: { $in: lista.map((a) => a.conta) } }).select('nome').lean(),
    ChatMensagem.aggregate([{ $match: { atendimento: { $in: ids }, deSuporte: false, lidaPeloSuporte: false } }, { $group: { _id: '$atendimento', n: { $sum: 1 } } }]),
    ChatMensagem.aggregate([{ $match: { atendimento: { $in: ids }, sistema: { $ne: true } } }, { $sort: { createdAt: -1 } }, { $group: { _id: '$atendimento', m: { $first: '$$ROOT' } } }]),
  ]);
  const nomes = new Map(contas.map((c) => [String(c._id), c.nome]));
  const nl = new Map(naoLidas.map((x) => [String(x._id), x.n]));
  const ul = new Map(ultimas.map((x) => [String(x._id), x.m]));
  return lista.map((a) => ({
    ...publicaAtendimento(a),
    nome: nomes.get(String(a.conta)) || '(escritório removido)',
    naoLidas: nl.get(String(a._id)) || 0,
    ultima: ul.has(String(a._id)) ? publica(ul.get(String(a._id))) : null,
  }));
}

export async function obterAtendimento(id) {
  if (!mongoose.isValidObjectId(id)) return null;
  return Atendimento.findById(id);
}

// ---------------------------------------------------------------- mensagens
/**
 * Mensagens de um atendimento (mais recentes por ultimo). Sem atendimento informado: as do
 * atendimento aberto do escritorio (lista vazia se nao houver). antes = id para carregar mais antigas.
 */
export async function listarMensagens(conta, { antes, atendimento } = {}) {
  if (!mongoose.isValidObjectId(conta)) throw new Error('Conversa inválida.');
  let a;
  if (atendimento) {
    a = mongoose.isValidObjectId(atendimento) ? await Atendimento.findById(atendimento) : null;
    if (!a || String(a.conta) !== String(conta)) throw new Error('Atendimento não encontrado.');
  } else {
    a = await atendimentoAberto(conta);
  }
  if (!a) return { atendimento: null, itens: [], temMais: false };
  const filtro = { atendimento: a._id };
  if (antes && mongoose.isValidObjectId(antes)) filtro._id = { $lt: antes };
  const lista = await ChatMensagem.find(filtro).sort({ _id: -1 }).limit(POR_PAGINA).lean();
  return { atendimento: publicaAtendimento(a), itens: lista.reverse().map(publica), temMais: lista.length === POR_PAGINA };
}

// Avisos por e-mail quando ninguem do outro lado esta com o chat aberto (no maximo 1 a cada 10 min por conversa).
const ultimoAviso = new Map();
function podeAvisar(chave) {
  const agora = Date.now();
  if ((ultimoAviso.get(chave) || 0) + 10 * 60 * 1000 > agora) return false;
  ultimoAviso.set(chave, agora);
  return true;
}

async function avisarPorEmail(m, nomeEscritorio) {
  const resumo = m.texto || `[arquivo] ${m.anexo?.nome || ''}`;
  const titulo = `${m.autorNome} - atendimento #${m.numeroAtendimento}`;
  if (m.deSuporte) {
    if (escritorioOnline(m.conta) || !podeAvisar(`esc:${m.conta}`)) return;
    const para = await destinatariosDaConta(m.conta);
    if (!para.length) return;
    await enviarEmail({
      para,
      assunto: `${env.saas.nomeProduto}: nova mensagem do suporte (atendimento #${m.numeroAtendimento})`,
      html: montarHtml('Você tem uma nova mensagem do suporte', [{ titulo, itens: [resumo] }], `Responda pelo sistema, em Suporte: ${env.webUrl}`),
    });
  } else {
    if (suporteOnline() || !podeAvisar(`sup:${m.conta}`)) return;
    await enviarEmail({
      assunto: `${env.saas.nomeProduto}: mensagem de ${nomeEscritorio || 'um escritório'} (atendimento #${m.numeroAtendimento})`,
      html: montarHtml(`Nova mensagem de ${nomeEscritorio || 'um escritório'}`, [{ titulo, itens: [resumo] }], `Responda em ${env.webUrl}/plataforma/chat?conta=${m.conta}`),
    });
  }
}

/**
 * Envia uma mensagem na conversa do escritorio `conta`. deSuporte = enviada pela equipe da plataforma.
 * arquivo (opcional): { buffer, nome } de um PDF ou imagem.
 * atendimento (opcional, plataforma): responder num atendimento especifico (precisa estar aberto).
 */
export async function enviarMensagem({ conta, autor, deSuporte = false, texto, arquivo, atendimento }) {
  if (!mongoose.isValidObjectId(conta)) throw new Error('Conversa inválida.');
  const t = String(texto || '').trim();
  const anexoInfo = arquivo?.buffer ? validarAnexo(arquivo.buffer, arquivo.nome) : null;
  if (!t && !anexoInfo) throw new Error('Escreva a mensagem ou anexe um arquivo.');
  if (t.length > LIMITE_TEXTO) throw new Error(`A mensagem pode ter no máximo ${LIMITE_TEXTO} caracteres.`);
  if (!dentroDoLimite(`chat|${autor._id}`, 30, 60 * 1000)) throw new Error('Muitas mensagens em pouco tempo. Aguarde um instante.');
  const c = await Conta.findById(conta).select('nome').lean();
  if (!c) throw new Error('Escritório não encontrado.');

  let at;
  if (atendimento) {
    at = await obterAtendimento(atendimento);
    if (!at || String(at.conta) !== String(conta)) throw new Error('Atendimento não encontrado.');
    if (at.status !== 'aberto') throw new Error(`O atendimento #${at.numero} está encerrado. Reabra para responder.`);
  } else {
    at = await garantirAtendimento(conta, { por: deSuporte ? `${autor.nome} (suporte)` : autor.nome });
  }

  let anexo;
  if (anexoInfo) {
    const doc = await ChatAnexo.create({ conta, ...anexoInfo, dados: arquivo.buffer });
    anexo = { id: doc._id, ...anexoInfo };
  }
  const m = await ChatMensagem.create({
    conta,
    atendimento: at._id,
    numeroAtendimento: at.numero,
    autor: autor._id,
    autorNome: deSuporte ? `${autor.nome} (suporte)` : autor.nome,
    deSuporte,
    texto: t,
    anexo,
    lidaPeloSuporte: deSuporte,
    lidaPeloEscritorio: !deSuporte,
  });
  Atendimento.updateOne({ _id: at._id }, { ultimaMensagemEm: new Date() }).catch(() => {});
  transmitir(conta, 'mensagem', publica(m));
  avisarPorEmail(m, c.nome).catch((err) => console.error('[chat] aviso por e-mail:', err.message));
  return publica(m);
}

/** Marca como lidas as mensagens do outro lado. lado: 'escritorio' | 'suporte'. */
export async function marcarLidas(conta, lado) {
  if (!mongoose.isValidObjectId(conta)) return 0;
  const r = lado === 'suporte'
    ? await ChatMensagem.updateMany({ conta, deSuporte: false, lidaPeloSuporte: false }, { lidaPeloSuporte: true })
    : await ChatMensagem.updateMany({ conta, deSuporte: true, lidaPeloEscritorio: false }, { lidaPeloEscritorio: true });
  if (r.modifiedCount) transmitir(conta, 'lidas', { conta: String(conta), lado });
  return r.modifiedCount || 0;
}

/** Quantas mensagens o lado ainda nao leu. */
export function naoLidasEscritorio(conta) {
  return ChatMensagem.countDocuments({ conta, deSuporte: true, lidaPeloEscritorio: false });
}
export function naoLidasSuporte() {
  return ChatMensagem.countDocuments({ deSuporte: false, lidaPeloSuporte: false });
}

/** Compatibilidade: conversas por escritorio (painel antigo) = atendimentos abertos e encerrados. */
export async function listarConversas() {
  const lista = await listarAtendimentos({ status: 'todos' });
  const porConta = new Map();
  for (const a of lista) if (!porConta.has(a.conta) || a.status === 'aberto') porConta.set(a.conta, a);
  return [...porConta.values()].map((a) => ({ conta: a.conta, nome: a.nome, status: null, naoLidas: a.naoLidas, ultima: a.ultima, numero: a.numero, situacao: a.status }));
}

export async function nomeDoEscritorio(conta) {
  if (!mongoose.isValidObjectId(conta)) return null;
  return (await Conta.findById(conta).select('nome').lean())?.nome || null;
}

/**
 * Migracao: mensagens antigas (sem atendimento) viram um atendimento aberto por escritorio.
 * Roda ao iniciar; so faz algo uma vez.
 */
export async function migrarAtendimentos() {
  const contas = await ChatMensagem.distinct('conta', { atendimento: null });
  for (const conta of contas) {
    const a = await garantirAtendimento(conta, { por: 'migracao' });
    await ChatMensagem.updateMany({ conta, atendimento: null }, { $set: { atendimento: a._id, numeroAtendimento: a.numero } });
  }
  if (contas.length) console.log(`[chat] ${contas.length} conversa(s) antiga(s) viraram atendimentos numerados.`);
  return contas.length;
}
