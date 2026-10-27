import { Router } from 'express';
import { requirePlataforma } from '../middleware/assinatura.js';
import { STATUS_CONTA } from '../models/Conta.js';
import { LISTA_PLANOS, TESTE, brl, FUNCIONALIDADES, PERIODOS } from '../config/planos.js';
import { asaasConfigurado } from '../services/asaas.js';
import { listarContas, ajustarConta, criarContaCliente, mensagemContaCriada, SITUACOES_INICIAIS, obterEscritorio, donoParaAcesso } from '../services/plataforma.js';
import { env } from '../config/env.js';
import { listarMensagens, acaoMensagem } from '../services/contato.js';
import { listarPlanosAdmin, criarPlano, editarPlano, excluirPlano, carregarPlanos } from '../services/planos.js';
import { Plano } from '../models/Plano.js';
import {
  obterControlePagamentos,
  confirmarPagamento,
  desmarcarPagamento,
  suspenderConta,
  reativarConta,
  gerarCsvPagamentos,
} from '../services/pagamentosControle.js';

/**
 * Painel do dono da plataforma: todas as contas de clientes, situacao da
 * assinatura, uso, receita mensal estimada e acoes manuais (liberar, suspender...).
 * So aparece para os e-mails de ADMIN_EMAIL / PLATAFORMA_ADMINS.
 */
const router = Router();
router.use(requirePlataforma);

function prepararDadosPlano(b) {
  return {
    nome: b.nome,
    codigo: b.codigo,
    descricao: b.descricao,
    preco: b.preco,
    periodo: b.periodo,
    limiteEmpresas: b.limiteEmpresas,
    limiteUsuarios: b.limiteUsuarios,
    diasGratis: b.diasGratis,
    retencaoDias: b.retencaoDias,
    ordem: b.ordem,
    funcionalidades: [].concat(b.funcionalidades || []).flatMap((x) => String(x).split(',')).map((x) => x.trim()).filter(Boolean),
    apagarAoBaixar: b.apagarAoBaixar === 'on' || b.apagarAoBaixar === 'true' || b.apagarAoBaixar === true,
    destaque: b.destaque === 'on' || b.destaque === 'true' || b.destaque === true,
    ativo: b.ativo === 'on' || b.ativo === 'true' || b.ativo === true,
    publico: b.publico === 'on' || b.publico === 'true' || b.publico === true,
  };
}

router.get('/', async (req, res) => {
  const [dados, mensagens, planosAdmin] = await Promise.all([
    listarContas(req.query),
    listarMensagens(req.query.msgs),
    listarPlanosAdmin(),
  ]);
  res.render('plataforma', {
    mensagens,
    title: 'Plataforma',
    ...dados,
    planos: LISTA_PLANOS,
    planosAdmin,
    STATUS: STATUS_CONTA,
    brl,
    asaasAtivo: asaasConfigurado(),
    asaasAmbiente: env.asaas.ambiente,
    situacoesIniciais: SITUACOES_INICIAIS,
    teste: TESTE,
  });
});

// Listagem e gestao de pacotes e planos
router.get('/planos', async (req, res) => {
  const planosAdmin = await listarPlanosAdmin();
  res.render('plataforma-planos', {
    title: 'Pacotes e Planos',
    planos: planosAdmin,
    funcionalidades: FUNCIONALIDADES,
    periodos: PERIODOS,
    editarId: req.query.editar || null,
    abrirNovo: req.query.novo === '1' || req.query.novo === 'true',
    brl,
  });
});

// Criar novo pacote/plano
router.post('/planos', async (req, res) => {
  try {
    const dados = prepararDadosPlano(req.body);
    const plano = await criarPlano(dados);
    console.log(`[plataforma] ${req.user.email} criou o plano ${plano.id} (${plano.nome})`);
    req.session.flash = { type: 'ok', msg: `Pacote "${plano.nome}" criado com sucesso!` };
  } catch (err) {
    req.session.flash = { type: 'erro', msg: `Não foi possível criar o pacote: ${err.message}` };
  }
  res.redirect('/plataforma/planos');
});

// Editar pacote/plano existente
router.post('/planos/:id', async (req, res) => {
  try {
    const dados = prepararDadosPlano(req.body);
    const plano = await editarPlano(req.params.id, dados);
    console.log(`[plataforma] ${req.user.email} editou o plano ${plano.id} (${plano.nome})`);
    req.session.flash = { type: 'ok', msg: `Pacote "${plano.nome}" atualizado com sucesso!` };
  } catch (err) {
    req.session.flash = { type: 'erro', msg: `Não foi possível atualizar o pacote: ${err.message}` };
  }
  res.redirect('/plataforma/planos');
});

