import { test } from 'node:test';
import assert from 'node:assert/strict';
import AdmZip from 'adm-zip';
import { fixture } from './helpers.js';
import { identificarXml, escolherEmpresas, extrairXmls } from '../src/services/importacao.js';

const empresas = [{ razaoSocial: 'PESSOA', cnpj: '52998224725' }, { razaoSocial: 'MATRIZ', cnpj: '11222333000181' }];

test('identifica NF-e, NFS-e e CT-e', () => {
  assert.equal(identificarXml(fixture('nfe.xml')).tipo, 'nfe');
  assert.equal(identificarXml(fixture('nfse.xml')).tipo, 'nfse');
  assert.equal(identificarXml(fixture('cte.xml')).tipo, 'cte');
  assert.equal(identificarXml('<outro/>').tipo, null);
});

test('documento entre duas empresas cadastradas vai para as duas; filial cai na matriz', () => {
  assert.deepEqual(escolherEmpresas(empresas, identificarXml(fixture('nfe.xml')).docs).map((e) => e.razaoSocial).sort(), ['MATRIZ', 'PESSOA']);
  assert.deepEqual(escolherEmpresas(empresas, ['11222333000262']).map((e) => e.razaoSocial), ['MATRIZ']);
  assert.equal(escolherEmpresas(empresas, ['99999999000199']).length, 0);
});

test('extrai XMLs de ZIP (inclusive ZIP dentro de ZIP)', () => {
  const interno = new AdmZip();
  interno.addFile('c.xml', Buffer.from(fixture('cte.xml')));
  const zip = new AdmZip();
  zip.addFile('a/nfe.xml', Buffer.from(fixture('nfe.xml')));
  zip.addFile('leia.txt', Buffer.from('x'));
  zip.addFile('sub.zip', interno.toBuffer());
  const xs = extrairXmls([{ originalname: 'lote.zip', buffer: zip.toBuffer() }, { originalname: 'ruim.zip', buffer: Buffer.from('PKxx') }]);
  assert.equal(xs.filter((x) => x.xml).length, 2);
  assert.equal(xs.filter((x) => x.erro).length, 1);
});
