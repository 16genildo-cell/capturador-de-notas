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
  {
    id: 'captura_nfe',
    nome: 'Captura de NF-e e NFC-e',
    grupo: 'Captura',
    icone: 'produtos',
    descricao: 'Busca automática na SEFAZ por NSU de todas as notas fiscais de entrada (mercadorias) e resumos com certificado A1.',
  },
  {
    id: 'captura_nfse',
    nome: 'Captura de NFS-e',
    grupo: 'Captura',
    icone: 'servicos',
    descricao: 'Coleta de notas de serviços tomados e prestados no Ambiente Nacional (ADN) e integração com provedores municipais.',
  },
  {
    id: 'captura_cte',
    nome: 'Captura de CT-e',
    grupo: 'Captura',
    icone: 'cte',
    descricao: 'Download automático de Conhecimentos de Transporte Eletrônico onde os clientes figuram como tomadores ou destinatários.',
  },
  {
    id: 'manifestacao',
    nome: 'Ciência e Manifestação',
    grupo: 'Notas',
    icone: 'notas',
    descricao: 'Ciência da emissão (libera o XML completo), confirmação da operação, desconhecimento e controle do prazo legal de 180 dias.',
  },
  {
    id: 'download_lote',
    nome: 'Download em lote (ZIP)',
    grupo: 'Notas',
    icone: 'importar',
    descricao: 'Exportação em massa de XMLs completos e DANFEs em PDF organizados por pastas de clientes, período e modelos.',
  },
  {
    id: 'relatorios',
    nome: 'Relatórios e Excel',
    grupo: 'Relatórios',
    icone: 'relatorios',
    descricao: 'Painéis consolidados de entradas, saídas, faturamento, filtros avançados por CFOP, NCM e download completo em Excel.',
  },
  {
    id: 'importar_xml',
    nome: 'Importação manual de XML',
    grupo: 'Notas',
    icone: 'importar',
    descricao: 'Upload individual ou em lote (arquivos ZIP) para importar notas de venda emitidas externamente e históricos fiscais antigos.',
  },
  {
    id: 'auditoria_fiscal',
    nome: 'Auditoria Fiscal Preventiva',
    grupo: 'Auditoria',
    icone: 'painel',
    descricao: 'Malha fina preventiva com score de risco, detecção de divergências tributárias (ICMS-ST, Simples Nacional) e notas frias.',
  },
  {
    id: 'dre_gerencial',
    nome: 'DRE Gerencial e Margens',
    grupo: 'Relatórios',
    icone: 'relatorios',
    descricao: 'Demonstração de Resultado do Exercício com cálculo automático de receita bruta, impostos dedutíveis, CMV e margem de lucro.',
  },
  {
    id: 'exportacao_sistemas',
    nome: 'Exportação Contábil',
    grupo: 'Notas',
    icone: 'tarefas',
    descricao: 'Geração e exportação direta de lotes de notas nos formatos dos principais ERPs: Domínio Sistemas, Questor e Alterdata.',
  },
  {
    id: 'emissao_nfe',
    nome: 'Emissão de Cupom e NF-e',
    grupo: 'Emissão',
    icone: 'produtos',
    descricao: 'Frente de Caixa (PDV) com emissão de Cupom Fiscal Eletrônico (NFC-e mod. 65) com QR Code e Nota Fiscal Eletrônica (NF-e mod. 55).',
  },
  {
    id: 'emissao_nfse',
    nome: 'Emissão de NFS-e Nacional',
    grupo: 'Emissão',
    icone: 'servicos',
    descricao: 'Módulo simplificado para prestadores de serviço emitirem NFS-e no padrão nacional de forma rápida com um clique.',
  },
  {
    id: 'controle_estoque',
    nome: 'Controle de Estoque no PDV',
    grupo: 'Emissão',
    icone: 'produtos',
    descricao: 'Baixa imediata de produtos no momento da venda no balcão, histórico de movimentações, reposição e inventário de mercadorias.',
  },
  {
    id: 'solicitacoes_documentos',
    nome: 'Tarefas e Solicitação de Docs',
    grupo: 'Escritório',
    icone: 'tarefas',
    descricao: 'Central de comunicação para o escritório solicitar extratos e guias para os clientes, com controle de status e prazos.',
  },
  {
    id: 'monitor_cnd',
    nome: 'Monitor de Certidões (CND)',
    grupo: 'Escritório',
    icone: 'certidoes',
    descricao: 'Consulta e renovação automática de Certidões Negativas de Débito (Federal RFB/PGFN, FGTS Caixa e CNDT Trabalhista).',
  },
  {
    id: 'acesso_clientes',
    nome: 'Portal do Cliente do Escritório',
    grupo: 'Escritório',
    icone: 'clientes',
    descricao: 'Permite cadastrar acessos exclusivos para que os empresários consultem e baixem apenas os documentos das suas próprias empresas.',
  },
  {
    id: 'alertas',
    nome: 'Alertas por e-mail e push',
    grupo: 'Escritório',
    icone: 'sino',
    descricao: 'Notificações automáticas para a equipe contábil quando novas notas chegam ou quando o certificado digital A1 está próximo do vencimento.',
  },
  {
    id: 'chat_suporte',
    nome: 'Chat com o suporte',
    grupo: 'Escritório',
    icone: 'suporte',
    descricao: 'Canal de atendimento via chat em tempo real entre os escritórios de contabilidade e a equipe gestora da plataforma.',
  },
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
