import test from 'node:test';
import assert from 'node:assert/strict';
import { analisarNota } from '../src/services/auditoriaFiscal.js';
import { gerarLayoutDominio, gerarLayoutQuestor, gerarLayoutAlterdata } from '../src/services/exportacaoContabil.js';
import { calcularDre } from '../src/services/dreService.js';
import { validarVenda, montarNFe } from '../src/services/nfe/xml.js';

test('Auditoria Fiscal: detecta irregularidades e inconsistências em notas', () => {
  // Nota cancelada mas ativa
  const notaCancelada = {
    tipoDocumento: 'nfe',
    emitenteCnpj: '12345678000199',
    chave: '35240112345678000199550010000000011000000011',
    numero: 1,
    serie: 1,
    statusSefaz: 'cancelada',
    dataEmissao: new Date(),
    totais: { valorTotal: 1500, valorProdutos: 1500, icms: 0 },
    itens: [
      {
        codigo: 'P1',
        descricao: 'Produto 1',
        ncm: '22021000',
        cfop: '5102',
        csosn: '500', // Inconsistência: CFOP 5102 com CSOSN 500 (ST)
        quantidade: 10,
        valorTotal: 1500,
      },
    ],
  };

  const alertas = analisarNota(notaCancelada, '12345678000199');
  assert.ok(alertas.length >= 2, 'deve apontar pelo menos 2 alertas (cancelada e divergência ST)');
  
  const alertaCancelada = alertas.find((a) => a.tipo === 'cancelada');
  assert.ok(alertaCancelada, 'deve conter alerta de nota cancelada');
  assert.equal(alertaCancelada.nivel, 'alto');

  const alertaSt = alertas.find((a) => a.tipo === 'st_inconsistente');
  assert.ok(alertaSt, 'deve apontar CSOSN 500 com CFOP 5102');
});

test('Auditoria Fiscal: alerta prazo de manifestação do destinatário', () => {
  const dataAntiga = new Date();
  dataAntiga.setDate(dataAntiga.getDate() - 160); // Mais de 150 dias atrás

  const notaSemManifestacao = {
    tipoDocumento: 'nfe',
    emitenteCnpj: '99999999000199', // Emitido por terceiros
    destinatarioCnpj: '12345678000199',
    chave: '35240199999999000199550010000000021000000022',
    numero: 2,
    serie: 1,
    statusSefaz: 'autorizada',
    manifestacao: null,
    dataEmissao: dataAntiga,
    totais: { valorTotal: 300 },
    itens: [],
  };

  const alertas = analisarNota(notaSemManifestacao, '12345678000199');
  const alertaPrazo = alertas.find((a) => a.tipo === 'prazo_manifestacao');
  assert.ok(alertaPrazo, 'deve alertar vencimento do prazo de 180 dias da manifestação');
});

test('Integração com Softwares Contábeis: gera layouts Domínio, Questor e Alterdata', () => {
  const notas = [
    {
      tipoDocumento: 'nfe',
      numero: 105,
      serie: 1,
      chave: '35240112345678000199550010000001051000000105',
      dataEmissao: new Date('2026-05-10T12:00:00Z'),
      emitenteCnpj: '12345678000199',
      destinatarioCnpj: '98765432000188',
      totais: { valorTotal: 2500.5, icms: 450.09, pis: 41.25, cofins: 190.03 },
      itens: [{ cfop: '5102' }],
    },
  ];

  // Domínio Sistemas
  const dominioTxt = gerarLayoutDominio(notas, '12345678000199');
  assert.ok(dominioTxt.includes('|0000|'), 'deve conter header 0000');
  assert.ok(dominioTxt.includes('|C100|1|0|'), 'deve conter registro C100 de saída própria');
  assert.ok(dominioTxt.includes('2500,50'), 'deve formatar valor com vírgula');

  // Questor Sistemas
  const questorTxt = gerarLayoutQuestor(notas, '12345678000199');
  assert.ok(questorTxt.includes('QUESTOR_FISCAL_V1'), 'deve conter cabeçalho Questor');
  assert.ok(questorTxt.includes(';1;105;'), 'deve conter série e número da nota');

  // Alterdata Pack
  const alterdataTxt = gerarLayoutAlterdata(notas, '12345678000199');
  assert.ok(alterdataTxt.includes('[ALTERDATA_PACK_NOTAS]'), 'deve conter cabeçalho Alterdata');
  assert.ok(alterdataTxt.includes('NFE;105;1;'), 'deve conter registro da nota');
});

