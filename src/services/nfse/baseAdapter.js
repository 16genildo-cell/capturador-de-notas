/**
 * Contrato que todo adaptador de NFS-e deve seguir.
 *
 * A NFS-e e MUNICIPAL: cada cidade (ou provedor) tem seu proprio web service,
 * layout e forma de autenticacao. Por isso a captura de NFS-e e organizada em
 * "adaptadores" plugaveis, registrados por chave (nome do provedor/municipio).
 *
 * Um adaptador recebe a empresa + certificado materializado e deve retornar a
 * lista de notas capturadas no formato padronizado abaixo.
 */
export class BaseNfseAdapter {
  /** @param {object} opts { empresa, certificado: {keyPem, certPem, pfx, senha} } */
  // eslint-disable-next-line no-unused-vars, class-methods-use-this
  async capturar(opts) {
    throw new Error('Adaptador de NFS-e nao implementou o metodo capturar().');
  }
}

/**
 * Formato padronizado de uma NFS-e capturada (o orquestrador converte em NotaFiscal):
 * {
 *   chave?: string,          // codigo de verificacao ou chave, quando houver
 *   numero: string,
 *   emitenteCnpjCpf: string, // prestador
 *   emitenteNome: string,
 *   destinatarioCnpjCpf: string, // tomador
 *   destinatarioNome: string,
 *   valorTotal: number,
 *   dataEmissao: Date,
 *   xml: string,
 *   papel: 'emitente' | 'destinatario',
 *   origem: string,          // ex: "nfse-nacional", "nfse-ginfes"
 * }
 */
