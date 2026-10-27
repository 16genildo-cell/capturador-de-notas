import { Router } from 'express';
import mongoose from 'mongoose';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { escopo, escopoDaEmpresa, restricaoEmpresas } from '../middleware/escopoEmpresa.js';
import { Empresa } from '../models/Empresa.js';
import { EmissaoNfe } from '../models/EmissaoNfe.js';
import { ProdutoNfe } from '../models/ProdutoNfe.js';
import { MovimentacaoEstoque } from '../models/MovimentacaoEstoque.js';
import { NotaFiscal } from '../models/NotaFiscal.js';
import { xmlToObj } from '../services/sefaz/parseDocumento.js';
import { enviarEmail } from '../services/email.js';
import { emitirNfe, cancelarNfe, cartaCorrecao, reconsultarNfe, statusServico, sincronizarContingencias } from '../services/nfe/emissao.js';
import { FORMAS_PAGAMENTO, CSOSN, PRESENCA, numeroBr } from '../services/nfe/xml.js';
import { gerarDanfe } from '../services/pdf/danfe.js';
import { gerarDanfeNfce } from '../services/pdf/danfeNfce.js';
import { soDigitos } from '../utils/documento.js';

/**
 * Emissao de NF-e (venda para empresa/CNPJ) e NFC-e (consumidor final / cupom),
 * cadastro de produtos e configuracao por empresa.
 */
const router = Router();
router.use(requireAuth);

const CRT = { 1: 'Simples Nacional', 4: 'MEI (Simples Nacional)' };
const ORIGENS = {
  0: '0 - Nacional',
  1: '1 - Estrangeira (importacao direta)',
  2: '2 - Estrangeira (adquirida no mercado interno)',
  3: '3 - Nacional, conteudo de importacao > 40%',
  4: '4 - Nacional, processos produtivos basicos',
  5: '5 - Nacional, conteudo de importacao <= 40%',
  6: '6 - Estrangeira sem similar (CAMEX)',
  7: '7 - Estrangeira mercado interno sem similar',
  8: '8 - Nacional, conteudo de importacao > 70%',
};
const CFOPS = {
  5102: '5102 - Venda de mercadoria adquirida de terceiros (revenda)',
  5101: '5101 - Venda de producao propria',
  5405: '5405 - Revenda com ICMS ja retido por substituicao tributaria',
  5103: '5103 - Venda de producao propria fora do estabelecimento',
  5104: '5104 - Venda de mercadoria de terceiros fora do estabelecimento',
  5115: '5115 - Venda de mercadoria recebida em consignacao mercantil',
  5933: '5933 - Prestacao de servico tributado pelo ISSQN',
};
const CONSTANTES = { CRT, ORIGENS, CFOPS, CSOSN, FORMAS_PAGAMENTO, PRESENCA };

const hoje = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

async function empresaDaConta(req, id) {
  if (!mongoose.isValidObjectId(id)) return null;
  if (req.empresaEscopo && String(id) !== String(req.empresaEscopo._id)) return null;
  return Empresa.findOne({ _id: id, owner: req.conta, ...restricaoEmpresas(req, '_id') });
}

/** Empresa escolhida na tela (pagina da empresa, ?empresa= ou a primeira habilitada). */
async function escolherEmpresa(req, { soHabilitadas = false } = {}) {
  const empresas = await Empresa.find({ owner: req.conta, ...escopoDaEmpresa(req) })
    .select('razaoSocial cnpj uf emissaoNfe inscricaoEstadual municipioCodigo municipioNome endereco certificado')
    .sort('razaoSocial')
    .lean();
  const habilitadas = empresas.filter((e) => e.emissaoNfe?.ativa);
  const base = soHabilitadas ? habilitadas : empresas;
  const sel = base.find((e) => String(e._id) === String(req.query.empresa || req.body?.empresa)) || habilitadas[0] || base[0] || null;
  return { empresas, habilitadas, sel };
}

