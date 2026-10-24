import { env } from '../config/env.js';
import { User } from '../models/User.js';

/**
 * Garante que exista o primeiro usuario (administrador) do sistema,
 * usando os dados definidos no .env (ADMIN_NOME, ADMIN_EMAIL, ADMIN_SENHA).
 *
 * - So cria se o banco ainda NAO tiver nenhum usuario.
 * - Se ja houver usuarios, nao faz nada (nao sobrescreve senha nem dados).
 * - Se o .env nao tiver ADMIN_EMAIL/ADMIN_SENHA, apenas avisa no log.
 *
 * @returns {Promise<{ criado: boolean, motivo: string, email?: string }>}
 */
export async function garantirPrimeiroUsuario() {
  const total = await User.estimatedDocumentCount();
  if (total > 0) {
    return { criado: false, motivo: 'ja-existem-usuarios' };
  }

  const { nome, email, senha } = env.admin;

  if (!email || !senha) {
    console.warn(
      '[admin] Nenhum usuário cadastrado e ADMIN_EMAIL/ADMIN_SENHA não definidos no .env. ' +
        'Defina-os e reinicie para criar o administrador inicial.',
    );
    return { criado: false, motivo: 'env-ausente' };
  }

  if (senha.length < 6) {
    throw new Error('ADMIN_SENHA no .env deve ter ao menos 6 caracteres.');
  }

  await User.criar({ nome, email, senha, role: 'admin' });
  console.log(`[admin] Primeiro usuário criado a partir do .env: ${email}`);
  console.log('[admin] Recomenda-se trocar a senha e remover ADMIN_SENHA do .env após o primeiro acesso.');
  return { criado: true, motivo: 'criado', email };
}

/**
 * Faz o login do administrador da plataforma voltar a funcionar com os dados do .env.
 *
 * O garantirPrimeiroUsuario() so cria o admin quando o banco esta VAZIO; se o usuario ja
 * existia (criado antes com outra senha), mudar o .env nao muda o login. Esta funcao:
 *  - se ja existe usuario com ADMIN_EMAIL: troca a senha para ADMIN_SENHA, reativa e garante perfil admin;
 *  - se nao existe: cria o usuario administrador com esses dados.
 * Tambem limpa links de "esqueci a senha" pendentes.
 *
 * @returns {Promise<{ acao: 'senha-atualizada' | 'criado', email: string, usuarios: number }>}
 */
export async function sincronizarAdmin() {
  const { nome, email, senha } = env.admin;
  if (!email || !senha) throw new Error('Defina ADMIN_EMAIL e ADMIN_SENHA no .env.');
  if (senha.length < 8) throw new Error('ADMIN_SENHA no .env deve ter ao menos 8 caracteres.');

  const usuarios = await User.estimatedDocumentCount();
  const existente = await User.findOne({ email });
  if (existente) {
    existente.senhaHash = await User.hashSenha(senha);
    existente.ativo = true;
    existente.role = 'admin';
    existente.resetTokenHash = undefined;
    existente.resetExpira = undefined;
    await existente.save();
    return { acao: 'senha-atualizada', email, usuarios };
  }
  await User.criar({ nome, email, senha, role: 'admin' });
  return { acao: 'criado', email, usuarios };
}
