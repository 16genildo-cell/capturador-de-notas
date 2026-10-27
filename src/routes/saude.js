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
import { capturaEmAndamento, liberarTravaCaptura } from '../services/capturaService.js';
import { env } from '../config/env.js';
import { emailConfigurado, enviarEmail, montarHtml } from '../services/email.js';
import { requirePlataforma } from '../middleware/assinatura.js';
import { destinatariosDaConta } from '../services/contas.js';

const router = Router();
router.use(requirePlataforma);

const TIPOS = ['nfe', 'nfse', 'cte'];

router.get('/', async (req, res) => {
  const conta = req.conta;
  const inicioPing = Date.now();
  let banco = { ok: false, ms: null, versao: '' };
  try {
    const info = await mongoose.connection.db.admin().command({ buildInfo: 1 });
    banco = { ok: true, ms: Date.now() - inicioPing, versao: info.version };
  } catch (err) {
    banco.erro = err.message;
  }

  const empresas = await Empresa.find({}).populate('certificado', 'apelido validoAte cnpjCpf').sort('razaoSocial').lean();
  const ids = empresas.map((e) => e._id);
  const desde = new Date(Date.now() - 7 * 864e5);
  const [logs, totalNotas, errosSemana, notasComXml, notasSemXml, marcadasParaApagar] = await Promise.all([
    CapturaLog.aggregate([
      { $match: { empresa: { $in: ids } } },
      { $sort: { createdAt: -1 } },
      { $group: { _id: { empresa: '$empresa', tipo: '$tipo' }, ultimo: { $first: '$$ROOT' } } },
    ]),
    NotaFiscal.countDocuments({}),
    CapturaLog.find({ status: 'erro', createdAt: { $gte: desde } })
      .sort('-createdAt')
      .limit(20)
      .populate('empresa', 'razaoSocial')
      .lean(),
    NotaFiscal.countDocuments({ xml: { $exists: true, $ne: null } }),
    NotaFiscal.countDocuments({ xmlApagadoEm: { $ne: null } }),
    NotaFiscal.countDocuments({ baixadaEm: { $ne: null }, xmlApagadoEm: null }),
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

  const backups = listarBackups();
  const mem = process.memoryUsage();

  res.render('saude', {
    title: 'Saude do sistema',
    banco,
    linhas,
    totalNotas,
    retencao: {
      comXml: notasComXml,
      semXml: notasSemXml,
      marcadasParaApagar,
    },
    errosSemana,
    tarefas: estadoTarefas,
    backups: backups.slice(0, 5),
    totalBackups: backups.length,
    plataforma: true,
    email: { ativo: emailConfigurado(), para: await destinatariosDaConta(conta) },
    sistema: {
      node: process.version,
      uptimeMin: Math.round(process.uptime() / 60),
      memoriaMb: Math.round(mem.rss / 1024 / 1024),
      heapUsadoMb: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
      host: os.hostname(),
      ambiente: env.sefazAmbiente,
      sefazCaFile: Boolean(env.sefazCaFile),
      sefazTlsVerificar: env.sefazTlsVerificar,
      certificadosCadastrados: await Certificado.countDocuments({}),
    },
  });
});

// 1. Destravar captura e limpar bloqueios recentes de 137 / 656
router.post('/empresa/:id/destravar', async (req, res) => {
  try {
    const { id } = req.params;
    const empresa = await Empresa.findById(id);
    if (!empresa) throw new Error('Empresa não encontrada.');

    liberarTravaCaptura(id);

    // Remove bloqueios recentes de 137 ou 656 nas últimas 2 horas
    const duasHorasAtras = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const del = await CapturaLog.deleteMany({
      empresa: id,
      cStat: { $in: ['137', '656'] },
      createdAt: { $gte: duasHorasAtras },
    });

    req.session.flash = {
      type: 'ok',
      msg: `Trava liberada e ${del.deletedCount || 0} bloqueio(s) de espera SEFAZ (137/656) removidos para "${empresa.razaoSocial}". Agora você pode capturar novamente!`,
    };
  } catch (err) {
    req.session.flash = { type: 'erro', msg: err.message };
  }
  res.redirect('/saude');
});

// 2. Ajustar/Redefinir ponteiro de NSU da empresa
router.post('/empresa/:id/ajustar-nsu', async (req, res) => {
  try {
    const { id } = req.params;
    const empresa = await Empresa.findById(id);
    if (!empresa) throw new Error('Empresa não encontrada.');

    const { acao, nsuManual } = req.body;
    let novoNsu = empresa.ultimoNSU;

    if (acao === 'zerar') {
      novoNsu = '000000000000000';
    } else if (acao === 'max') {
      if (!empresa.maxNSU) throw new Error('A empresa ainda não possui um maxNSU registrado pela SEFAZ.');
      novoNsu = empresa.maxNSU;
    } else if (acao === 'manual') {
      const digitos = String(nsuManual || '').replace(/\D/g, '');
      if (!digitos) throw new Error('Informe um NSU numérico válido.');
      novoNsu = digitos.padStart(15, '0');
    } else {
      throw new Error('Ação inválida.');
    }

    const nsuAnterior = empresa.ultimoNSU;
    empresa.ultimoNSU = novoNsu;
    await Empresa.updateOne({ _id: empresa._id }, { ultimoNSU: novoNsu });

    req.session.flash = {
      type: 'ok',
      msg: `Ponteiro de NSU da empresa "${empresa.razaoSocial}" atualizado de ${nsuAnterior || '0'} para ${novoNsu}.`,
    };
  } catch (err) {
    req.session.flash = { type: 'erro', msg: err.message };
  }
  res.redirect('/saude');
});

// 3. Testar conexão mTLS com a SEFAZ
router.post('/testar-sefaz', async (req, res) => {
  try {
    const { requisicaoMtls } = await import('../services/sefaz/soapClient.js');
    const { getEndpoints } = await import('../services/sefaz/endpoints.js');
    const endpoints = getEndpoints(env.sefazAmbiente);

    const certDoc = await Certificado.findOne({ owner: req.conta });
    let keyPem, certPem;
    if (certDoc) {
      const { materializarCertificado } = await import('../services/crypto/certificado.js');
      const mat = materializarCertificado(certDoc);
      keyPem = mat.keyPem;
      certPem = mat.certPem;
    }

    const inicio = Date.now();
    const resp = await requisicaoMtls({
      method: 'GET',
      url: endpoints.distribuicaoDFe,
      keyPem,
      certPem,
      timeoutMs: 15000,
    });
    const duracao = Date.now() - inicio;

    req.session.flash = {
      type: 'ok',
      msg: `Conexão mTLS com a SEFAZ funcionando! HTTP ${resp.status} em ${duracao} ms (Ambiente: ${env.sefazAmbiente}). Certificados e rota responderam com sucesso.`,
    };
  } catch (err) {
    req.session.flash = {
      type: 'erro',
      msg: `Falha na conexão com a SEFAZ: ${err.message}`,
    };
  }
  res.redirect('/saude');
});

// 4. Testar descriptografia e validade do certificado A1
router.post('/certificado/:id/testar', async (req, res) => {
  try {
    const { id } = req.params;
    const certDoc = await Certificado.findById(id);
    if (!certDoc) throw new Error('Certificado não encontrado.');

    const { lerPfx } = await import('../services/crypto/certificado.js');
    const { decryptBuffer, decryptString } = await import('../services/crypto/vault.js');

    const pfx = decryptBuffer(certDoc.pfxCriptografado);
    const senha = decryptString(certDoc.senhaCriptografada);
    const info = lerPfx(pfx, senha);

    const agora = Date.now();
    const expira = new Date(info.validoAte).getTime();
    const dias = Math.ceil((expira - agora) / (1000 * 60 * 60 * 24));

    if (dias < 0) {
      req.session.flash = {
        type: 'erro',
        msg: `Certificado "${certDoc.apelido}" (${info.cnpjCpf}) VENCIDO há ${Math.abs(dias)} dia(s) (venceu em ${new Date(info.validoAte).toLocaleDateString('pt-BR')})!`,
      };
    } else {
      req.session.flash = {
        type: 'ok',
        msg: `Certificado OK! Titular: ${info.titular} · CNPJ/CPF: ${info.cnpjCpf} · Válido até ${new Date(info.validoAte).toLocaleDateString('pt-BR')} (${dias} dias restantes) · Emissor: ${info.emissor}`,
      };
    }
  } catch (err) {
    req.session.flash = { type: 'erro', msg: `Falha no teste do certificado: ${err.message}` };
  }
  res.redirect('/saude');
});

// 5. Otimização de memória do Node.js
router.post('/limpar-memoria', requirePlataforma, async (req, res) => {
  try {
    const antes = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    if (typeof global.gc === 'function') {
      global.gc();
    }
    const depois = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    req.session.flash = {
      type: 'ok',
      msg: `Memória otimizada! Heap em uso: ${depois} MB (anterior: ${antes} MB).`,
    };
  } catch (err) {
    req.session.flash = { type: 'erro', msg: err.message };
  }
  res.redirect('/saude');
});

// 6. Proteção de retenção de XMLs: cancelar agendamento de exclusão
router.post('/retencao/cancelar-exclusao', async (req, res) => {
  try {
    const r = await NotaFiscal.updateMany(
      { baixadaEm: { $ne: null }, xmlApagadoEm: null },
      { $set: { baixadaEm: null } }
    );
    req.session.flash = {
      type: 'ok',
      msg: `Proteção ativada! ${r.modifiedCount || 0} nota(s) baixada(s) tiveram o agendamento de exclusão cancelado e permanecerão guardadas.`,
    };
  } catch (err) {
    req.session.flash = { type: 'erro', msg: err.message };
  }
  res.redirect('/saude');
});

// 7. Retenção de XMLs: executar limpeza manual agora
router.post('/retencao/limpar-agora', requirePlataforma, async (req, res) => {
  try {
    const { limparArquivos } = await import('../services/retencao.js');
    const r = await limparArquivos();
    req.session.flash = {
      type: 'ok',
      msg: `Rotina de retenção executada: ${r.apagadas} arquivo(s) de nota expirado(s) foram apagados em ${r.contas} conta(s).`,
    };
  } catch (err) {
    req.session.flash = { type: 'erro', msg: err.message };
  }
  res.redirect('/saude');
});

router.post('/email-teste', async (req, res) => {
  try {
    if (!emailConfigurado()) throw new Error('E-mail não configurado. Preencha SMTP_HOST, SMTP_USUARIO, SMTP_SENHA e SMTP_REMETENTE no .env.');
    await enviarEmail({
      assunto: 'Captura Total: e-mail de teste',
      html: montarHtml('Os alertas por e-mail estão funcionando', [{ titulo: 'Você receberá', itens: ['Aviso de certificado vencendo', 'Prazo de manifestação de NF-e terminando'] }]),
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
