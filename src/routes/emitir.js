import { Router } from 'express';
import { escopo, escopoDaEmpresa, restricaoEmpresas } from '../middleware/escopoEmpresa.js';
import mongoose from 'mongoose';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { Empresa } from '../models/Empresa.js';
import { EmissaoNfse } from '../models/EmissaoNfse.js';
import { ServicoNfse } from '../models/ServicoNfse.js';
import { emitirNfse, cancelarNfse, consultarConvenio, MOTIVOS_CANCELAMENTO } from '../services/nfse/emissao.js';
import { gerarPdfNota } from '../services/pdf/documentoPdf.js';
import { formatarDocumento, soDigitos } from '../utils/documento.js';

const router = Router();
router.use(requireAuth);

const OP_SIMP_NAC = { 1: 'Nao optante do Simples Nacional', 2: 'MEI', 3: 'ME/EPP optante do Simples Nacional' };

async function empresasDaConta(req) {
  return Empresa.find({ owner: req.conta, ...escopoDaEmpresa(req) }).populate('certificado', 'apelido validoAte').sort('razaoSocial').lean();
}

// Pagina principal: formulario de emissao + historico
router.get('/', async (req, res) => {
  const empresas = await empresasDaConta(req);
  const habilitadas = empresas.filter((e) => e.emissaoNfse?.ativa);
  const [historico, usados] = await Promise.all([
    EmissaoNfse.find({ owner: req.conta, ...escopo(req) }).select('-dpsXml -nfseXml -eventoCancelamentoXml -dados').sort('-createdAt').limit(50).populate('empresa', 'razaoSocial').lean(),
    EmissaoNfse.aggregate([
      { $match: { owner: req.conta, ...escopo(req), status: { $in: ['autorizada', 'cancelada'] } } },
      { $sort: { createdAt: -1 } },
      { $limit: 300 },
      { $group: { _id: '$dados.cTribNac', descricao: { $first: '$descricao' } } },
      { $limit: 20 },
    ]),
  ]);

  // "Emitir de novo" a partir de uma emissao anterior
  let anterior = null;
  if (req.query.de && mongoose.isValidObjectId(req.query.de)) {
    anterior = (await EmissaoNfse.findOne({ _id: req.query.de, owner: req.conta, ...escopo(req) }).select('dados empresa').lean()) || null;
  }
  // Valores do formulario: o que foi digitado (apos erro) ou a emissao usada como base
  let form = req.session.formEmissao || null;
  delete req.session.formEmissao;
  if (!form && anterior?.dados) {
    const d = anterior.dados;
    const t = d.tomador || {};
    form = {
      empresa: String(anterior.empresa),
      tomadorTipo: t.tipo, tomadorDocumento: t.documento, tomadorNome: t.nome, tomadorEmail: t.email, tomadorFone: t.fone,
      tomadorCep: t.cep, tomadorCMun: t.cMun, tomadorLogradouro: t.logradouro, tomadorNumero: t.numero,
      tomadorComplemento: t.complemento, tomadorBairro: t.bairro, tomadorCidade: t.cidade,
      cTribNac: d.cTribNac, cNBS: d.cNBS, descricao: d.descricao, cLocPrestacao: d.cLocPrestacao,
      valor: d.valor, desconto: d.desconto, issRetido: d.issRetido, naoIncidencia: d.naoIncidencia,
      aliquota: d.aliquota, infoComplementar: d.infoComplementar,
    };
  }
  const empresaSel = habilitadas.find((e) => String(e._id) === String(form?.empresa || req.query.empresa)) || habilitadas[0] || null;

  const servicos = empresaSel
    ? (await ServicoNfse.find({ owner: req.conta, empresa: empresaSel._id, ativo: true }).sort('-ultimaEmissao nome')).map((s) => s.toObject())
    : [];

  res.render('emitir/index', {
    title: 'Emitir NFS-e',
    servicos,
    empresas,
    habilitadas,
    empresaSel,
    form: form || {},
    historico,
    codigosUsados: usados.filter((u) => u._id),
    OP_SIMP_NAC,
    hoje: new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }),
  });
});