// Ativar/desativar (arquivar) pacote
router.post('/planos/:id/toggle', async (req, res) => {
  try {
    const doc = await Plano.findById(req.params.id);
    if (!doc) throw new Error('Pacote não encontrado.');
    doc.ativo = !doc.ativo;
    await doc.save();
    await carregarPlanos();
    console.log(`[plataforma] ${req.user.email} ${doc.ativo ? 'ativou' : 'arquivou'} o plano ${doc._id}`);
    req.session.flash = { type: 'ok', msg: `Pacote "${doc.nome}" ${doc.ativo ? 'ativado' : 'arquivado'}.` };
  } catch (err) {
    req.session.flash = { type: 'erro', msg: err.message };
  }
  res.redirect('/plataforma/planos');
});

// Excluir pacote
router.post('/planos/:id/excluir', async (req, res) => {
  try {
    await excluirPlano(req.params.id);
    console.log(`[plataforma] ${req.user.email} excluiu o plano ${req.params.id}`);
    req.session.flash = { type: 'ok', msg: 'Pacote excluído com sucesso.' };
  } catch (err) {
    req.session.flash = { type: 'erro', msg: `Não foi possível excluir o pacote: ${err.message}` };
  }
  res.redirect('/plataforma/planos');
});

// Criar a conta de um novo cliente (o cadastro publico fica fechado)
router.post('/contas', async (req, res) => {
  try {
    const r = await criarContaCliente(req.body, { criadoPor: req.user.email });
    console.log(`[plataforma] ${req.user.email} criou a conta ${r.conta._id} (${r.user.email})`);
    req.session.flash = { type: 'ok', msg: mensagemContaCriada(r) };
  } catch (err) {
    req.session.flash = { type: 'erro', msg: `Não foi possível criar o escritório: ${err.message}` };
  }
  res.redirect('/plataforma');
});

// Chat com os escritorios (lista de conversas + conversa aberta, em tempo real)
router.get('/chat', async (req, res) => {
  const { nomeDoEscritorio } = await import('../services/chat.js');
  const conta = String(req.query.conta || '');
  res.render('plataforma-chat', { title: 'Chat dos escritórios', contaInicial: conta, nomeInicial: (await nomeDoEscritorio(conta)) || '' });
});

// Pagina de um escritorio: dados, plano, clientes, equipe, capturas e cobranca
router.get('/escritorios/:id', async (req, res, next) => {
  const dados = await obterEscritorio(req.params.id);
  if (!dados) return next();
  res.render('plataforma-escritorio', {
    title: `Escritorio: ${dados.conta.nome}`,
    ...dados,
    planos: LISTA_PLANOS,
    STATUS: STATUS_CONTA,
    brl,
  });
});

// Acessar o escritorio como suporte: o dono da plataforma passa a ver o sistema como o dono
// do escritorio. Uma faixa no topo mostra o acesso e o botao para voltar (POST /suporte/voltar).
router.post('/escritorios/:id/acessar', async (req, res) => {
  try {
    const { conta, dono } = await donoParaAcesso(req.params.id);
    console.log(`[plataforma] ${req.user.email} acessou o escritório ${conta._id} (${conta.nome}) como suporte`);
    req.session.acessoSuporte = { adminId: String(req.user._id), contaId: String(conta._id), nome: conta.nome, desde: new Date().toISOString() };
    req.session.userId = String(dono._id);
    req.session.save(() => res.redirect('/'));
  } catch (err) {
    req.session.flash = { type: 'erro', msg: err.message };
    res.redirect(`/plataforma/escritorios/${req.params.id}`);
  }
});

// Mensagens do formulario de contato do site
router.post('/mensagens/:id', async (req, res) => {
  try {
    req.session.flash = { type: 'ok', msg: await acaoMensagem(req.params.id, String(req.body.acao || '')) };
  } catch (err) {
    req.session.flash = { type: 'erro', msg: err.message };
  }
  res.redirect(req.get('referer') || '/plataforma#mensagens');
});

// Ajustes manuais de uma conta
router.post('/contas/:id', async (req, res) => {
  try {
    const conta = await ajustarConta(req.params.id, req.body, { por: req.user.email });
    console.log(`[plataforma] ${req.user.email} -> conta ${conta._id}: ${req.body.acao}`);
    req.session.flash = conta.aviso ? { type: 'erro', msg: conta.aviso } : { type: 'ok', msg: `Conta "${conta.nome}" atualizada.` };
  } catch (err) {
    req.session.flash = { type: 'erro', msg: err.message };
  }
  res.redirect(req.get('referer') || '/plataforma');
});