/** Formulario da venda -> entrada da emissao. */
function entradaDoFormulario(b) {
  const itens = Object.values(b.itens || {})
    .filter((i) => i && mongoose.isValidObjectId(i.produtoId))
    .map((i) => ({ produtoId: i.produtoId, quantidade: i.quantidade, valorUnitario: i.valorUnitario, desconto: i.desconto }));
  return {
    modelo: b.modelo === '55' ? '55' : '65',
    dest: {
      documento: b.destDocumento,
      nome: b.destNome,
      ie: b.destIE,
      indIEDest: b.destIndIEDest,
      email: b.destEmail,
      fone: b.destFone,
      cep: b.destCep,
      logradouro: b.destLogradouro,
      numero: b.destNumero,
      complemento: b.destComplemento,
      bairro: b.destBairro,
      cMun: b.destCMun,
      cidade: b.destCidade,
      uf: b.destUf,
    },
    itens,
    pagamento: { tPag: b.tPag, valorRecebido: b.valorRecebido },
    presenca: b.presenca,
    consumidorFinal: b.consumidorFinal === 'on',
    infComplementar: b.infComplementar,
    contingencia: b.contingencia === 'on' || b.contingencia === '1' || b.contingencia === true,
    xJustCont: b.xJustCont,
  };
}

// ------------------------------------------------------------------ venda

router.get('/', async (req, res) => {
  const { empresas, habilitadas, sel } = await escolherEmpresa(req, { soHabilitadas: true });
  const [produtos, historico] = await Promise.all([
    sel?.emissaoNfe?.ativa
      ? ProdutoNfe.find({ owner: req.conta, empresa: sel._id, ativo: true }).select('codigo descricao preco unidade gtin totalVendido').sort('-totalVendido descricao').lean()
      : [],
    EmissaoNfe.find({ owner: req.conta, ...(sel ? { empresa: sel._id } : escopo(req)) })
      .select('modelo ambiente serie numero status destNome valor createdAt cStat xMotivo')
      .sort('-createdAt')
      .limit(50)
      .lean(),
  ]);
  // "Emitir outra igual"
  let anterior = null;
  if (mongoose.isValidObjectId(req.query.de)) {
    anterior = await EmissaoNfe.findOne({ _id: req.query.de, owner: req.conta, ...escopo(req) }).select('dados').lean();
  }
  const form = req.session.formVenda || anterior?.dados || null;
  delete req.session.formVenda;
  res.render('vendas/index', {
    title: 'Emitir NF-e / NFC-e',
    empresas,
    habilitadas,
    empresaSel: sel,
    produtos,
    historico,
    form,
    modelo: form?.modelo || (req.query.modelo === '55' ? '55' : '65'),
    ...CONSTANTES,
  });
});

// Status do web service da SEFAZ em tempo real
router.get('/status-sefaz', async (req, res) => {
  try {
    const { empresa: empresaId, modelo = '65' } = req.query;
    const empresa = await empresaDaConta(req, empresaId);
    if (!empresa) return res.json({ ok: false, xMotivo: 'Empresa não encontrada ou não informada.' });
    const r = await statusServico(empresa._id, modelo === '55' ? '55' : '65');
    res.json(r);
  } catch (err) {
    res.json({ ok: false, xMotivo: err.message });
  }
});

router.post('/', async (req, res) => {
  const b = req.body;
  try {
    const empresa = await empresaDaConta(req, b.empresa);
    if (!empresa) throw new Error('Selecione a empresa.');
    const emissao = await emitirNfe(empresa._id, entradaDoFormulario(b), { usuarioId: req.user._id });
    const nome = emissao.modelo === '65' ? 'NFC-e' : 'NF-e';
    const teste = emissao.ambiente === 'homologacao' ? ' em HOMOLOGACAO (teste, sem valor fiscal)' : '';
    req.session.flash = {
      autorizada: { type: 'ok', msg: `${nome} n ${emissao.numero} autorizada${teste}.` },
      rejeitada: { type: 'erro', msg: `A SEFAZ rejeitou a ${nome}: ${emissao.cStat} - ${emissao.xMotivo}` },
      denegada: { type: 'erro', msg: `${nome} DENEGADA pela SEFAZ: ${emissao.xMotivo}` },
      sem_resposta: { type: 'erro', msg: `Sem resposta da SEFAZ. Use "Consultar na SEFAZ" em instantes para saber se a ${nome} foi autorizada.` },
    }[emissao.status];
    if (emissao.status === 'rejeitada') req.session.formVenda = { ...entradaDoFormulario(b), empresa: String(empresa._id) };
    res.redirect(`${req.base}/vendas/${emissao._id}`);
  } catch (err) {
    req.session.flash = { type: 'erro', msg: err.lista ? err.lista.join(' ') : err.message };
    req.session.formVenda = { ...entradaDoFormulario(b), empresa: b.empresa };
    res.redirect(`${req.base}/vendas?${new URLSearchParams({ empresa: b.empresa || '', modelo: b.modelo || '65' })}`);
  }
});

