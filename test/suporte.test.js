import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import mongoose from 'mongoose';
import './helpers.js';

process.env.ADMIN_EMAIL = 'dono@plataforma.com';
const { User } = await import('../src/models/User.js');
const { Conta } = await import('../src/models/Conta.js');
const { default: plataformaRoutes } = await import('../src/routes/plataforma.js');
const { default: authRoutes } = await import('../src/routes/auth.js');
const { donoParaAcesso } = await import('../src/services/plataforma.js');

const ADMIN = new mongoose.Types.ObjectId();
const ESC = new mongoose.Types.ObjectId();
const usuarios = {
  [ADMIN]: { _id: ADMIN, nome: 'Dono', email: 'dono@plataforma.com', ativo: true, role: 'admin' },
  [ESC]: { _id: ESC, nome: 'Resp', email: 'resp@escritorio.com', ativo: true, role: 'admin' },
};
const consulta = (v) => Object.assign(Promise.resolve(v), { select() { return this; }, lean() { return this; } });
User.findById = (id) => consulta(usuarios[String(id)] || null);
Conta.findById = (id) => consulta(String(id) === String(ESC) ? { _id: ESC, nome: 'Contab Silva' } : null);

/** App minimo com sessao em memoria (um "navegador"). */
function montar(sessao) {
  const app = express();
  app.set('views', new URL('../src/views', import.meta.url).pathname);
  app.set('view engine', 'ejs');
  app.use(express.urlencoded({ extended: true }));
  app.use((req, res, next) => {
    req.session = Object.assign(sessao, { save: (cb) => cb(), destroy: (cb) => { for (const k of Object.keys(sessao)) if (typeof sessao[k] !== 'function') delete sessao[k]; cb(); } });
    const u = usuarios[sessao.userId];
    req.user = u;
    req.ehPlataforma = u?.email === 'dono@plataforma.com';
    next();
  });
  app.use('/plataforma', plataformaRoutes);
  app.use('/', authRoutes);
  return new Promise((ok) => { const s = app.listen(0, () => ok(s)); });
}
const post = (s, path) => fetch(`http://127.0.0.1:${s.address().port}${path}`, { method: 'POST', redirect: 'manual' });

test('acessar o escritorio troca a sessao e voltar restaura o dono da plataforma', async () => {
  const sessao = { userId: String(ADMIN) };
  const s = await montar(sessao);
  try {
    let r = await post(s, `/plataforma/escritorios/${ESC}/acessar`);
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), '/');
    assert.equal(sessao.userId, String(ESC));
    assert.equal(sessao.acessoSuporte.adminId, String(ADMIN));
    assert.equal(sessao.acessoSuporte.nome, 'Contab Silva');

    r = await post(s, '/suporte/voltar');
    assert.equal(r.headers.get('location'), `/plataforma/escritorios/${ESC}`);
    assert.equal(sessao.userId, String(ADMIN));
    assert.equal(sessao.acessoSuporte, undefined);
  } finally {
    s.close();
  }
});

test('quem nao e dono da plataforma nao acessa escritorios', async () => {
  const sessao = { userId: String(ESC) };
  const s = await montar(sessao);
  try {
    const r = await post(s, `/plataforma/escritorios/${ESC}/acessar`);
    assert.equal(r.status, 404);
    assert.equal(sessao.userId, String(ESC));
    assert.equal(sessao.acessoSuporte, undefined);
  } finally {
    s.close();
  }
});

test('voltar sem acesso de suporte nao muda nada', async () => {
  const sessao = { userId: String(ESC) };
  const s = await montar(sessao);
  try {
    const r = await post(s, '/suporte/voltar');
    assert.equal(r.headers.get('location'), '/');
    assert.equal(sessao.userId, String(ESC));
  } finally {
    s.close();
  }
});

test('donoParaAcesso recusa escritorio inexistente ou responsavel desativado', async () => {
  await assert.rejects(donoParaAcesso('x'), /inválido/);
  await assert.rejects(donoParaAcesso(new mongoose.Types.ObjectId()), /não encontrado/);
  usuarios[ESC].ativo = false;
  await assert.rejects(donoParaAcesso(ESC), /desativado/);
  usuarios[ESC].ativo = true;
});
