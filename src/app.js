import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { Router } from 'express';
// Erros em rotas async viram resposta 500 em vez de derrubar o servidor (de todos os clientes).
import 'express-async-errors';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import expressLayouts from 'express-ejs-layouts';
import mongoose from 'mongoose';

import { env } from './config/env.js';
import { attachUser } from './middleware/auth.js';
import { cabecalhosSeguranca, protecaoCsrf, sanitizarNoSql } from './middleware/seguranca.js';
import usuarioRoutes from './routes/usuarios.js';
import saudeRoutes from './routes/saude.js';
import importarRoutes from './routes/importar.js';
import relatorioRoutes from './routes/relatorios.js';
import { alertaCertificados } from './middleware/alertas.js';
import { escopoEmpresa, semEscopo, menuEmpresas } from './middleware/escopoEmpresa.js';
import empresaPainelRoutes from './routes/empresaPainel.js';
import vendasRoutes from './routes/vendas.js';
import emitirRoutes from './routes/emitir.js';
import servicoNfseRoutes from './routes/servicosNfse.js';
import solicitacaoRoutes from './routes/solicitacoes.js';
import certidaoRoutes from './routes/certidoes.js';
import capturaRoutes from './routes/captura.js';

import authRoutes from './routes/auth.js';
import dashboardRoutes from './routes/dashboard.js';
import empresaRoutes from './routes/empresas.js';
import certificadoRoutes from './routes/certificados.js';
import notaRoutes from './routes/notas.js';
import assinaturaRoutes from './routes/assinatura.js';
import webhookRoutes from './routes/webhooks.js';
import apiV1 from './api/index.js';
import plataformaRoutes from './routes/plataforma.js';
import chatRoutes from './routes/chat.js';
import { requireAdmin } from './middleware/auth.js';
import siteRoutes from './routes/site.js';
import { carregarConta, exigirAssinatura, exigirRecurso, chatLiberado, mensagemRecurso } from './middleware/assinatura.js';
import { restringirClienteSite } from './middleware/perfilCliente.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();

  // Views
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.use(expressLayouts);
  app.set('layout', 'layout');

  // Atras do proxy do Render/Railway: IP real do cliente e cookie "secure" funcionando.
  if (env.trustProxy) app.set('trust proxy', 1);

  // Verificacao de saude para o Render/Railway (sem sessao nem banco de sessoes).
  app.get('/healthz', (req, res) => {
    const ok = mongoose.connection.readyState === 1;
    res.status(ok ? 200 : 503).json({ ok, uptime: Math.round(process.uptime()) });
  });

  // Cabecalhos de seguranca e protecao CSRF (verificacao de origem dos POSTs)
  app.disable('x-powered-by');
  app.use(cabecalhosSeguranca);
  app.use(protecaoCsrf);

  // Estaticos e PWA
  app.get('/manifest.json', (req, res) => res.sendFile(path.join(__dirname, 'public', 'manifest.json')));
  app.get('/sw.js', (req, res) => {
    res.type('application/javascript');
    res.sendFile(path.join(__dirname, 'public', 'sw.js'));
  });
  app.use('/static', express.static(path.join(__dirname, 'public')));

  // Body parsing e sanitização contra NoSQL injection
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));
  app.use(express.json({ limit: '1mb' }));
  app.use(sanitizarNoSql);

  // Webhooks (Asaas): sem sessao, autenticados por token
  app.use('/webhooks', webhookRoutes);

  // API JSON para o frontend web (React) e o app (Flutter): login por token, sem sessao
  app.use('/api/v1', apiV1);

  // Sessao persistida no Mongo
  app.use(
    session({
      secret: env.sessionSecret,
      resave: false,
      saveUninitialized: false,
      store: MongoStore.create({ mongoUrl: env.mongoUri }),
      name: 'ct.sid',
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 1000 * 60 * 60 * 8, // 8h
        secure: env.isProd,
      },
    }),
  );

  // Disponibiliza o usuario logado e flash simples nas views
  app.use(attachUser);
  app.use(carregarConta);
  // Cliente do escritorio: somente consulta das proprias notas
  app.use(restringirClienteSite);
  app.use((req, res, next) => {
    res.locals.cadastroAberto = env.saas.cadastroAberto;
    res.locals.nomeProduto = env.saas.nomeProduto;
    next();
  });
  // Paginas publicas (inicio com planos, termos, privacidade)
  app.use('/', siteRoutes);
  // Teste encerrado ou pagamento vencido: so a pagina "Minha conta" fica aberta
  app.use(exigirAssinatura);
  app.use(alertaCertificados);
  app.use(menuEmpresas);
  app.use(semEscopo);
  app.use((req, res, next) => {
    res.locals.currentPath = req.path;
    res.locals.queryAtual = req.query;
    res.locals.sefazAmbiente = env.sefazAmbiente;
    res.locals.flash = req.session.flash || null;
    res.locals.tem = (id) => !res.locals.recursos || res.locals.recursos.includes(id);
    delete req.session.flash;
    next();
  });

  // Rotas
  app.use('/', authRoutes);
  app.use('/assinatura', assinaturaRoutes);
  app.use('/plataforma', plataformaRoutes);
  // Chat interno com o suporte: pagina do escritorio (so administradores) + rotas JSON/tempo real
  app.get('/chat', requireAdmin, (req, res) => {
    if (!chatLiberado(req)) return res.status(403).render('error', { title: 'Nao incluido no plano', message: mensagemRecurso('chat_suporte'), status: 403 });
    res.render('chat', { title: 'Suporte' });
  });
  app.use('/chat', chatRoutes);
  app.use('/', dashboardRoutes);
  // Pagina propria de cada empresa: as mesmas funcoes, restritas a ela
  const paginaEmpresa = Router({ mergeParams: true });
  paginaEmpresa.use(escopoEmpresa);
  paginaEmpresa.use('/', empresaPainelRoutes);
  paginaEmpresa.use('/notas', notaRoutes);
  // Funcionalidades que dependem do plano do escritorio
  const relatorios = exigirRecurso('relatorios');
  const importar = exigirRecurso('importar_xml');
  const emissaoNfe = exigirRecurso('emissao_nfe');
  const emissaoNfse = exigirRecurso('emissao_nfse');
  const solicitacoes = exigirRecurso('solicitacoes_documentos');
  const certidoes = exigirRecurso('monitor_cnd');
  paginaEmpresa.use('/solicitacoes', solicitacoes, solicitacaoRoutes);
  paginaEmpresa.use('/relatorios', relatorios, relatorioRoutes);
  paginaEmpresa.use('/importar', importar, importarRoutes);
  paginaEmpresa.use('/vendas', emissaoNfe, vendasRoutes);
  paginaEmpresa.use('/emitir/servicos', emissaoNfse, servicoNfseRoutes);
  paginaEmpresa.use('/emitir', emissaoNfse, emitirRoutes);
  app.use('/empresas/:empresaId', paginaEmpresa);
  app.use('/empresas', empresaRoutes);
  app.use('/certificados', certificadoRoutes);
  app.use('/certidoes', certidoes, certidaoRoutes);
  app.use('/captura', capturaRoutes);
  app.use('/notas', notaRoutes);
  app.use('/vendas', emissaoNfe, vendasRoutes);
  app.use('/emitir/servicos', emissaoNfse, servicoNfseRoutes);
  app.use('/emitir', emissaoNfse, emitirRoutes);
  app.use('/solicitacoes', solicitacoes, solicitacaoRoutes);
  app.use('/usuarios', usuarioRoutes);
  app.use('/saude', saudeRoutes);
  app.use('/importar', importar, importarRoutes);
  app.use('/relatorios', relatorios, relatorioRoutes);

  // 404
  app.use((req, res) => {
    res.status(404).render('error', {
      title: 'Nao encontrado',
      message: 'Pagina nao encontrada.',
      status: 404,
    });
  });

  // Erros
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error('[erro]', err);
    res.status(500).render('error', {
      title: 'Erro',
      message: env.isProd ? 'Ocorreu um erro interno.' : err.message,
      status: 500,
    });
  });

  return app;
}