// ------------------------------------------------------------------ configuracao

router.get('/configurar/:empresaId', requireAdmin, async (req, res) => {
  const empresa = await empresaDaConta(req, req.params.empresaId);
  if (!empresa) return res.redirect(`${req.base}/vendas`);
  const e = empresa.toObject();
  res.render('vendas/configurar', { title: `NF-e / NFC-e - ${e.razaoSocial}`, empresa: e, cfg: e.emissaoNfe || {}, teste: null, ...CONSTANTES });
});

router.post('/configurar/:empresaId', requireAdmin, async (req, res) => {
  const empresa = await empresaDaConta(req, req.params.empresaId);
  if (!empresa) return res.redirect(`${req.base}/vendas`);
  const b = req.body;
  try {
    const ambiente = b.ambiente === 'producao' ? 'producao' : 'homologacao';
    const num = (v) => {
      const n = Number(soDigitos(v));
      return Number.isFinite(n) ? n : 0;
    };
    const serie = (v) => {
      const n = Number(soDigitos(v) || 1);
      if (!(n >= 0 && n <= 889)) throw new Error('Serie invalida: use de 0 a 889.');
      return String(n);
    };
    const pCredSN = numeroBr(b.pCredSN) || 0;
    if (Number.isNaN(pCredSN) || pCredSN < 0 || pCredSN > 100) throw new Error('Aliquota de credito do Simples invalida.');
    const atual = empresa.emissaoNfe?.toObject?.() || {};
    const numeracao = { ...(atual.numeracao || {}) };
    for (const amb of ['producao', 'homologacao']) {
      const sufixo = amb === 'producao' ? 'Producao' : 'Homologacao';
      numeracao[amb] = { ...(numeracao[amb] || {}), 55: num(b[`ultimoNfe${sufixo}`]), 65: num(b[`ultimoNfce${sufixo}`]) };
    }

    empresa.inscricaoEstadual = soDigitos(b.inscricaoEstadual) || empresa.inscricaoEstadual;
    if (soDigitos(b.municipioCodigo)) empresa.municipioCodigo = soDigitos(b.municipioCodigo);
    if (b.municipioNome) empresa.municipioNome = String(b.municipioNome).trim();
    empresa.endereco = {
      logradouro: String(b.logradouro || '').trim(),
      numero: String(b.numero || '').trim(),
      complemento: String(b.complemento || '').trim(),
      bairro: String(b.bairro || '').trim(),
      cep: soDigitos(b.cep),
      fone: soDigitos(b.fone),
    };
    empresa.emissaoNfe = {
      ...atual,
      ativa: b.ativa === 'on',
      ambiente,
      crt: ['1', '4'].includes(b.crt) ? b.crt : '1',
      serieNfe: serie(b.serieNfe),
      serieNfce: serie(b.serieNfce),
      numeracao,
      naturezaOperacao: String(b.naturezaOperacao || 'Venda de mercadoria').trim(),
      pCredSN,
      cstPisCofins: ['49', '99', '07', '08'].includes(b.cstPisCofins) ? b.cstPisCofins : '49',
      csc: {
        producao: { id: soDigitos(b.cscIdProducao), token: String(b.cscProducao || '').trim() || atual.csc?.producao?.token || '' },
        homologacao: { id: soDigitos(b.cscIdHomologacao), token: String(b.cscHomologacao || '').trim() || atual.csc?.homologacao?.token || '' },
      },
      versaoQrCode: ['2', '3'].includes(b.versaoQrCode) ? b.versaoQrCode : '',
      respTec: { cnpj: soDigitos(b.respCnpj), contato: String(b.respContato || '').trim(), email: String(b.respEmail || '').trim(), fone: soDigitos(b.respFone) },
      infComplementarPadrao: String(b.infComplementarPadrao || '').trim(),
    };
    empresa.markModified('emissaoNfe');
    await empresa.save();
    req.session.flash = { type: 'ok', msg: 'Configuracao de NF-e / NFC-e salva.' };
    res.redirect(`${req.base}/vendas/configurar/${empresa._id}`);
  } catch (err) {
    req.session.flash = { type: 'erro', msg: err.message };
    res.redirect(`${req.base}/vendas/configurar/${empresa._id}`);
  }
});

