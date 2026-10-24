import { test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import './helpers.js';

const { User, empresasPermitidas } = await import('../src/models/User.js');
const { escopo, escopoDaEmpresa, podeVerEmpresa } = await import('../src/middleware/escopoEmpresa.js');
const { montarFiltroNotas } = await import('../src/services/filtroNotas.js');

const oid = () => new mongoose.Types.ObjectId();
const A = oid();
const B = oid();
const C = oid();
const conta = oid();

test('so operadores com "algumas empresas" ficam restritos', () => {
  assert.equal(empresasPermitidas({ role: 'admin', todasEmpresas: false, empresas: [A] }), null);
  assert.equal(empresasPermitidas({ role: 'operador' }), null);
  assert.deepEqual(empresasPermitidas({ role: 'operador', todasEmpresas: false, empresas: [A, B] }).map(String), [A, B].map(String));
  assert.equal(new User({ nome: 'x', email: 'x@x', senhaHash: 'h' }).todasEmpresas, true);
});

test('escopo aplica as empresas permitidas', () => {
  const rest = { empresasPermitidas: [A, B] };
  assert.deepEqual(escopo({ empresasPermitidas: null }), {});
  assert.deepEqual(escopo(rest), { empresa: { $in: [A, B] } });
  assert.deepEqual(escopoDaEmpresa(rest), { _id: { $in: [A, B] } });
  assert.deepEqual(escopo({ ...rest, empresaEscopo: { _id: A } }), { empresa: A });
  assert.equal(podeVerEmpresa(rest, C), false);
});

test('filtro de notas: restrito nunca ve empresa fora da lista', () => {
  assert.deepEqual(montarFiltroNotas({}, conta, [A, B]).filtro.empresa, { $in: [A, B] });
  assert.equal(String(montarFiltroNotas({ empresa: String(A) }, conta, [A, B]).filtro.empresa), String(A));
  assert.deepEqual(montarFiltroNotas({ empresa: String(C) }, conta, [A, B]).filtro.empresa, { $in: [A, B] });
  assert.equal(String(montarFiltroNotas({ empresa: String(C) }, conta, null).filtro.empresa), String(C));
});

// ---------------- Perfil "Cliente do escritorio" ----------------
const { restringirClienteSite, restringirClienteApi } = await import('../src/middleware/perfilCliente.js');

function chamar(mw, { role = 'cliente', method = 'GET', path = '/', body = {} } = {}) {
  const r = { next: false, status: null, json: null, redirect: null, view: null };
  const req = { user: { role }, method, path, body, session: {}, get: () => null };
  const res = {
    locals: {},
    status(s) { r.status = s; return this; },
    render(v) { r.view = v; return this; },
    json(j) { r.json = j; return this; },
    redirect(u) { r.redirect = u; return this; },
  };
  mw(req, res, () => { r.next = true; });
  return r;
}

test('cliente do escritorio sempre fica limitado aos CNPJs dele', () => {
  assert.deepEqual(empresasPermitidas({ role: 'cliente', todasEmpresas: true, empresas: [A] }).map(String), [String(A)]);
  assert.deepEqual(empresasPermitidas({ role: 'cliente', empresas: [] }), []);
});

test('cliente do escritorio: painel antigo so permite consulta', () => {
  const id = String(A);
  for (const path of ['/', '/notas', `/notas/${id}`, `/notas/${id}/pdf`, '/notas/exportar', '/relatorios', '/empresas', `/empresas/${id}`, `/empresas/${id}/notas`, '/minha-senha']) {
    assert.equal(chamar(restringirClienteSite, { path }).next, true, `deveria abrir ${path}`);
  }
  for (const path of ['/captura', '/emitir', '/vendas', '/assinatura', '/usuarios', '/certificados', '/importar', '/saude', `/empresas/${id}/captura`, `/empresas/${id}/emitir`, '/empresas/nova']) {
    const r = chamar(restringirClienteSite, { path });
    assert.equal(r.next, false, `deveria bloquear ${path}`);
    assert.equal(r.status, 403);
  }
  assert.equal(chamar(restringirClienteSite, { method: 'POST', path: `/notas/${id}/ciencia` }).next, false);
  assert.equal(chamar(restringirClienteSite, { method: 'POST', path: '/captura/todas' }).next, false);
  assert.equal(chamar(restringirClienteSite, { method: 'POST', path: '/notas/lote', body: { acao: 'ciencia' } }).next, false);
  assert.equal(chamar(restringirClienteSite, { method: 'POST', path: '/notas/lote', body: { acao: 'baixar' } }).next, true);
  assert.equal(chamar(restringirClienteSite, { method: 'POST', path: '/logout' }).next, true);
  // Outros perfis nao sao afetados
  assert.equal(chamar(restringirClienteSite, { role: 'operador', path: '/captura' }).next, true);
});

test('cliente do escritorio: API so permite consulta', () => {
  const id = String(A);
  for (const path of ['/me', '/painel', '/notas', `/notas/${id}`, `/notas/${id}/xml`, '/relatorios', '/empresas', `/empresas/${id}`]) {
    assert.equal(chamar(restringirClienteApi, { path }).next, true, `deveria abrir ${path}`);
  }
  assert.equal(chamar(restringirClienteApi, { method: 'POST', path: `/notas/${id}/ciencia` }).status, 403);
  assert.equal(chamar(restringirClienteApi, { method: 'POST', path: `/empresas/${id}/capturar` }).status, 403);
  assert.equal(chamar(restringirClienteApi, { path: '/conta' }).status, 403);
  assert.equal(chamar(restringirClienteApi, { path: '/usuarios' }).status, 403);
  assert.equal(chamar(restringirClienteApi, { path: '/captura/historico' }).status, 403);
  assert.equal(chamar(restringirClienteApi, { method: 'POST', path: '/me/senha' }).next, true);
  assert.equal(chamar(restringirClienteApi, { role: 'admin', path: '/conta' }).next, true);
});