// Sincronizar assinatura no Asaas diretamente
router.post('/contas/:id/sincronizar-asaas', async (req, res) => {
  try {
    const { sincronizarAssinatura } = await import('../services/asaas.js');
    const { Conta } = await import('../models/Conta.js');
    const conta = await Conta.findById(req.params.id);
    if (!conta) throw new Error('Conta não encontrada.');
    const r = await sincronizarAssinatura(conta);
    req.session.flash = {
      type: 'ok',
      msg: `Asaas sincronizado! Status: ${r.statusAtual} (Último pagamento: ${r.ultimoPagamento}).`,
    };
  } catch (err) {
    req.session.flash = { type: 'erro', msg: `Falha ao sincronizar com Asaas: ${err.message}` };
  }
  res.redirect(req.get('referer') || '/plataforma');
});

// ==========================================
// CONTROLE DE PAGAMENTOS MENSAIS
// ==========================================

// Tela principal de controle de pagamentos
router.get('/pagamentos', async (req, res) => {
  const dados = await obterControlePagamentos(req.query);
  res.render('plataforma-pagamentos', {
    title: 'Controle de Pagamentos',
    subtitulo: 'Acompanhe as mensalidades e confirme os pagamentos dos escritórios',
    brl,
    ...dados,
  });
});

// Confirmar OK de pagamento de um escritório para o mês
router.post('/pagamentos/:contaId/ok', async (req, res) => {
  try {
    const { mes, valor, formaPagamento, observacoes, atualizarAcesso } = req.body;
    await confirmarPagamento(req.params.contaId, mes, {
      valor,
      formaPagamento,
      observacoes,
      adminEmail: req.user.email,
      atualizarAcesso: atualizarAcesso === '1' || atualizarAcesso === 'true' || atualizarAcesso === true,
    });
    req.session.flash = { type: 'ok', msg: 'Pagamento confirmado com sucesso!' };
  } catch (err) {
    req.session.flash = { type: 'erro', msg: `Erro ao confirmar pagamento: ${err.message}` };
  }
  const mes = req.body.mes || '';
  res.redirect(`/plataforma/pagamentos${mes ? `?mes=${mes}` : ''}`);
});

// Desmarcar pagamento de um escritório para o mês
router.post('/pagamentos/:contaId/desmarcar', async (req, res) => {
  try {
    const { mes } = req.body;
    await desmarcarPagamento(req.params.contaId, mes, {
      adminEmail: req.user.email,
    });
    req.session.flash = { type: 'ok', msg: 'Pagamento desmarcado com sucesso.' };
  } catch (err) {
    req.session.flash = { type: 'erro', msg: `Erro ao desmarcar pagamento: ${err.message}` };
  }
  const mes = req.body.mes || '';
  res.redirect(`/plataforma/pagamentos${mes ? `?mes=${mes}` : ''}`);
});

// Suspender serviço/acesso de um escritório por falta de pagamento
router.post('/pagamentos/:contaId/suspender', async (req, res) => {
  try {
    const { mes, motivo } = req.body;
    const conta = await suspenderConta(req.params.contaId, {
      motivo,
      adminEmail: req.user.email,
      mes,
    });
    req.session.flash = { type: 'ok', msg: `Serviço do escritório "${conta.nome}" foi suspenso com sucesso.` };
  } catch (err) {
    req.session.flash = { type: 'erro', msg: `Erro ao suspender serviço: ${err.message}` };
  }
  const mes = req.body.mes || '';
  res.redirect(`/plataforma/pagamentos${mes ? `?mes=${mes}` : ''}`);
});

// Reativar serviço/acesso de um escritório suspenso
router.post('/pagamentos/:contaId/ativar', async (req, res) => {
  try {
    const { mes } = req.body;
    const conta = await reativarConta(req.params.contaId, {
      adminEmail: req.user.email,
      mes,
    });
    req.session.flash = { type: 'ok', msg: `Serviço do escritório "${conta.nome}" foi reativado com sucesso!` };
  } catch (err) {
    req.session.flash = { type: 'erro', msg: `Erro ao reativar serviço: ${err.message}` };
  }
  const mes = req.body.mes || '';
  res.redirect(`/plataforma/pagamentos${mes ? `?mes=${mes}` : ''}`);
});

// Relatório de pagamentos (CSV / Excel ou Impressão/PDF)
router.get('/pagamentos/relatorio', async (req, res) => {
  const formato = String(req.query.formato || 'impressao');
  const dados = await obterControlePagamentos(req.query);

  if (formato === 'csv') {
    const csv = gerarCsvPagamentos(dados);
    const agora = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="relatorio-pagamentos-${dados.mes}-${agora}.csv"`);
    return res.send(csv);
  }

  // Formato impressão / PDF
  res.render('plataforma-relatorio-impressao', {
    layout: false,
    title: `Relatório de Pagamentos - ${dados.mesFormatado}`,
    nomeProduto: env.saas.nomeProduto,
    adminEmail: req.user.email,
    brl,
    ...dados,
  });
});

export default router;