// Testa a comunicacao com a SEFAZ (status do servico) para NF-e e NFC-e
router.post('/configurar/:empresaId/testar', requireAdmin, async (req, res) => {
  const empresa = await empresaDaConta(req, req.params.empresaId);
  if (!empresa) return res.redirect(`${req.base}/vendas`);
  const teste = {};
  for (const modelo of ['55', '65']) {
    try {
      teste[modelo] = await statusServico(empresa._id, modelo);
    } catch (err) {
      teste[modelo] = { ok: false, xMotivo: err.message };
    }
  }
  const e = empresa.toObject();
  res.render('vendas/configurar', { title: `NF-e / NFC-e - ${e.razaoSocial}`, empresa: e, cfg: e.emissaoNfe || {}, teste, ...CONSTANTES });
});

// ------------------------------------------------------------------ produtos

router.get('/produtos', async (req, res) => {
  const { empresas, sel } = await escolherEmpresa(req);
  const produtos = sel ? await ProdutoNfe.find({ owner: req.conta, empresa: sel._id }).sort('descricao').lean() : [];
  res.render('vendas/produtos', { title: 'Produtos', empresas, empresaSel: sel, produtos, ...CONSTANTES });
});

function produtoDoFormulario(b) {
  const preco = numeroBr(b.preco);
  const pTotTrib = numeroBr(b.pTotTrib) || 0;
  const estoque = numeroBr(b.estoque) || 0;
  const estoqueMinimo = numeroBr(b.estoqueMinimo) || 0;
  return {
    codigo: String(b.codigo || '').trim(),
    descricao: String(b.descricao || '').trim(),
    gtin: soDigitos(b.gtin),
    ncm: soDigitos(b.ncm),
    cest: soDigitos(b.cest),
    unidade: String(b.unidade || 'UN').trim().toUpperCase() || 'UN',
    preco,
    estoque,
    estoqueMinimo,
    controlaEstoque: b.controlaEstoque !== 'off',
    cfop: soDigitos(b.cfop) || '5102',
    origem: ORIGENS[b.origem] ? String(b.origem) : '0',
    csosn: CSOSN[b.csosn] ? String(b.csosn) : '102',
    pTotTrib,
    ativo: b.ativo !== 'off',
  };
}

function validarProduto(p) {
  const erros = [];
  if (!p.codigo) erros.push('Informe o codigo do produto.');
  if (!p.descricao) erros.push('Informe a descricao.');
  if (p.ncm.length !== 8) erros.push('NCM deve ter 8 digitos (consulte o contador ou a tabela NCM).');
  if (p.cest && p.cest.length !== 7) erros.push('CEST deve ter 7 digitos (ou deixe vazio).');
  if (p.gtin && ![8, 12, 13, 14].includes(p.gtin.length)) erros.push('Codigo de barras (GTIN) deve ter 8, 12, 13 ou 14 digitos (ou deixe vazio).');
  if (p.cfop.length !== 4 || p.cfop[0] !== '5') erros.push('Use o CFOP de venda dentro do estado (comeca com 5). Para fora do estado o sistema troca sozinho.');
  if (Number.isNaN(p.preco) || p.preco === null || p.preco <= 0) erros.push('Informe o preco de venda.');
  if (Number.isNaN(p.pTotTrib) || p.pTotTrib < 0 || p.pTotTrib > 100) erros.push('Percentual aproximado de tributos invalido.');
  if (p.csosn === '500' && p.cfop !== '5405') erros.push('Para CSOSN 500 (ICMS ja retido por ST) use o CFOP 5405.');
  if (erros.length) throw Object.assign(new Error(erros.join(' ')), { lista: erros });
}

router.get('/produtos/novo', requireAdmin, async (req, res) => {
  const empresa = await empresaDaConta(req, req.query.empresa);
  if (!empresa) return res.redirect(`${req.base}/vendas/produtos`);
  res.render('vendas/produto-form', { title: 'Novo produto', empresa, p: { unidade: 'UN', cfop: '5102', csosn: '102', origem: '0', ativo: true }, ...CONSTANTES });
});

router.get('/produtos/:id/editar', requireAdmin, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.redirect(`${req.base}/vendas/produtos`);
  const p = await ProdutoNfe.findOne({ _id: req.params.id, owner: req.conta, ...escopo(req) }).lean();
  if (!p) return res.redirect(`${req.base}/vendas/produtos`);
  const empresa = await empresaDaConta(req, p.empresa);
  res.render('vendas/produto-form', { title: `Editar produto - ${p.descricao}`, empresa, p, ...CONSTANTES });
});

