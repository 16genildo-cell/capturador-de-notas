import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { montarPainel } from '../services/painel.js';
import { avisosAtivos } from '../services/avisos.js';

const router = Router();

router.get('/', requireAuth, async (req, res) => {
  const bloqueado = !req.ehPlataforma && req.acessoConta && !req.acessoConta.liberado;
  const avisos = req.user.role === 'cliente' ? [] : await avisosAtivos(new Date(), { bloqueado }).catch(() => []);
  res.render('dashboard', { title: 'Painel', avisos, ...(await montarPainel(req.conta, req.empresasPermitidas)) });
});

export default router;
