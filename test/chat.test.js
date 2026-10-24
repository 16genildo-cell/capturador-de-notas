import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import mongoose from 'mongoose';
import './helpers.js';

const { ChatMensagem } = await import('../src/models/ChatMensagem.js');
const { ChatAnexo } = await import('../src/models/ChatAnexo.js');
const { Atendimento } = await import('../src/models/Atendimento.js');
const { Contador } = await import('../src/models/Contador.js');
const { Conta } = await import('../src/models/Conta.js');
const chat = await import('../src/services/chat.js');
const { default: chatRoutes } = await import('../src/routes/chat.js');

const A = new mongoose.Types.ObjectId(); // escritorio A
const B = new mongoose.Types.ObjectId(); // escritorio B
const consulta = (v) => Object.assign(Promise.resolve(v), { select() { return this; }, lean() { return this; }, sort() { return this; }, limit() { return this; } });
Conta.findById = (id) => consulta([String(A), String(B)].includes(String(id)) ? { _id: id, nome: String(id) === String(A) ? 'Contab A' : 'Contab B' } : null);

// ---------------- banco em memoria
const salvas = [];
ChatMensagem.create = async (d) => {
  const m = new ChatMensagem(d);
  await m.validate();
  m.createdAt = new Date();
  salvas.push(m);
  return m;
};
ChatMensagem.countDocuments = async () => 0;
ChatMensagem.updateMany = async () => ({ modifiedCount: 0 });
ChatMensagem.find = (f) => consulta(salvas.filter((m) => String(m.atendimento) === String(f.atendimento)).map((m) => m.toObject()).reverse());

const atendimentos = [];
let seq = 0;
Contador.proximo = async () => (seq += 1);
const casa = (a, f) => Object.entries(f).every(([k, v]) => String(a[k]) === String(v));
Atendimento.findOne = (f) => consulta(atendimentos.find((a) => casa(a, f)) || null);
Atendimento.findById = (id) => consulta(atendimentos.find((a) => String(a._id) === String(id)) || null);
Atendimento.find = (f) => consulta(atendimentos.filter((a) => casa(a, f)).map((a) => a.toObject()));
Atendimento.updateOne = async () => ({});
Atendimento.create = async (d) => {
  if (atendimentos.some((a) => String(a.conta) === String(d.conta) && a.status === 'aberto')) throw Object.assign(new Error('dup'), { code: 11000 });
  const a = new Atendimento(d);
  a.createdAt = new Date();
  a.save = async () => a;
  atendimentos.push(a);
  return a;
};
const anexos = [];
ChatAnexo.create = async (d) => {
  const a = new ChatAnexo(d);
  await a.validate();
  anexos.push(a);
  return a;
};
ChatAnexo.findById = async (id) => anexos.find((a) => String(a._id) === String(id)) || null;

const pessoas = {
  adminA: { _id: new mongoose.Types.ObjectId(), nome: 'Ana', role: 'admin', conta: A },
  operA: { _id: new mongoose.Types.ObjectId(), nome: 'Op', role: 'operador', conta: A },
  adminB: { _id: new mongoose.Types.ObjectId(), nome: 'Beto', role: 'admin', conta: B },
  suporte: { _id: new mongoose.Types.ObjectId(), nome: 'Gen', role: 'admin', conta: new mongoose.Types.ObjectId(), plataforma: true },
};

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  const p = pessoas[req.get('x-quem')];
  if (p) {
    req.user = p;
    req.conta = p.conta;
    req.ehPlataforma = Boolean(p.plataforma);
  }
  next();
});
app.use('/chat', chatRoutes);
const servidor = await new Promise((ok) => { const s = app.listen(0, () => ok(s)); });
const URL_BASE = `http://127.0.0.1:${servidor.address().port}`;
after(() => servidor.close());

const pedir = (quem, metodo, caminho, corpo) => fetch(URL_BASE + caminho, {
  method: metodo,
  headers: { 'x-quem': quem, ...(corpo instanceof FormData ? {} : { 'Content-Type': 'application/json' }) },
  body: corpo instanceof FormData ? corpo : corpo ? JSON.stringify(corpo) : undefined,
});

/** Abre uma conexao SSE e junta os eventos "mensagem" recebidos. */
function ouvir(quem, caminho) {
  return new Promise((ok) => {
    const recebidas = [];
    const req = http.get(URL_BASE + caminho, { headers: { 'x-quem': quem } }, (res) => {
      let buf = '';
      res.on('data', (c) => {
        buf += c;
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const bloco = buf.slice(0, i);
          buf = buf.slice(i + 2);
          if (bloco.includes('event: pronto')) ok({ recebidas, fechar: () => req.destroy() });
          const ev = /event: (\w+)\ndata: (.*)/.exec(bloco);
          if (ev && ev[1] === 'mensagem') recebidas.push(JSON.parse(ev[2]));
        }
      });
    });
  });
}
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 1)]);
const PDF = Buffer.from('%PDF-1.4\n%teste\n');