async function salvarProduto(req, res, existente) {
  const empresa = await empresaDaConta(req, existente ? existente.empresa : req.body.empresa);
  if (!empresa) {
    req.session.flash = { type: 'erro', msg: 'Empresa nao encontrada.' };
    return res.redirect(`${req.base}/vendas/produtos`);
  }
  const dados = produtoDoFormulario(req.body);
  try {
    validarProduto(dados);
    const repetido = await ProdutoNfe.findOne({ owner: req.conta, empresa: empresa._id, codigo: dados.codigo, ...(existente ? { _id: { $ne: existente._id } } : {}) }).select('_id').lean();
    if (repetido) throw new Error(`Ja existe outro produto com o codigo ${dados.codigo}.`);
    if (existente) {
      Object.assign(existente, dados);
      await existente.save();
    } else {
      await ProdutoNfe.create({ ...dados, owner: req.conta, empresa: empresa._id });
    }
    req.session.flash = { type: 'ok', msg: `Produto "${dados.descricao}" salvo.` };
    if (req.body.depois === 'novo') return res.redirect(`${req.base}/vendas/produtos/novo?empresa=${empresa._id}`);
    res.redirect(req.base ? `${req.base}/vendas/produtos` : `/vendas/produtos?empresa=${empresa._id}`);
  } catch (err) {
    res.locals.flash = { type: 'erro', msg: err.message };
    res.render('vendas/produto-form', { title: existente ? 'Editar produto' : 'Novo produto', empresa, p: { ...dados, preco: req.body.preco, _id: existente?._id }, ...CONSTANTES });
  }
}

router.post('/produtos', requireAdmin, (req, res) => salvarProduto(req, res, null));

router.post('/produtos/:id', requireAdmin, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.redirect(`${req.base}/vendas/produtos`);
  const p = await ProdutoNfe.findOne({ _id: req.params.id, owner: req.conta, ...escopo(req) });
  if (!p) return res.redirect(`${req.base}/vendas/produtos`);
  return salvarProduto(req, res, p);
});

router.post('/produtos/:id/excluir', requireAdmin, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.redirect(`${req.base}/vendas/produtos`);
  const p = await ProdutoNfe.findOneAndDelete({ _id: req.params.id, owner: req.conta, ...escopo(req) });
  req.session.flash = { type: 'ok', msg: p ? `Produto "${p.descricao}" excluido. As notas ja emitidas nao mudam.` : 'Produto nao encontrado.' };
  res.redirect(req.base ? `${req.base}/vendas/produtos` : `/vendas/produtos${p ? `?empresa=${p.empresa}` : ''}`);
});

