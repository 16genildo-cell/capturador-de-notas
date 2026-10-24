import { Router } from 'express';
import mongoose from 'mongoose';
import multer from 'multer';
import { env } from '../config/env.js';
import { LISTA_PLANOS, PLANOS, TESTE, FUNCIONALIDADES, PERIODOS, planosPublicos } from '../config/planos.js';
import { listarPlanosAdmin, criarPlano, editarPlano, excluirPlano } from '../services/planos.js';
import { marcarBaixadas, situacaoArquivo, mensagemArquivoApagado } from '../services/retencao.js';
import { avisosAtivos, listarAvisos, criarAviso, apagarAviso, TIPOS_AVISO, PUBLICOS_AVISO } from '../services/avisos.js';
import { Empresa } from '../models/Empresa.js';
import { NotaFiscal } from '../models/NotaFiscal.js';
import { Certificado } from '../models/Certificado.js';
import { CapturaLog } from '../models/CapturaLog.js';
import { User, validarSenha } from '../models/User.js';
import { verificarLimiteEmpresas, verificarLimiteUsuarios, exigirRecursoApi, recursoLiberado, mensagemRecurso } from '../middleware/assinatura.js';
import { montarPainel } from '../services/painel.js';
import { montarFiltroNotas, CATEGORIAS } from '../services/filtroNotas.js';
import { detalharDocumento } from '../services/detalheNota.js';
import { gerarPdfNota, nomeArquivoNota } from '../services/pdf/documentoPdf.js';
import { obterCertificadoEmpresa } from '../services/sefaz/distribuicaoDFe.js';
import { cienciaEDownload, manifestarNota, EVENTOS, prazoManifestacao } from '../services/sefaz/manifestacao.js';
import { capturarEmpresa, capturaEmAndamento } from '../services/capturaService.js';
import { lerPfx } from '../services/crypto/certificado.js';
import { encrypt } from '../services/crypto/vault.js';
import { resumoMensal, porParceiro, porCfopNcm, gerarExcel } from '../services/relatorios.js';
import { asaasConfigurado, linkFaturaAberta } from '../services/asaas.js';
import { listarContas, ajustarConta, criarContaCliente, mensagemContaCriada, SITUACOES_INICIAIS, STATUS_CONTA, obterEscritorio, donoParaAcesso } from '../services/plataforma.js';
import { abrirSessao } from './tokens.js';
import { empresasPermitidas } from '../models/User.js';
import { obterConta } from '../middleware/assinatura.js';
import { normalizarDocumento } from '../utils/documento.js';
import { acessoParaPerfil, aplicarPerfil, lerPerfil, temAcessoNoCorpo } from '../services/permissoes.js';
import { listarMensagens, acaoMensagem } from '../services/contato.js';
import { enviarZip } from '../routes/notas.js';
import { extrairDados } from '../routes/empresas.js';
import { falha, soAdmin, idValido, contaPublica } from './util.js';

const r = Router();

/** Operador restrito a algumas empresas: filtro extra (vazio para quem ve todas). */
const restricao = (req, campo) => (req.empresasPermitidas ? { [campo]: { $in: req.empresasPermitidas } } : {});
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// ======================= Painel =======================
r.get('/painel', async (req, res) => res.json(await montarPainel(req.conta, req.empresasPermitidas)));

// Avisos da plataforma para os escritorios (o cliente do escritorio nao ve)
r.get('/avisos', async (req, res) => {
  if (req.user.role === 'cliente') return res.json({ itens: [] });
  const bloqueado = !req.ehPlataforma && !req.acessoConta?.liberado;
  res.json({ itens: await avisosAtivos(new Date(), { bloqueado }) });
});

// ======================= Notas =======================
const POR_PAGINA = 25;