test('mensagem chega em tempo real so para o proprio escritorio e para o suporte', async () => {
  const ouvA = await ouvir('adminA', '/chat/eventos');
  const ouvB = await ouvir('adminB', '/chat/eventos');
  const ouvSup = await ouvir('suporte', '/chat/suporte/eventos');

  let r = await pedir('adminA', 'POST', '/chat/mensagens', { texto: 'Ola, preciso de ajuda' });
  assert.equal(r.status, 201);
  r = await pedir('suporte', 'POST', `/chat/suporte/${A}/mensagens`, { texto: 'Oi Ana, pode falar' });
  assert.equal(r.status, 201);
  await esperar(100);

  assert.deepEqual(ouvA.recebidas.map((m) => m.texto), ['Ola, preciso de ajuda', 'Oi Ana, pode falar']);
  assert.deepEqual(ouvSup.recebidas.map((m) => m.texto), ['Ola, preciso de ajuda', 'Oi Ana, pode falar']);
  assert.equal(ouvB.recebidas.length, 0, 'outro escritorio nao recebe');
  assert.equal(ouvSup.recebidas[1].deSuporte, true);
  assert.match(ouvSup.recebidas[1].autorNome, /suporte/);
  assert.equal(ouvA.recebidas[0].numeroAtendimento, ouvA.recebidas[1].numeroAtendimento, 'mesma conversa = mesmo atendimento');
  assert.equal(salvas.at(-2).lidaPeloEscritorio, true);
  assert.equal(salvas.at(-1).lidaPeloSuporte, true);
  [ouvA, ouvB, ouvSup].forEach((o) => o.fechar());
});

test('so administradores do escritorio usam o chat; so a plataforma usa o lado do suporte', async () => {
  assert.equal((await pedir('operA', 'POST', '/chat/mensagens', { texto: 'oi' })).status, 403);
  assert.equal((await pedir('ninguem', 'GET', '/chat/mensagens')).status, 401);
  assert.equal((await pedir('adminA', 'GET', '/chat/suporte/conversas')).status, 404);
  assert.equal((await pedir('adminA', 'GET', '/chat/suporte/atendimentos')).status, 404);
  assert.equal((await pedir('adminA', 'POST', `/chat/suporte/${B}/mensagens`, { texto: 'invadir' })).status, 404);
});

test('valida o texto e o escritorio', async () => {
  await assert.rejects(chat.enviarMensagem({ conta: A, autor: pessoas.adminA, texto: '   ' }), /Escreva/);
  await assert.rejects(chat.enviarMensagem({ conta: A, autor: pessoas.adminA, texto: 'x'.repeat(2001) }), /2000/);
  await assert.rejects(chat.enviarMensagem({ conta: new mongoose.Types.ObjectId(), autor: pessoas.suporte, deSuporte: true, texto: 'oi' }), /não encontrado/);
  await assert.rejects(chat.enviarMensagem({ conta: 'x', autor: pessoas.suporte, texto: 'oi' }), /inválida/);
});

