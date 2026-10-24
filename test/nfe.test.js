import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { SignedXml } from 'xml-crypto';
import { gerarPfx } from './helpers.js';
import { lerPfx } from '../src/services/crypto/certificado.js';
import {
  digitoChave, montarChave, validarVenda, montarNFe, assinarNFe, montarQrCode, incluirQrCode, textoSefaz, cfopDaOperacao, webservices,
} from '../src/services/nfe/xml.js';
import { consultarProtocolo, montarEvento, _definirTransporte } from '../src/services/nfe/emissao.js';

const cert = lerPfx(gerarPfx('LOJA MG LTDA:11222333000181'), 's');
const empresa = {
  cnpj: '11222333000181', razaoSocial: 'LOJA MG LTDA', uf: 'MG', municipioCodigo: '3106200', municipioNome: 'Belo Horizonte',
  inscricaoEstadual: '0623079040081', endereco: { logradouro: 'Rua da Bahia', numero: '100', bairro: 'Centro', cep: '30160-011' },
};
const cfg = { crt: '1', cstPisCofins: '49', csc: { homologacao: { id: '000001', token: 'TOKEN123' } } };
const produto = { codigo: 'P1', descricao: 'Camiseta', ncm: '61091000', cfop: '5102', unidade: 'UN', preco: 50, csosn: '102', origem: '0' };
const dhEmi = '2026-10-15T10:00:00-03:00';

test('digito da chave (exemplo do manual) e chave com 44 digitos', () => {
  assert.equal(digitoChave('5206043300991100250655012000000780026730161'), 5);
  const ch = montarChave({ cUF: '31', aamm: '2610', documento: '11222333000181', modelo: '65', serie: '1', numero: 7, cNF: '12345678' });
  assert.equal(ch.length, 44);
  assert.equal(String(digitoChave(ch.slice(0, 43))), ch[43]);
});

test('texto aceito pela SEFAZ e CFOP interestadual', () => {
  assert.equal(textoSefaz('  Café “especial” – 500g\u{1F600} '), 'Café "especial" - 500g');
  assert.equal(cfopDaOperacao('5102', true), '6102');
  assert.equal(cfopDaOperacao('5405', true), '6404');
  assert.equal(cfopDaOperacao('5102', false), '5102');
});