r.get('/notas', async (req, res) => {
  const { filtro, filtros } = montarFiltroNotas(req.query, req.conta, req.empresasPermitidas);
  const pagina = Math.max(1, Number(req.query.pagina) || 1);
  const porPagina = Math.min(100, Math.max(5, Number(req.query.porPagina) || POR_PAGINA));
  const [itens, total, grupos] = await Promise.all([
    NotaFiscal.find(filtro).select('-xml').sort('-dataEmissao -createdAt').skip((pagina - 1) * porPagina).limit(porPagina).populate('empresa', 'razaoSocial').lean(),
    NotaFiscal.countDocuments(filtro),
    NotaFiscal.aggregate([{ $match: filtro }, { $group: { _id: { tipo: '$tipo', cancelada: '$cancelada' }, qtd: { $sum: 1 }, valor: { $sum: '$valorTotal' } } }]),
  ]);
  // Totais por tipo; notas canceladas contam na quantidade, mas nao no valor.
  const porTipo = {};
  for (const g of grupos) {
    const t = (porTipo[g._id.tipo] ||= { _id: g._id.tipo, qtd: 0, valor: 0 });
    t.qtd += g.qtd;
    if (g._id.cancelada !== true) t.valor += g.valor;
  }
  const totais = Object.values(porTipo);
  const regra = req.contaSaas.armazenamento();
  res.json({
    itens: itens.map((n) => ({ ...n, arquivo: situacaoArquivo(n, regra) })),
    armazenamento: { ...regra, rotulo: req.contaSaas.planoAtual()?.rotuloArmazenamento || 'Guarda as notas sempre' },
    total,
    pagina,
    paginas: Math.ceil(total / porPagina),
    filtros,
    categorias: CATEGORIAS,
    totais: { qtd: totais.reduce((a, t) => a + t.qtd, 0), valor: totais.reduce((a, t) => a + t.valor, 0), porTipo: Object.fromEntries(totais.map((t) => [t._id, t])) },
  });
});

// Download em lote (ZIP com XML/PDF e planilha) do filtro: ?formato=xml|pdf|ambos
r.get('/notas/exportar', exigirRecursoApi('download_lote'), async (req, res) => {
  const { filtro } = montarFiltroNotas(req.query, req.conta, req.empresasPermitidas);
  filtro.xmlApagadoEm = null; // so as notas que ainda tem o arquivo guardado
  const formato = ['xml', 'pdf', 'ambos'].includes(req.query.formato) ? req.query.formato : 'xml';
  const limite = formato === 'xml' ? 5000 : 1000;
  const total = await NotaFiscal.countDocuments(filtro);
  if (!total) throw falha(404, 'Nenhuma nota com arquivo disponível nesses filtros (os arquivos podem ter sido apagados conforme o plano).');
  if (total > limite) throw falha(400, `O filtro tem ${total} notas; o limite por download e ${limite}. Use um período menor.`);
  await enviarZip(res, filtro, formato);
});

async function notaDaConta(req, comXml = false) {
  const q = NotaFiscal.findOne({ _id: idValido(req.params.id), owner: req.conta, ...restricao(req, 'empresa') });
  if (!comXml) q.select('-xml');
  const nota = await q.populate('empresa', 'razaoSocial cnpj').lean();
  if (!nota) throw falha(404, 'Nota não encontrada.');
  return nota;
}

r.get('/notas/:id', async (req, res) => {
  const nota = await notaDaConta(req, true);
  const eventos = nota.chave ? await NotaFiscal.find({ owner: req.conta, tipo: 'evento', chaveNota: nota.chave }).select('-xml').sort('dataEmissao').lean() : [];
  const detalhe = detalharDocumento(nota);
  delete nota.xml;
  res.json({
    nota,
    arquivo: situacaoArquivo(nota, req.contaSaas.armazenamento()),
    detalhe,
    eventos,
    prazoManifestacao: nota.tipo === 'nfe' && nota.papel === 'destinatario' ? prazoManifestacao(nota.dataEmissao) : null,
    eventosManifestacao: Object.keys(EVENTOS),
  });
});

