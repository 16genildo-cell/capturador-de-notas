import { env } from './env.js';

/**
 * Planos do SaaS para escritorios de contabilidade.
 *
 * Os planos ficam no banco (colecao "planos") e sao criados/editados pelo dono da
 * plataforma em Plataforma > Planos. Aqui ficam:
 *  - o catalogo de FUNCIONALIDADES que um plano pode liberar;
 *  - os PERIODOS de cobranca (15 dias, mensal, trimestral, anual...);
 *  - o cache em memoria dos planos (PLANOS / LISTA_PLANOS), lido do banco ao iniciar
 *    e atualizado a cada alteracao (o servidor roda com 1 instancia, ver render.yaml);
 *  - os planos padrao, gravados no banco na primeira vez (mesmos ids de antes:
 *    basico, profissional, escritorio), para nao afetar as contas existentes.
 */

// ---------------------------------------------------------------- funcionalidades
export const FUNCIONALIDADES = [
  { id: 'captura_nfe', nome: 'Captura de NF-e e NFC-e', grupo: 'Captura' },
  { id: 'captura_nfse', nome: 'Captura de NFS-e', grupo: 'Captura' },
  { id: 'captura_cte', nome: 'Captura de CT-e', grupo: 'Captura' },
  { id: 'captura_automatica', nome: 'Captura automática agendada', grupo: 'Captura' },
  { id: 'manifestacao', nome: 'Ciência e manifestação do destinatário', grupo: 'Notas' },
  { id: 'download_lote', nome: 'Download em lote (ZIP) e exportação', grupo: 'Notas' },
  { id: 'relatorios', nome: 'Relatórios e planilha Excel', grupo: 'Notas' },
  { id: 'importar_xml', nome: 'Importação de XML', grupo: 'Notas' },
  { id: 'emissao_nfse', nome: 'Emissão de NFS-e', grupo: 'Emissão' },
  { id: 'emissao_nfe', nome: 'Emissão de NF-e e NFC-e', grupo: 'Emissão' },
  { id: 'acesso_clientes', nome: 'Acesso de consulta para os clientes do escritório', grupo: 'Escritório' },
  { id: 'alertas', nome: 'Alertas por e-mail e no celular', grupo: 'Escritório' },
  { id: 'chat_suporte', nome: 'Chat com o suporte', grupo: 'Escritório' },
];
export const TODAS_FUNCIONALIDADES = FUNCIONALIDADES.map((f) => f.id);
const NOME_FUNCIONALIDADE = Object.fromEntries(FUNCIONALIDADES.map((f) => [f.id, f.nome]));
export const nomeFuncionalidade = (id) => NOME_FUNCIONALIDADE[id] || id;

/** Mantem so ids conhecidos, sem repetir, na ordem do catalogo. */
export function normalizarFuncionalidades(lista) {
  const marcadas = new Set([].concat(lista || []).map(String));
  return TODAS_FUNCIONALIDADES.filter((id) => marcadas.has(id));
}

// ---------------------------------------------------------------- periodos
/** Periodos prontos (o dono da plataforma tambem pode informar um personalizado). */
export const PERIODOS = [
  { id: '15dias', nome: '15 dias', quantidade: 15, unidade: 'dia' },
  { id: 'mensal', nome: 'Mensal', quantidade: 1, unidade: 'mes' },
  { id: 'bimestral', nome: 'Bimestral', quantidade: 2, unidade: 'mes' },
  { id: 'trimestral', nome: 'Trimestral', quantidade: 3, unidade: 'mes' },
  { id: 'semestral', nome: 'Semestral', quantidade: 6, unidade: 'mes' },
  { id: 'anual', nome: 'Anual', quantidade: 12, unidade: 'mes' },
];

/** Valida um periodo { quantidade, unidade: 'dia' | 'mes' } (ou o id de um periodo pronto). */
export function normalizarPeriodo(p) {
  if (typeof p === 'string') {
    const pronto = PERIODOS.find((x) => x.id === p);
    if (!pronto) throw new Error('Período inválido.');
    return { quantidade: pronto.quantidade, unidade: pronto.unidade };
  }
  const unidade = p?.unidade === 'dia' ? 'dia' : p?.unidade === 'mes' ? 'mes' : null;
  const quantidade = Math.floor(Number(p?.quantidade));
  if (!unidade || !Number.isFinite(quantidade) || quantidade < 1) throw new Error('Informe o período do plano (quantidade e dias/meses).');
  if ((unidade === 'dia' && quantidade > 3650) || (unidade === 'mes' && quantidade > 120)) throw new Error('Período longo demais.');
  return { quantidade, unidade };
}

/** "Mensal", "Trimestral", "15 dias", "A cada 45 dias", "A cada 4 meses". */
export function rotuloPeriodo(p) {
  if (!p) return 'Mensal';
  const pronto = PERIODOS.find((x) => x.quantidade === p.quantidade && x.unidade === p.unidade);
  if (pronto) return pronto.nome;
  if (p.unidade === 'dia') return `A cada ${p.quantidade} dias`;
  return `A cada ${p.quantidade} meses`;
}

/** Duracao do periodo em meses (para estimar a receita mensal). */
export function mesesDoPeriodo(p) {
  if (!p) return 1;
  return p.unidade === 'mes' ? p.quantidade : p.quantidade / 30;
}