test('atendimento numerado: encerrar arquiva, nova mensagem abre outro numero, reabrir', async () => {
  const autor = { _id: new mongoose.Types.ObjectId(), nome: 'Beto', role: 'admin' };
  const m1 = await chat.enviarMensagem({ conta: B, autor, texto: 'primeiro problema' });
  const n1 = m1.numeroAtendimento;
  assert.ok(n1 >= 1);
  const a1 = atendimentos.find((a) => a.numero === n1);

  // so a plataforma encerra
  assert.equal((await pedir('adminB', 'POST', `/chat/suporte/atendimentos/${a1._id}/encerrar`)).status, 404);
  let r = await pedir('suporte', 'POST', `/chat/suporte/atendimentos/${a1._id}/encerrar`);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).atendimento.status, 'encerrado');
  assert.match(salvas.at(-1).texto, new RegExp(`#${n1} encerrado`));
  // atendimento encerrado nao recebe resposta direta
  r = await pedir('suporte', 'POST', `/chat/suporte/atendimentos/${a1._id}/mensagens`, { texto: 'mais uma' });
  assert.equal(r.status, 400);
  assert.match((await r.json()).erro, /encerrado/);
  // sem atendimento aberto, a tela do escritorio vem vazia
  r = await pedir('adminB', 'GET', '/chat/mensagens');
  assert.equal((await r.json()).atendimento, null);

  // nova mensagem abre o proximo numero
  const m2 = await chat.enviarMensagem({ conta: B, autor, texto: 'outro assunto' });
  assert.ok(m2.numeroAtendimento > n1);
  // nao reabre o antigo enquanto houver outro aberto
  r = await pedir('adminB', 'POST', `/chat/atendimentos/${a1._id}/reabrir`);
  assert.equal(r.status, 400);
  assert.match((await r.json()).erro, new RegExp(`#${m2.numeroAtendimento}`));
  // encerra o novo e reabre o antigo (pelo proprio escritorio)
  const a2 = atendimentos.find((a) => a.numero === m2.numeroAtendimento);
  await chat.encerrarAtendimento(a2._id, { por: 'Gen' });
  r = await pedir('adminB', 'POST', `/chat/atendimentos/${a1._id}/reabrir`);
  assert.equal(r.status, 200);
  assert.equal(a1.status, 'aberto');
  // outro escritorio nao reabre nem le os atendimentos de B
  assert.equal((await pedir('adminA', 'POST', `/chat/atendimentos/${a1._id}/reabrir`)).status, 400);
  assert.equal((await pedir('adminA', 'GET', `/chat/mensagens?atendimento=${a1._id}`)).status, 404);
  // historico arquivado continua legivel
  r = await pedir('adminB', 'GET', `/chat/mensagens?atendimento=${a2._id}`);
  const arq = await r.json();
  assert.equal(arq.atendimento.status, 'encerrado');
  assert.ok(arq.itens.some((m) => m.texto === 'outro assunto'));
});

test('anexos: PDF e imagem pelo conteudo; outros arquivos recusados', () => {
  assert.equal(chat.validarAnexo(PDF, 'nota.pdf').tipo, 'application/pdf');
  assert.deepEqual(chat.validarAnexo(PNG, '../../foto'), { tipo: 'image/png', nome: 'foto.png', tamanho: PNG.length });
  assert.equal(chat.validarAnexo(PNG, 'print.jpg').nome, 'print.png'); // extensao corrigida pelo conteudo
  assert.throws(() => chat.validarAnexo(Buffer.from('<svg onload=alert(1)>'), 'x.svg'), /PDF ou uma imagem/);
  assert.throws(() => chat.validarAnexo(Buffer.from('MZ\x90\x00'), 'virus.pdf'), /PDF ou uma imagem/);
  assert.throws(() => chat.validarAnexo(Buffer.alloc(0), 'a.pdf'), /vazio/);
});

test('anexos: envio pelo escritorio e pela plataforma; so quem pode baixa', async () => {
  let fd = new FormData();
  fd.append('texto', 'segue o boleto');
  fd.append('arquivo', new Blob([PDF], { type: 'application/pdf' }), 'boleto.pdf');
  let r = await pedir('adminA', 'POST', '/chat/mensagens', fd);
  assert.equal(r.status, 201);
  const m = (await r.json()).mensagem;
  assert.equal(m.anexo.nome, 'boleto.pdf');
  assert.equal(m.texto, 'segue o boleto');

  // so arquivo, sem texto (plataforma)
  fd = new FormData();
  fd.append('arquivo', new Blob([PNG], { type: 'image/png' }), 'tela.png');
  r = await pedir('suporte', 'POST', `/chat/suporte/${A}/mensagens`, fd);
  assert.equal(r.status, 201);
  const m2 = (await r.json()).mensagem;
  assert.equal(m2.anexo.tipo, 'image/png');

  // download
  r = await pedir('adminA', 'GET', `/chat/anexos/${m.anexo.id}`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/pdf');
  assert.match(r.headers.get('content-security-policy'), /sandbox/);
  assert.equal(Buffer.from(await r.arrayBuffer()).toString('latin1').slice(0, 5), '%PDF-');
  assert.equal((await pedir('adminB', 'GET', `/chat/anexos/${m.anexo.id}`)).status, 404, 'outro escritorio nao baixa');
  assert.equal((await pedir('suporte', 'GET', `/chat/suporte/anexos/${m2.anexo.id}`)).status, 200);

  // arquivo que nao e PDF/imagem
  fd = new FormData();
  fd.append('arquivo', new Blob(['<html>']), 'pagina.pdf');
  r = await pedir('adminA', 'POST', '/chat/mensagens', fd);
  assert.equal(r.status, 400);
});

test('limite de mensagens por minuto', async () => {
  const p = { _id: new mongoose.Types.ObjectId(), nome: 'Rapido', role: 'admin' };
  for (let i = 0; i < 30; i += 1) await chat.enviarMensagem({ conta: B, autor: p, texto: `m${i}` });
  await assert.rejects(chat.enviarMensagem({ conta: B, autor: p, texto: 'mais uma' }), /Muitas mensagens/);
});
