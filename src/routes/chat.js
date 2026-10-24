import { Router } from 'express';
import multer from 'multer';
import {
  abrirEventos, enviarMensagem, listarMensagens, marcarLidas, listarConversas, naoLidasEscritorio, naoLidasSuporte, nomeDoEscritorio,
  listarAtendimentos, listarAtendimentosDaConta, encerrarAtendimento, reabrirAtendimento, obterAtendimento, publicaAtendimento,
  obterAnexo, LIMITE_ANEXO,
} from '../services/chat.js';
import { chatLiberado, mensagemRecurso } from '../middleware/assinatura.js';

/**
 * Rotas JSON do chat interno, usadas pelo painel antigo (sessao) e pela API (token).
 * Montadas em /chat (painel) e /api/v1/chat (API). Precisam de req.user, req.conta e req.ehPlataforma.
 *
 *  Escritorio (somente administradores do escritorio):
 *    GET  /mensagens[?atendimento=id]   POST /mensagens {texto} ou multipart (texto + arquivo)
 *    GET  /atendimentos                 POST /atendimentos/:id/reabrir
 *    GET  /anexos/:id                   POST /lidas     GET /eventos (SSE)
 *  Equipe da plataforma:
 *    GET  /suporte/atendimentos?status=abertos|encerrados|todos&q=
 *    GET  /suporte/atendimentos/:id/mensagens          POST /suporte/atendimentos/:id/mensagens
 *    POST /suporte/atendimentos/:id/encerrar           POST /suporte/atendimentos/:id/reabrir
 *    GET  /suporte/:conta/mensagens   POST /suporte/:conta/mensagens (abre atendimento se preciso)
 *    POST /suporte/:conta/lidas       GET /suporte/conversas (painel antigo)
 *    GET  /suporte/anexos/:id         GET /suporte/eventos (SSE)
 */
const router = Router();

const erro = (res, status, msg) => res.status(status).json({ erro: msg });

// Anexo (PDF/imagem) junto da mensagem: multipart com o campo "arquivo".
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: LIMITE_ANEXO, files: 1 } });
function receberArquivo(req, res, next) {
  upload.single('arquivo')(req, res, (err) => {
    if (!err) return next();
    erro(res, 400, err.code === 'LIMIT_FILE_SIZE' ? 'O arquivo pode ter no máximo 10 MB.' : `Não foi possível receber o arquivo: ${err.message}`);
  });
}
const arquivoDe = (req) => (req.file ? { buffer: req.file.buffer, nome: req.file.originalname } : null);