// Importação automática de produtos para o catálogo a partir de nota fiscal de entrada
router.post('/produtos/importar-de-nota/:notaId', requireAdmin, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.notaId)) throw new Error('Nota fiscal inválida.');
    const nota = await NotaFiscal.findOne({ _id: req.params.notaId, owner: req.conta, ...escopo(req) });
    if (!nota) throw new Error('Nota fiscal não encontrada.');
    if (!nota.xml) throw new Error('O XML desta nota não está disponível no sistema.');

    const obj = xmlToObj(nota.xml);
    const nfe = obj?.nfeProc?.NFe || obj?.NFe;
    if (!nfe) throw new Error('Não foi possível ler a estrutura da NF-e no XML.');

    const dets = nfe.infNFe?.det;
    const listaDets = Array.isArray(dets) ? dets : (dets ? [dets] : []);
    if (!listaDets.length) throw new Error('Nenhum produto/item encontrado no XML desta nota.');

    let importados = 0;
    for (const item of listaDets) {
      const prod = item.prod || {};
      const codigo = String(prod.cProd || '').trim();
      const descricao = String(prod.xProd || '').trim();
      if (!codigo || !descricao) continue;

      const gtin = prod.cEAN && prod.cEAN !== 'SEM GTIN' ? soDigitos(prod.cEAN) : '';
      const ncm = soDigitos(prod.NCM || '').slice(0, 8);
      const cest = soDigitos(prod.CEST || '').slice(0, 7);
      const unidade = String(prod.uCom || 'UN').trim().toUpperCase().slice(0, 6) || 'UN';
      let preco = Number(prod.vUnCom || 0);
      if (Number.isNaN(preco) || preco <= 0) preco = 1.0;

      // Se CFOP de entrada começar com 14, 24, 54 ou 64, sugere revenda ST (CFOP 5405 e CSOSN 500)
      const cfopOrig = String(prod.CFOP || '');
      const temSt = cfopOrig.startsWith('140') || cfopOrig.startsWith('240') || cfopOrig.startsWith('540') || cfopOrig.startsWith('640');
      const cfop = temSt ? '5405' : '5102';
      const csosn = temSt ? '500' : '102';

      // Origem do ICMS
      const icms = item.imposto?.ICMS || {};
      const icmsDetalhe = Object.values(icms)[0] || {};
      const orig = String(icmsDetalhe.orig ?? '0');
      const origem = ORIGENS[orig] ? orig : '0';
      const qtdEntrada = Math.max(0, Number(prod.qCom || 0));

      const prodAtualizado = await ProdutoNfe.findOneAndUpdate(
        { owner: req.conta, empresa: nota.empresa, codigo },
        {
          $set: {
            descricao,
            gtin: [8, 12, 13, 14].includes(gtin.length) ? gtin : '',
            ncm: ncm.length === 8 ? ncm : '00000000',
            cest: cest.length === 7 ? cest : '',
            unidade,
            preco,
            cfop,
            csosn,
            origem,
            pTotTrib: 0,
            ativo: true,
          },
          $inc: { estoque: qtdEntrada },
        },
        { upsert: true, new: true },
      );

      if (qtdEntrada > 0) {
        await MovimentacaoEstoque.create({
          owner: req.conta,
          empresa: nota.empresa,
          produto: prodAtualizado._id,
          tipo: 'entrada',
          quantidade: qtdEntrada,
          estoqueAnterior: Math.round(((prodAtualizado.estoque || 0) - qtdEntrada) * 10000) / 10000,
          estoqueFinal: prodAtualizado.estoque,
          origem: 'xml_entrada',
          referenciaId: nota._id,
          documentoNumero: `${nota.numero || ''}/${nota.serie || ''}`,
          motivo: `Importação XML nota fornecedor ${nota.numero || ''}`,
        }).catch(() => {});
      }
      importados += 1;
    }

    req.session.flash = {
      type: 'ok',
      msg: `${importados} produto(s) importado(s) com sucesso para o catálogo (estoques atualizados com os itens da nota)!`,
    };
    res.redirect(`${req.base}/vendas/produtos?empresa=${nota.empresa}`);
  } catch (err) {
    req.session.flash = { type: 'erro', msg: err.message };
    res.redirect(req.get('referer') || `${req.base}/notas/${req.params.notaId}`);
  }
});

// ------------------------------------------------------------------ emissao (detalhe e eventos)

async function carregarEmissao(req) {
  if (!mongoose.isValidObjectId(req.params.id)) return null;
  return EmissaoNfe.findOne({ _id: req.params.id, owner: req.conta, ...escopo(req) })
    .populate('empresa', 'razaoSocial cnpj uf')
    .populate('usuario', 'nome email role')
    .lean();
}

router.get('/:id', async (req, res, next) => {
  const emissao = await carregarEmissao(req);
  if (!emissao) return next();
  const nome = emissao.modelo === '65' ? 'NFC-e' : 'NF-e';
  res.render('vendas/detalhe', { title: `${nome} ${emissao.numero || ''}`, emissao, nome, ...CONSTANTES });
});

router.get('/:id/pdf', async (req, res, next) => {
  try {
    const e = await carregarEmissao(req);
    if (!e) return res.status(404).send('Nao encontrada.');
    if (!['autorizada', 'cancelada'].includes(e.status)) return res.status(404).send('A nota nao foi autorizada: nao ha DANFE.');
    const cancelada = e.status === 'cancelada';
    const pdf = e.modelo === '65' ? await gerarDanfeNfce(e.xml, { cancelada }) : await gerarDanfe(e.xml, { cancelada });
    res.type('application/pdf');
    res.set('Content-Disposition', `${req.query.baixar ? 'attachment' : 'inline'}; filename="${e.modelo === '65' ? 'NFCe' : 'NFe'}_${e.chave}.pdf"`);
    res.send(pdf);
  } catch (err) {
    next(err);
  }
});

