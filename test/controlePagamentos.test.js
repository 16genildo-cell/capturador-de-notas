import { test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import {
  obterMesAtual,
  formatarMesNome,
  listarCompetencias,
  gerarCsvPagamentos,
} from '../src/services/pagamentosControle.js';

test('obterMesAtual retorna formato AAAA-MM válido', () => {
  const mesAtual = obterMesAtual();
  assert.match(mesAtual, /^\d{4}-\d{2}$/, 'Deve retornar formato YYYY-MM');
});

test('formatarMesNome converte competência para texto legível em português', () => {
  assert.equal(formatarMesNome('2026-10'), 'Outubro de 2026');
  assert.equal(formatarMesNome('2026-01'), 'Janeiro de 2026');
  assert.equal(formatarMesNome('2026-12'), 'Dezembro de 2026');
});

test('listarCompetencias gera lista com mês selecionado e formato correto', () => {
  const lista = listarCompetencias('2026-10');
  assert.ok(Array.isArray(lista));
  assert.ok(lista.length >= 10);
  assert.ok(lista.some((c) => c.id === '2026-10' && c.selecionado === true));
  assert.ok(lista.every((c) => /^\d{4}-\d{2}$/.test(c.id)));
});

test('gerarCsvPagamentos gera arquivo CSV com BOM UTF-8 e cabeçalhos corretos', () => {
  const dadosMock = {
    mesFormatado: 'Outubro de 2026',
    estatisticas: {
      totalContas: 2,
      totalPagos: 1,
      totalPendentes: 1,
      valorTotalEsperado: 299.8,
      valorTotalPago: 199.9,
      valorTotalPendente: 99.9,
      percentualPago: 50,
    },
    itens: [
      {
        nome: 'Contabilidade Alpha',
        documento: '12.345.678/0001-90',
        responsavel: 'Carlos Silva',
        telefone: '(11) 98888-7777',
        email: 'carlos@alpha.com',
        planoNome: 'Profissional',
        valor: 199.9,
        pago: true,
        pagoEm: new Date('2026-10-10T12:00:00Z'),
        formaPagamento: 'pix',
        confirmadoPor: 'admin@vfisco.com',
        observacoes: 'Pago no dia 10 via PIX',
      },
      {
        nome: 'Contabilidade Beta',
        documento: '98.765.432/0001-10',
        responsavel: 'Mariana Souza',
        telefone: '(21) 97777-6666',
        email: 'mariana@beta.com',
        planoNome: 'Básico',
        valor: 99.9,
        pago: false,
        pagoEm: null,
        formaPagamento: 'boleto',
        confirmadoPor: null,
        observacoes: '',
      },
    ],
  };

  const csv = gerarCsvPagamentos(dadosMock);

  // Verifica presença do BOM UTF-8 para compatibilidade com Excel
  assert.ok(csv.startsWith('\uFEFF'));

  // Verifica cabeçalhos esperados
  assert.ok(csv.includes('Escritorio'));
  assert.ok(csv.includes('Documento'));
  assert.ok(csv.includes('Situacao'));
  assert.ok(csv.includes('Valor (R$)'));

  // Verifica dados do escritório pago
  assert.ok(csv.includes('Contabilidade Alpha'));
  assert.ok(csv.includes('"PAGO"'));
  assert.ok(csv.includes('"PIX"'));
  assert.ok(csv.includes('admin@vfisco.com'));

  // Verifica dados do escritório pendente
  assert.ok(csv.includes('Contabilidade Beta'));
  assert.ok(csv.includes('"PENDENTE"'));

  // Verifica totais
  assert.ok(csv.includes('TOTAL GERAL'));
  assert.ok(csv.includes('Adimplência: 50%'));
});

test('rotas de controle de pagamentos estão montadas no roteador da plataforma', async () => {
  const { default: plataformaRoutes } = await import('../src/routes/plataforma.js');
  const rotas = plataformaRoutes.stack
    .filter((layer) => layer.route)
    .map((layer) => ({ path: layer.route.path, methods: Object.keys(layer.route.methods) }));

  assert.ok(rotas.some((r) => r.path === '/pagamentos' && r.methods.includes('get')));
  assert.ok(rotas.some((r) => r.path === '/pagamentos/:contaId/ok' && r.methods.includes('post')));
  assert.ok(rotas.some((r) => r.path === '/pagamentos/:contaId/desmarcar' && r.methods.includes('post')));
  assert.ok(rotas.some((r) => r.path === '/pagamentos/:contaId/suspender' && r.methods.includes('post')));
  assert.ok(rotas.some((r) => r.path === '/pagamentos/:contaId/ativar' && r.methods.includes('post')));
  assert.ok(rotas.some((r) => r.path === '/pagamentos/relatorio' && r.methods.includes('get')));
});

test('suspenderConta e reativarConta alternam status e gravam histórico', async () => {
  const { Conta } = await import('../src/models/Conta.js');
  const { suspenderConta, reativarConta } = await import('../src/services/pagamentosControle.js');

  const contaMock = new Conta({
    _id: new (await import('mongoose')).default.Types.ObjectId(),
    nome: 'Escritório Teste',
    status: 'inadimplente',
  });

  // Mock do Conta.findById
  const originalFindById = Conta.findById;
  Conta.findById = async (id) => (String(id) === String(contaMock._id) ? contaMock : null);
  contaMock.save = async () => contaMock;

  try {
    // Suspender
    await suspenderConta(contaMock._id, {
      motivo: 'Falta de pagamento de Outubro',
      adminEmail: 'admin@vfisco.com',
      mes: '2026-10',
    });
    assert.equal(contaMock.status, 'suspensa');
    assert.equal(contaMock.statusAnterior, 'inadimplente');
    assert.ok(contaMock.historico.some((h) => h.acao === 'suspensao-falta-pagamento'));

    // Reativar
    await reativarConta(contaMock._id, {
      adminEmail: 'admin@vfisco.com',
      mes: '2026-10',
    });
    assert.equal(contaMock.status, 'inadimplente'); // volta para o status anterior ou ativa
    assert.ok(contaMock.historico.some((h) => h.acao === 'reativacao-servico'));
  } finally {
    Conta.findById = originalFindById;
  }
});
