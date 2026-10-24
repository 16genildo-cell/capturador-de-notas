import { Router } from 'express';
import { LISTA_PLANOS, TESTE, brl } from '../config/planos.js';
import { env } from '../config/env.js';
import { registrarContato, FAIXAS_CLIENTES } from '../services/contato.js';

/** Paginas publicas: inicio (apresentacao), termos de uso e privacidade. */
const router = Router();

const comum = () => ({
  layout: 'layout-site',
  planos: LISTA_PLANOS,
  teste: TESTE,
  brl,
  nomeProduto: env.saas.nomeProduto,
  emailSuporte: env.saas.emailSuporte,
  cadastroAberto: env.saas.cadastroAberto,
  faixasClientes: FAIXAS_CLIENTES,
});

// Visitante ve a apresentacao; quem esta logado segue para o painel.
router.get('/', (req, res, next) => {
  if (req.user) return next();
  res.render('site/inicio', { title: 'Captura automática de notas fiscais', ...comum(), contato: { enviado: req.query.contato === 'enviado', form: {} } });
});

// Formulario "Fale com a gente" da pagina inicial: a mensagem vai para o painel da plataforma.
router.post('/contato', async (req, res) => {
  try {
    await registrarContato(req.body, { ip: req.ip, origem: 'site' });
    res.redirect('/?contato=enviado#contato');
  } catch (err) {
    res.status(400).render('site/inicio', {
      title: 'Captura automática de notas fiscais',
      ...comum(),
      contato: { erro: err.message, form: req.body || {} },
    });
  }
});

// Os planos nao aparecem na pagina inicial: so dentro do sistema, em "Meu escritorio".
router.get('/planos', (req, res) => res.redirect(req.user ? '/assinatura#planos' : '/'));

router.get('/termos', (req, res) => res.render('site/termos', { title: 'Termos de uso', ...comum() }));
router.get('/privacidade', (req, res) => res.render('site/privacidade', { title: 'Politica de privacidade', ...comum() }));

export default router;
