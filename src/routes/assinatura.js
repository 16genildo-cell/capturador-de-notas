import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { LISTA_PLANOS, PLANOS, TESTE, brl } from '../config/planos.js';
import { Empresa } from '../models/Empresa.js';
import { User } from '../models/User.js';
import { normalizarDocumento } from '../utils/documento.js';
import { asaasConfigurado, linkFaturaAberta } from '../services/asaas.js';
import { env } from '../config/env.js';
import { avisosAtivos } from '../services/avisos.js';

const router = Router();
router.use(requireAuth);

const ROTULO_STATUS = {
  teste: ['Teste grátis', 'tag-warn'],
  pendente: ['Aguardando 1o pagamento', 'tag-warn'],
  ativa: ['Ativa', 'tag-ok'],
  inadimplente: ['Pagamento em atraso', 'tag-err'],
  cancelada: ['Cancelada', 'tag-err'],
  pausada: ['Pausada', 'tag-warn'],
  suspensa: ['Bloqueada', 'tag-err'],
  cortesia: ['Cortesia', 'tag-ok'],
};

router.get('/', async (req, res) => {
  const conta = req.contaSaas;
  const [empresasUsadas, usuarios] = await Promise.all([
    Empresa.countDocuments({ owner: req.conta }),
    User.countDocuments({ $or: [{ _id: req.conta }, { conta: req.conta }] }),
  ]);
  const bloqueado = !req.ehPlataforma && req.acessoConta && !req.acessoConta.liberado;
  const avisos = req.user.role === 'cliente' ? [] : await avisosAtivos(new Date(), { bloqueado }).catch(() => []);
  res.render('assinatura', {
    avisos,
    title: 'Meu escritório',
    conta: conta.toObject(),
    acesso: req.acessoConta,
    rotuloStatus: ROTULO_STATUS[conta.status] || [conta.status, 'tag-warn'],
    planos: LISTA_PLANOS,
    planoAtual: PLANOS[conta.plano] || null,
    planoSugerido: req.query.plano || '',
    limite: conta.limiteEmpresas(),
    empresasUsadas,
    usuarios,
    teste: TESTE,
    brl,
    cobrancaAtiva: asaasConfigurado(),
    emailSuporte: env.saas.emailSuporte,
  });
});

// Dados da conta (nome, documento de cobranca, alertas, ciencia automatica)
router.post('/dados', requireAdmin, async (req, res) => {
  try {
    const conta = req.contaSaas;
    const nome = String(req.body.nome || '').trim();
    if (!nome) throw new Error('Informe o nome da conta.');
    conta.nome = nome;
    if (req.body.documento) {
      const doc = normalizarDocumento(req.body.documento);
      if (conta.asaas?.customerId && conta.documento && doc !== conta.documento) {
        throw new Error('O documento de cobrança não pode ser trocado depois de assinar. Fale com o suporte.');
      }
      conta.documento = doc;
    }
    conta.emailCobranca = String(req.body.emailCobranca || '').trim().toLowerCase() || conta.emailCobranca;
    conta.telefone = String(req.body.telefone || '').trim();
    conta.set(
      'config.alertasPara',
      String(req.body.alertasPara || '')
        .split(/[,;\s]+/)
        .map((s) => s.trim().toLowerCase())
        .filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s))
        .slice(0, 10),
    );
    conta.set('config.cienciaAutomatica', req.body.cienciaAutomatica === 'on');
    await conta.save();
    req.session.flash = { type: 'ok', msg: 'Dados da conta salvos.' };
  } catch (err) {
    req.session.flash = { type: 'erro', msg: err.message };
  }
  res.redirect('/assinatura#dados');
});

// Contratacao online desativada: plano, troca e cancelamento sao feitos pela equipe da plataforma
// (painel /plataforma). As rotas antigas so avisam, para links e formularios antigos nao quebrarem.
const MSG_CONTRATACAO = 'A contratação, a troca de plano e o cancelamento são feitos com a nossa equipe.';
router.post('/plano', (req, res) => {
  req.session.flash = { type: 'info', msg: MSG_CONTRATACAO };
  res.redirect('/assinatura#planos');
});

// Abrir a fatura em aberto (Pix, boleto ou cartao)
router.get('/pagar', async (req, res) => {
  try {
    const fatura = await linkFaturaAberta(req.contaSaas);
    if (fatura?.url) return res.redirect(fatura.url);
    req.session.flash = { type: 'info', msg: 'Nenhuma fatura em aberto.' };
  } catch (err) {
    req.session.flash = { type: 'erro', msg: err.message };
  }
  res.redirect('/assinatura');
});

router.post('/cancelar', (req, res) => {
  req.session.flash = { type: 'info', msg: MSG_CONTRATACAO };
  res.redirect('/assinatura#planos');
});

export default router;
