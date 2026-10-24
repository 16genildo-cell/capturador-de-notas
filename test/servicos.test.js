import { test } from 'node:test';
import assert from 'node:assert/strict';
import { preencherModelo, servicoDoFormulario, dadosDaEmissao, validarServico } from '../src/services/nfse/servicos.js';
import { validarDados, montarDps } from '../src/services/nfse/emissao.js';

const empresa = { cnpj: '11222333000181', municipioCodigo: '2927408', emissaoNfse: { opSimpNac: '1', serie: '1' } };

test('modelo de descricao troca {mes}, {ano} e {competencia}', () => {
  assert.equal(preencherModelo('Honorarios {mes}/{ano} ({competencia})', '2026-03-01'), 'Honorarios marco/2026 (03/2026)');
});

test('formulario vira servico (valor vazio = informar na hora)', () => {
  const s = servicoDoFormulario({ nome: ' Mensalidade ', cTribNac: '01.07.01', descricao: 'Suporte {mes}', valor: '', aliquota: '2,5', tomadorTipo: 'perguntar' });
  assert.equal(s.nome, 'Mensalidade');
  assert.equal(s.cTribNac, '010701');
  assert.equal(s.valor, null);
  assert.equal(s.aliquota, 2.5);
  assert.equal(s.tomador.tipo, 'perguntar');
  assert.equal(servicoDoFormulario({ valor: '1.234,50' }).valor, 1234.5);
  assert.ok(Number.isNaN(servicoDoFormulario({ valor: 'abc' }).valor));
});

test('emissao com um clique: tomador fixo e valor fixo', () => {
  const s = servicoDoFormulario({
    nome: 'Contabilidade', cTribNac: '171901', descricao: 'Honorarios contabeis de {mes}/{ano}', valor: '850,00',
    tomadorTipo: 'cnpj', tomadorDocumento: '11.444.777/0001-61', tomadorNome: 'Cliente Ltda',
  });
  const dados = dadosDaEmissao(s, { competencia: '2026-09-01' });
  assert.equal(dados.descricao, 'Honorarios contabeis de setembro/2026');
  assert.equal(dados.valor, 850);
  const d = validarDados(dados, empresa.emissaoNfse, empresa);
  const { xml } = montarDps({ empresa, cfg: empresa.emissaoNfse, d, nDPS: 1, ambiente: 'homologacao' });
  assert.ok(xml.includes('<CNPJ>11444777000161</CNPJ>'));
  assert.ok(xml.includes('<vServ>850.00</vServ>'));
});

test('tomador e valor informados na hora', () => {
  const s = servicoDoFormulario({ nome: 'Consulta', cTribNac: '040101', descricao: 'Consulta', tomadorTipo: 'perguntar' });
  const dados = dadosDaEmissao(s, { tomadorDocumento: '529.982.247-25', tomadorNome: 'Maria', valor: '200,00' });
  assert.equal(dados.tomador.tipo, 'cpf');
  const d = validarDados(dados, empresa.emissaoNfse, empresa);
  assert.equal(d.valor, 200);
});

test('cadastro incompleto e recusado com mensagens', () => {
  assert.throws(() => validarServico(servicoDoFormulario({ nome: '', cTribNac: '010701', descricao: 'x' }), empresa), /nome/);
  assert.throws(() => validarServico(servicoDoFormulario({ nome: 'X', cTribNac: '1', descricao: '' }), empresa), (e) => e.lista.length >= 1);
  assert.throws(() => validarServico(servicoDoFormulario({ nome: 'X', cTribNac: '010701', descricao: 'x', valor: '-5' }), empresa), /Valor/);
  validarServico(servicoDoFormulario({ nome: 'X', cTribNac: '010701', descricao: 'x' }), empresa);
});
