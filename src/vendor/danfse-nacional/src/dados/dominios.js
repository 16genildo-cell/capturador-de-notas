/**
 * Descrições dos códigos do leiaute, copiadas da documentação dos esquemas oficiais
 * (tiposSimples_v1.01.xsd, pacote "esquemas-nfse-rtc-v1-01-20260727").
 * O DANFSe manda imprimir a DESCRIÇÃO da opção, não o número (NT 008, item 2.4.5).
 */
module.exports = {
  tpAmb: { 1: 'Produção', 2: 'Homologação' },
  ambGer: { 1: 'Prefeitura', 2: 'Sistema Nacional da NFS-e' },
  tpEmit: { 1: 'Prestador', 2: 'Tomador', 3: 'Intermediário' },
  cStat: { 100: 'NFS-e Gerada', 102: 'NFS-e de Decisão Judicial', 103: 'NFS-e Avulsa', 107: 'NFS-e MEI' },
  finNFSe: { 0: 'NFS-e regular' },
  opSimpNac: {
    1: 'Não Optante',
    2: 'Optante - Microempreendedor Individual (MEI)',
    3: 'Optante - Microempresa ou Empresa de Pequeno Porte (ME/EPP)',
  },
  regApTribSN: {
    1: 'Regime de apuração dos tributos federais e municipal pelo Simples Nacional',
    2: 'Regime de apuração dos tributos federais pelo Simples Nacional e ISSQN por fora do Simples Nacional conforme respectiva legislação municipal do tributo',
    3: 'Regime de apuração dos tributos federais e municipal por fora do Simples Nacional conforme respectivas legislações federal e municipal de cada tributo',
  },
  regEspTrib: {
    0: 'Nenhum', 1: 'Ato Cooperado (Cooperativa)', 2: 'Estimativa', 3: 'Microempresa Municipal',
    4: 'Notário ou Registrador', 5: 'Profissional Autônomo', 6: 'Sociedade de Profissionais', 9: 'Outros',
  },
  tribISSQN: { 1: 'Operação Tributável', 2: 'Imunidade', 3: 'Exportação de Serviço', 4: 'Não Incidência' },
  tpImunidade: {
    0: 'Imunidade (tipo não informado na nota de origem)',
    1: 'Patrimônio, renda ou serviços, uns dos outros (CF88, Art 150, VI, a)',
    2: 'Templos de qualquer culto (CF88, Art 150, VI, b)',
    3: 'Patrimônio, renda ou serviços dos partidos políticos, inclusive suas fundações, das entidades sindicais dos trabalhadores, das instituições de educação e de assistência social, sem fins lucrativos (CF88, Art 150, VI, c)',
    4: 'Livros, jornais, periódicos e o papel destinado a sua impressão (CF88, Art 150, VI, d)',
    5: 'Fonogramas e videofonogramas musicais produzidos no Brasil (CF88, Art 150, VI, e)',
  },
  tpSusp: {
    1: 'Exigibilidade Suspensa por Decisão Judicial',
    2: 'Exigibilidade Suspensa por Processo Administrativo',
  },
  tpBM: { 1: 'Isenção', 2: 'Redução da BC em %', 3: 'Redução da BC em R$', 4: 'Alíquota Diferenciada' },
  tpRetISSQN: { 1: 'Não Retido', 2: 'Retido pelo Tomador', 3: 'Retido pelo Intermediário' },
  tpRetPisCofins: {
    0: 'PIS/COFINS/CSLL Não Retidos',
    1: 'PIS/COFINS Retidos',
    2: 'PIS/COFINS Não Retidos',
    3: 'PIS/COFINS/CSLL Retidos',
    4: 'PIS/COFINS Retidos, CSLL Não Retido',
    5: 'PIS Retido, COFINS/CSLL Não Retido',
    6: 'COFINS Retido, PIS/CSLL Não Retido',
    7: 'PIS Não Retido, COFINS/CSLL Retidos',
    8: 'PIS/COFINS Não Retidos, CSLL Retido',
    9: 'COFINS Não Retido, PIS/CSLL Retidos',
  },
};