test('DRE Gerencial: calcula receita bruta, impostos, CMV e margem corretamente', async () => {
  const notasEmitidas = [
    {
      totais: { valorTotal: 10000, icms: 1200, pis: 165, cofins: 760 },
      itens: [{ quantidade: 10, valorTotal: 10000 }],
    },
    {
      totais: { valorTotal: 5000, icms: 600, pis: 82.5, cofins: 380 },
      itens: [{ quantidade: 5, valorTotal: 5000 }],
    },
  ];

  const notasEntrada = [
    {
      totais: { valorTotal: 6000, icms: 720 },
      itens: [{ quantidade: 15, valorTotal: 6000 }],
    },
  ];

  const vendasEmissao = [
    {
      valorTotal: 2000,
      itens: [{ quantidade: 2, valorUnitario: 1000, valorTotal: 2000 }],
    },
  ];

  const dre = await calcularDre({ notasEmitidas, notasEntrada, vendasEmissao });

  // Receita bruta = 10000 + 5000 + 2000 = 17000
  assert.equal(dre.receitaBruta, 17000);

  // Impostos faturados = (1200 + 165 + 760) + (600 + 82.5 + 380) = 3187.50
  assert.equal(dre.impostos, 3187.5);

  // Receita líquida = 17000 - 3187.5 = 13812.5
  assert.equal(dre.receitaLiquida, 13812.5);

  // CMV = 6000
  assert.equal(dre.custoMercadorias, 6000);

  // Lucro bruto = 13812.5 - 6000 = 7812.5
  assert.equal(dre.lucroBruto, 7812.5);

  // Margem bruta = (7812.5 / 13812.5) * 100 ≈ 56.56%
  assert.ok(dre.margemBruta > 55 && dre.margemBruta < 58);

  // Lucro líquido operacional
  assert.equal(dre.lucroLiquido, dre.lucroBruto);
});

test('NFC-e em Contingência Offline: gera tpEmis = 9, dhCont e xJust no XML', () => {
  const empresa = {
    cnpj: '11222333000181',
    razaoSocial: 'EMPRESA TESTE LTDA',
    uf: 'MG',
    municipioCodigo: '3106200',
    municipioNome: 'Belo Horizonte',
    inscricaoEstadual: '0621234560099',
    endereco: { logradouro: 'Rua Principal', numero: '10', bairro: 'Centro', cep: '30160-000' },
  };
  const cfg = { crt: '1', cstPisCofins: '49' };
  const produto = { codigo: 'P1', descricao: 'Refrigerante', ncm: '22021000', cfop: '5405', unidade: 'UN', preco: 10, csosn: '500', origem: '0' };

  const venda = validarVenda(
    {
      modelo: '65',
      contingencia: true,
      itens: [{ produto, quantidade: 2 }],
      pagamento: { tPag: '01', valorRecebido: 20 },
    },
    cfg,
    empresa,
  );

  const res = montarNFe({
    empresa,
    cfg,
    venda,
    numero: 1,
    serie: 1,
    ambiente: 'homologacao',
    dhEmi: '2026-10-25T15:30:00-03:00',
    cNF: '12345678',
  });

  assert.ok(res.xml.includes('<tpEmis>9</tpEmis>'), 'deve conter tpEmis = 9');
  assert.ok(res.xml.includes('<dhCont>'), 'deve conter tag dhCont');
  assert.ok(res.xml.includes('<xJust>'), 'deve conter tag xJust');
  assert.equal(res.chave.charAt(34), '9', 'digito tpEmis na chave deve ser 9');
});
