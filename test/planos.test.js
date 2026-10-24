import { test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import './helpers.js';

process.env.CARENCIA_DIAS = '5';
const { Conta } = await import('../src/models/Conta.js');
const { User } = await import('../src/models/User.js');
const {
  PLANOS, LISTA_PLANOS, aplicarPlanos, somarPeriodo, rotuloPeriodo, normalizarPeriodo, mesesDoPeriodo, TODAS_FUNCIONALIDADES, planosPublicos,
} = await import('../src/config/planos.js');
const { lerDadosPlano, codigoDoNome } = await import('../src/services/planos.js');
const { ajustarConta } = await import('../src/services/plataforma.js');
const { cicloAsaas, fimDoPeriodo } = await import('../src/services/asaas.js');
const { exigirRecursoApi, verificarLimiteUsuarios, recursoLiberado } = await import('../src/middleware/assinatura.js');
const { contaPublica } = await import('../src/api/util.js');

const DIA = 864e5;
const iso = (d) => d.toISOString().slice(0, 10);

// Planos de teste no cache (como se tivessem vindo do banco)
aplicarPlanos([
  { _id: 'quinzenal', nome: 'Quinzenal', preco: 50, periodo: { quantidade: 15, unidade: 'dia' }, limiteEmpresas: 2, limiteUsuarios: 2, diasGratis: 0, funcionalidades: ['captura_nfe', 'relatorios'] },
  { _id: 'anual', nome: 'Anual', preco: 1200, periodo: { quantidade: 12, unidade: 'mes' }, limiteEmpresas: null, limiteUsuarios: null, diasGratis: 30, funcionalidades: TODAS_FUNCIONALIDADES, publico: false },
  { _id: 'antigo', nome: 'Antigo', preco: 10, periodo: { quantidade: 1, unidade: 'mes' }, limiteEmpresas: 5, funcionalidades: ['captura_nfe'], ativo: false },
]);

test('periodos: 15 dias, mensal no fim do mes, anual e rotulos', () => {
  assert.equal(iso(somarPeriodo(new Date('2026-10-01T12:00:00Z'), { quantidade: 15, unidade: 'dia' })), '2026-10-16');
  assert.equal(iso(somarPeriodo(new Date('2026-01-31T12:00:00Z'), { quantidade: 1, unidade: 'mes' })), '2026-02-28');
  assert.equal(iso(somarPeriodo(new Date('2026-03-10T12:00:00Z'), { quantidade: 12, unidade: 'mes' })), '2027-03-10');
  assert.equal(rotuloPeriodo({ quantidade: 3, unidade: 'mes' }), 'Trimestral');
  assert.equal(rotuloPeriodo({ quantidade: 15, unidade: 'dia' }), '15 dias');
  assert.equal(rotuloPeriodo({ quantidade: 45, unidade: 'dia' }), 'A cada 45 dias');
  assert.deepEqual(normalizarPeriodo('anual'), { quantidade: 12, unidade: 'mes' });
  assert.throws(() => normalizarPeriodo({ quantidade: 0, unidade: 'mes' }));
  assert.equal(mesesDoPeriodo({ quantidade: 12, unidade: 'mes' }), 12);
});

test('Asaas: ciclo e fim do periodo conforme o plano', () => {
  assert.equal(cicloAsaas({ quantidade: 1, unidade: 'mes' }), 'MONTHLY');
  assert.equal(cicloAsaas({ quantidade: 3, unidade: 'mes' }), 'QUARTERLY');
  assert.equal(cicloAsaas({ quantidade: 15, unidade: 'dia' }), 'BIWEEKLY');
  assert.equal(cicloAsaas({ quantidade: 45, unidade: 'dia' }), null);
  assert.equal(iso(fimDoPeriodo('2026-10-15', PLANOS.anual)), '2027-10-15');
  assert.equal(iso(fimDoPeriodo('2026-10-15', PLANOS.quinzenal)), '2026-10-30');
  assert.equal(iso(fimDoPeriodo('2026-10-15', null)), '2026-11-15');
});

test('formulario do plano: valida e normaliza', () => {
  const d = lerDadosPlano({ nome: 'Plus', preco: '99,90', periodo: 'trimestral', limiteEmpresas: '', limiteUsuarios: '3', diasGratis: '7', funcionalidades: ['relatorios', 'xpto', 'captura_nfe'] });
  assert.equal(d.preco, 99.9);
  assert.deepEqual(d.periodo, { quantidade: 3, unidade: 'mes' });
  assert.equal(d.limiteEmpresas, null);
  assert.equal(d.limiteUsuarios, 3);
  assert.deepEqual(d.funcionalidades, ['captura_nfe', 'relatorios']);
  assert.throws(() => lerDadosPlano({ nome: 'X', periodo: 'mensal', funcionalidades: [] }), /funcionalidade/);
  assert.throws(() => lerDadosPlano({ nome: '', periodo: 'mensal', funcionalidades: ['relatorios'] }), /nome/);
  assert.equal(codigoDoNome('Plano Anual Básico!'), 'plano-anual-basico');
});

test('site so mostra planos ativos e publicos; cache ordenado', () => {
  assert.deepEqual(planosPublicos().map((p) => p.id), ['quinzenal']);
  assert.equal(LISTA_PLANOS.length, 3);
});

test('conta: limites e funcionalidades vem do plano; sem plano libera tudo', () => {
  const c = new Conta({ nome: 'X', status: 'ativa', plano: 'quinzenal' });
  assert.equal(c.limiteEmpresas(), 2);
  assert.equal(c.limiteUsuarios(), 2);
  assert.equal(c.temRecurso('relatorios'), true);
  assert.equal(c.temRecurso('importar_xml'), false);
  const anual = new Conta({ nome: 'Y', status: 'ativa', plano: 'anual' });
  assert.equal(anual.limiteEmpresas(), Infinity);
  assert.equal(anual.limiteUsuarios(), Infinity);
  const sem = new Conta({ nome: 'Z', status: 'cortesia' });
  assert.deepEqual(sem.recursos(), TODAS_FUNCIONALIDADES);
  c.limiteUsuariosManual = 5;
  assert.equal(c.limiteUsuarios(), 5);
  const pub = contaPublica(c);
  assert.deepEqual(pub.recursos, ['captura_nfe', 'relatorios']);
  assert.equal(pub.limiteUsuarios, 5);
  assert.equal(pub.plano.rotuloPeriodo, '15 dias');
  assert.equal(contaPublica(anual).limiteEmpresas, null);
});

test('pausada bloqueia o acesso', () => {
  const r = new Conta({ nome: 'X', status: 'pausada', pagoAte: new Date(Date.now() + 10 * DIA) }).acesso();
  assert.equal(r.liberado, false);
  assert.equal(r.motivo, 'pausada');
});

// ---------------------------------------------------------------- acoes do dono da plataforma
/** Conta em memoria: ajustarConta busca, altera e "salva". */
function contaFake(dados) {
  const c = new Conta({ _id: new mongoose.Types.ObjectId(), nome: 'Contab', ...dados });
  c.save = async () => c;
  Conta.findById = async (id) => (String(id) === String(c._id) ? c : null);
  return c;
}
const fazer = (c, dados) => ajustarConta(String(c._id), dados, { por: 'dono@plataforma.com' });

test('atribuir plano com periodo gratis, ja pago e sem periodo gratis definido', async () => {
  let c = contaFake({ status: 'teste' });
  await fazer(c, { acao: 'atribuir-plano', plano: 'anual', inicio: 'gratis' });
  assert.equal(c.status, 'teste');
  assert.equal(Math.round((c.testeAte - Date.now()) / DIA), 30); // dias gratis do plano
  assert.equal(c.historico.at(-1).por, 'dono@plataforma.com');

  c = contaFake({ status: 'teste' });
  await fazer(c, { acao: 'atribuir-plano', plano: 'quinzenal', inicio: 'pago' });
  assert.equal(c.status, 'ativa');
  assert.equal(Math.round((c.pagoAte - Date.now()) / DIA), 15);

  c = contaFake({ status: 'teste' });
  await assert.rejects(fazer(c, { acao: 'atribuir-plano', plano: 'quinzenal', inicio: 'gratis' }), /dias grátis/);
  await fazer(c, { acao: 'atribuir-plano', plano: 'quinzenal', inicio: 'gratis', dias: 3 });
  assert.equal(Math.round((c.testeAte - Date.now()) / DIA), 3);

  await assert.rejects(fazer(c, { acao: 'atribuir-plano', plano: 'antigo', inicio: 'pago' }), /arquivado/);
  await assert.rejects(fazer(c, { acao: 'atribuir-plano', plano: 'nao-existe' }), /não encontrado/);
});

test('registrar pagamento: emenda no periodo anterior ou comeca hoje', async () => {
  const daqui5 = new Date(Date.now() + 5 * DIA);
  let c = contaFake({ status: 'inadimplente', plano: 'quinzenal', pagoAte: daqui5 });
  await fazer(c, { acao: 'renovar', periodos: 2 });
  assert.equal(c.status, 'ativa');
  assert.equal(Math.round((c.pagoAte - daqui5) / DIA), 30);

  c = contaFake({ status: 'inadimplente', plano: 'quinzenal', pagoAte: new Date(Date.now() - 60 * DIA) });
  await fazer(c, { acao: 'renovar' });
  assert.equal(Math.round((c.pagoAte - Date.now()) / DIA), 15);

  c = contaFake({ status: 'teste' });
  await assert.rejects(fazer(c, { acao: 'renovar' }), /Atribua um plano/);
});

test('pausar e retomar devolve os dias parados', async () => {
  const c = contaFake({ status: 'ativa', plano: 'quinzenal', pagoAte: new Date(Date.now() + 10 * DIA) });
  await fazer(c, { acao: 'pausar' });
  assert.equal(c.status, 'pausada');
  assert.equal(c.acesso().liberado, false);
  c.pausadaEm = new Date(Date.now() - 4 * DIA); // ficou 4 dias parada
  const antes = c.pagoAte.getTime();
  await fazer(c, { acao: 'retomar' });
  assert.equal(c.status, 'ativa');
  assert.equal(Math.round((c.pagoAte.getTime() - antes) / DIA), 4);
  await assert.rejects(fazer(c, { acao: 'retomar' }), /não está pausada/);
});

test('bloquear e desbloquear volta para a situacao anterior', async () => {
  const c = contaFake({ status: 'teste', testeAte: new Date(Date.now() + 5 * DIA) });
  await fazer(c, { acao: 'bloquear', motivo: 'calote' });
  assert.equal(c.status, 'suspensa');
  assert.equal(c.acesso().liberado, false);
  assert.match(c.historico.at(-1).detalhe, /calote/);
  await fazer(c, { acao: 'desbloquear' });
  assert.equal(c.status, 'teste');
  assert.equal(c.acesso().liberado, true);
});

test('cancelar: no fim do periodo pago ou com bloqueio imediato', async () => {
  let c = contaFake({ status: 'ativa', plano: 'quinzenal', pagoAte: new Date(Date.now() + 7 * DIA) });
  await fazer(c, { acao: 'cancelar' });
  assert.equal(c.status, 'cancelada');
  assert.equal(c.acesso().liberado, true); // usa ate o fim do que pagou

  c = contaFake({ status: 'inadimplente', plano: 'quinzenal', pagoAte: new Date(Date.now() + 2 * DIA) });
  await fazer(c, { acao: 'cancelar', imediato: true });
  assert.equal(c.status, 'cancelada');
  assert.equal(c.acesso().liberado, false);
});

test('marcar inadimplente respeita a carencia', async () => {
  const c = contaFake({ status: 'ativa', plano: 'quinzenal', pagoAte: new Date(Date.now() - 2 * DIA) });
  await fazer(c, { acao: 'inadimplente' });
  assert.equal(c.status, 'inadimplente');
  assert.equal(c.acesso().liberado, true); // ainda dentro dos 5 dias
});

// ---------------------------------------------------------------- bloqueios
test('API: funcionalidade fora do plano responde 403', () => {
  const req = { contaSaas: new Conta({ nome: 'X', status: 'ativa', plano: 'quinzenal' }) };
  let status;
  let corpo;
  const res = { status(s) { status = s; return this; }, json(j) { corpo = j; return this; } };
  let passou = false;
  exigirRecursoApi('importar_xml')(req, res, () => { passou = true; });
  assert.equal(passou, false);
  assert.equal(status, 403);
  assert.equal(corpo.codigo, 'recurso');
  exigirRecursoApi('relatorios')(req, res, () => { passou = true; });
  assert.equal(passou, true);
  assert.equal(recursoLiberado({ ...req, ehPlataforma: true }, 'importar_xml'), true);
});

test('limite de usuarios da equipe', async () => {
  const conta = new Conta({ nome: 'X', status: 'ativa', plano: 'quinzenal' }); // ate 2
  const req = { conta: conta._id, contaSaas: conta };
  User.countDocuments = async () => 1;
  await verificarLimiteUsuarios(req);
  User.countDocuments = async () => 2;
  await assert.rejects(verificarLimiteUsuarios(req), /2 usuário/);
  conta.plano = 'anual';
  await verificarLimiteUsuarios(req); // ilimitado
});

// ---------------------------------------------------------------- armazenamento das notas
const { NotaFiscal } = await import('../src/models/NotaFiscal.js');
const { situacaoArquivo, filtroVencidas, limparArquivos, marcarBaixadas, MARGEM_APOS_DOWNLOAD_MS } = await import('../src/services/retencao.js');
const { rotuloArmazenamento } = await import('../src/config/planos.js');

test('armazenamento: regra do plano, rotulo e formulario', () => {
  assert.equal(rotuloArmazenamento({ dias: null, apagarAoBaixar: false }), 'Guarda as notas sempre');
  assert.equal(rotuloArmazenamento({ dias: 30, apagarAoBaixar: true }), 'Apaga ao baixar ou após 30 dia(s)');
  const d = lerDadosPlano({ nome: 'X', periodo: 'mensal', funcionalidades: ['relatorios'], retencaoDias: '30', apagarAoBaixar: true });
  assert.equal(d.retencaoDias, 30);
  assert.equal(d.apagarAoBaixar, true);
  assert.equal(lerDadosPlano({ nome: 'X', periodo: 'mensal', funcionalidades: ['relatorios'], retencaoDias: '' }).retencaoDias, null);
  assert.throws(() => lerDadosPlano({ nome: 'X', periodo: 'mensal', funcionalidades: ['relatorios'], retencaoDias: '0' }));
  // conta sem plano guarda sempre
  assert.deepEqual(new Conta({ nome: 'X', status: 'cortesia' }).armazenamento(), { dias: null, apagarAoBaixar: false });
});

test('situacao do arquivo: data de expiracao, ao baixar e ja apagado', () => {
  const capturada = new Date('2026-10-01T12:00:00Z');
  const n = { arquivoEm: capturada, createdAt: capturada };
  assert.equal(situacaoArquivo(n, { dias: null, apagarAoBaixar: false }).ate, null);
  assert.equal(iso(situacaoArquivo(n, { dias: 10, apagarAoBaixar: false }).ate), '2026-10-11');
  const baixada = new Date('2026-10-03T12:00:00Z');
  assert.equal(situacaoArquivo({ ...n, baixadaEm: baixada }, { dias: 10, apagarAoBaixar: true }).ate.getTime(), baixada.getTime() + MARGEM_APOS_DOWNLOAD_MS);
  assert.equal(situacaoArquivo({ ...n, resumo: true }, { dias: 1, apagarAoBaixar: true }).ate, null); // resumo nao apaga
  const ap = situacaoArquivo({ ...n, xmlApagadoEm: baixada }, { dias: 10 });
  assert.equal(ap.disponivel, false);
});

test('filtro de notas vencidas: por dias, ao baixar (com margem) e guardar sempre', () => {
  const agora = new Date('2026-10-20T12:00:00Z');
  const owner = new mongoose.Types.ObjectId();
  assert.equal(filtroVencidas(owner, { dias: null, apagarAoBaixar: false }, agora), null);
  const f = filtroVencidas(owner, { dias: 10, apagarAoBaixar: true }, agora);
  assert.equal(iso(f.$or[0].arquivoEm.$lt), '2026-10-10');
  assert.equal(f.$or[2].baixadaEm.$lt.getTime(), agora.getTime() - MARGEM_APOS_DOWNLOAD_MS);
  assert.deepEqual(f.resumo, { $ne: true });
  assert.equal(f.xmlApagadoEm, null);
});

test('limpeza: so contas com regra; apaga o XML e marca a data; downloads sao marcados', async () => {
  aplicarPlanos([
    { _id: 'efemero', nome: 'Efemero', preco: 1, periodo: { quantidade: 1, unidade: 'mes' }, funcionalidades: ['captura_nfe'], retencaoDias: 7, apagarAoBaixar: true },
    { _id: 'guarda', nome: 'Guarda', preco: 1, periodo: { quantidade: 1, unidade: 'mes' }, funcionalidades: ['captura_nfe'] },
  ]);
  const c1 = new Conta({ _id: new mongoose.Types.ObjectId(), nome: 'A', status: 'ativa', plano: 'efemero' });
  let consultaContas;
  Conta.find = (q) => { consultaContas = q; return { select: async () => [c1] }; };
  const chamadas = [];
  NotaFiscal.updateMany = async (filtro, upd) => { chamadas.push({ filtro, upd }); return { modifiedCount: 3 }; };
  const r = await limparArquivos(new Date());
  assert.deepEqual(consultaContas.plano.$in, ['efemero']);
  assert.equal(r.apagadas, 3);
  assert.equal(String(chamadas[0].filtro.owner), String(c1._id));
  assert.deepEqual(chamadas[0].upd.$unset, { xml: 1 });
  assert.ok(chamadas[0].upd.$set.xmlApagadoEm instanceof Date);

  await marcarBaixadas({ _id: 'x' });
  assert.equal(chamadas[1].filtro.baixadaEm, null); // so marca o 1o download
  assert.ok(chamadas[1].upd.$set.baixadaEm instanceof Date);
  // nota com XML apagado continua valida para salvar (sem o XML)
  const n = new NotaFiscal({ empresa: c1._id, owner: c1._id, tipo: 'nfe', xmlApagadoEm: new Date() });
  assert.equal(n.validateSync(), undefined);
  assert.ok(new NotaFiscal({ empresa: c1._id, owner: c1._id, tipo: 'nfe' }).validateSync().errors.xml);
});

test('chat com o suporte: sempre aberto para conta sem acesso ou sem plano', async () => {
  const { chatLiberado } = await import('../src/middleware/assinatura.js');
  aplicarPlanos([{ _id: 'semchat', nome: 'Sem chat', preco: 1, periodo: { quantidade: 1, unidade: 'mes' }, funcionalidades: ['captura_nfe'] }]);
  const futuro = new Date(Date.now() + 10 * DIA);
  assert.equal(chatLiberado({ contaSaas: new Conta({ nome: 'A', status: 'ativa', plano: 'semchat', pagoAte: futuro }) }), false);
  assert.equal(chatLiberado({ contaSaas: new Conta({ nome: 'B', status: 'suspensa', plano: 'semchat' }) }), true);
  assert.equal(chatLiberado({ contaSaas: new Conta({ nome: 'C', status: 'pausada', plano: 'semchat' }) }), true);
  assert.equal(chatLiberado({ contaSaas: new Conta({ nome: 'D', status: 'teste', testeAte: new Date(Date.now() - DIA) }) }), true);
  assert.equal(chatLiberado({ contaSaas: new Conta({ nome: 'E', status: 'ativa' }) }), true);
});