/** Soma um periodo a uma data. Meses respeitam o fim do mes (31/01 + 1 mes = 28/02). */
export function somarPeriodo(data, p) {
  const base = new Date(data);
  const per = p || { quantidade: 1, unidade: 'mes' };
  if (per.unidade === 'dia') return new Date(base.getTime() + per.quantidade * 864e5);
  const r = new Date(base);
  const dia = r.getDate();
  r.setDate(1);
  r.setMonth(r.getMonth() + per.quantidade);
  const ultimo = new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate();
  r.setDate(Math.min(dia, ultimo));
  return r;
}

// ---------------------------------------------------------------- armazenamento das notas
/**
 * Por quanto tempo o XML das notas capturadas fica guardado no sistema.
 *  - dias: apaga N dias depois de capturado (null = guarda sempre)
 *  - apagarAoBaixar: apaga depois que o escritorio baixa o XML (com uma margem de 1 hora)
 * Os dois podem valer juntos: apaga no que acontecer primeiro.
 * Os dados basicos da nota (chave, numero, emitente, valor, data) continuam no sistema
 * para nao baixar a mesma nota de novo e para controlar prazos.
 */
export function rotuloArmazenamento(a) {
  const dias = a?.dias ?? null;
  if (dias == null && !a?.apagarAoBaixar) return 'Guarda as notas sempre';
  if (dias == null) return 'Apaga o arquivo quando o escritório baixar';
  if (!a?.apagarAoBaixar) return `Guarda o arquivo por ${dias} dia(s)`;
  return `Apaga ao baixar ou após ${dias} dia(s)`;
}

// ---------------------------------------------------------------- planos (cache)
/** Converte o documento do banco no formato usado pelo sistema e pelas telas. */
export function planoParaCache(doc) {
  const d = doc?.toObject ? doc.toObject() : doc;
  const armazenamento = { dias: d.retencaoDias ?? null, apagarAoBaixar: Boolean(d.apagarAoBaixar) };
  const periodo = d.periodo?.unidade ? { quantidade: d.periodo.quantidade, unidade: d.periodo.unidade } : { quantidade: 1, unidade: 'mes' };
  return {
    id: String(d._id ?? d.id),
    nome: d.nome,
    descricao: d.descricao || '',
    preco: Number(d.preco || 0),
    periodo,
    rotuloPeriodo: rotuloPeriodo(periodo),
    // null = ilimitado
    empresas: d.limiteEmpresas ?? null,
    usuarios: d.limiteUsuarios ?? null,
    diasGratis: Number(d.diasGratis || 0),
    funcionalidades: normalizarFuncionalidades(d.funcionalidades),
    armazenamento,
    rotuloArmazenamento: rotuloArmazenamento(armazenamento),
    ativo: d.ativo !== false,
    publico: d.publico !== false,
    destaque: Boolean(d.destaque),
    ordem: Number(d.ordem || 0),
  };
}

/** Planos que existiam fixos no codigo: viram os primeiros planos do banco. */
function padrao(id, nome, empresas, preco, destaque, descricao, ordem) {
  const ID = id.toUpperCase();
  return {
    _id: id,
    nome,
    descricao,
    preco: Number(process.env[`PLANO_${ID}_PRECO`] || preco),
    periodo: { quantidade: 1, unidade: 'mes' },
    limiteEmpresas: Number(process.env[`PLANO_${ID}_EMPRESAS`] || empresas),
    limiteUsuarios: null,
    diasGratis: env.saas.trialDias,
    funcionalidades: TODAS_FUNCIONALIDADES,
    retencaoDias: null,
    apagarAoBaixar: false,
    ativo: true,
    publico: true,
    destaque,
    ordem,
  };
}
export const PLANOS_PADRAO = [
  padrao('basico', 'Inicial', 3, 79.9, false, 'Para o contador autonomo ou o escritório que está começando.', 1),
  padrao('profissional', 'Profissional', 15, 199.9, true, 'Para escritórios de contabilidade em crescimento.', 2),
  padrao('escritorio', 'Avançado', 50, 449.9, false, 'Para escritórios com uma carteira grande de clientes.', 3),
];

/**
 * PLANOS (por id) e LISTA_PLANOS (ordenada) sao objetos "vivos": o conteudo e trocado
 * em aplicarPlanos(), entao quem os importou sempre ve a versao atual.
 * Comecam com os planos padrao (ate o banco ser lido).
 */
export const PLANOS = {};
export const LISTA_PLANOS = [];

export function aplicarPlanos(docs) {
  const lista = docs.map(planoParaCache).sort((a, b) => a.ordem - b.ordem || a.preco - b.preco || a.nome.localeCompare(b.nome));
  for (const k of Object.keys(PLANOS)) delete PLANOS[k];
  for (const p of lista) PLANOS[p.id] = p;
  LISTA_PLANOS.splice(0, LISTA_PLANOS.length, ...lista);
  return lista;
}
aplicarPlanos(PLANOS_PADRAO);

/** Planos que aparecem no site (ativos e marcados como publicos). */
export const planosPublicos = () => LISTA_PLANOS.filter((p) => p.ativo && p.publico);

/** Teste gratis padrao (conta sem plano): dias e quantas empresas pode cadastrar. */
export const TESTE = {
  dias: env.saas.trialDias,
  empresas: Number(process.env.TESTE_EMPRESAS || 3),
};

export function planoPorId(id) {
  return (id && PLANOS[id]) || null;
}

export const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