// Emitir
router.post('/', async (req, res) => {
  const b = req.body;
  try {
    if (!mongoose.isValidObjectId(b.empresa)) throw new Error('Selecione a empresa.');
    const empresa = await Empresa.findOne({ _id: b.empresa, owner: req.conta, ...escopoDaEmpresa(req) }).select('_id').lean();
    if (!empresa) throw new Error('Empresa nao encontrada.');
    const dados = {
      tomador: {
        tipo: b.tomadorTipo,
        documento: b.tomadorDocumento,
        nome: b.tomadorNome,
        email: b.tomadorEmail,
        fone: b.tomadorFone,
        cep: b.tomadorCep,
        cMun: b.tomadorCMun,
        logradouro: b.tomadorLogradouro,
        numero: b.tomadorNumero,
        complemento: b.tomadorComplemento,
        bairro: b.tomadorBairro,
        cidade: b.tomadorCidade,
      },
      cTribNac: b.cTribNac,
      cNBS: b.cNBS,
      descricao: b.descricao,
      cLocPrestacao: b.cLocPrestacao,
      competencia: b.competencia,
      valor: b.valor,
      desconto: b.desconto,
      issRetido: b.issRetido,
      naoIncidencia: b.naoIncidencia,
      aliquota: b.aliquota,
      infoComplementar: b.infoComplementar,
    };
    const emissao = await emitirNfse(empresa._id, dados, { usuarioId: req.user._id });
    const id = emissao._id;
    req.session.flash =
      emissao.status === 'autorizada'
        ? { type: 'ok', msg: `NFS-e autorizada${emissao.ambiente === 'homologacao' ? ' em PRODUCAO RESTRITA (teste, sem valor fiscal)' : ''}.` }
        : { type: 'erro', msg: emissao.status === 'rejeitada' ? 'A Sefin Nacional rejeitou a nota. Veja os motivos abaixo.' : 'Sem resposta da Sefin Nacional.' };
    res.redirect(`${req.base}/emitir/${id}`);
  } catch (err) {
    req.session.flash = { type: 'erro', msg: err.message };
    req.session.formEmissao = b; // preserva o que foi digitado
    res.redirect(`${req.base}/emitir#formulario`);
  }
});

// Configuracao da emissao por empresa (administrador)
router.get('/configurar/:empresaId', requireAdmin, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.empresaId)) return res.redirect(`${req.base}/emitir`);
  const empresa = await Empresa.findOne({ _id: req.params.empresaId, owner: req.conta }).populate('certificado', 'apelido validoAte').lean();
  if (!empresa) return res.redirect(`${req.base}/emitir`);
  res.render('emitir/configurar', { title: `Emissao de NFS-e - ${empresa.razaoSocial}`, empresa, cfg: empresa.emissaoNfse || {}, OP_SIMP_NAC, convenio: null });
});

router.post('/configurar/:empresaId', requireAdmin, async (req, res) => {
  const b = req.body;
  try {
    const empresa = await Empresa.findOne({ _id: req.params.empresaId, owner: req.conta });
    if (!empresa) throw new Error('Empresa nao encontrada.');
    const serie = soDigitos(b.serie) || '1';
    if (Number(serie) < 1 || Number(serie) > 49999) throw new Error('A serie deve estar entre 1 e 49999 (faixa de aplicativos proprios).');
    const cMun = soDigitos(b.municipioCodigo);
    if (cMun && !/^\d{7}$/.test(cMun)) throw new Error('O codigo IBGE do municipio deve ter 7 digitos.');
    if (cMun) empresa.municipioCodigo = cMun;
    if (b.ativa === 'on' && !/^\d{7}$/.test(soDigitos(empresa.municipioCodigo))) {
      throw new Error('Informe o codigo IBGE do municipio do prestador para ativar a emissao.');
    }
    if (b.ativa === 'on' && !empresa.certificado) throw new Error('Vincule um certificado digital A1 a empresa antes de ativar a emissao.');
    const pTot = Number(String(b.pTotTribSN || '0').replace(',', '.'));
    if (!(pTot >= 0 && pTot < 100)) throw new Error('Percentual aproximado de tributos invalido.');

    const novaNumeracao = { ...(empresa.emissaoNfse?.numeracao || {}) };
    // Permite ajustar o ultimo numero usado (ex.: continuar a sequencia de outro sistema)
    for (const amb of ['producao', 'homologacao']) {
      const v = b[`ultimoNumero_${amb}`];
      if (v !== undefined && v !== '') {
        const n = Number(soDigitos(v));
        if (!(n >= 0)) throw new Error('Ultimo numero de DPS invalido.');
        novaNumeracao[amb] = n;
      }
    }

    empresa.emissaoNfse = {
      ...(empresa.emissaoNfse?.toObject?.() || {}),
      ativa: b.ativa === 'on',
      ambiente: b.ambiente === 'producao' ? 'producao' : 'homologacao',
      opSimpNac: ['1', '2', '3'].includes(b.opSimpNac) ? b.opSimpNac : '1',
      regApTribSN: ['1', '2', '3'].includes(b.regApTribSN) ? b.regApTribSN : '1',
      regEspTrib: /^[0-9]$/.test(b.regEspTrib) ? b.regEspTrib : '0',
      pTotTribSN: pTot,
      serie,
      numeracao: novaNumeracao,
      cTribNac: soDigitos(b.cTribNac),
      cNBS: soDigitos(b.cNBS),
      descricaoPadrao: String(b.descricaoPadrao || '').trim(),
    };
    empresa.markModified('emissaoNfse');
    await empresa.save();
    req.session.flash = { type: 'ok', msg: 'Configuracao de emissao salva.' };
    res.redirect(`${req.base}/emitir`);
  } catch (err) {
    req.session.flash = { type: 'erro', msg: err.message };
    res.redirect(`${req.base}/emitir/configurar/${req.params.empresaId}`);
  }
});

