import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { Conta, STATUS_CONTA } from '../models/Conta.js';
import { User, validarSenha } from '../models/User.js';
import { Empresa } from '../models/Empresa.js';
import { NotaFiscal } from '../models/NotaFiscal.js';
import { EventoCobranca } from '../models/EventoCobranca.js';
import { CapturaLog } from '../models/CapturaLog.js';
import { LISTA_PLANOS, PLANOS, TESTE, somarPeriodo, mesesDoPeriodo, rotuloPeriodo, brl } from '../config/planos.js';
import { cancelarAssinatura } from './asaas.js';
import { env } from '../config/env.js';
import { normalizarDocumento } from '../utils/documento.js';
import { emailConfigurado, enviarEmail, montarHtml } from './email.js';
import { gerarLinkSenha } from './cadastro.js';

/** Situacoes iniciais permitidas ao criar uma conta pelo painel ('ativa' = 1o periodo ja pago). */
export const SITUACOES_INICIAIS = ['teste', 'ativa', 'cortesia'];
const DIAS_CONVITE = 7;

/**
 * Cria a conta de um cliente pelo painel da plataforma (o cadastro publico fica fechado).
 * Cria o usuario dono (administrador da conta) + a Conta.
 *
 * Senha do cliente:
 *  - informada pelo dono da plataforma: o cliente ja entra com ela;
 *  - em branco, com e-mail configurado: o cliente recebe um convite para criar a senha (7 dias);
 *  - em branco, sem e-mail: o sistema gera uma senha provisoria e devolve para ser repassada.
 *
 * @returns {Promise<{ conta, user, senhaGerada: string|null, convite: boolean, emailEnviado: boolean }>}
 */
