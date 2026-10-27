import { test } from 'node:test';
import assert from 'node:assert/strict';
import ejs from 'ejs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('relatorios.ejs compila e renderiza sem erro de tem is not defined', () => {
  const filePath = path.join(__dirname, '../src/views/relatorios.ejs');
  const template = fs.readFileSync(filePath, 'utf8');

  const dadosMock = {
    base: '',
    meses: [
      { mes: '2026-10', entradas: { valor: 100, qtd: 1 }, saidas: { valor: 200, qtd: 2 } },
    ],
    fornecedores: [],
    clientes: [],
    itens: { cfop: [], ncm: [] },
    empresas: [],
    filtros: { ano: '2026', de: '', ate: '', categoria: '', empresa: '' },
    categorias: { produtos: { rotulo: 'Produtos' } },
    qs: () => '',
    locals: {
      recursos: ['relatorios', 'dre_gerencial', 'auditoria_fiscal'],
    },
  };

  let html = '';
  assert.doesNotThrow(() => {
    html = ejs.render(template, dadosMock);
  });

  assert.ok(html.includes('DRE Gerencial'));
  assert.ok(html.includes('Auditoria Preventiva'));
});

test('relatorios.ejs funciona mesmo quando locals.recursos e locals.tem estão vazios', () => {
  const filePath = path.join(__dirname, '../src/views/relatorios.ejs');
  const template = fs.readFileSync(filePath, 'utf8');

  const dadosMock = {
    base: '',
    meses: [],
    fornecedores: [],
    clientes: [],
    itens: { cfop: [], ncm: [] },
    empresas: [],
    filtros: { ano: '2026', de: '', ate: '', categoria: '', empresa: '' },
    categorias: { produtos: { rotulo: 'Produtos' } },
    qs: () => '',
    locals: {},
  };

  let html = '';
  assert.doesNotThrow(() => {
    html = ejs.render(template, dadosMock);
  });
  assert.ok(html.includes('Relatórios Fiscais'));
});