// Verifica se o municipio do prestador aderiu ao emissor nacional
router.post('/configurar/:empresaId/convenio', requireAdmin, async (req, res) => {
  const empresa = await Empresa.findOne({ _id: req.params.empresaId, owner: req.conta }).populate('certificado');
  if (!empresa) return res.redirect(`${req.base}/emitir`);
  let convenio;
  try {
    convenio = await consultarConvenio(empresa, empresa.emissaoNfse?.ambiente === 'producao' ? 'producao' : 'homologacao');
  } catch (err) {
    convenio = { ok: false, mensagem: err.message };
  }
  const e = empresa.toObject();
  res.render('emitir/configurar', { title: `Emissao de NFS-e - ${e.razaoSocial}`, empresa: e, cfg: e.emissaoNfse || {}, OP_SIMP_NAC, convenio });
});

// Detalhe de uma emissao
router.get('/:id', async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.id)) return next();
  const emissao = await EmissaoNfse.findOne({ _id: req.params.id, owner: req.conta, ...escopo(req) }).populate('empresa', 'razaoSocial cnpj').lean();
  if (!emissao) return next();
  res.render('emitir/detalhe', {
    title: `NFS-e - DPS ${emissao.nDPS}`,
    emissao,
    MOTIVOS_CANCELAMENTO,
    docTomador: emissao.tomadorDocumento ? formatarDocumento(emissao.tomadorDocumento) : '',
  });
});

router.get('/:id/pdf', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).send('Nao encontrada.');
    const e = await EmissaoNfse.findOne({ _id: req.params.id, owner: req.conta, ...escopo(req) }).lean();
    if (!e || !e.nfseXml) return res.status(404).send('Nota sem XML autorizado.');
    const pdf = await gerarPdfNota({ tipo: 'nfse', xml: e.nfseXml, cancelada: e.status === 'cancelada', chave: e.chaveAcesso });
    res.type('application/pdf');
    res.set('Content-Disposition', `${req.query.baixar ? 'attachment' : 'inline'}; filename="NFSe_${e.chaveAcesso}.pdf"`);
    res.send(pdf);
  } catch (err) {
    next(err);
  }
});

router.get('/:id/xml', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).send('Nao encontrada.');
  const e = await EmissaoNfse.findOne({ _id: req.params.id, owner: req.conta, ...escopo(req) }).lean();
  if (!e) return res.status(404).send('Nao encontrada.');
  const qual = req.query.tipo === 'dps' ? e.dpsXml : req.query.tipo === 'cancelamento' ? e.eventoCancelamentoXml : e.nfseXml;
  if (!qual) return res.status(404).send('XML nao disponivel.');
  res.type('application/xml');
  res.set('Content-Disposition', `attachment; filename="${req.query.tipo || 'NFSe'}_${e.chaveAcesso || e.dpsId}.xml"`);
  res.send(qual);
});

router.post('/:id/cancelar', requireAdmin, async (req, res) => {
  try {
    const r = await cancelarNfse(req.params.id, req.conta, { cMotivo: req.body.cMotivo, xMotivo: req.body.xMotivo });
    req.session.flash = { type: r.ok ? 'ok' : 'erro', msg: r.mensagem };
  } catch (err) {
    req.session.flash = { type: 'erro', msg: err.message };
  }
  res.redirect(`${req.base}/emitir/${req.params.id}`);
});

export default router;
