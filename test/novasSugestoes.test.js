import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { xmlToObj } from '../src/services/sefaz/parseDocumento.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('PWA: manifest.json e sw.js existem e sao validos', () => {
  const manifestPath = path.join(__dirname, '..', 'src', 'public', 'manifest.json');
  assert.ok(fs.existsSync(manifestPath), 'manifest.json deve existir');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.name, 'Captura Total');
  assert.equal(manifest.short_name, 'Captura Total');
  assert.ok(manifest.icons.length >= 2, 'manifest deve ter ao menos 2 icones');

  const swPath = path.join(__dirname, '..', 'src', 'public', 'sw.js');
  assert.ok(fs.existsSync(swPath), 'sw.js deve existir');
  const sw = fs.readFileSync(swPath, 'utf8');
  assert.ok(sw.includes('CACHE_NAME'), 'sw.js deve definir CACHE_NAME');
  assert.ok(sw.includes('addEventListener(\'fetch\''), 'sw.js deve tratar fetch');
});

test('Cupom Fiscal / Catálogo: extrai itens do XML para cadastro automático de produtos', () => {
  const xmlExemplo = `<?xml version="1.0" encoding="UTF-8"?>
  <nfeProc xmlns="http://www.portalfiscal.inf.br/nfe">
    <NFe>
      <infNFe>
        <det nItem="1">
          <prod>
            <cProd>PROD-001</cProd>
            <cEAN>7891234567890</cEAN>
            <xProd>REFRIGERANTE COLA 2L</xProd>
            <NCM>22021000</NCM>
            <CEST>0301000</CEST>
            <CFOP>5405</CFOP>
            <uCom>UN</uCom>
            <qCom>10.0000</qCom>
            <vUnCom>8.5000</vUnCom>
            <vProd>85.00</vProd>
          </prod>
          <imposto>
            <ICMS>
              <ICMSSN500>
                <orig>0</orig>
                <CSOSN>500</CSOSN>
              </ICMSSN500>
            </ICMS>
          </imposto>
        </det>
        <det nItem="2">
          <prod>
            <cProd>PROD-002</cProd>
            <cEAN>SEM GTIN</cEAN>
            <xProd>BISCOITO SALGADO 200G</xProd>
            <NCM>19053100</NCM>
            <CFOP>5102</CFOP>
            <uCom>PCT</uCom>
            <qCom>5.0000</qCom>
            <vUnCom>4.2000</vUnCom>
            <vProd>21.00</vProd>
          </prod>
          <imposto>
            <ICMS>
              <ICMSSN102>
                <orig>0</orig>
                <CSOSN>102</CSOSN>
              </ICMSSN102>
            </ICMS>
          </imposto>
        </det>
      </infNFe>
    </NFe>
  </nfeProc>`;

  const obj = xmlToObj(xmlExemplo);
  const nfe = obj?.nfeProc?.NFe || obj?.NFe;
  assert.ok(nfe, 'deve ler a NFe do XML');
  const dets = Array.isArray(nfe.infNFe.det) ? nfe.infNFe.det : [nfe.infNFe.det];
  assert.equal(dets.length, 2, 'deve encontrar 2 itens no XML');

  // Item 1 (ST)
  const item1 = dets[0].prod;
  assert.equal(item1.cProd, 'PROD-001');
  assert.equal(item1.xProd, 'REFRIGERANTE COLA 2L');
  assert.equal(item1.cEAN, '7891234567890');
  assert.equal(item1.NCM, '22021000');
  assert.equal(Number(item1.vUnCom), 8.5);

  // Item 2 (Standard)
  const item2 = dets[1].prod;
  assert.equal(item2.cProd, 'PROD-002');
  assert.equal(item2.xProd, 'BISCOITO SALGADO 200G');
  assert.equal(item2.uCom, 'PCT');
});

test('Alerta de Certificado: calculo de dias restantes e identificacao de vencimento', () => {
  const agora = Date.now();
  const diaMs = 24 * 60 * 60 * 1000;

  const certVencido = {
    apelido: 'Certificado Vencido',
    validoAte: new Date(agora - 5 * diaMs),
  };
  const certVencendo15d = {
    apelido: 'Certificado 15 Dias',
    validoAte: new Date(agora + 15 * diaMs),
  };
  const certValidoLonge = {
    apelido: 'Certificado OK',
    validoAte: new Date(agora + 120 * diaMs),
  };

  const calcDias = (c) => Math.ceil((new Date(c.validoAte).getTime() - agora) / diaMs);
  const isVencido = (c) => new Date(c.validoAte).getTime() < agora;

  assert.equal(isVencido(certVencido), true);
  assert.ok(calcDias(certVencido) < 0);

  assert.equal(isVencido(certVencendo15d), false);
  assert.equal(calcDias(certVencendo15d), 15);
  assert.ok(calcDias(certVencendo15d) <= 30, 'deve alertar certificados <= 30 dias');

  assert.equal(isVencido(certValidoLonge), false);
  assert.ok(calcDias(certValidoLonge) > 30, 'nao deve alertar certificados > 30 dias');
});
