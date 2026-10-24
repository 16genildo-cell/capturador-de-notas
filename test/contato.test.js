import { test } from 'node:test';
import assert from 'node:assert/strict';
import './helpers.js';

const { MensagemContato } = await import('../src/models/MensagemContato.js');
const { registrarContato, acaoMensagem } = await import('../src/services/contato.js');

// Sem banco: guarda as mensagens criadas em memoria.
const criadas = [];
MensagemContato.create = async (d) => {
  const m = new MensagemContato(d);
  await m.validate();
  criadas.push(m);
  return m;
};

const valido = { nome: 'Ana Souza', email: 'ANA@escritorio.com.br', mensagem: 'Quero conhecer o sistema.', escritorio: 'Contab Ana', qtdClientes: '11 a 30' };

test('formulario de contato grava a mensagem como nova', async () => {
  const m = await registrarContato(valido, { ip: '1.1.1.1', origem: 'web' });
  assert.equal(m.email, 'ana@escritorio.com.br');
  assert.equal(m.lida, false);
  assert.equal(m.arquivada, false);
  assert.equal(m.qtdClientes, '11 a 30');
  assert.equal(m.origem, 'web');
});

test('valida nome, e-mail e mensagem', async () => {
  await assert.rejects(registrarContato({ ...valido, nome: '' }, { ip: '2.2.2.2' }), /nome/);
  await assert.rejects(registrarContato({ ...valido, email: 'x' }, { ip: '2.2.2.3' }), /e-mail/);
  await assert.rejects(registrarContato({ ...valido, mensagem: '' }, { ip: '2.2.2.4' }), /mensagem/);
});

test('faixa de clientes fora da lista e ignorada', async () => {
  const m = await registrarContato({ ...valido, qtdClientes: 'mil' }, { ip: '3.3.3.3' });
  assert.equal(m.qtdClientes, '');
});

test('robo (campo escondido preenchido) e descartado sem gravar', async () => {
  const antes = criadas.length;
  assert.equal(await registrarContato({ ...valido, site: 'http://spam' }, { ip: '4.4.4.4' }), null);
  assert.equal(criadas.length, antes);
});

test('limite de envios por IP', async () => {
  for (let i = 0; i < 5; i += 1) await registrarContato(valido, { ip: '5.5.5.5' });
  await assert.rejects(registrarContato(valido, { ip: '5.5.5.5' }), /varias mensagens/);
});

test('acoes do painel validam id e acao', async () => {
  await assert.rejects(acaoMensagem('nao-e-id', 'lida'), /inválida/);
  await assert.rejects(acaoMensagem('6553f1a1a1a1a1a1a1a1a1a1', 'voar'), /Ação inválida/);
});
