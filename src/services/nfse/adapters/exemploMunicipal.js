import { BaseNfseAdapter } from '../baseAdapter.js';

/**
 * Adaptador de EXEMPLO para um portal municipal / provedor de NFS-e.
 *
 * Serve de modelo para criar adaptadores reais (ex.: GINFES, ISSNet, Betha, WebISS).
 * Cada provedor tem seu web service SOAP/REST proprio; a logica de consulta vai aqui.
 *
 * Este exemplo demonstra a FORMA de retorno esperada, usando dados ficticios apenas
 * quando o ambiente esta em homologacao, para permitir testar o fluxo do dashboard
 * ponta a ponta sem um municipio real. Em producao ele nao gera nada.
 */
export class ExemploMunicipalAdapter extends BaseNfseAdapter {
  constructor() {
    super();
    this.nome = 'exemplo';
  }

  // eslint-disable-next-line class-methods-use-this
  async capturar({ empresa }) {
    const ehHomolog = (process.env.SEFAZ_AMBIENTE || 'homologacao') !== 'producao';
    if (!ehHomolog) {
      return {
        notas: [],
        aviso: 'Adaptador de exemplo nao opera em producao. Implemente o provedor real.',
      };
    }

    // Exemplo didatico (apenas homologacao): uma NFS-e ficticia.
    const agora = new Date();
    const xml =
      `<NFSe><InfNfse><Numero>EXEMPLO-001</Numero>` +
      `<DataEmissao>${agora.toISOString()}</DataEmissao>` +
      `<Valores><ValorServicos>100.00</ValorServicos></Valores>` +
      `<PrestadorServico><Cnpj>${empresa.cnpj}</Cnpj>` +
      `<RazaoSocial>${empresa.razaoSocial}</RazaoSocial></PrestadorServico>` +
      `<TomadorServico><RazaoSocial>Tomador Exemplo LTDA</RazaoSocial></TomadorServico>` +
      `</InfNfse></NFSe>`;

    return {
      notas: [
        {
          chave: `EXEMPLO-${empresa.cnpj}-001`,
          numero: 'EXEMPLO-001',
          emitenteCnpjCpf: empresa.cnpj,
          emitenteNome: empresa.razaoSocial,
          destinatarioCnpjCpf: '',
          destinatarioNome: 'Tomador Exemplo LTDA',
          valorTotal: 100.0,
          dataEmissao: agora,
          xml,
          papel: 'emitente',
          origem: 'nfse-exemplo',
        },
      ],
      aviso: 'Nota de exemplo gerada em homologacao (adaptador didatico).',
    };
  }
}
