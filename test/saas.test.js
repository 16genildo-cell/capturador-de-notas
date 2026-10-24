import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.ASAAS_WEBHOOK_TOKEN = 'token_de_teste_com_mais_de_32_caracteres';
process.env.CARENCIA_DIAS = '5';
const { Conta } = await import('../src/models/Conta.js');
const { somarMes, webhookAutentico } = await import('../src/services/asaas.js');
const { protecaoCsrf } = await import('../src/middleware/seguranca.js');
const { PLANOS, TESTE } = await import('../src/config/planos.js');

const DIA = 864e5;
const conta = (d) => new Conta({ nome: 'X', ...d });

test('teste gratis: liberado ate o fim, bloqueado depois', () => {
  assert.equal(conta({ status: 'teste', testeAte: new Date(Date.now() + 3 * DIA) }).acesso().liberado, true);
  const r = conta({ status: 'teste', testeAte: new Date(Date.now() - DIA) }).acesso();
  assert.equal(r.liberado, false);
  assert.equal(r.motivo, 'teste-encerrado');
});

test('ativa e inadimplente respeitam a carencia', () => {
  assert.equal(conta({ status: 'ativa', pagoAte: new Date(Date.now() - 2 * DIA) }).acesso().liberado, true);
  assert.equal(conta({ status: 'ativa', pagoAte: new Date(Date.now() - 6 * DIA) }).acesso().liberado, false);
  assert.equal(conta({ status: 'inadimplente', pagoAte: new Date(Date.now() - 2 * DIA) }).acesso().liberado, true);
  assert.equal(conta({ status: 'inadimplente', pagoAte: new Date(Date.now() - 9 * DIA) }).acesso().liberado, false);
});

test('cancelada usa ate o fim do periodo pago; suspensa bloqueia; cortesia libera', () => {
  assert.equal(conta({ status: 'cancelada', pagoAte: new Date(Date.now() + DIA) }).acesso().liberado, true);
  assert.equal(conta({ status: 'cancelada', pagoAte: new Date(Date.now() - DIA) }).acesso().liberado, false);
  assert.equal(conta({ status: 'suspensa' }).acesso().liberado, false);
  assert.equal(conta({ status: 'cortesia' }).acesso().liberado, true);
});

test('limite de empresas por plano', () => {
  assert.equal(conta({ status: 'teste' }).limiteEmpresas(), TESTE.empresas);
  assert.equal(conta({ status: 'ativa', plano: 'profissional' }).limiteEmpresas(), PLANOS.profissional.empresas);
  assert.equal(conta({ status: 'cortesia' }).limiteEmpresas(), Infinity);
  assert.equal(conta({ status: 'ativa', plano: 'basico', limiteEmpresasManual: 7 }).limiteEmpresas(), 7);
});

test('periodo pago: soma um mes (fim de mes ajustado)', () => {
  assert.equal(somarMes('2026-10-15').toISOString().slice(0, 10), '2026-11-15');
  assert.equal(somarMes('2026-01-31').toISOString().slice(0, 10), '2026-02-28');
  assert.equal(somarMes('2026-12-10').toISOString().slice(0, 10), '2027-01-10');
});

test('webhook: so aceita o token configurado', () => {
  assert.equal(webhookAutentico('token_de_teste_com_mais_de_32_caracteres'), true);
  assert.equal(webhookAutentico('outro'), false);
  assert.equal(webhookAutentico(undefined), false);
});

test('CSRF nao bloqueia webhooks, mas bloqueia o resto', () => {
  const rodar = (path) => {
    let passou = false;
    protecaoCsrf({ method: 'POST', path, originalUrl: path, get: () => undefined }, { status: () => ({ send: () => {} }) }, () => { passou = true; });
    return passou;
  };
  assert.equal(rodar('/webhooks/asaas'), true);
  assert.equal(rodar('/assinatura/plano'), false);
});
