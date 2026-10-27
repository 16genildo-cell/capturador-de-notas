import { Router } from 'express';
import multer from 'multer';
import mongoose from 'mongoose';
import { requireAuth } from '../middleware/auth.js';
import { Empresa } from '../models/Empresa.js';
import { Certidao, ESFERAS, SITUACOES, statusValidade } from '../models/Certidao.js';
import {
  emitirFederalEmpresa,
  emitirCndGratuitaEmpresa,
  emitirTodasGratuitasEmpresa,
  renovarTodasVencendo,
} from '../services/certidoes/index.js';
import { serproConfigurado } from '../services/certidoes/serproCnd.js';
import { formatarDocumento, tipoPessoa } from '../utils/documento.js';

const router = Router();
router.use(requireAuth);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, ok) => ok(null, /pdf$/i.test(file.mimetype) || /\.pdf$/i.test(file.originalname)),
});

/** Sites oficiais para emissao manual (quando nao ha emissao automatica). */
function linksOficiais(empresa) {
  const pf = tipoPessoa(empresa.cnpj) === 'PF';
  return {
    federal: `https://solucoes.receita.fazenda.gov.br/Servicos/certidaointernet/${pf ? 'PF' : 'PJ'}/Emitir`,
    fgts: pf ? '' : 'https://consulta-crf.caixa.gov.br/consultacrf/pages/consultaEmpregador.jsf',
    trabalhista: 'https://cndt-certidao.tst.jus.br/inicio.faces',
    estadual: empresa.linksCertidao?.estadual || '',
    municipal: empresa.linksCertidao?.municipal || '',
  };
}

function dataForm(v) {
  // "AAAA-MM-DD" do formulario -> meio-dia de Brasilia (evita virar o dia anterior)
  return /^\d{4}-\d{2}-\d{2}$/.test(v || '') ? new Date(`${v}T12:00:00-03:00`) : undefined;
}

// Painel de certidoes: situacao atual por empresa e esfera + historico
router.get('/', async (req, res) => {
  const owner = req.user._id;
  const empresas = await Empresa.find({ owner }).sort('razaoSocial').lean();
  const certidoes = await Certidao.find({ owner }).select('-pdf').sort('-dataEmissao -createdAt').lean();
  const comPdf = new Set(
    (await Certidao.find({ owner, pdf: { $exists: true } }).select('_id').lean()).map((c) => String(c._id)),
  );

  const linhas = empresas.map((e) => {
    const atuais = {};
    for (const esfera of Object.keys(ESFERAS)) {
      const c = certidoes.find((x) => String(x.empresa) === String(e._id) && x.esfera === esfera);
      atuais[esfera] = c ? { ...c, status: statusValidade(c.dataValidade), temPdf: comPdf.has(String(c._id)) } : null;
    }
    return {
      ...e,
      documento: formatarDocumento(e.cnpj),
      pf: tipoPessoa(e.cnpj) === 'PF',
      atuais,
      links: linksOficiais(e),
    };
  });

  const alertas = { vencidas: 0, vencendo: 0 };
  for (const l of linhas) {
    for (const c of Object.values(l.atuais)) {
      if (c?.status === 'vencida') alertas.vencidas += 1;
      if (c?.status === 'vencendo') alertas.vencendo += 1;
    }
  }

  res.render('certidoes/lista', {
    title: 'Certidões',
    linhas,
    historico: certidoes.slice(0, 40).map((c) => ({
      ...c,
      status: statusValidade(c.dataValidade),
      temPdf: comPdf.has(String(c._id)),
      empresaNome: empresas.find((e) => String(e._id) === String(c.empresa))?.razaoSocial || '-',
    })),
    ESFERAS,
    SITUACOES,
    alertas,
    serpro: serproConfigurado(),
  });
});

// Varredura de CNDs de todas as empresas
router.post('/varredura', async (req, res) => {
  try {
    const { renovadas, erros } = await renovarTodasVencendo({ owner: req.user._id, dias: 30 });
    req.session.flash = {
      type: 'ok',
      msg: `Varredura concluída: ${renovadas} certidão(ões) emitida(s)/renovada(s) com sucesso.${erros ? ` (${erros} falha(s))` : ''}`,
    };
  } catch (err) {
    req.session.flash = { type: 'erro', msg: err.message };
  }
  res.redirect('/certidoes');
});

// Emitir todas as CNDs de uma empresa (Trabalhista + Federal + FGTS)
router.post('/emitir-todas/:empresaId', async (req, res) => {
  try {
    const empresa = await Empresa.findOne({ _id: req.params.empresaId, owner: req.user._id }).populate('certificado');
    if (!empresa) throw new Error('Empresa não encontrada.');
    const resultados = await emitirTodasGratuitasEmpresa(empresa);
    const sucessos = resultados.filter((r) => r.ok).length;
    req.session.flash = {
      type: sucessos > 0 ? 'ok' : 'erro',
      msg: `${sucessos} de ${resultados.length} certidões emitidas com sucesso para ${empresa.razaoSocial}.`,
    };
  } catch (err) {
    req.session.flash = { type: 'erro', msg: err.message };
  }
  res.redirect('/certidoes');
});