r.get('/notas/:id/xml', async (req, res) => {
  const nota = await notaDaConta(req, true);
  if (!nota.xml) throw falha(410, mensagemArquivoApagado(nota), 'arquivo-apagado');
  res.set('Content-Type', 'application/xml; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${nomeArquivoNota(nota)}.xml"`);
  res.send(nota.xml);
  marcarBaixadas({ _id: nota._id }).catch(() => {});
});

r.get('/notas/:id/pdf', async (req, res) => {
  const nota = await notaDaConta(req, true);
  if (!nota.xml) throw falha(410, mensagemArquivoApagado(nota), 'arquivo-apagado');
  const pdf = await gerarPdfNota(nota);
  res.set('Content-Type', 'application/pdf');
  res.set('Content-Disposition', `${req.query.baixar ? 'attachment' : 'inline'}; filename="${nomeArquivoNota(nota)}.pdf"`);
  res.send(pdf);
});

async function empresaComCertificado(nota) {
  const empresa = await Empresa.findById(nota.empresa._id || nota.empresa).populate('certificado');
  return { empresa, certificado: await obterCertificadoEmpresa(empresa) };
}

r.post('/notas/:id/ciencia', exigirRecursoApi('manifestacao'), async (req, res) => {
  const nota = await notaDaConta(req, true);
  if (!nota.resumo) throw falha(400, 'Esta nota já tem o XML completo.');
  const { empresa, certificado } = await empresaComCertificado(nota);
  res.json(await cienciaEDownload(empresa, certificado, nota));
});

r.post('/notas/:id/manifestar', exigirRecursoApi('manifestacao'), async (req, res) => {
  soAdmin(req);
  const tipo = String(req.body.tipo || '');
  if (!EVENTOS[tipo] || tipo === 'ciencia') throw falha(400, 'Escolha o tipo de manifestação.');
  const nota = await notaDaConta(req, true);
  if (!['nfe', 'nfce'].includes(nota.tipo) || !nota.chave) throw falha(400, 'Manifestação só se aplica a NF-e recebidas.');
  const { empresa, certificado } = await empresaComCertificado(nota);
  res.json(await manifestarNota(empresa, certificado, nota, tipo, req.body.justificativa));
});

// ======================= Empresas =======================
async function empresaDaConta(req) {
  const e = await Empresa.findOne({ _id: idValido(req.params.id), owner: req.conta, ...restricao(req, '_id') }).populate('certificado', 'apelido validoAte titular');
  if (!e) throw falha(404, 'Empresa não encontrada.');
  return e;
}

/** O formulario web/app manda booleanos; o extrator do site espera "on". */
function dadosEmpresa(req) {
  const b = { ...req.body };
  for (const k of ['capturaNfe', 'capturaNfse', 'capturaCte']) b[k] = b[k] === true || b[k] === 'on' ? 'on' : '';
  return extrairDados({ body: b });
}

r.get('/empresas', async (req, res) => {
  const lista = await Empresa.find({ owner: req.conta, ...restricao(req, '_id') }).populate('certificado', 'apelido validoAte titular').sort('razaoSocial');
  res.json({ itens: lista.map((e) => ({ ...e.toObject(), capturando: capturaEmAndamento(e._id) })), limite: contaPublica(req.contaSaas).limiteEmpresas });
});

r.get('/empresas/:id', async (req, res) => {
  const e = await empresaDaConta(req);
  const logs = await CapturaLog.find({ empresa: e._id }).sort('-createdAt').limit(30).lean();
  res.json({ empresa: { ...e.toObject(), capturando: capturaEmAndamento(e._id) }, logs });
});

r.post('/empresas', async (req, res) => {
  soAdmin(req);
  try {
    await verificarLimiteEmpresas(req);
  } catch (err) {
    throw falha(402, err.message, 'limite');
  }
  const dados = dadosEmpresa(req);
  if (dados.certificado && !(await Certificado.exists({ _id: dados.certificado, owner: req.conta }))) throw falha(400, 'Certificado inválido.');
  const nova = await Empresa.create({ ...dados, owner: req.conta });
  res.status(201).json({ empresa: nova.toObject() });
});

r.put('/empresas/:id', async (req, res) => {
  soAdmin(req);
  const e = await empresaDaConta(req);
  const dados = dadosEmpresa(req);
  if (dados.certificado && !(await Certificado.exists({ _id: dados.certificado, owner: req.conta }))) throw falha(400, 'Certificado inválido.');
  await Empresa.updateOne({ _id: e._id, owner: req.conta }, dados, { runValidators: true });
  res.json({ ok: true });
});

r.delete('/empresas/:id', async (req, res) => {
  soAdmin(req);
  const e = await empresaDaConta(req);
  await Empresa.deleteOne({ _id: e._id, owner: req.conta });
  res.json({ ok: true });
});

r.post('/empresas/:id/capturar', async (req, res) => {
  const e = await empresaDaConta(req);
  const tipos = Array.isArray(req.body?.tipos) ? req.body.tipos.filter((t) => ['nfe', 'nfse', 'cte'].includes(t)) : undefined;
  const resultado = await capturarEmpresa(e._id, { origem: 'manual', tipos });
  res.json({ resultado, novos: (resultado.nfe?.novos || 0) + (resultado.nfse?.novos || 0) + (resultado.cte?.novos || 0) });
});

r.post('/captura/todas', async (req, res) => {
  const empresas = await Empresa.find({ owner: req.conta, ativa: true, ...restricao(req, '_id') }).select('_id razaoSocial').lean();
  let novos = 0;
  let erros = 0;
  for (const e of empresas) {
    try {
      const x = await capturarEmpresa(e._id, { origem: 'manual' });
      novos += (x.nfe?.novos || 0) + (x.nfse?.novos || 0) + (x.cte?.novos || 0);
      if ([x.nfe, x.nfse, x.cte].some((y) => y?.status === 'erro')) erros += 1;
    } catch {
      erros += 1;
    }
  }
  res.json({ empresas: empresas.length, novos, erros });
});

r.get('/captura/historico', async (req, res) => {
  const ids = await Empresa.find({ owner: req.conta, ...restricao(req, '_id') }).distinct('_id');
  res.json({ itens: await CapturaLog.find({ empresa: { $in: ids } }).sort('-createdAt').limit(50).populate('empresa', 'razaoSocial').lean() });
});

// ======================= Certificados =======================
r.get('/certificados', async (req, res) => {
  soAdmin(req);
  const lista = await Certificado.find({ owner: req.conta }).select('-pfxCriptografado -senhaCriptografada').sort('-createdAt');
  res.json({ itens: lista.map((c) => c.toObject()) });
});

r.post('/certificados', upload.single('pfx'), async (req, res) => {
  soAdmin(req);
  if (!req.file) throw falha(400, 'Envie o arquivo .pfx/.p12.');
  if (!req.body.senha) throw falha(400, 'Informe a senha do certificado.');
  let info;
  try {
    info = lerPfx(req.file.buffer, req.body.senha);
  } catch (err) {
    throw falha(400, `Não foi possível ler o certificado: ${err.message}. Verifique o arquivo e a senha.`);
  }
  const c = await Certificado.create({
    owner: req.conta,
    apelido: String(req.body.apelido || '').trim() || info.titular || 'Certificado A1',
    titular: info.titular,
    cnpjCpf: info.cnpjCpf,
    emissor: info.emissor,
    validoDe: info.validoDe,
    validoAte: info.validoAte,
    pfxCriptografado: encrypt(req.file.buffer),
    senhaCriptografada: encrypt(req.body.senha),
  });
  const { pfxCriptografado, senhaCriptografada, ...seguro } = c.toObject();
  res.status(201).json({ certificado: seguro });
});

r.delete('/certificados/:id', async (req, res) => {
  soAdmin(req);
  await Certificado.deleteOne({ _id: idValido(req.params.id), owner: req.conta });
  res.json({ ok: true });
});

// ======================= Relatorios =======================
function filtroRelatorio(req) {
  const q = { ...req.query };
  if (!q.mes && !q.ano && !q.de && !q.ate) q.ano = String(new Date().getFullYear());
  return montarFiltroNotas(q, req.conta, req.empresasPermitidas);
}

r.get('/relatorios', exigirRecursoApi('relatorios'), async (req, res) => {
  const { filtro, filtros } = filtroRelatorio(req);
  const [meses, fornecedores, clientes, itens] = await Promise.all([
    resumoMensal(filtro),
    porParceiro(filtro, 'destinatario', 15),
    porParceiro(filtro, 'emitente', 15),
    porCfopNcm(filtro),
  ]);
  res.json({ filtros, meses, fornecedores, clientes, itens });
});

r.get('/relatorios/excel', exigirRecursoApi('relatorios'), async (req, res) => {
  const buf = await gerarExcel(filtroRelatorio(req).filtro);
  res.attachment(`relatorio-notas-${new Date().toISOString().slice(0, 10)}.xlsx`);
  res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(Buffer.from(buf));
});

// ======================= Usuarios da conta =======================
const daConta = (req) => ({ $or: [{ _id: req.conta }, { conta: req.conta }] });

async function usuarioAlvo(req) {
  soAdmin(req);
  const u = await User.findOne({ _id: idValido(req.params.id), ...daConta(req) });
  if (!u) throw falha(404, 'Usuário não encontrado.');
  if (String(u._id) === String(req.user._id)) throw falha(400, 'Você não pode alterar o próprio usuário aqui.');
  if (String(u._id) === String(req.conta)) throw falha(400, 'O dono da conta não pode ser alterado.');
  return u;
}

/** O plano permite este perfil? Cliente do escritorio depende da funcionalidade; equipe, do limite. */
async function checarPerfilNoPlano(req, role, { contarVaga = true } = {}) {
  if (role === 'cliente') {
    if (!recursoLiberado(req, 'acesso_clientes')) throw falha(403, mensagemRecurso('acesso_clientes'), 'recurso');
    return;
  }
  if (!contarVaga) return;
  try {
    await verificarLimiteUsuarios(req);
  } catch (err) {
    throw falha(402, err.message, 'limite');
  }
}

r.get('/usuarios', async (req, res) => {
  soAdmin(req);
  const [itens, empresas] = await Promise.all([
    User.find(daConta(req)).select('nome email role ativo ultimoLogin createdAt todasEmpresas empresas').sort('nome').lean(),
    Empresa.find({ owner: req.conta }).select('razaoSocial cnpj').sort('razaoSocial').lean(),
  ]);
  res.json({
    itens: itens.map((u) => ({ ...u, todasEmpresas: u.role === 'admin' || (u.role !== 'cliente' && u.todasEmpresas !== false), empresas: (u.empresas || []).map(String) })),
    empresas,
    dono: String(req.conta),
    eu: String(req.user._id),
  });
});

r.post('/usuarios', async (req, res) => {
  soAdmin(req);
  const nome = String(req.body.nome || '').trim();
  const email = String(req.body.email || '').toLowerCase().trim();
  if (!nome || !email) throw falha(400, 'Informe nome e e-mail.');
  try {
    validarSenha(req.body.senha);
  } catch (err) {
    throw falha(400, err.message);
  }
  if (await User.exists({ email })) throw falha(400, 'Já existe um usuário com esse e-mail.');
  const role = lerPerfil(req.body.role);
  await checarPerfilNoPlano(req, role);
  let acesso;
  try {
    acesso = await acessoParaPerfil(req.conta, role, req.body);
  } catch (err) {
    throw falha(400, err.message);
  }
  const u = await User.criar({ nome, email, senha: req.body.senha, role, conta: req.conta, ...acesso });
  res.status(201).json({ usuario: { _id: u._id, nome, email, role: u.role, ativo: true, ...acesso } });
});

r.patch('/usuarios/:id', async (req, res) => {
  const u = await usuarioAlvo(req);
  // Limites do plano: reativar alguem da equipe ou tirar do perfil "cliente" ocupa uma vaga.
  const novoRole = req.body.role ? lerPerfil(req.body.role) : u.role;
  const vaiAtivar = req.body.ativo === true && u.ativo === false;
  if (novoRole !== u.role || vaiAtivar) {
    const ocupaVaga = novoRole !== 'cliente' && (vaiAtivar || u.role === 'cliente');
    await checarPerfilNoPlano(req, novoRole, { contarVaga: ocupaVaga });
  }
  if (typeof req.body.ativo === 'boolean') u.ativo = req.body.ativo;
  try {
    // Primeiro os clientes liberados, depois o perfil (o cliente do escritorio precisa de CNPJs marcados).
    if (temAcessoNoCorpo(req.body)) {
      const novoPerfil = req.body.role ? lerPerfil(req.body.role) : u.role;
      if (novoPerfil === 'admin') throw new Error('Administradores veem todos os clientes. Mude o perfil para restringir.');
      const acesso = await acessoParaPerfil(req.conta, novoPerfil, req.body);
      u.todasEmpresas = acesso.todasEmpresas;
      u.empresas = acesso.empresas;
    }
    if (req.body.role) aplicarPerfil(u, lerPerfil(req.body.role));
  } catch (err) {
    throw falha(400, err.message);
  }
  if (req.body.senha) {
    try {
      validarSenha(req.body.senha);
    } catch (err) {
      throw falha(400, err.message);
    }
    u.senhaHash = await User.hashSenha(req.body.senha);
  }
  await u.save();
  res.json({ ok: true });
});

r.delete('/usuarios/:id', async (req, res) => {
  const u = await usuarioAlvo(req);
  await User.deleteOne({ _id: u._id });
  res.json({ ok: true });
});

// ======================= Minha conta / assinatura =======================
r.get('/conta', async (req, res) => {
  const [empresasUsadas, usuarios] = await Promise.all([Empresa.countDocuments({ owner: req.conta }), User.countDocuments(daConta(req))]);
  const equipe = await User.countDocuments({ ...daConta(req), role: { $ne: 'cliente' }, ativo: true });
  res.json({ conta: contaPublica(req.contaSaas), empresasUsadas, usuarios, equipe, planos: planosPublicos(), funcionalidades: FUNCIONALIDADES, cobrancaAtiva: asaasConfigurado(), emailSuporte: env.saas.emailSuporte });
});

r.put('/conta', async (req, res) => {
  soAdmin(req);
  const conta = req.contaSaas;
  const nome = String(req.body.nome || '').trim();
  if (!nome) throw falha(400, 'Informe o nome da conta.');
  conta.nome = nome;
  if (req.body.documento) {
    let doc;
    try {
      doc = normalizarDocumento(req.body.documento);
    } catch (err) {
      throw falha(400, err.message);
    }
    if (conta.asaas?.customerId && conta.documento && doc !== conta.documento) throw falha(400, 'O documento de cobrança não pode ser trocado depois de assinar.');
    conta.documento = doc;
  }
  if (req.body.emailCobranca !== undefined) conta.emailCobranca = String(req.body.emailCobranca).trim().toLowerCase();
  if (req.body.telefone !== undefined) conta.telefone = String(req.body.telefone).trim();
  if (Array.isArray(req.body.alertasPara)) {
    conta.set('config.alertasPara', req.body.alertasPara.map((s) => String(s).trim().toLowerCase()).filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)).slice(0, 10));
  }
  await conta.save();
  res.json({ conta: contaPublica(conta) });
});

