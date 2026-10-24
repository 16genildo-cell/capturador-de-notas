/**
 * Endpoints dos web services da SEFAZ usados pela captura.
 *
 * A Distribuicao de DF-e (NFeDistribuicaoDFe) e o servico NACIONAL que entrega
 * todos os documentos (NF-e, eventos, resumos) de interesse de um CNPJ. E o
 * principal mecanismo de captura de notas de ENTRADA (onde a empresa e
 * destinataria).
 *
 * A Manifestacao do Destinatario (RecepcaoEvento do Ambiente Nacional) permite
 * dar ciencia/confirmar as notas destinadas, o que libera o XML completo de
 * notas que vieram apenas como resumo.
 */
export const ENDPOINTS = {
  producao: {
    distribuicaoDFe: 'https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx',
    recepcaoEvento: 'https://www.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx',
  },
  homologacao: {
    distribuicaoDFe: 'https://hom1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx',
    recepcaoEvento: 'https://hom1.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx',
  },
};

export const SOAP_ACTION = {
  distribuicaoDFe: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe/nfeDistDFeInteresse',
  recepcaoEvento: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4/nfeRecepcaoEvento',
};

/** Codigo do orgao Ambiente Nacional (usado nos eventos de manifestacao). */
export const C_ORGAO_AN = '91';

/** Codigo IBGE de cada UF (usado em cUFAutor). */
export const CODIGO_UF = {
  RO: '11', AC: '12', AM: '13', RR: '14', PA: '15', AP: '16', TO: '17',
  MA: '21', PI: '22', CE: '23', RN: '24', PB: '25', PE: '26', AL: '27', SE: '28', BA: '29',
  MG: '31', ES: '32', RJ: '33', SP: '35',
  PR: '41', SC: '42', RS: '43',
  MS: '50', MT: '51', GO: '52', DF: '53',
};

export function codigoUF(uf) {
  const cod = CODIGO_UF[String(uf || '').toUpperCase()];
  if (!cod) throw new Error(`UF invalida no cadastro da empresa: "${uf}".`);
  return cod;
}

export function getEndpoints(ambiente) {
  return ambiente === 'producao' ? ENDPOINTS.producao : ENDPOINTS.homologacao;
}