router.get('/:id/xml', async (req, res) => {
  const e = await carregarEmissao(req);
  if (!e) return res.status(404).send('Nao encontrada.');
  let xml = e.xml;
  let nome = `${e.chave}-${e.status === 'autorizada' || e.status === 'cancelada' ? 'procNFe' : 'nfe'}`;
  if (req.query.evento !== undefined) {
    const ev = e.eventos?.[Number(req.query.evento)];
    if (!ev?.xml) return res.status(404).send('Evento nao encontrado.');
    xml = ev.xml;
    nome = `${e.chave}-evento-${ev.tipo}-${ev.seq}`;
  }
  res.type('application/xml');
  res.set('Content-Disposition', `attachment; filename="${nome}.xml"`);
  res.send(xml);
});

router.post('/:id/enviar-email', async (req, res) => {
  try {
    const e = await carregarEmissao(req);
    if (!e) return res.status(404).send('Nota não encontrada.');
    if (!['autorizada', 'cancelada'].includes(e.status)) {
      throw new Error('Apenas notas autorizadas ou canceladas podem ser enviadas por e-mail.');
    }
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!email || !email.includes('@') || !email.includes('.')) {
      throw new Error('Informe um endereço de e-mail válido.');
    }

    const cancelada = e.status === 'cancelada';
    const pdf = e.modelo === '65' ? await gerarDanfeNfce(e.xml, { cancelada }) : await gerarDanfe(e.xml, { cancelada });
    const nomeDoc = e.modelo === '65' ? 'Cupom Fiscal (NFC-e)' : 'Nota Fiscal (NF-e)';
    const empresaNome = e.empresa?.razaoSocial || 'Empresa';

    const enviado = await enviarEmail({
      para: email,
      assunto: `${nomeDoc} nº ${e.numero} - ${empresaNome}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; color: #1e293b;">
          <h2 style="color: #2563eb; margin-bottom: 12px;">${nomeDoc} Emitida</h2>
          <p>Olá,</p>
          <p>Segue em anexo o documento fiscal da sua compra na empresa <strong>${empresaNome}</strong>.</p>
          <div style="background: #f1f5f9; padding: 12px 16px; border-radius: 8px; margin: 16px 0;">
            <p style="margin: 4px 0;"><strong>Documento:</strong> ${nomeDoc} nº ${e.numero} · Série ${e.serie}</p>
            <p style="margin: 4px 0;"><strong>Valor Total:</strong> R$ ${Number(e.valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            <p style="margin: 4px 0;"><strong>Chave de Acesso:</strong> <span style="font-family: monospace;">${(e.chave || '').replace(/(\d{4})(?=\d)/g, '$1 ')}</span></p>
            ${e.protocolo ? `<p style="margin: 4px 0;"><strong>Protocolo SEFAZ:</strong> ${e.protocolo}</p>` : ''}
          </div>
          <p style="color: #64748b; font-size: 13px;">O DANFE em PDF e o arquivo XML oficial estão anexados a esta mensagem.</p>
        </div>
      `,
      attachments: [
        {
          filename: `${e.modelo === '65' ? 'NFCe' : 'NFe'}_${e.chave}.pdf`,
          content: pdf,
        },
        {
          filename: `${e.chave}.xml`,
          content: e.xml,
        },
      ],
    });

    if (enviado) {
      req.session.flash = { type: 'ok', msg: `Comprovante enviado com sucesso para ${email}.` };
    } else {
      req.session.flash = {
        type: 'info',
        msg: `Serviço de e-mail (SMTP) não configurado no servidor. Configure as variáveis SMTP no .env para o envio real.`,
      };
    }
  } catch (err) {
    req.session.flash = { type: 'erro', msg: err.message };
  }
  res.redirect(`${req.base}/vendas/${req.params.id}`);
});

router.post('/:id/cancelar', requireAdmin, async (req, res) => {
  try {
    const r = await cancelarNfe(req.params.id, req.conta, { justificativa: req.body.justificativa }, escopo(req));
    req.session.flash = { type: r.ok ? 'ok' : 'erro', msg: r.mensagem };
  } catch (err) {
    req.session.flash = { type: 'erro', msg: err.message };
  }
  res.redirect(`${req.base}/vendas/${req.params.id}`);
});

router.post('/:id/cce', requireAdmin, async (req, res) => {
  try {
    const r = await cartaCorrecao(req.params.id, req.conta, { texto: req.body.correcao }, escopo(req));
    req.session.flash = { type: r.ok ? 'ok' : 'erro', msg: r.mensagem };
  } catch (err) {
    req.session.flash = { type: 'erro', msg: err.message };
  }
  res.redirect(`${req.base}/vendas/${req.params.id}`);
});