// Contratacao online desativada: plano, troca e cancelamento sao feitos pela equipe da plataforma.
const MSG_CONTRATACAO = 'A contratação, a troca de plano e o cancelamento são feitos com a nossa equipe.';
r.post('/conta/plano', () => {
  throw falha(403, MSG_CONTRATACAO, 'contratacao');
});

r.get('/conta/fatura', async (req, res) => {
  res.json({ fatura: await linkFaturaAberta(req.contaSaas) });
});

r.post('/conta/cancelar', () => {
  throw falha(403, MSG_CONTRATACAO, 'contratacao');
});

// ======================= Plataforma (dono do SaaS) =======================
r.use('/plataforma', (req, res, next) => (req.ehPlataforma ? next() : next(falha(404, 'Rota não encontrada.'))));
r.get('/plataforma/contas', async (req, res) => {
  const dados = await listarContas(req.query);
  dados.contas = dados.contas.map((c) => ({ ...c, limite: c.limite === Infinity ? null : c.limite, limiteUsuarios: c.limiteUsuarios === Infinity ? null : c.limiteUsuarios }));
  res.json({ ...dados, planos: LISTA_PLANOS, status: STATUS_CONTA, situacoesIniciais: SITUACOES_INICIAIS, teste: TESTE, asaasAtivo: asaasConfigurado(), asaasAmbiente: env.asaas.ambiente });
});
// Pagina de um escritorio
r.get('/plataforma/escritorios/:id', async (req, res) => {
  const d = await obterEscritorio(req.params.id);
  if (!d) throw falha(404, 'Escritório não encontrado.');
  res.json({ ...d, limite: d.limite === Infinity ? null : d.limite, limiteUsuarios: d.limiteUsuarios === Infinity ? null : d.limiteUsuarios, planos: LISTA_PLANOS, status: STATUS_CONTA, funcionalidades: FUNCIONALIDADES, carenciaDias: env.saas.carenciaDias });
});

