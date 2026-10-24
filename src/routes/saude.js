import os from 'node:os';
import { Router } from 'express';
import mongoose from 'mongoose';
import { requireAdmin } from '../middleware/auth.js';
import { Empresa } from '../models/Empresa.js';
import { Certificado } from '../models/Certificado.js';
import { NotaFiscal } from '../models/NotaFiscal.js';
import { CapturaLog } from '../models/CapturaLog.js';
import { estadoTarefas, executarBackupAgendado } from '../services/scheduler/index.js';
import { listarBackups } from '../services/backup.js';
import { capturaEmAndamento } from '../services/capturaService.js';
import { env } from '../config/env.js';
import { emailConfigurado, enviarEmail, montarHtml } from '../services/email.js';
import { requirePlataforma } from '../middleware/assinatura.js';
import { destinatariosDaConta } from '../services/contas.js';

const router = Router();
router.use(requireAdmin);

const TIPOS = ['nfe', 'nfse', 'cte'];

router.get('/', async (req, res) => {
  const conta = req.conta;
  const inicioPing = Date.now();
  const plataforma = Boolean(req.ehPlataforma);
  let banco = { ok: false, ms: null, versao: '' };
  if (plataforma) try {
    const info = await mongoose.connection.db.admin().command({ buildInfo: 1 });
    banco = { ok: true, ms: Date.now() - inicioPing, versao: info.version };
  } catch (err) {
    banco.erro = err.message;
  }

  const empresas = await Empresa.find({ owner: conta }).populate('certificado', 'apelido validoAte').sort('razaoSocial').lean();
  const ids = empresas.map((e) => e._id);
  const desde = new Date(Date.now() - 7 * 864e5);
  const [logs, totalNotas, errosSemana] = await Promise.all([
    CapturaLog.aggregate([
      { $match: { empresa: { $in: ids } } },
      { $sort: { createdAt: -1 } },
      { $group: { _id: { empresa: '$empresa', tipo: '$tipo' }, ultimo: { $first: '$$ROOT' } } },
    ]),
    NotaFiscal.countDocuments({ owner: conta }),
    CapturaLog.find({ empresa: { $in: ids }, status: 'erro', createdAt: { $gte: desde } })
      .sort('-createdAt')
      .limit(15)
      .populate('empresa', 'razaoSocial')
      .lean(),
  ]);

  const linhas = empresas.map((e) => {
    const porTipo = {};
    for (const t of TIPOS) {
      porTipo[t] = logs.find((l) => String(l._id.empresa) === String(e._id) && l._id.tipo === t)?.ultimo || null;
    }
    const validade = e.certificado?.validoAte ? new Date(e.certificado.validoAte) : null;
    return {
      ...e,
      porTipo,
      rodando: capturaEmAndamento(e._id),
      certDias: validade ? Math.ceil((validade.getTime() - Date.now()) / 864e5) : null,
    };
  });

  const backups = plataforma ? listarBackups() : [];
  res.render('saude', {
    title: 'Saude do sistema',
    banco,
    linhas,
    totalNotas,
    errosSemana,
    tarefas: estadoTarefas,
    backups: backups.slice(0, 5),
    totalBackups: backups.length,
    plataforma,
    email: { ativo: emailConfigurado(), para: await destinatariosDaConta(conta) },
    sistema: {
      node: process.version,
      uptimeMin: Math.round(process.uptime() / 60),
      memoriaMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      host: os.hostname(),
      ambiente: env.sefazAmbiente,
      certificadosCadastrados: await Certificado.countDocuments({ owner: conta }),
    },
  });
});

router.post('/email-teste', async (req, res) => {
  try {
    if (!emailConfigurado()) throw new Error('E-mail não configurado. Preencha SMTP_HOST, SMTP_USUARIO, SMTP_SENHA e SMTP_REMETENTE no .env.');
    await enviarEmail({
      assunto: 'Captura Total: e-mail de teste',
      html: montarHtml('Os alertas por e-mail estão funcionando', [{ titulo: 'Você recebera', itens: ['Aviso de certificado vencendo', 'Prazo de manifestação de NF-e terminando'] }]),
      para: [req.user.email],
    });
    req.session.flash = { type: 'ok', msg: `E-mail de teste enviado para ${req.user.email}.` };
  } catch (err) {
    req.session.flash = { type: 'erro', msg: `Falha ao enviar: ${err.message}` };
  }
  res.redirect('/saude');
});

router.post('/backup', requirePlataforma, async (req, res) => {
  await executarBackupAgendado();
  const st = estadoTarefas.backup;
  req.session.flash = st.erro
    ? { type: 'erro', msg: `Falha no backup: ${st.erro}` }
    : { type: 'ok', msg: `Backup criado em ${st.resultado}` };
  res.redirect('/saude');
});

export default router;
