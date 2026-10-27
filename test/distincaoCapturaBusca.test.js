import { test } from 'node:test';
import assert from 'node:assert/strict';
import { montarFiltroNotas, queryString } from '../src/services/filtroNotas.js';

test('filtro local no banco não depende do parâmetro buscar', () => {
  const queryFiltroLocal = {
    q: 'Supermercado 123456',
    mes: '2026-10',
    papel: 'tomadas',
    situacao: 'ativas',
  };

  const { filtro, filtros } = montarFiltroNotas(queryFiltroLocal, 'owner_teste');

  // Verifica que o filtro Mongo gerado busca no banco local
  assert.equal(filtro.owner, 'owner_teste');
  assert.equal(filtro.papel, 'destinatario');
  assert.equal(filtro.cancelada.$ne, true);
  assert.equal(filtro.tipo.$ne, 'evento');
  assert.ok(filtro.dataEmissao.$gte instanceof Date);
  assert.ok(filtro.dataEmissao.$lt instanceof Date);

  // O parâmetro buscar não afeta o filtro local
  assert.equal(filtros.q, 'Supermercado 123456');
  assert.equal(filtros.mes, '2026-10');
  assert.equal(filtros.papel, 'tomadas');
});

test('queryString preserva filtros para busca e exportação', () => {
  const qs = queryString({
    empresa: 'empresa123',
    categoria: 'produtos',
    mes: '2026-10',
  }, { page: '' });

  assert.ok(qs.includes('empresa=empresa123'));
  assert.ok(qs.includes('categoria=produtos'));
  assert.ok(qs.includes('mes=2026-10'));
  assert.ok(!qs.includes('page='));
});

test('rotas de captura / e /todas e /:empresaId estão definidas', async () => {
  const { default: capturaRoutes } = await import('../src/routes/captura.js');
  const rotas = capturaRoutes.stack
    .filter((layer) => layer.route)
    .map((layer) => ({ path: layer.route.path, methods: Object.keys(layer.route.methods) }));

  assert.ok(rotas.some((r) => r.path === '/' && r.methods.includes('get')));
  assert.ok(rotas.some((r) => r.path === '/todas' && r.methods.includes('post')));
  assert.ok(rotas.some((r) => r.path === '/:empresaId' && r.methods.includes('post')));
});
