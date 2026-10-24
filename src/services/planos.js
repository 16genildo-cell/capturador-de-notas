import { Plano } from '../models/Plano.js';
import { Conta } from '../models/Conta.js';
import {
  PLANOS, LISTA_PLANOS, PLANOS_PADRAO, aplicarPlanos, normalizarPeriodo, normalizarFuncionalidades, planoParaCache,
} from '../config/planos.js';

/**
 * Cadastro de planos pelo dono da plataforma.
 * Toda alteracao grava no banco e recarrega o cache em memoria (PLANOS / LISTA_PLANOS).
 */

/** Le os planos do banco para o cache. Chamado ao iniciar e depois de cada alteracao. */
export async function carregarPlanos() {
  const docs = await Plano.find({}).lean();
  aplicarPlanos(docs);
  return LISTA_PLANOS;
}

/** Primeira execucao: grava os planos que antes eram fixos no codigo (mesmos ids). */
export async function garantirPlanosPadrao() {
  if (await Plano.estimatedDocumentCount()) return 0;
  await Plano.insertMany(PLANOS_PADRAO, { ordered: false }).catch((err) => {
    if (err.code !== 11000) throw err;
  });
  console.log(`[planos] ${PLANOS_PADRAO.length} plano(s) padrão criado(s).`);
  return PLANOS_PADRAO.length;
}

/** "Plano Anual Plus!" -> "plano-anual-plus" */
export function codigoDoNome(nome) {
  return String(nome || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'plano';
}

const numeroOuNulo = (v, { min = 0, nome }) => {
  const t = String(v ?? '').trim();
  if (t === '' || t === 'null') return null;
  const n = Math.floor(Number(t));
  if (!Number.isFinite(n) || n < min) throw new Error(`${nome}: informe um número a partir de ${min} (ou deixe em branco para ilimitado).`);
  return n;
};

/** Valida o formulario de plano. Lanca erro com mensagem amigavel. */
export function lerDadosPlano(b = {}) {
  const nome = String(b.nome || '').trim();
  if (!nome) throw new Error('Informe o nome do plano.');
  if (nome.length > 60) throw new Error('Nome do plano muito longo (máximo 60 caracteres).');
  const preco = Number(String(b.preco ?? '0').replace(',', '.'));
  if (!Number.isFinite(preco) || preco < 0) throw new Error('Preço inválido.');
  const diasGratis = Math.floor(Number(b.diasGratis || 0));
  if (!Number.isFinite(diasGratis) || diasGratis < 0 || diasGratis > 365) throw new Error('Período grátis: de 0 a 365 dias.');
  const funcionalidades = normalizarFuncionalidades(b.funcionalidades);
  const retencaoDias = numeroOuNulo(b.retencaoDias, { min: 1, nome: 'Dias que o arquivo fica guardado' });
  if (retencaoDias != null && retencaoDias > 3650) throw new Error('Dias que o arquivo fica guardado: máximo 3650.');
  if (!funcionalidades.length) throw new Error('Marque ao menos uma funcionalidade do plano.');
  return {
    nome,
    descricao: String(b.descricao || '').trim().slice(0, 300),
    preco: Math.round(preco * 100) / 100,
    periodo: normalizarPeriodo(b.periodo),
    limiteEmpresas: numeroOuNulo(b.limiteEmpresas, { min: 0, nome: 'Limite de CNPJs' }),
    limiteUsuarios: numeroOuNulo(b.limiteUsuarios, { min: 1, nome: 'Limite de usuários' }),
    diasGratis,
    funcionalidades,
    retencaoDias,
    apagarAoBaixar: b.apagarAoBaixar === true || b.apagarAoBaixar === 'true' || b.apagarAoBaixar === 'on',
    ativo: b.ativo !== false && b.ativo !== 'false',
    publico: b.publico !== false && b.publico !== 'false',
    destaque: b.destaque === true || b.destaque === 'true' || b.destaque === 'on',
    ordem: Math.floor(Number(b.ordem || 0)) || 0,
  };
}

/** Planos com quantos escritorios usam cada um (painel da plataforma). */
export async function listarPlanosAdmin() {
  const uso = await Conta.aggregate([{ $match: { plano: { $ne: null } } }, { $group: { _id: '$plano', n: { $sum: 1 } } }]);
  const porPlano = new Map(uso.map((u) => [String(u._id), u.n]));
  return LISTA_PLANOS.map((p) => ({ ...p, escritorios: porPlano.get(p.id) || 0 }));
}

/** Cria um plano novo. O codigo vem do nome (com sufixo se ja existir). */
export async function criarPlano(b) {
  const dados = lerDadosPlano(b);
  const base = codigoDoNome(b.codigo || dados.nome);
  let id = base;
  for (let i = 2; await Plano.exists({ _id: id }); i += 1) id = `${base}-${i}`;
  const doc = await Plano.create({ _id: id, ...dados });
  await carregarPlanos();
  return planoParaCache(doc);
}

/** Edita um plano. Vale na hora para todos os escritorios que usam o plano. */
export async function editarPlano(id, b) {
  const doc = await Plano.findById(String(id));
  if (!doc) throw new Error('Plano não encontrado.');
  doc.set(lerDadosPlano(b));
  await doc.save();
  await carregarPlanos();
  return planoParaCache(doc);
}

/**
 * Exclui um plano que nenhum escritorio usa. Em uso: so pode ser arquivado
 * (ativo = false), para nao deixar contas sem as regras do plano.
 */
export async function excluirPlano(id) {
  const doc = await Plano.findById(String(id));
  if (!doc) throw new Error('Plano não encontrado.');
  const emUso = await Conta.countDocuments({ plano: doc._id });
  if (emUso) throw new Error(`${emUso} escritório(s) usam este plano. Troque o plano deles antes de excluir, ou arquive o plano (desmarque "Disponível").`);
  await Plano.deleteOne({ _id: doc._id });
  await carregarPlanos();
}

export { PLANOS };