// Emitir CND individual por esfera (trabalhista, federal, fgts)
router.post('/emitir/:empresaId/:esfera', async (req, res) => {
  try {
    const { empresaId, esfera } = req.params;
    const empresa = await Empresa.findOne({ _id: empresaId, owner: req.user._id }).populate('certificado');
    if (!empresa) throw new Error('Empresa não encontrada.');

    let c;
    if (esfera === 'federal') {
      c = await emitirFederalEmpresa(empresa);
    } else {
      c = await emitirCndGratuitaEmpresa(empresa, esfera);
    }

    req.session.flash = {
      type: 'ok',
      msg: `Certidão ${ESFERAS[esfera] || esfera} emitida para ${empresa.razaoSocial}: ${SITUACOES[c.situacao]}, válida até ${c.dataValidade ? c.dataValidade.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '-'}.`,
    };
  } catch (err) {
    req.session.flash = { type: 'erro', msg: err.message };
  }
  res.redirect('/certidoes');
});

// Emitir certidao federal agora (API Serpro ou direta via Certificado A1)
router.post('/federal/:empresaId', async (req, res) => {
  try {
    const empresa = await Empresa.findOne({ _id: req.params.empresaId, owner: req.user._id }).populate('certificado');
    if (!empresa) throw new Error('Empresa não encontrada.');
    const c = await emitirFederalEmpresa(empresa);
    req.session.flash =
      c.situacao === 'nao_emitida'
        ? { type: 'erro', msg: `Certidão federal não emitida para ${empresa.razaoSocial}. ${c.mensagem || ''}` }
        : {
            type: 'ok',
            msg: `Certidão federal emitida para ${empresa.razaoSocial}: ${SITUACOES[c.situacao]}, válida até ${c.dataValidade ? c.dataValidade.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '-'}.`,
          };
  } catch (err) {
    req.session.flash = { type: 'erro', msg: err.message };
  }
  res.redirect('/certidoes');
});

// Enviar certidao manualmente (PDF baixado do site do orgao)
router.post('/enviar', upload.single('pdf'), async (req, res) => {
  try {
    const b = req.body;
    if (!mongoose.isValidObjectId(b.empresa)) throw new Error('Selecione a empresa.');
    const empresa = await Empresa.findOne({ _id: b.empresa, owner: req.user._id }).lean();
    if (!empresa) throw new Error('Empresa não encontrada.');
    if (!ESFERAS[b.esfera]) throw new Error('Selecione o tipo da certidao.');
    if (!req.file) throw new Error('Anexe o PDF da certidao.');
    const dataValidade = dataForm(b.dataValidade);
    if (!dataValidade) throw new Error('Informe a data de validade da certidao.');

    await Certidao.create({
      empresa: empresa._id,
      owner: req.user._id,
      esfera: b.esfera,
      situacao: SITUACOES[b.situacao] ? b.situacao : 'negativa',
      codigoControle: (b.codigoControle || '').trim(),
      dataEmissao: dataForm(b.dataEmissao) || new Date(),
      dataValidade,
      pdf: req.file.buffer,
      origem: 'manual',
    });
    req.session.flash = { type: 'ok', msg: `Certidao ${ESFERAS[b.esfera]} salva para ${empresa.razaoSocial}.` };
  } catch (err) {
    req.session.flash = { type: 'erro', msg: err.message };
  }
  res.redirect('/certidoes');
});

// Salvar links dos sites de emissao estadual/municipal da empresa
router.post('/links/:empresaId', async (req, res) => {
  const limpar = (u) => {
    const v = String(u || '').trim();
    return /^https?:\/\//i.test(v) ? v : '';
  };
  await Empresa.updateOne(
    { _id: req.params.empresaId, owner: req.user._id },
    { 'linksCertidao.estadual': limpar(req.body.estadual), 'linksCertidao.municipal': limpar(req.body.municipal) },
  );
  req.session.flash = { type: 'ok', msg: 'Links salvos.' };
  res.redirect('/certidoes');
});

router.get('/:id/pdf', async (req, res) => {
  const c = await Certidao.findOne({ _id: req.params.id, owner: req.user._id }).lean();
  if (!c || !c.pdf) return res.status(404).send('Certidao sem PDF.');
  res.set('Content-Type', 'application/pdf');
  res.set('Content-Disposition', `inline; filename="certidao-${c.esfera}-${String(c._id).slice(-6)}.pdf"`);
  res.send(Buffer.from(c.pdf.buffer || c.pdf));
});

router.post('/:id/excluir', async (req, res) => {
  await Certidao.deleteOne({ _id: req.params.id, owner: req.user._id });
  req.session.flash = { type: 'ok', msg: 'Certidao removida.' };
  res.redirect('/certidoes');
});

export default router;