// Acessar o escritorio como suporte: devolve uma sessao do dono do escritorio.
// O site guarda a sessao do dono da plataforma e mostra a faixa "Voltar para a plataforma".
r.post('/plataforma/escritorios/:id/acessar', async (req, res) => {
  let alvo;
  try {
    alvo = await donoParaAcesso(req.params.id);
  } catch (err) {
    throw falha(400, err.message);
  }
  const { conta, dono } = alvo;
  console.log(`[plataforma] ${req.user.email} acessou o escritório ${conta._id} (${conta.nome}) como suporte`);
  const tokens = await abrirSessao(dono, { cliente: 'suporte', ip: req.ip });
  res.json({
    ...tokens,
    escritorio: { id: String(conta._id), nome: conta.nome },
    usuario: { id: String(dono._id), nome: dono.nome, email: dono.email, role: dono.role, plataforma: false, restrito: Boolean(empresasPermitidas(dono)) },
    conta: contaPublica(await obterConta(dono._id)),
  });
});

// Mensagens do formulario de contato do site
r.get('/plataforma/mensagens', async (req, res) => res.json(await listarMensagens(req.query.filtro)));
r.post('/plataforma/mensagens/:id', async (req, res) => {
  try {
    res.json({ ok: true, mensagem: await acaoMensagem(req.params.id, String(req.body?.acao || '')) });
  } catch (err) {
    throw falha(400, err.message);
  }
});

