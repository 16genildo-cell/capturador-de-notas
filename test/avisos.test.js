import { test } from 'node:test';
import assert from 'node:assert/strict';
import './helpers.js';

const { Aviso } = await import('../src/models/Aviso.js');
const { lerAviso, situacaoAviso, avisosAtivos, apagarAviso } = await import('../src/services/avisos.js');

const H = 36e5;
const agora = new Date('2026-10-23T12:00:00Z');

test('duracao: horas, ate uma data ou sem prazo', () => {
  assert.equal(lerAviso({ titulo: 'Manutencao', duracao: { horas: 24 } }, agora).fim.getTime(), agora.getTime() + 24 * H);
  assert.equal(lerAviso({ titulo: 'X', duracao: { ate: '2026-10-30T18:00:00Z' } }, agora).fim.toISOString(), '2026-10-30T18:00:00.000Z');
  assert.equal(lerAviso({ titulo: 'X', duracao: { semPrazo: true } }, agora).fim, null);
  const ag = lerAviso({ titulo: 'X', inicio: '2026-10-25T09:00:00Z', duracao: { horas: 2 } }, agora);
  assert.equal(ag.fim.toISOString(), '2026-10-25T11:00:00.000Z');
  assert.equal(lerAviso({ titulo: 'X', tipo: 'hack', duracao: { semPrazo: true } }, agora).tipo, 'info');
});

test('validacao do aviso', () => {
  assert.throws(() => lerAviso({ titulo: '', duracao: { horas: 1 } }, agora), /título/);
  assert.throws(() => lerAviso({ titulo: 'X' }, agora), /quanto tempo/);
  assert.throws(() => lerAviso({ titulo: 'X', duracao: { ate: '2026-10-01T00:00:00Z' } }, agora), /já passou|depois do início/);
  assert.throws(() => lerAviso({ titulo: 'X', texto: 'a'.repeat(1001), duracao: { horas: 1 } }, agora), /1000/);
});

test('situacao: agendado, ativo e expirado', () => {
  assert.equal(situacaoAviso({ inicio: new Date(agora.getTime() + H), fim: null }, agora), 'agendado');
  assert.equal(situacaoAviso({ inicio: new Date(agora.getTime() - H), fim: null }, agora), 'ativo');
  assert.equal(situacaoAviso({ inicio: new Date(agora.getTime() - 2 * H), fim: new Date(agora.getTime() - H) }, agora), 'expirado');
});

test('escritorios so veem os ativos, importantes primeiro', async () => {
  let consulta;
  const docs = [
    { _id: '1', titulo: 'info', tipo: 'info', inicio: new Date(agora.getTime() - H) },
    { _id: '2', titulo: 'urgente', tipo: 'importante', inicio: new Date(agora.getTime() - 2 * H), fim: new Date(agora.getTime() + H) },
  ];
  Aviso.find = (q) => { consulta = q; return { sort() { return this; }, limit() { return this; }, lean: async () => docs }; };
  const r = await avisosAtivos(agora);
  assert.deepEqual(r.map((a) => a.titulo), ['urgente', 'info']);
  assert.deepEqual(consulta.inicio, { $lte: agora });
  assert.deepEqual(consulta.$or, [{ fim: null }, { fim: { $gt: agora } }]);
});

test('apagar aviso', async () => {
  Aviso.deleteOne = async () => ({ deletedCount: 0 });
  await assert.rejects(apagarAviso('0123456789abcdef01234567'), /não encontrado/);
  await assert.rejects(apagarAviso('x'), /não encontrado/);
  Aviso.deleteOne = async () => ({ deletedCount: 1 });
  await apagarAviso('0123456789abcdef01234567');
});

test('publico do aviso: todos, so ativos ou so bloqueados', async () => {
  assert.equal(lerAviso({ titulo: 'X', para: 'bloqueados', duracao: { horas: 1 } }, agora).para, 'bloqueados');
  assert.equal(lerAviso({ titulo: 'X', para: 'outro', duracao: { horas: 1 } }, agora).para, 'todos');
  const consultas = [];
  Aviso.find = (q) => { consultas.push(q); return { sort() { return this; }, limit() { return this; }, lean: async () => [] }; };
  await avisosAtivos(agora, { bloqueado: true });
  await avisosAtivos(agora);
  assert.deepEqual(consultas[0].para.$in, [null, 'todos', 'bloqueados']);
  assert.deepEqual(consultas[1].para.$in, [null, 'todos', 'ativos']);
});