router.post('/:id/reconsultar', async (req, res) => {
  try {
    const r = await reconsultarNfe(req.params.id, req.conta, escopo(req));
    req.session.flash = { type: r.ok ? 'ok' : 'info', msg: r.mensagem };
  } catch (err) {
    req.session.flash = { type: 'erro', msg: err.message };
  }
  res.redirect(`${req.base}/vendas/${req.params.id}`);
});

// Sincroniza todas as notas emitidas em contingência offline
router.post('/sincronizar-contingencias', async (req, res) => {
  try {
    const empresaId = req.body.empresa || req.query.empresa;
    const empresa = await empresaDaConta(req, empresaId);
    if (!empresa) throw new Error('Selecione uma empresa válida.');
    const r = await sincronizarContingencias(empresa._id, req.conta);
    req.session.flash = {
      type: r.sincronizadas > 0 ? 'ok' : r.total === 0 ? 'info' : 'erro',
      msg: `${r.sincronizadas} de ${r.total} nota(s) em contingência transmitida(s) para a SEFAZ.` + (r.erros.length ? ` Detalhes: ${r.erros.slice(0, 3).join(' | ')}` : ''),
    };
    res.redirect(`${req.base}/vendas?empresa=${empresa._id}`);
  } catch (err) {
    req.session.flash = { type: 'erro', msg: err.message };
    res.redirect(`${req.base}/vendas`);
  }
});

// Visualização térmica direta para impressora de 80mm/58mm
router.get('/:id/cupom-termico', async (req, res, next) => {
  try {
    const e = await carregarEmissao(req);
    if (!e) return res.status(404).send('Nota não encontrada.');
    const nome = e.modelo === '65' ? 'NFC-e' : 'NF-e';
    res.render('vendas/cupom-termico', { layout: false, emissao: e, nome, ...CONSTANTES });
  } catch (err) {
    next(err);
  }
});

// Arquivo binário ESC/POS para envio direto à porta serial/USB da impressora
router.get('/:id/escpos', async (req, res, next) => {
  try {
    const e = await carregarEmissao(req);
    if (!e) return res.status(404).send('Nota não encontrada.');
    const init = Buffer.from([0x1b, 0x40]); // ESC @
    const center = Buffer.from([0x1b, 0x61, 0x01]);
    const left = Buffer.from([0x1b, 0x61, 0x00]);
    const boldOn = Buffer.from([0x1b, 0x45, 0x01]);
    const boldOff = Buffer.from([0x1b, 0x45, 0x00]);
    const cut = Buffer.from([0x1d, 0x56, 0x00]); // GS V 0

    const empresaNome = (e.empresa?.razaoSocial || 'EMPRESA').slice(0, 40) + '\n';
    const cnpj = `CNPJ: ${e.empresa?.cnpj || ''}\n`;
    const tit = `DOCUMENTO AUXILIAR DE NFC-e\nNumero: ${e.numero} Serie: ${e.serie}\n`;
    const separador = '------------------------------------------------\n';
    const total = `TOTAL R$ ${Number(e.valor || 0).toFixed(2)}\n`;
    const chave = `Chave:\n${(e.chave || '').replace(/(\d{4})(?=\d)/g, '$1 ')}\n`;
    const rodape = e.status === 'contingencia' ? 'EMITIDA EM CONTINGENCIA OFFLINE\n' : `Protocolo: ${e.protocolo || '-'}\n`;

    const buf = Buffer.concat([
      init,
      center,
      boldOn,
      Buffer.from(empresaNome, 'latin1'),
      boldOff,
      Buffer.from(cnpj, 'latin1'),
      Buffer.from(tit, 'latin1'),
      Buffer.from(separador, 'latin1'),
      left,
      boldOn,
      Buffer.from(total, 'latin1'),
      boldOff,
      Buffer.from(separador, 'latin1'),
      center,
      Buffer.from(chave, 'latin1'),
      Buffer.from(rodape, 'latin1'),
      Buffer.from('\n\n\n', 'latin1'),
      cut,
    ]);

    res.type('application/octet-stream');
    res.set('Content-Disposition', `attachment; filename="cupom_${e.numero || 'nfe'}.bin"`);
    res.send(buf);
  } catch (err) {
    next(err);
  }
});

export default router;
