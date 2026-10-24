import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { restricaoEmpresas } from '../middleware/escopoEmpresa.js';
import { Empresa } from '../models/Empresa.js';
import { Certificado } from '../models/Certificado.js';
import { CapturaLog } from '../models/CapturaLog.js';
import { NotaFiscal } from '../models/NotaFiscal.js';
import { capturarEmpresa } from '../services/capturaService.js';
import { env } from '../config/env.js';
import { formatarDocumento, tipoPessoa } from '../utils/documento.js';

const router = Router();
router.use(requireAuth);

// Pagina central da captura: passo a passo, empresas e historico.
router.get('/', async (req, res) => {
  const owner = req.conta;
  // Operador restrito: so as empresas permitidas, e sem a lista de certificados da conta.
  const re = restricaoEmpresas(req, 'empresa');
  const [empresas, certificados] = await Promise.all([
    Empresa.find({ owner, ...restricaoEmpresas(req, '_id') }).populate('certificado').sort('razaoSocial').lean(),
    req.empresasPermitidas ? [] : Certificado.find({ owner, ativo: true }).sort('-createdAt').lean(),
  ]);

  // Cliente escolhido no topo da pagina: tudo abaixo passa a mostrar so ele.
  const clienteSel = empresas.find((e) => String(e._id) === String(req.query.cliente || '')) || null;
  const doCliente = clienteSel ? { empresa: clienteSel._id } : re;
  const idsEmpresas = clienteSel ? [clienteSel._id] : empresas.map((e) => e._id);
  const [logs, resumosPendentes, notasRecentes] = await Promise.all([
    CapturaLog.find({ empresa: { $in: idsEmpresas } })
      .sort('-createdAt')
      .limit(30)
      .populate('empresa', 'razaoSocial')
      .lean(),
    NotaFiscal.countDocuments({ owner, ...doCliente, resumo: true, tipo: { $in: ['nfe', 'nfce'] }, cancelada: { $ne: true } }),
    // Ultimas notas capturadas (sem eventos), para conferir o resultado aqui mesmo.
    NotaFiscal.find({ owner, ...doCliente, tipo: { $ne: 'evento' } })
      .sort('-createdAt')
      .limit(15)
      .select('-xml')
      .populate('empresa', 'razaoSocial')
      .lean(),
  ]);

  // Certificados que ainda nao estao em nenhuma empresa (atalho para cadastrar).
  const usados = new Set(empresas.filter((e) => e.certificado).map((e) => String(e.certificado._id)));
  const certificadosSemEmpresa = certificados.filter((c) => !usados.has(String(c._id)));

  const agora = Date.now();
  const comStatus = (e) => ({
    ...e,
    cnpjFormatado: formatarDocumento(e.cnpj),
    tipoPessoa: tipoPessoa(e.cnpj),
    certVencido: e.certificado?.validoAte ? new Date(e.certificado.validoAte).getTime() < agora : false,
    ultimoLog: logs.find((l) => l.empresa && String(l.empresa._id) === String(e._id) && l.tipo === 'nfe'),
    ultimoLogNfse: logs.find((l) => l.empresa && String(l.empresa._id) === String(e._id) && l.tipo === 'nfse'),
    ultimoLogCte: logs.find((l) => l.empresa && String(l.empresa._id) === String(e._id) && l.tipo === 'cte'),
  });
  res.render('captura', {
    title: 'Captura',
    clienteSel: clienteSel ? comStatus(clienteSel) : null,
    opcoesClientes: empresas.map((e) => ({ _id: e._id, razaoSocial: e.razaoSocial, doc: formatarDocumento(e.cnpj) })),
    totalClientes: empresas.length,
    empresas: (clienteSel ? [clienteSel] : empresas).map(comStatus),
    certificados,
    certificadosSemEmpresa,
    logs,
    resumosPendentes,
    notasRecentes,
    config: {
      ambiente: env.sefazAmbiente,
      agendador: env.schedulerEnabled,
      cron: env.schedulerCron,
      cienciaAutomatica: req.contaSaas?.config?.cienciaAutomatica ?? env.cienciaAutomatica,
    },
  });
});

// Captura de todas as empresas do usuario
router.post('/todas', async (req, res) => {
  const empresas = await Empresa.find({ owner: req.conta, ativa: true, ...restricaoEmpresas(req, '_id') }).select('_id razaoSocial').lean();
  if (empresas.length === 0) {
    req.session.flash = { type: 'erro', msg: 'Cadastre uma empresa antes de capturar.' };
    return res.redirect('/captura');
  }
  let novos = 0;
  let erros = 0;
  for (const e of empresas) {
    try {
      const r = await capturarEmpresa(e._id, { origem: 'manual' });
      novos += (r.nfe?.novos || 0) + (r.nfse?.novos || 0) + (r.cte?.novos || 0);
      if ([r.nfe, r.nfse, r.cte].some((x) => x?.status === 'erro')) erros += 1;
    } catch {
      erros += 1;
    }
  }
  req.session.flash = {
    type: erros > 0 ? 'erro' : novos > 0 ? 'ok' : 'info',
    msg:
      `Captura concluída: ${empresas.length} empresa(s), ${novos} documento(s) novo(s)` +
      (erros > 0 ? `, ${erros} com erro (veja o histórico abaixo).` : '.'),
  };
  res.redirect('/captura#notas-capturadas');
});

export default router;