test('enderecos oficiais de MG', () => {
  assert.match(webservices('MG', '55', 'producao').autorizacao, /^https:\/\/nfe\.fazenda\.mg\.gov\.br\//);
  assert.match(webservices('MG', '65', 'homologacao').autorizacao, /^https:\/\/hnfce\.fazenda\.mg\.gov\.br\//);
});

test('NFC-e em homologacao: textos obrigatorios, troco, assinatura e QR Code', () => {
  const v = validarVenda({ modelo: '65', itens: [{ produto, quantidade: '2', desconto: '1,00' }], pagamento: { tPag: '01', valorRecebido: '100' } }, cfg, empresa);
  assert.equal(v.totais.total, 99);
  const { xml, chave } = montarNFe({ empresa, cfg, venda: v, numero: 5, serie: '1', ambiente: 'homologacao', dhEmi });
  assert.ok(xml.includes('<mod>65</mod>') && xml.includes('<tpImp>4</tpImp>') && xml.includes('<indFinal>1</indFinal>'));
  assert.ok(xml.includes('<xProd>NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL</xProd>'));
  assert.ok(xml.includes('<ICMSSN102><orig>0</orig><CSOSN>102</CSOSN></ICMSSN102>'));
  assert.ok(xml.includes('<vPag>100.00</vPag>') && xml.includes('<vTroco>1.00</vTroco>'));
  assert.ok(xml.includes('OPTANTE PELO SIMPLES NACIONAL'));
  const assinado = assinarNFe(xml, cert);
  const qr = montarQrCode({ chave, ambiente: 'homologacao', uf: 'MG', versao: '2', csc: cfg.csc.homologacao });
  const seq = `${chave}|2|2|1`;
  assert.equal(qr.qrCode.split('?p=')[1], `${seq}|${crypto.createHash('sha1').update(`${seq}TOKEN123`).digest('hex').toUpperCase()}`);
  const v3 = montarQrCode({ chave, ambiente: 'homologacao', uf: 'MG', versao: '3' });
  assert.ok(v3.qrCode.endsWith(`?p=${chave}|3|2`));
  const final = incluirQrCode(assinado, qr);
  assert.ok(/<\/infNFe><infNFeSupl><qrCode>.+<\/qrCode><urlChave>.+<\/urlChave><\/infNFeSupl><Signature/.test(final));
  const s = new SignedXml({ publicCert: cert.certPem });
  s.loadSignature(final.match(/<Signature[\s\S]*<\/Signature>/)[0]);
  assert.equal(s.checkSignature(final), true);
  assert.ok(final.includes('rsa-sha1'));
});

test('NF-e para CNPJ de outro estado: destinatario, CFOP 6xxx e credito do Simples', () => {
  const v = validarVenda({
    modelo: '55',
    dest: { documento: '11.444.777/0001-61', nome: 'Cliente', indIEDest: '1', ie: '123456', cep: '01310100', logradouro: 'Av Paulista', numero: '1', bairro: 'Bela Vista', cMun: '3550308', cidade: 'Sao Paulo', uf: 'SP' },
    itens: [{ produto: { ...produto, csosn: '101' }, quantidade: 1 }],
    pagamento: { tPag: '15' },
  }, { ...cfg, pCredSN: 2 }, empresa);
  assert.equal(v.consumidorFinal, false);
  const { xml } = montarNFe({ empresa, cfg: { ...cfg, pCredSN: 2 }, venda: v, numero: 1, serie: '1', ambiente: 'producao', dhEmi });
  assert.ok(xml.includes('<idDest>2</idDest>') && xml.includes('<CFOP>6102</CFOP>'));
  assert.ok(xml.includes('<xNome>Cliente</xNome>') && xml.includes('<IE>123456</IE>') && xml.includes('<indIEDest>1</indIEDest>'));
  assert.ok(xml.includes('<pCredSN>2.0000</pCredSN><vCredICMSSN>1.00</vCredICMSSN>'));
  assert.ok(xml.includes('<tpAmb>1</tpAmb>') && xml.includes('<indPag>1</indPag><tPag>15</tPag>'));
});

test('venda incompleta e recusada com mensagens', () => {
  assert.throws(() => validarVenda({ modelo: '55', itens: [] }, cfg, { ...empresa, inscricaoEstadual: '' }), (e) => e.lista.length >= 3 && e.lista.some((m) => m.includes('Inscricao Estadual')));
  assert.throws(() => validarVenda({ modelo: '65', itens: [{ produto: { ...produto, ncm: '123' }, quantidade: 0 }] }, cfg, empresa), (e) => e.lista.some((m) => m.includes('NCM')) && e.lista.some((m) => m.includes('quantidade')));
  assert.throws(() => validarVenda({ modelo: '65', itens: [{ produto, quantidade: 1 }], pagamento: { tPag: '90' } }, cfg, empresa), /forma de pagamento/);
  assert.throws(() => montarQrCode({ chave: '1'.repeat(44), ambiente: 'homologacao', uf: 'MG', versao: '2', csc: {} }), /CSC/);
});

test('evento de cancelamento assinado e consulta de protocolo pela SEFAZ (servidor falso)', async () => {
  const ev = montarEvento({ cOrgao: '31', ambiente: 'homologacao', cnpj: empresa.cnpj, chave: '3'.repeat(44), tpEvento: '110111', nSeq: 1, dhEvento: dhEmi, certificado: cert, detEvento: '<descEvento>Cancelamento</descEvento><nProt>1</nProt><xJust>Venda cancelada pelo cliente</xJust>' });
  assert.equal(ev.id, `ID110111${'3'.repeat(44)}01`);
  const chamadas = [];
  _definirTransporte(async (req) => {
    chamadas.push(req);
    return '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><nfeResultMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeConsultaProtocolo4">' +
      '<retConsSitNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><tpAmb>2</tpAmb><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo>' +
      `<protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><chNFe>${'3'.repeat(44)}</chNFe><dhRecbto>2026-10-15T10:00:05-03:00</dhRecbto><nProt>131260000000001</nProt><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe>` +
      '</retConsSitNFe></nfeResultMsg></soap:Body></soap:Envelope>';
  });
  try {
    const r = await consultarProtocolo({ uf: 'MG', modelo: '65', ambiente: 'homologacao', chave: '3'.repeat(44), certificado: cert });
    assert.equal(r.prot.cStat, '100');
    assert.equal(r.prot.protocolo, '131260000000001');
    assert.ok(r.protXml.startsWith('<protNFe xmlns="http://www.portalfiscal.inf.br/nfe"'));
    assert.match(chamadas[0].url, /hnfce\.fazenda\.mg\.gov\.br\/nfce\/services\/NFeConsultaProtocolo4/);
    assert.match(chamadas[0].soapAction, /NFeConsultaProtocolo4\/nfeConsultaNF$/);
  } finally {
    _definirTransporte(null);
  }
});