// Criar a conta de um novo cliente (o cadastro publico fica fechado)
r.post('/plataforma/contas', async (req, res) => {
  let resultado;
  try {
    resultado = await criarContaCliente(req.body || {}, { criadoPor: req.user.email });
  } catch (err) {
    throw falha(400, err.message);
  }
  console.log(`[plataforma] ${req.user.email} criou a conta ${resultado.conta._id} (${resultado.user.email})`);
  res.status(201).json({
    ok: true,
    id: String(resultado.conta._id),
    convite: resultado.convite,
    senhaGerada: resultado.senhaGerada,
    mensagem: mensagemContaCriada(resultado),
  });
});
r.post('/plataforma/contas/:id', async (req, res) => {
  try {
    const conta = await ajustarConta(req.params.id, req.body, { por: req.user.email });
    console.log(`[plataforma] ${req.user.email} -> conta ${conta._id}: ${req.body.acao}`);
    res.json({ ok: true, aviso: conta.aviso || null });
  } catch (err) {
    throw falha(400, err.message);
  }
});

// Avisos para todos os escritorios
r.get('/plataforma/avisos', async (req, res) => res.json({ itens: await listarAvisos(), tipos: TIPOS_AVISO, publicos: PUBLICOS_AVISO }));
r.post('/plataforma/avisos', async (req, res) => {
  try {
    const aviso = await criarAviso(req.body || {}, { por: req.user.nome });
    console.log(`[plataforma] ${req.user.email} publicou o aviso "${aviso.titulo}"`);
    res.status(201).json({ aviso });
  } catch (err) {
    throw falha(400, err.message);
  }
});
r.delete('/plataforma/avisos/:id', async (req, res) => {
  try {
    await apagarAviso(req.params.id);
    console.log(`[plataforma] ${req.user.email} apagou o aviso ${req.params.id}`);
    res.json({ ok: true });
  } catch (err) {
    throw falha(404, err.message);
  }
});

// Planos (criar, editar, arquivar, excluir)
r.get('/plataforma/planos', async (req, res) => {
  res.json({ itens: await listarPlanosAdmin(), funcionalidades: FUNCIONALIDADES, periodos: PERIODOS });
});
r.post('/plataforma/planos', async (req, res) => {
  try {
    const plano = await criarPlano(req.body || {});
    console.log(`[plataforma] ${req.user.email} criou o plano ${plano.id}`);
    res.status(201).json({ plano });
  } catch (err) {
    throw falha(400, err.message);
  }
});
r.put('/plataforma/planos/:id', async (req, res) => {
  try {
    const plano = await editarPlano(req.params.id, req.body || {});
    console.log(`[plataforma] ${req.user.email} editou o plano ${plano.id}`);
    res.json({ plano });
  } catch (err) {
    throw falha(400, err.message);
  }
});
r.delete('/plataforma/planos/:id', async (req, res) => {
  try {
    await excluirPlano(req.params.id);
    console.log(`[plataforma] ${req.user.email} excluiu o plano ${req.params.id}`);
    res.json({ ok: true });
  } catch (err) {
    throw falha(400, err.message);
  }
});

export { mongoose };
export default r;
