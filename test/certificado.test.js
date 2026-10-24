import { test } from 'node:test';
import assert from 'node:assert/strict';
import forge from 'node-forge';
import { SignedXml } from 'xml-crypto';
import { gerarPfx } from './helpers.js';
import { lerPfx } from '../src/services/crypto/certificado.js';
import { encrypt } from '../src/services/crypto/vault.js';
import { obterCertificadoEmpresa } from '../src/services/sefaz/distribuicaoDFe.js';
import { montarEventoAssinado, EVENTOS, prazoManifestacao } from '../src/services/sefaz/manifestacao.js';

const pfxEmpresa = gerarPfx('EMPRESA LTDA:11222333000181', { comCa: true });
const pfxPessoa = gerarPfx('JOAO DA SILVA:52998224725');
const certDoc = (pfx) => ({ pfxCriptografado: encrypt(pfx), senhaCriptografada: encrypt('s') });

test('le o certificado do titular mesmo com a AC antes no .pfx', () => {
  const info = lerPfx(pfxEmpresa, 's');
  assert.equal(info.cnpjCpf, '11222333000181');
  assert.equal(forge.pki.certificateFromPem(info.certPem).subject.getField('CN').value, 'EMPRESA LTDA:11222333000181');
});

test('confere certificado x cadastro (CPF/CNPJ)', async () => {
  await obterCertificadoEmpresa({ cnpj: '52998224725', certificado: certDoc(pfxPessoa) });
  await obterCertificadoEmpresa({ cnpj: '11222333000262', certificado: certDoc(pfxEmpresa) }); // filial
  await assert.rejects(obterCertificadoEmpresa({ cnpj: '52998224725', certificado: certDoc(pfxEmpresa) }));
  await assert.rejects(obterCertificadoEmpresa({ cnpj: '39053344705', certificado: certDoc(pfxPessoa) }));
});

test('evento de manifestacao assinado e valido', () => {
  const info = lerPfx(pfxPessoa, 's');
  const chave = '3'.repeat(44);
  const xml = montarEventoAssinado({ cnpj: '52998224725', chave, evento: EVENTOS.naoRealizada, justificativa: 'Mercadoria <recusada> & devolvida', keyPem: info.keyPem, certPem: info.certTitularPem });
  assert.ok(xml.includes('<CPF>52998224725</CPF>'));
  assert.ok(xml.includes(`URI="#ID210240${chave}01"`));
  assert.ok(xml.includes('&lt;recusada&gt; &amp;'));
  const v = new SignedXml({ publicCert: info.certTitularPem });
  v.loadSignature(xml.match(/<Signature[\s\S]*<\/Signature>/)[0]);
  assert.equal(v.checkSignature(xml), true);
  assert.equal(prazoManifestacao(new Date('2026-10-01T12:00:00Z')).toISOString().slice(0, 10), '2027-03-30');
});
