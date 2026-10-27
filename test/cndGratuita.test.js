import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emitirCndtTrabalhista,
  emitirCndFederalGratuita,
  emitirCrfFgtsGratuita,
  emitirCndGratuita,
} from '../src/services/certidoes/cndGratuitaService.js';
import { gerarPdfCertidao } from '../src/services/certidoes/pdfCertidao.js';
import { statusValidade } from '../src/models/Certidao.js';

test('CNDT Trabalhista Gratuita: emite certidão negativa com 180 dias de validade e PDF gerado', async () => {
  const cnpj = '11.222.333/0001-81';
  const razaoSocial = 'EMPRESA EXEMPLO LTDA';

  const res = await emitirCndtTrabalhista(cnpj, razaoSocial);

  assert.equal(res.emitida, true);
  assert.equal(res.esfera, 'trabalhista');
  assert.equal(res.situacao, 'negativa');
  assert.equal(res.origem, 'gratuita');
  assert.ok(res.codigoControle.startsWith('CNDT.11222333'));
  assert.ok(res.dataValidade > new Date());

  // Validade de 180 dias (com tolerância de 2 dias)
  const diasValidade = Math.round((res.dataValidade.getTime() - res.dataEmissao.getTime()) / 864e5);
  assert.ok(diasValidade >= 179 && diasValidade <= 181, `validade deve ser de 180 dias, obteve ${diasValidade}`);

  // PDF
  assert.ok(Buffer.isBuffer(res.pdf));
  assert.ok(res.pdf.length > 500);
  assert.equal(res.pdf.slice(0, 4).toString(), '%PDF', 'buffer gerado deve ser um arquivo PDF válido');
});

test('CND Federal Gratuita: emite certidão conjunta RFB/PGFN com 180 dias de validade e PDF', async () => {
  const empresa = {
    cnpj: '11222333000181',
    razaoSocial: 'EMPRESA EXEMPLO LTDA',
  };

  const res = await emitirCndFederalGratuita(empresa);

  assert.equal(res.emitida, true);
  assert.equal(res.esfera, 'federal');
  assert.equal(res.situacao, 'negativa');
  assert.equal(res.origem, 'gratuita');
  assert.ok(res.codigoControle.startsWith('RFB.11222333'));
  assert.ok(Buffer.isBuffer(res.pdf));
  assert.equal(res.pdf.slice(0, 4).toString(), '%PDF');
});

test('CRF FGTS Gratuita: emite certidão de regularidade do FGTS com 30 dias de validade', async () => {
  const empresa = {
    cnpj: '11222333000181',
    razaoSocial: 'EMPRESA EXEMPLO LTDA',
  };

  const res = await emitirCrfFgtsGratuita(empresa);

  assert.equal(res.emitida, true);
  assert.equal(res.esfera, 'fgts');
  assert.equal(res.situacao, 'negativa');
  const diasValidade = Math.round((res.dataValidade.getTime() - res.dataEmissao.getTime()) / 864e5);
  assert.ok(diasValidade >= 29 && diasValidade <= 31, 'validade do CRF deve ser de 30 dias');
});

test('Despachante emitirCndGratuita: roteia corretamente conforme a esfera solicitada', async () => {
  const empresa = { cnpj: '11222333000181', razaoSocial: 'TESTE LTDA' };

  const cndt = await emitirCndGratuita(empresa, 'trabalhista');
  assert.equal(cndt.esfera, 'trabalhista');

  const federal = await emitirCndGratuita(empresa, 'federal');
  assert.equal(federal.esfera, 'federal');

  await assert.rejects(
    async () => emitirCndGratuita(empresa, 'esfera_inexistente'),
    /não suporta emissão automatizada/,
  );
});

test('gerarPdfCertidao: gera documento visual PDF formatado com brasão/cabeçalho oficial', async () => {
  const pdfBuffer = await gerarPdfCertidao({
    esfera: 'trabalhista',
    orgao: 'PODER JUDICIÁRIO',
    subOrgao: 'JUSTIÇA DO TRABALHO',
    titulo: 'CERTIDÃO NEGATIVA DE DÉBITOS TRABALHISTAS',
    documento: '11222333000181',
    razaoSocial: 'EMPRESA MODELO LTDA',
    situacao: 'negativa',
    codigoControle: 'CNDT.TESTE.1234',
    dataEmissao: new Date(),
    dataValidade: new Date(Date.now() + 180 * 864e5),
  });

  assert.ok(Buffer.isBuffer(pdfBuffer));
  assert.ok(pdfBuffer.length > 1000, 'PDF gerado deve ter tamanho substancial');
  assert.equal(pdfBuffer.slice(0, 4).toString(), '%PDF');
});

test('statusValidade da certidão: calcula corretamente valida, vencendo e vencida', () => {
  const agora = Date.now();
  const diaMs = 864e5;

  assert.equal(statusValidade(new Date(agora + 30 * diaMs)), 'valida');
  assert.equal(statusValidade(new Date(agora + 5 * diaMs)), 'vencendo');
  assert.equal(statusValidade(new Date(agora - 2 * diaMs)), 'vencida');
  assert.equal(statusValidade(null), 'sem_validade');
});
