import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validarCPF, validarCNPJ, normalizarDocumento, formatarDocumento, tagDocumento, tipoPessoa } from '../src/utils/documento.js';

test('valida CPF e CNPJ', () => {
  assert.equal(validarCPF('529.982.247-25'), true);
  assert.equal(validarCPF('52998224724'), false);
  assert.equal(validarCPF('11111111111'), false);
  assert.equal(validarCNPJ('11.222.333/0001-81'), true);
  assert.equal(validarCNPJ('11222333000182'), false);
});

test('normaliza, formata e monta a tag do interessado', () => {
  assert.equal(normalizarDocumento('529.982.247-25'), '52998224725');
  assert.throws(() => normalizarDocumento('123'));
  assert.equal(formatarDocumento('11222333000181'), '11.222.333/0001-81');
  assert.equal(tagDocumento('52998224725'), '<CPF>52998224725</CPF>');
  assert.equal(tagDocumento('11222333000181'), '<CNPJ>11222333000181</CNPJ>');
  assert.equal(tipoPessoa('52998224725'), 'PF');
});