export async function criarContaCliente(dados = {}, { criadoPor } = {}) {
  const nome = String(dados.nome || '').trim();
  const email = String(dados.email || '').toLowerCase().trim();
  const nomeConta = String(dados.conta || '').trim() || nome;
  const telefone = String(dados.telefone || '').trim();
  const senha = String(dados.senha || '');
  const plano = PLANOS[dados.plano] ? dados.plano : null;
  if (dados.plano && !plano) throw new Error('Plano não encontrado.');
  if (plano && !PLANOS[plano].ativo) throw new Error('Este plano está arquivado. Escolha outro plano.');
  let situacao = SITUACOES_INICIAIS.includes(dados.situacao) ? dados.situacao : 'teste';
  if (situacao === 'ativa' && !plano) throw new Error('Para comecar com o período já pago, escolha um plano.');
  // Dias gratis: o informado; senao o do plano; senao o padrao do sistema.
  const diasPadrao = plano ? PLANOS[plano].diasGratis : TESTE.dias;
  const diasTeste = Math.min(365, Math.max(0, Math.floor(Number(dados.diasTeste === '' || dados.diasTeste == null ? diasPadrao : dados.diasTeste)) || 0));
  if (situacao === 'teste' && diasTeste < 1) {
    if (!plano) throw new Error('Informe os dias de teste grátis.');
    situacao = 'ativa'; // plano sem periodo gratis: ja comeca valendo
  }
  const limiteTxt = String(dados.limite ?? '').trim();

  if (!nome || !email) throw new Error('Informe o nome do responsável e o e-mail.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('E-mail inválido.');
  const documento = String(dados.documento || '').trim() ? normalizarDocumento(dados.documento) : undefined;
  if (senha) validarSenha(senha);
  if (await User.exists({ email })) throw new Error('Já existe um usuário com esse e-mail.');

  const user = await User.criar({
    nome,
    email,
    // Sem senha informada: senha aleatoria (o cliente cria a dele pelo convite ou recebe a provisoria).
    senha: senha || crypto.randomBytes(24).toString('base64url'),
    role: 'admin',
  });

  let conta;
  try {
    conta = await Conta.create({
      _id: user._id,
      nome: nomeConta,
      documento,
      emailCobranca: email,
      telefone: telefone || undefined,
      plano,
      status: situacao,
      testeAte: situacao === 'teste' ? new Date(Date.now() + diasTeste * 864e5) : undefined,
      pagoAte: situacao === 'ativa' ? somarPeriodo(new Date(), PLANOS[plano].periodo) : undefined,
      limiteEmpresasManual: limiteTxt === '' ? null : Math.max(0, Number(limiteTxt) || 0),
      observacao: String(dados.observacao || '').trim().slice(0, 1000) || (criadoPor ? `Criada por ${criadoPor}` : undefined),
      historico: [{ em: new Date(), acao: 'criada', detalhe: [plano ? `plano ${PLANOS[plano].nome}` : 'sem plano', situacao === 'teste' ? `${diasTeste} dia(s) grátis` : situacao].join(', '), por: criadoPor || 'sistema' }],
    });
  } catch (err) {
    await User.deleteOne({ _id: user._id });
    throw err;
  }

  const primeiroNome = nome.split(' ')[0];
  const passos = [
    'Envie os certificados digitais A1 (.pfx) dos seus clientes em Certificados.',
    'Cadastre cada cliente em Clientes e clique em "Capturar agora".',
    'Em Usuários, cadastre a sua equipe e, se quiser, de a cada cliente um acesso só de consulta as notas dele.',
  ];
  if (situacao === 'teste') passos.push(`Você tem ${diasTeste} dias de teste grátis.`);
  if (situacao === 'ativa') passos.push(`Seu plano ${PLANOS[plano].nome} já está valendo.`);

  // 1) Senha definida pelo dono da plataforma: so avisa que a conta esta pronta.
  if (senha) {
    const emailEnviado = await enviarEmail({
      para: [email],
      assunto: `Sua conta no ${env.saas.nomeProduto} está pronta`,
      html: montarHtml(`Ola, ${primeiroNome}! Sua conta foi criada.`, [
        { titulo: 'Acesso', itens: [`Entre em ${env.webUrl}/login com o e-mail ${email} e a senha que você recebeu.`] },
        { titulo: 'Próximos passos', itens: passos },
      ], env.webUrl),
    }).catch((err) => {
      console.error('[email] conta criada:', err.message);
      return false;
    });
    return { conta, user, senhaGerada: null, convite: false, emailEnviado };
  }

  // 2) Convite por e-mail para o cliente criar a propria senha.
  if (emailConfigurado()) {
    try {
      const link = await gerarLinkSenha(user, DIAS_CONVITE * 24);
      const enviado = await enviarEmail({
        para: [email],
        assunto: `Convite: crie sua senha no ${env.saas.nomeProduto}`,
        html: montarHtml(`Ola, ${primeiroNome}! Sua conta foi criada.`, [
          { titulo: `Crie sua senha (link válido por ${DIAS_CONVITE} dias)`, itens: [link] },
          { titulo: 'Próximos passos', itens: passos },
        ], `Depois de criar a senha, entre em ${env.webUrl}/login`),
      });
      if (enviado) return { conta, user, senhaGerada: null, convite: true, emailEnviado: true };
    } catch (err) {
      console.error('[email] convite:', err.message);
    }
  }

  // 3) Sem e-mail (ou falhou): senha provisoria para o dono da plataforma repassar.
  const senhaGerada = crypto.randomBytes(9).toString('base64url');
  await User.updateOne({ _id: user._id }, { senhaHash: await User.hashSenha(senhaGerada), resetTokenHash: null, resetExpira: null });
  return { conta, user, senhaGerada, convite: false, emailEnviado: false };
}

/** Mensagem para mostrar ao dono da plataforma depois de criar a conta. */
export function mensagemContaCriada({ conta, user, senhaGerada, convite, emailEnviado }) {
  const base = `Escritório "${conta.nome}" criado para ${user.email}.`;
  if (convite) return `${base} Enviamos um convite por e-mail para o responsável criar a senha.`;
  if (senhaGerada) return `${base} Senha provisoria: ${senhaGerada} (anote agora, ela não será mostrada de novo; o responsável pode troca-la em "Trocar senha").`;
  return `${base} O responsável já pode entrar com a senha informada.${emailEnviado ? ' Enviamos um e-mail avisando.' : ''}`;
}

/** Contas de clientes com uso, situacao e resumo financeiro (painel do dono da plataforma). */
export async function listarContas(consulta = {}) {
  const filtroStatus = STATUS_CONTA.includes(consulta.status) ? consulta.status : '';
  const busca = String(consulta.q || '').trim();
  const filtro = {};
  if (filtroStatus) filtro.status = filtroStatus;
  if (busca) {
    const rx = new RegExp(busca.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const donos = await User.find({ $or: [{ email: rx }, { nome: rx }] }).select('_id conta').lean();
    filtro.$or = [{ nome: rx }, { documento: rx }, { _id: { $in: donos.map((u) => u.conta || u._id) } }];
  }

  const contas = await Conta.find(filtro).sort('-createdAt').limit(500).lean();
  const ids = contas.map((c) => c._id);
  const [donos, empresas, notas, usuarios, todas, eventos] = await Promise.all([
    User.find({ _id: { $in: ids } }).select('nome email ultimoLogin').lean(),
    Empresa.aggregate([{ $match: { owner: { $in: ids } } }, { $group: { _id: '$owner', n: { $sum: 1 } } }]),
    NotaFiscal.aggregate([{ $match: { owner: { $in: ids } } }, { $group: { _id: '$owner', n: { $sum: 1 } } }]),
    User.find({ $or: [{ _id: { $in: ids } }, { conta: { $in: ids } }] })
      .select('conta ultimoLogin')
      .lean()
      .then((lista) => {
        const porConta = new Map();
        for (const u of lista) {
          const k = String(u.conta || u._id);
          const g = porConta.get(k) || { _id: k, n: 0, ultimo: null };
          g.n += 1;
          if (u.ultimoLogin && (!g.ultimo || u.ultimoLogin > g.ultimo)) g.ultimo = u.ultimoLogin;
          porConta.set(k, g);
        }
        return [...porConta.values()];
      }),
    Conta.find({}).select('status plano').lean(),
    EventoCobranca.find({}).sort('-createdAt').limit(15).populate('conta', 'nome').lean(),
  ]);
  const mapa = (lista) => new Map(lista.map((x) => [String(x._id), x]));
  const mDonos = mapa(donos);
  const mEmp = mapa(empresas);
  const mNotas = mapa(notas);
  const mUsu = mapa(usuarios);

  const resumo = { total: todas.length, porStatus: {}, mrr: 0, pagantes: 0 };
  for (const c of todas) {
    resumo.porStatus[c.status] = (resumo.porStatus[c.status] || 0) + 1;
    // Receita mensal estimada: preco do plano convertido para 1 mes (anual / 12, 15 dias x 2...).
    if (c.status === 'ativa' && PLANOS[c.plano]) {
      resumo.mrr += PLANOS[c.plano].preco / mesesDoPeriodo(PLANOS[c.plano].periodo);
      resumo.pagantes += 1;
    }
  }

  return {
    contas: contas.map((c) => {
      const doc = Conta.hydrate(c);
      return {
        ...c,
        dono: mDonos.get(String(c._id)),
        empresas: mEmp.get(String(c._id))?.n || 0,
        notas: mNotas.get(String(c._id))?.n || 0,
        usuarios: mUsu.get(String(c._id))?.n || 0,
        ultimoAcesso: mUsu.get(String(c._id))?.ultimo,
        limite: doc.limiteEmpresas(),
        limiteUsuarios: doc.limiteUsuarios(),
        acesso: doc.acesso(),
        historico: undefined,
      };
    }),
    resumo,
    eventos,
    filtroStatus,
    busca,
  };
}

const DIA = 864e5;
const dataBR = (d) => (d ? new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '-');

/** Plano valido para atribuir (o atual pode continuar mesmo se arquivado). */
function planoParaAtribuir(conta, id) {
  const plano = PLANOS[id];
  if (!plano) throw new Error('Plano não encontrado.');
  if (!plano.ativo && conta.plano !== plano.id) throw new Error('Este plano está arquivado. Reative-o em Planos ou escolha outro.');
  return plano;
}

/**
 * Ajuste de uma conta pelo dono da plataforma. Acoes:
 *  - atribuir-plano { plano, inicio: 'gratis' | 'pago' | 'cortesia' | 'manter', dias? }
 *  - renovar { periodos? }         registra pagamento: soma N periodos do plano ao "pago ate"
 *  - pausar / retomar              pausa sem acesso; ao retomar, devolve os dias que faltavam
 *  - bloquear { motivo? } / desbloquear
 *  - cancelar { imediato? }        imediato = corta o acesso agora (inadimplente/calote)
 *  - inadimplente                  marca em atraso (bloqueia apos a carencia)
 *  - status, plano, estender-teste, limite, limite-usuarios, observacao (ajustes diretos)
 * @returns {Promise<Conta>} (conta.aviso traz um alerta opcional para mostrar)
 */
export async function ajustarConta(id, dados = {}, { por } = {}) {
  if (!mongoose.isValidObjectId(id)) throw new Error('Conta inválida.');
  const conta = await Conta.findById(id);
  if (!conta) throw new Error('Conta não encontrada.');
  const acao = String(dados.acao || '');
  const agora = new Date();
  const log = (detalhe) => conta.registrar(acao, detalhe, por);
  const limparPausa = () => {
    conta.statusAnterior = null;
    conta.pausadaEm = undefined;
  };

  switch (acao) {
    case 'atribuir-plano': {
      if (!dados.plano) {
        const antes = conta.planoAtual()?.nome;
        conta.plano = null;
        log(`plano removido${antes ? ` (era ${antes})` : ''}`);
        break;
      }
      const plano = planoParaAtribuir(conta, dados.plano);
      const inicio = ['gratis', 'pago', 'cortesia', 'manter'].includes(dados.inicio) ? dados.inicio : 'manter';
      conta.plano = plano.id;
      if (inicio === 'gratis') {
        const dias = Math.floor(Number(dados.dias === '' || dados.dias == null ? plano.diasGratis : dados.dias));
        if (!(dias >= 1 && dias <= 365)) throw new Error('Informe de 1 a 365 dias grátis (este plano não tem período grátis definido).');
        conta.status = 'teste';
        conta.testeAte = new Date(agora.getTime() + dias * DIA);
        limparPausa();
        log(`${plano.nome} com ${dias} dia(s) grátis, até ${dataBR(conta.testeAte)}`);
      } else if (inicio === 'pago') {
        conta.status = 'ativa';
        conta.pagoAte = somarPeriodo(agora, plano.periodo);
        limparPausa();
        log(`${plano.nome} (${rotuloPeriodo(plano.periodo).toLowerCase()}, ${brl(plano.preco)}), pago até ${dataBR(conta.pagoAte)}`);
      } else if (inicio === 'cortesia') {
        conta.status = 'cortesia';
        limparPausa();
        log(`${plano.nome} como cortesia (sem cobrança)`);
      } else {
        log(`plano trocado para ${plano.nome}`);
      }
      break;
    }
    case 'renovar': {
      const plano = conta.planoAtual();
      if (!plano) throw new Error('Atribua um plano antes de registrar o pagamento.');
      const n = Math.min(24, Math.max(1, Math.floor(Number(dados.periodos) || 1)));
      // Pagou em dia (ou dentro da carencia): o periodo novo emenda no anterior. Senao, comeca hoje.
      const carencia = env.saas.carenciaDias * DIA;
      let fim = conta.pagoAte && conta.pagoAte.getTime() + carencia > agora.getTime() ? conta.pagoAte : agora;
      for (let i = 0; i < n; i += 1) fim = somarPeriodo(fim, plano.periodo);
      conta.pagoAte = fim;
      // Pausada/bloqueada continua assim; ao retomar/desbloquear volta como ativa.
      if (['pausada', 'suspensa'].includes(conta.status)) conta.statusAnterior = 'ativa';
      else if (conta.status !== 'cortesia') conta.status = 'ativa';
      log(`pagamento de ${n} período(s) (${brl(plano.preco * n)}), pago até ${dataBR(fim)}`);
      break;
    }
    case 'pausar': {
      if (['pausada', 'suspensa', 'cancelada'].includes(conta.status)) throw new Error(`A conta está ${conta.status}: não da para pausar.`);
      conta.statusAnterior = conta.status;
      conta.pausadaEm = agora;
      conta.status = 'pausada';
      log(dados.motivo ? `pausada: ${String(dados.motivo).slice(0, 200)}` : 'pausada');
      break;
    }
    case 'retomar': {
      if (conta.status !== 'pausada') throw new Error('A conta não está pausada.');
      const parada = conta.pausadaEm ? agora.getTime() - conta.pausadaEm.getTime() : 0;
      // Devolve os dias parados a quem ainda tinha periodo (gratis ou pago) quando pausou.
      if (parada > 0 && conta.testeAte && conta.testeAte > conta.pausadaEm) conta.testeAte = new Date(conta.testeAte.getTime() + parada);
      if (parada > 0 && conta.pagoAte && conta.pagoAte > conta.pausadaEm) conta.pagoAte = new Date(conta.pagoAte.getTime() + parada);
      conta.status = conta.statusAnterior && conta.statusAnterior !== 'pausada' ? conta.statusAnterior : 'ativa';
      limparPausa();
      log(`retomada (${Math.round(parada / DIA)} dia(s) parada devolvidos)`);
      break;
    }
    case 'bloquear': {
      if (conta.status === 'suspensa') throw new Error('A conta já está bloqueada.');
      conta.statusAnterior = conta.status === 'pausada' ? conta.statusAnterior : conta.status;
      conta.pausadaEm = undefined;
      conta.status = 'suspensa';
      log(dados.motivo ? `bloqueada: ${String(dados.motivo).slice(0, 200)}` : 'bloqueada');
      break;
    }
    case 'desbloquear': {
      if (conta.status !== 'suspensa') throw new Error('A conta não está bloqueada.');
      conta.status = conta.statusAnterior && !['suspensa', 'pausada'].includes(conta.statusAnterior) ? conta.statusAnterior : 'ativa';
      limparPausa();
      log(`desbloqueada (volta como ${conta.status})`);
      break;
    }
    case 'cancelar': {
      const imediato = dados.imediato === true || dados.imediato === 'true' || dados.imediato === 'on';
      if (conta.asaas?.subscriptionId) {
        try {
          await cancelarAssinatura(conta);
        } catch (err) {
          conta.aviso = `A conta foi cancelada aqui, mas a assinatura no Asaas não: ${err.message}. Cancele também no painel do Asaas.`;
        }
      }
      conta.status = 'cancelada';
      limparPausa();
      if (imediato || !conta.pagoAte || conta.pagoAte < agora) conta.pagoAte = agora;
      log(imediato ? 'cancelada com bloqueio imediato' : `cancelada (acesso até ${dataBR(conta.pagoAte)})`);
      break;
    }
    case 'inadimplente': {
      if (['suspensa', 'pausada', 'cancelada', 'cortesia'].includes(conta.status)) throw new Error(`A conta está ${conta.status}.`);
      conta.status = 'inadimplente';
      if (!conta.pagoAte) conta.pagoAte = conta.testeAte && conta.testeAte < agora ? conta.testeAte : agora;
      log(`marcada como inadimplente (bloqueio ${env.saas.carenciaDias} dia(s) após ${dataBR(conta.pagoAte)})`);
      break;
    }
    // ---- ajustes diretos (como antes)
    case 'status': {
      if (!STATUS_CONTA.includes(dados.status)) throw new Error('Situação inválida.');
      if (dados.status === 'pausada') return ajustarConta(id, { acao: 'pausar' }, { por });
      conta.status = dados.status;
      if (dados.status !== 'suspensa') limparPausa();
      log(`situação alterada para ${dados.status}`);
      break;
    }
    case 'plano': {
      return ajustarConta(id, { acao: 'atribuir-plano', plano: dados.plano, inicio: 'manter' }, { por });
    }
    case 'estender-teste': {
      const dias = Math.min(365, Math.max(1, Number(dados.dias) || 7));
      const base = Math.max(Date.now(), conta.testeAte ? conta.testeAte.getTime() : 0);
      conta.testeAte = new Date(base + dias * DIA);
      if (!['teste', 'pendente'].includes(conta.status)) conta.status = 'teste';
      limparPausa();
      log(`+${dias} dia(s) grátis, até ${dataBR(conta.testeAte)}`);
      break;
    }
    case 'limite': {
      const v = String(dados.limite ?? '').trim();
      conta.limiteEmpresasManual = v === '' ? null : Math.max(0, Number(v) || 0);
      log(`limite especial de CNPJs: ${v === '' ? 'do plano' : conta.limiteEmpresasManual}`);
      break;
    }
    case 'limite-usuarios': {
      const v = String(dados.limite ?? '').trim();
      conta.limiteUsuariosManual = v === '' ? null : Math.max(1, Number(v) || 1);
      log(`limite especial de usuários: ${v === '' ? 'do plano' : conta.limiteUsuariosManual}`);
      break;
    }
    case 'observacao':
      conta.observacao = String(dados.observacao || '').slice(0, 1000);
      break;
    default:
      throw new Error('Ação inválida.');
  }
  const aviso = conta.aviso;
  await conta.save();
  if (aviso) conta.aviso = aviso;
  return conta;
}

export { STATUS_CONTA, LISTA_PLANOS };

/**
 * Pagina de um escritorio no painel da plataforma: dados, plano, uso, clientes, equipe,
 * ultimas capturas e cobranca. So para o dono da plataforma.
 */
export async function obterEscritorio(id) {
  if (!mongoose.isValidObjectId(id)) return null;
  const conta = await Conta.findById(id);
  if (!conta) return null;
  const owner = conta._id;
  const trintaDias = new Date(Date.now() - 30 * 864e5);

  const [dono, usuarios, empresas, notasPorEmpresa, totalNotas, notas30, eventos] = await Promise.all([
    User.findById(owner).select('nome email ultimoLogin ativo').lean(),
    User.find({ $or: [{ _id: owner }, { conta: owner }] }).select('nome email role ativo ultimoLogin todasEmpresas empresas createdAt').sort('nome').lean(),
    Empresa.find({ owner }).select('razaoSocial cnpj uf ativa certificado createdAt').populate('certificado', 'apelido validoAte').sort('razaoSocial').lean(),
    NotaFiscal.aggregate([{ $match: { owner, tipo: { $ne: 'evento' } } }, { $group: { _id: '$empresa', n: { $sum: 1 }, ultima: { $max: '$createdAt' } } }]),
    NotaFiscal.countDocuments({ owner, tipo: { $ne: 'evento' } }),
    NotaFiscal.countDocuments({ owner, tipo: { $ne: 'evento' }, createdAt: { $gte: trintaDias } }),
    EventoCobranca.find({ conta: owner }).sort('-createdAt').limit(20).lean(),
  ]);
  const logs = await CapturaLog.find({ empresa: { $in: empresas.map((e) => e._id) } })
    .sort('-createdAt')
    .limit(20)
    .populate('empresa', 'razaoSocial')
    .lean();

  const porEmpresa = new Map(notasPorEmpresa.map((x) => [String(x._id), x]));
  const nomes = new Map(empresas.map((e) => [String(e._id), e.razaoSocial]));
  const agora = Date.now();
  return {
    conta: conta.toObject(),
    acesso: conta.acesso(),
    limite: conta.limiteEmpresas(),
    limiteUsuarios: conta.limiteUsuarios(),
    plano: PLANOS[conta.plano] || null,
    historico: [...(conta.historico || [])].reverse(),
    dono,
    usuarios: usuarios.map((u) => ({
      ...u,
      clientesQueVe: u.role === 'admin' || (u.role !== 'cliente' && u.todasEmpresas !== false)
        ? 'todos'
        : (u.empresas || []).map((x) => nomes.get(String(x))).filter(Boolean),
    })),
    empresas: empresas.map((e) => {
      const vence = e.certificado?.validoAte ? new Date(e.certificado.validoAte).getTime() : null;
      return {
        ...e,
        notas: porEmpresa.get(String(e._id))?.n || 0,
        ultimaNota: porEmpresa.get(String(e._id))?.ultima || null,
        certVencido: vence != null && vence < agora,
        certDias: vence != null ? Math.ceil((vence - agora) / 864e5) : null,
      };
    }),
    numeros: { clientes: empresas.length, usuarios: usuarios.length, equipe: usuarios.filter((u) => u.role !== 'cliente' && u.ativo !== false).length, notas: totalNotas, notas30 },
    logs,
    eventos,
  };
}

/**
 * Dono do escritorio, para o dono da plataforma "acessar o escritorio" (suporte).
 * Lanca erro se o escritorio nao existe ou o usuario dono esta desativado.
 */
export async function donoParaAcesso(id) {
  if (!mongoose.isValidObjectId(id)) throw new Error('Escritório inválido.');
  const conta = await Conta.findById(id).select('nome').lean();
  if (!conta) throw new Error('Escritório não encontrado.');
  const dono = await User.findById(id);
  if (!dono) throw new Error('O usuário dono deste escritório não existe mais.');
  if (!dono.ativo) throw new Error('O usuário dono deste escritório está desativado.');
  return { conta, dono };
}
