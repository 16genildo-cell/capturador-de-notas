import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.js';
import { gerarPdfNota } from '../src/services/pdf/documentoPdf.js';

for (const [tipo, arquivo, extra] of [['nfe', 'nfe.xml'], ['nfe', 'resnfe.xml', { resumo: true }], ['nfse', 'nfse.xml', { cancelada: true }], ['cte', 'cte.xml']]) {
  test(`gera PDF de ${tipo} (${arquivo})`, async () => {
    const pdf = await gerarPdfNota({ tipo, xml: fixture(arquivo), ...extra });
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    assert.ok(pdf.length > 2000);
  });
}

test('CT-e completo gera DACTE oficial (leiaute retrato)', async () => {
  const { gerarDacte } = await import('../src/services/pdf/dacte.js');
  const xml = (await import('node:fs')).readFileSync(new URL('./fixtures/cte.xml', import.meta.url), 'utf8');
  const pdf = await gerarDacte(xml);
  assert.ok(pdf && pdf.subarray(0, 4).toString() === '%PDF');
  assert.equal(await gerarDacte('<nfeProc/>'), null);
});