/** Envia o anexo para o navegador (inline; ?baixar=1 forca o download). */
function enviarAnexo(req, res, a) {
  if (!a) return erro(res, 404, 'Arquivo não encontrado.');
  res.set('Content-Type', a.tipo);
  res.set('Content-Length', String(a.dados.length));
  res.set('Content-Disposition', `${req.query.baixar ? 'attachment' : 'inline'}; filename="${encodeURIComponent(a.nome)}"; filename*=UTF-8''${encodeURIComponent(a.nome)}`);
  res.set('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
  res.set('Cache-Control', 'private, max-age=3600');
  res.send(a.dados);
}

// ---- equipe da plataforma
router.use('/suporte', (req, res, next) => (req.user && req.ehPlataforma ? next() : erro(res, 404, 'Rota não encontrada.')));
router.get('/suporte/eventos', (req, res) => abrirEventos(req, res, { tipo: 'suporte' }));
router.get('/suporte/conversas', async (req, res) => res.json({ itens: await listarConversas(), naoLidas: await naoLidasSuporte() }));
router.get('/suporte/atendimentos', async (req, res) => {
  const status = ['abertos', 'encerrados', 'todos'].includes(req.query.status) ? req.query.status : 'abertos';
  res.json({ itens: await listarAtendimentos({ status, q: req.query.q }), naoLidas: await naoLidasSuporte() });
});
router.get('/suporte/anexos/:id', async (req, res) => enviarAnexo(req, res, await obterAnexo(req.params.id, { plataforma: true })));
router.get('/suporte/atendimentos/:id/mensagens', async (req, res) => {
  const a = await obterAtendimento(req.params.id);
  if (!a) return erro(res, 404, 'Atendimento não encontrado.');
  const nome = await nomeDoEscritorio(a.conta);
  res.json({ escritorio: { id: String(a.conta), nome }, ...(await listarMensagens(a.conta, { atendimento: a._id, antes: req.query.antes })) });
});
router.post('/suporte/atendimentos/:id/mensagens', receberArquivo, async (req, res) => {
  try {
    const a = await obterAtendimento(req.params.id);
    if (!a) return erro(res, 404, 'Atendimento não encontrado.');
    res.status(201).json({ mensagem: await enviarMensagem({ conta: a.conta, autor: req.user, deSuporte: true, texto: req.body?.texto, arquivo: arquivoDe(req), atendimento: a._id }) });
  } catch (err) {
    erro(res, 400, err.message);
  }
});
router.post('/suporte/atendimentos/:id/encerrar', async (req, res) => {
  try {
    res.json({ atendimento: publicaAtendimento(await encerrarAtendimento(req.params.id, { por: req.user.nome })) });
  } catch (err) {
    erro(res, 400, err.message);
  }
});
router.post('/suporte/atendimentos/:id/reabrir', async (req, res) => {
  try {
    res.json({ atendimento: publicaAtendimento(await reabrirAtendimento(req.params.id, { por: `${req.user.nome} (suporte)` })) });
  } catch (err) {
    erro(res, 400, err.message);
  }
});
router.get('/suporte/:conta/mensagens', async (req, res) => {
  try {
    const nome = await nomeDoEscritorio(req.params.conta);
    if (!nome) return erro(res, 404, 'Escritório não encontrado.');
    res.json({ escritorio: { id: req.params.conta, nome }, ...(await listarMensagens(req.params.conta, { antes: req.query.antes })) });
  } catch (err) {
    erro(res, 400, err.message);
  }
});
router.post('/suporte/:conta/mensagens', receberArquivo, async (req, res) => {
  try {
    res.status(201).json({ mensagem: await enviarMensagem({ conta: req.params.conta, autor: req.user, deSuporte: true, texto: req.body?.texto, arquivo: arquivoDe(req) }) });
  } catch (err) {
    erro(res, 400, err.message);
  }
});
router.post('/suporte/:conta/lidas', async (req, res) => res.json({ ok: true, marcadas: await marcarLidas(req.params.conta, 'suporte') }));

// ---- escritorio: so administradores
router.use((req, res, next) => {
  if (!req.user) return erro(res, 401, 'Faca login para continuar.');
  if (req.user.role !== 'admin') return erro(res, 403, 'O chat com o suporte e para os administradores do escritório.');
  if (!chatLiberado(req)) return erro(res, 403, mensagemRecurso('chat_suporte'));
  next();
});
router.get('/eventos', (req, res) => abrirEventos(req, res, { tipo: 'escritorio', conta: req.conta }));
router.get('/mensagens', async (req, res) => {
  try {
    res.json({ ...(await listarMensagens(req.conta, { antes: req.query.antes, atendimento: req.query.atendimento })), naoLidas: await naoLidasEscritorio(req.conta) });
  } catch (err) {
    erro(res, 404, err.message);
  }
});
router.post('/mensagens', receberArquivo, async (req, res) => {
  try {
    res.status(201).json({ mensagem: await enviarMensagem({ conta: req.conta, autor: req.user, texto: req.body?.texto, arquivo: arquivoDe(req) }) });
  } catch (err) {
    erro(res, 400, err.message);
  }
});
router.get('/atendimentos', async (req, res) => res.json({ itens: await listarAtendimentosDaConta(req.conta) }));
router.post('/atendimentos/:id/reabrir', async (req, res) => {
  try {
    res.json({ atendimento: publicaAtendimento(await reabrirAtendimento(req.params.id, { por: req.user.nome, conta: req.conta })) });
  } catch (err) {
    erro(res, 400, err.message);
  }
});
router.get('/anexos/:id', async (req, res) => enviarAnexo(req, res, await obterAnexo(req.params.id, { conta: req.conta })));
router.post('/lidas', async (req, res) => res.json({ ok: true, marcadas: await marcarLidas(req.conta, 'escritorio') }));

export default router;
