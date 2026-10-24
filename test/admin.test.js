import { test } from 'node:test';
import assert from 'node:assert/strict';
import './helpers.js';

process.env.ADMIN_EMAIL = 'Dono@Exemplo.com';
process.env.ADMIN_SENHA = 'senha-do-env-123';
const { User } = await import('../src/models/User.js');
const { sincronizarAdmin } = await import('../src/services/bootstrapAdmin.js');

test('sincronizarAdmin troca a senha do admin existente pela do .env', async () => {
  const u = new User({ nome: 'Dono', email: 'dono@exemplo.com', senhaHash: await User.hashSenha('senha-antiga-999'), role: 'operador', ativo: false });
  u.save = async () => u;
  User.estimatedDocumentCount = async () => 3;
  User.findOne = async (q) => (q.email === 'dono@exemplo.com' ? u : null);
  const r = await sincronizarAdmin();
  assert.equal(r.acao, 'senha-atualizada');
  assert.equal(await u.verificarSenha('senha-do-env-123'), true);
  assert.equal(await u.verificarSenha('senha-antiga-999'), false);
  assert.equal(u.ativo, true);
  assert.equal(u.role, 'admin');
});

test('sincronizarAdmin cria o admin quando nao existe', async () => {
  let criado = null;
  User.findOne = async () => null;
  User.create = async (d) => (criado = d);
  const r = await sincronizarAdmin();
  assert.equal(r.acao, 'criado');
  assert.equal(criado.email, 'dono@exemplo.com');
  assert.equal(criado.role, 'admin');
});
