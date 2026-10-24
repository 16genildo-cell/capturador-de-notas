import { Router } from 'express';
import { NotaFiscal } from '../models/NotaFiscal.js';
import { CapturaLog } from '../models/CapturaLog.js';
import { EmissaoNfse } from '../models/EmissaoNfse.js';
import { ServicoNfse } from '../models/ServicoNfse.js';
import { capturarEmpresa } from '../services/capturaService.js';
import { resumoMensal } from '../services/relatorios.js';
import { env } from '../config/env.js';

/**
 * Pagina propria de cada empresa (montada em /empresas/:empresaId, depois do escopoEmpresa):
 * visao geral e captura. Notas, emissao, servicos, relatorios e importacao usam as rotas de
 * sempre, restritas a empresa pelo escopo.
 */
const router = Router();

const ROT_TIPO = { nfe: 'NF-e', nfse: 'NFS-e', cte: 'CT-e' };

function hojeBr() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
}

/** Ultimo registro de captura de cada tipo de documento. */
async function ultimaCapturaPorTipo(empresaId) {
  const linhas = await CapturaLog.aggregate([
    { $match: { empresa: empresaId } },
    { $sort: { createdAt: -1 } },
    { $group: { _id: '$tipo', log: { $first: '$$ROOT' } } },
  ]);
  return Object.fromEntries(linhas.map((l) => [l._id, l.log]));
}

// Visao geral
router.get('/', async (req, res) => {
  const empresa = req.empresaEscopo;
  const filtroBase = { owner: req.conta, empresa: empresa._id };

  const inicio12 = new Date();
  inicio12.setMonth(inicio12.getMonth() - 11, 1);
  inicio12.setHours(0, 0, 0, 0);

  const [porTipo, meses, ultimasNotas, capturas, pendManifestacao, resumos, servicos, emissoes] = await Promise.all([
    NotaFiscal.aggregate([
      { $match: { ...filtroBase, tipo: { $ne: 'evento' } } },
      {
        $group: {
          _id: '$tipo',
          qtd: { $sum: 1 },
          valor: { $sum: { $cond: [{ $eq: ['$cancelada', true] }, 0, '$valorTotal'] } },
        },
      },
    ]),
    resumoMensal({ ...filtroBase, tipo: { $ne: 'evento' }, dataEmissao: { $gte: inicio12 } }),
    NotaFiscal.find({ ...filtroBase, tipo: { $ne: 'evento' } }).select('-xml').sort('-dataEmissao -createdAt').limit(10).lean(),
    ultimaCapturaPorTipo(empresa._id),
    NotaFiscal.countDocuments({ ...filtroBase, tipo: 'nfe', papel: 'destinatario', cancelada: { $ne: true }, situacaoManifestacao: { $in: ['pendente', 'ciencia'] } }),
    NotaFiscal.countDocuments({ ...filtroBase, resumo: true, cancelada: { $ne: true } }),
    empresa.emissaoNfse?.ativa
      ? ServicoNfse.find({ ...filtroBase, ativo: true }).sort('-ultimaEmissao nome').limit(6).then((l) => l.map((s) => s.toObject()))
      : [],
    EmissaoNfse.find(filtroBase).select('status ambiente nDPS serie tomadorNome valor createdAt').sort('-createdAt').limit(5).lean(),
  ]);

  const stats = { total: 0, valor: 0, porTipo: {} };
  for (const t of porTipo) {
    stats.total += t.qtd;
    stats.valor += t.valor;
    stats.porTipo[t._id] = t;
  }
  const mesAtual = hojeBr().slice(0, 7);

  res.render('empresas/painel', {
    title: 'Visao geral',
    empresa,
    stats,
    meses,
    mesAtual: meses.find((m) => m.mes === mesAtual) || null,
    ultimasNotas,
    capturas,
    pendencias: { manifestacao: pendManifestacao, resumos },
    servicos,
    emissoes,
    hoje: hojeBr(),
    ROT_TIPO,
  });
});

// Aba de captura: o que e capturado, ultimo NSU e historico
router.get('/captura', async (req, res) => {
  const empresa = req.empresaEscopo;
  const [logs, capturas] = await Promise.all([
    CapturaLog.find({ empresa: empresa._id }).sort('-createdAt').limit(60).lean(),
    ultimaCapturaPorTipo(empresa._id),
  ]);
  res.render('empresas/captura', {
    title: 'Captura',
    empresa,
    logs,
    capturas,
    ROT_TIPO,
    config: { ambiente: env.sefazAmbiente, agendador: env.schedulerEnabled, cron: env.schedulerCron },
  });
});

// Capturar agora (so esta empresa)
router.post('/capturar', async (req, res) => {
  const empresa = req.empresaEscopo;
  try {
    const r = await capturarEmpresa(empresa._id, { origem: 'manual' });
    const novos = (r.nfe?.novos || 0) + (r.nfse?.novos || 0) + (r.cte?.novos || 0);
    const houveErro = [r.nfe, r.nfse, r.cte].some((x) => x?.status === 'erro');
    req.session.flash = {
      type: houveErro ? 'erro' : novos > 0 ? 'ok' : 'info',
      msg:
        `Captura concluída: ${novos} documento(s) novo(s). ` +
        [r.nfe && `NF-e: ${r.nfe.mensagem}`, r.nfse && `NFS-e: ${r.nfse.mensagem}`, r.cte && `CT-e: ${r.cte.mensagem}`]
          .filter(Boolean)
          .join(' | '),
    };
  } catch (err) {
    req.session.flash = { type: 'erro', msg: `Erro na captura: ${err.message}` };
  }
  const voltar = req.get('referer') || '';
  res.redirect(voltar.includes(req.base) ? voltar : req.base);
});

export default router;
