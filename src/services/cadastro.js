import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { TESTE } from '../config/planos.js';
import { User, validarSenha } from '../models/User.js';
import { Conta } from '../models/Conta.js';
import { normalizarDocumento } from '../utils/documento.js';
import { emailConfigurado, enviarEmail, montarHtml } from './email.js';
import { dentroDoLimite, limparFalhasLogin } from '../middleware/seguranca.js';

/**
 * Regras de cadastro e de senha, usadas pelo site (EJS) e pela API (web React e app).
 */

/** Cria o usuario dono + a conta em teste gratis. Lanca erro com mensagem amigavel. */
export async function criarContaNova({ nome, email, senha, confirmar, conta, documento, telefone, termos, ip, robo }) {
  nome = String(nome || '').trim();
  email = String(email || '').toLowerCase().trim();
  conta = String(conta || '').trim();
  if (!env.saas.cadastroAberto) throw new Error('Cadastro de novas contas fechado no momento.');
  if (!dentroDoLimite(`cadastro|${ip}`, 5, 60 * 60 * 1000)) throw new Error('Muitos cadastros a partir deste endereço. Tente novamente mais tarde.');
  if (robo) throw new Error('Cadastro recusado.');
  if (!nome || !email || !conta) throw new Error('Preencha nome, e-mail e o nome da empresa/escritorio.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('E-mail inválido.');
  const doc = normalizarDocumento(documento);
  validarSenha(senha);
  if (confirmar !== undefined && senha !== confirmar) throw new Error('A confirmacao não confere com a senha.');
  if (!termos) throw new Error('E preciso aceitar os termos de uso e a politica de privacidade.');
  if (await User.exists({ email })) throw new Error('Já existe uma conta com esse e-mail. Use "Esqueci a senha" se precisar.');

  const user = await User.criar({ nome, email, senha, role: 'admin' });
  try {
    await Conta.criarTeste({ donoId: user._id, nome: conta, documento: doc, email, ip });
    if (telefone) await Conta.updateOne({ _id: user._id }, { telefone: String(telefone).trim() });
  } catch (err) {
    await User.deleteOne({ _id: user._id });
    throw err;
  }

  enviarEmail({
    para: [email],
    assunto: `Bem-vindo ao ${env.saas.nomeProduto}`,
    html: montarHtml(`Sua conta está pronta, ${nome.split(' ')[0]}!`, [
      {
        titulo: 'Próximos passos',
        itens: [
          'Envie o certificado digital A1 (.pfx) da empresa em Certificados.',
          'Cadastre a empresa e clique em "Capturar agora".',
          `Você tem ${TESTE.dias} dias de teste grátis, com até ${TESTE.empresas} empresa(s).`,
        ],
      },
    ], env.webUrl),
  }).catch((err) => console.error('[email] boas-vindas:', err.message));

  return user;
}

const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');

/**
 * Gera um link de uso unico para o usuario criar/trocar a senha (mesmo mecanismo do
 * "esqueci a senha"). Usado tambem no convite de contas criadas pela plataforma.
 */
export async function gerarLinkSenha(user, horas = 1) {
  const token = crypto.randomBytes(32).toString('hex');
  await User.updateOne({ _id: user._id }, { resetTokenHash: hashToken(token), resetExpira: new Date(Date.now() + horas * 60 * 60 * 1000) });
  return `${env.webUrl}/redefinir-senha/${token}`;
}

/** Envia o link de nova senha (se o e-mail existir). Nunca revela se o e-mail existe. */
export async function pedirNovaSenha(email, ip) {
  email = String(email || '').toLowerCase().trim();
  if (!dentroDoLimite(`reset|${ip}`, 5, 15 * 60 * 1000)) throw new Error('Muitas solicitacoes. Aguarde alguns minutos.');
  const user = email && (await User.findOne({ email, ativo: true }));
  if (!user || !emailConfigurado()) return;
  const token = crypto.randomBytes(32).toString('hex');
  await User.updateOne({ _id: user._id }, { resetTokenHash: hashToken(token), resetExpira: new Date(Date.now() + 60 * 60 * 1000) });
  const link = `${env.webUrl}/redefinir-senha/${token}`;
  await enviarEmail({
    para: [user.email],
    assunto: `${env.saas.nomeProduto}: criar nova senha`,
    html: montarHtml('Pedido de nova senha', [{ titulo: 'Use o link abaixo (válido por 1 hora)', itens: [link] }], 'Se não foi você, ignore este e-mail; sua senha continua a mesma.'),
  });
}

export async function usuarioDoTokenSenha(token) {
  if (!/^[a-f0-9]{64}$/.test(String(token))) return null;
  return User.findOne({ resetTokenHash: hashToken(token), resetExpira: { $gt: new Date() }, ativo: true });
}

/** Troca a senha a partir do link do e-mail. */
export async function redefinirSenha(token, nova, confirmar, req) {
  const user = await usuarioDoTokenSenha(token);
  if (!user) throw new Error('Link inválido ou expirado. Peca um novo.');
  validarSenha(nova);
  if (confirmar !== undefined && nova !== confirmar) throw new Error('A confirmacao não confere com a nova senha.');
  user.senhaHash = await User.hashSenha(nova);
  user.resetTokenHash = undefined;
  user.resetExpira = undefined;
  await user.save();
  if (req) limparFalhasLogin(req, user.email);
  return user;
}
