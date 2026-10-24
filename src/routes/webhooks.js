import { Router } from 'express';
import { processarEvento, webhookAutentico } from '../services/asaas.js';

const router = Router();

// Notificacoes do Asaas. Cadastre no painel do Asaas:
//   URL: <APP_URL>/webhooks/asaas   Token: o mesmo valor de ASAAS_WEBHOOK_TOKEN
router.post('/asaas', async (req, res) => {
  if (!webhookAutentico(req.get('asaas-access-token'))) {
    console.warn('[asaas] webhook recusado: token inválido');
    return res.status(401).json({ ok: false });
  }
  try {
    const r = await processarEvento(req.body);
    console.log(`[asaas] ${req.body?.event} -> ${r}`);
    res.json({ ok: true, resultado: r });
  } catch (err) {
    console.error('[asaas] erro no webhook:', err.message);
    // 500 faz o Asaas tentar de novo mais tarde
    res.status(500).json({ ok: false });
  }
});

export default router;
