import { test } from 'node:test';
import assert from 'node:assert/strict';
import { protecaoCsrf, loginBloqueado, registrarFalhaLogin, limparFalhasLogin } from '../src/middleware/seguranca.js';

const req = (method, headers) => ({ method, originalUrl: '/x', ip: '1.1.1.1', get: (h) => headers[h.toLowerCase()] });
const rodar = (r) => {
  let passou = false;
  protecaoCsrf(r, { status: () => ({ send: () => {} }) }, () => { passou = true; });
  return passou;
};

test('CSRF: aceita mesma origem e bloqueia outras', () => {
  const host = 'localhost:3000';
  assert.equal(rodar(req('GET', {})), true);
  assert.equal(rodar(req('POST', { host, origin: 'http://localhost:3000' })), true);
  assert.equal(rodar(req('POST', { host, referer: 'http://localhost:3000/notas' })), true);
  assert.equal(rodar(req('POST', { host, origin: 'https://site-malicioso.com' })), false);
  assert.equal(rodar(req('POST', { host })), false);
});

test('bloqueio de login apos 5 falhas', () => {
  const r = { ip: '9.9.9.9' };
  for (let i = 0; i < 4; i += 1) registrarFalhaLogin(r, 'x@y.z');
  assert.equal(loginBloqueado(r, 'x@y.z'), 0);
  registrarFalhaLogin(r, 'x@y.z');
  assert.ok(loginBloqueado(r, 'x@y.z') > 0);
  limparFalhasLogin(r, 'x@y.z');
  assert.equal(loginBloqueado(r, 'x@y.z'), 0);
});
