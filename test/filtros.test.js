import { test } from 'node:test';
import assert from 'node:assert/strict';
import { montarFiltroNotas, queryString } from '../src/services/filtroNotas.js';

test('sem filtros esconde eventos', () => {
  assert.deepEqual(montarFiltroNotas({}, 'U').filtro, { owner: 'U', tipo: { $ne: 'evento' } });
});

test('mes, servicos e tomadas', () => {
  const { filtro } = montarFiltroNotas({ categoria: 'servicos', papel: 'tomadas', mes: '2026-12' }, 'U');
  assert.deepEqual(filtro.tipo, { $in: ['nfse'] });
  assert.equal(filtro.papel, 'destinatario');
  assert.equal(filtro.dataEmissao.$gte.toISOString(), '2026-12-01T03:00:00.000Z');
  assert.equal(filtro.dataEmissao.$lt.toISOString(), '2027-01-01T03:00:00.000Z');
});

test('intervalo de datas tem prioridade sobre o mes', () => {
  const { filtro } = montarFiltroNotas({ de: '2026-01-15', ate: '2026-01-31', mes: '2026-05' }, 'U');
  assert.equal(filtro.dataEmissao.$gte.toISOString(), '2026-01-15T03:00:00.000Z');
  assert.equal(filtro.dataEmissao.$lt.toISOString(), '2026-02-01T03:00:00.000Z');
});

test('busca por CPF com pontuacao e texto com caracteres especiais', () => {
  const { filtro } = montarFiltroNotas({ q: 'A.B (x) 529.982' }, 'U');
  assert.ok(filtro.$or.some((c) => c.destinatarioCnpjCpf && c.destinatarioCnpjCpf.test('52998224725')));
  assert.ok(filtro.$or[0].chave.test('a.b (x) 529.982'));
});

test('aguardando manifestacao', () => {
  const { filtro } = montarFiltroNotas({ situacao: 'manifestar' }, 'U');
  assert.deepEqual(filtro.situacaoManifestacao, { $in: ['pendente', 'ciencia'] });
  assert.equal(queryString({ a: '1', b: '', c: undefined }), 'a=1');
});

test('captura com filtro: varios tipos e so o que chegou na captura', async () => {
  const { montarFiltroNotas } = await import('../src/services/filtroNotas.js');
  const owner = '0123456789abcdef01234567';
  const { filtro } = montarFiltroNotas({ categoria: 'produtos,cte', papel: 'tomadas', capturadasDesde: '2026-10-23T05:00:00.000Z' }, owner);
  assert.deepEqual(filtro.tipo, { $in: ['nfe', 'nfce', 'cte'] });
  assert.equal(filtro.papel, 'destinatario');
  assert.equal(filtro.arquivoEm.$gte.toISOString(), '2026-10-23T05:00:00.000Z');
  const sem = montarFiltroNotas({ capturadasDesde: 'lixo' }, owner);
  assert.equal(sem.filtro.arquivoEm, undefined);
  assert.equal(sem.filtros.capturadasDesde, '');
});
