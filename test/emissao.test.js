import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SignedXml } from 'xml-crypto';
import { gerarPfx } from './helpers.js';
import { lerPfx } from '../src/services/crypto/certificado.js';
import { validarDados, montarDps, assinar, idDps, montarCancelamento, mensagensSefin, dataHoraBrasilia } from '../src/services/nfse/emissao.js';

const empresa = { cnpj: '11222333000181', municipioCodigo: '2927408' };
const cert = lerPfx(gerarPfx('EMPRESA LTDA:11222333000181'), 's');

test('Id da DPS tem 45 caracteres no formato oficial', () => {
  assert.equal(idDps('2927408', '11222333000181', '1', 42), 'DPS292740821122233300018100001000000000000042');
  assert.equal(idDps('2927408', '52998224725', '70000', 1).slice(10, 25), '100052998224725');
});

test('DPS de nao optante com tomador CPF: campos e assinatura', () => {
  const cfg = { opSimpNac: '1', serie: '1' };
  const d = validarDados({ tomador: { tipo: 'cpf', documento: '529.982.247-25', nome: 'Cliente & Filhos' }, cTribNac: '01.07.01', descricao: 'Suporte', valor: '1.234,50', issRetido: 'on' }, cfg, empresa);
  const { id, xml } = montarDps({ empresa, cfg, d, nDPS: 7, ambiente: 'homologacao' });
  assert.ok(xml.includes('<tpAmb>2</tpAmb>'));
  assert.ok(xml.includes('<vServ>1234.50</vServ>'));
  assert.ok(xml.includes('<tpRetISSQN>2</tpRetISSQN>'));
  assert.ok(xml.includes('<indTotTrib>0</indTotTrib>'));
  assert.ok(xml.includes('Cliente &amp; Filhos'));
  assert.ok(!xml.includes('<xNome>EMPRESA'), 'prestador nao envia nome (E0121)');
  const assinado = assinar(xml, id, 'infDPS', cert);
  const v = new SignedXml({ publicCert: cert.certTitularPem });
  v.loadSignature(assinado.match(/<Signature[\s\S]*<\/Signature>/)[0]);
  assert.equal(v.checkSignature(assinado), true);
  assert.ok(assinado.includes('rsa-sha256'));
});

test('ME/EPP usa regApTribSN e pTotTribSN; aliquota so para ME/EPP', () => {
  const cfg = { opSimpNac: '3', regApTribSN: '1', pTotTribSN: 6, serie: '1' };
  const d = validarDados({ tomador: { tipo: 'nenhum' }, cTribNac: '010701', descricao: 'X', valor: '100', aliquota: '2,5' }, cfg, empresa);
  const { xml } = montarDps({ empresa, cfg, d, nDPS: 1, ambiente: 'producao' });
  assert.ok(xml.includes('<regApTribSN>1</regApTribSN>'));
  assert.ok(xml.includes('<pTotTribSN>6.00</pTotTribSN>'));
  assert.ok(xml.includes('<pAliq>2.50</pAliq>'));
  assert.ok(!xml.includes('<toma>'));
  const d2 = validarDados({ tomador: { tipo: 'nenhum' }, cTribNac: '010701', descricao: 'X', valor: '100', aliquota: '2,5' }, { opSimpNac: '1' }, empresa);
  assert.equal(d2.aliquota, null);
});

test('validacao aponta os erros em portugues', () => {
  assert.throws(
    () => validarDados({ tomador: { tipo: 'cnpj', documento: '123', nome: '' }, cTribNac: '1', valor: '0' }, { opSimpNac: '1' }, { municipioCodigo: '' }),
    (e) => e.lista.length >= 5 && e.lista.some((m) => m.includes('CNPJ do tomador')),
  );
});

test('cancelamento e mensagens da Sefin', () => {
  const { id, xml } = montarCancelamento({ empresa, chave: '2'.repeat(50), ambiente: 'producao', cMotivo: 1, xMotivo: 'Valor errado na nota emitida' });
  assert.equal(id.length, 59);
  assert.ok(xml.includes('<CNPJAutor>11222333000181</CNPJAutor>'));
  assert.ok(xml.includes('<xDesc>Cancelamento de NFS-e</xDesc>'));
  assert.deepEqual(mensagensSefin({ erros: [{ Codigo: 'E0014', Descricao: 'DPS ja existe' }] }), ['E0014 - DPS ja existe']);
  assert.match(dataHoraBrasilia(new Date('2026-10-14T12:00:00Z')), /^2026-10-14T09:00:00-03:00$/);
});
