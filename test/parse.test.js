import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.js';
import { resumirDocumento } from '../src/services/sefaz/parseDocumento.js';
import { resumirNfseNacional } from '../src/services/nfse/parseNfseNacional.js';
import { resumirCte } from '../src/services/sefaz/cteDistribuicao.js';

test('NF-e completa: chave como texto, valor e papel', () => {
  const r = resumirDocumento(fixture('nfe.xml'), '52998224725');
  assert.equal(r.tipo, 'nfe');
  assert.equal(r.chave, '35261011222333000181550010000012341000012345');
  assert.equal(r.valorTotal, 735);
  assert.equal(r.papel, 'destinatario');
  assert.equal(r.resumo, false);
});

test('resumo de NF-e fica pendente de manifestacao', () => {
  const r = resumirDocumento(fixture('resnfe.xml'), '52998224725');
  assert.equal(r.resumo, true);
  assert.equal(r.situacaoManifestacao, 'pendente');
});

test('NFS-e nacional: tomador pessoa fisica', () => {
  const r = resumirNfseNacional(fixture('nfse.xml'), '52998224725');
  assert.equal(r.tipo, 'nfse');
  assert.equal(r.papel, 'destinatario');
  assert.equal(r.valorTotal, 250);
  assert.equal(r.chave.length, 50);
});

test('CT-e: participante como destinatario', () => {
  const r = resumirCte(fixture('cte.xml'), '52998224725');
  assert.equal(r.tipo, 'cte');
  assert.equal(r.papel, 'destinatario');
  assert.equal(r.valorTotal, 180);
});
