import mongoose from 'mongoose';

/**
 * Documento fiscal capturado (NF-e, NFC-e ou NFS-e).
 * Guarda o XML original e um resumo indexavel para o dashboard.
 */
const notaFiscalSchema = new mongoose.Schema(
  {
    empresa: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true, index: true },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    tipo: {
      type: String,
      enum: ['nfe', 'nfce', 'nfse', 'cte', 'evento'],
      required: true,
      index: true,
    },

    // Chave de acesso (44 digitos) para documentos modelo 55/65; ausente em NFS-e antiga.
    chave: { type: String, trim: true, index: true },

    // Em eventos: chave da nota a que o evento se refere.
    chaveNota: { type: String, trim: true, index: true },
    tpEvento: { type: String, trim: true },

    // NSU da Distribuicao DF-e (quando aplicavel)
    nsu: { type: String, trim: true },

    // Resumo
    numero: { type: String, trim: true },
    serie: { type: String, trim: true },
    modelo: { type: String, trim: true },
    emitenteCnpjCpf: { type: String, trim: true },
    emitenteNome: { type: String, trim: true },
    destinatarioCnpjCpf: { type: String, trim: true },
    destinatarioNome: { type: String, trim: true },
    valorTotal: { type: Number, default: 0 },
    dataEmissao: { type: Date },

    // Papel da empresa nesta nota
    papel: { type: String, enum: ['emitente', 'destinatario', 'desconhecido'], default: 'desconhecido' },

    // Situacao de manifestacao (NF-e destinada)
    // Cancelada (recebido evento de cancelamento 110111)
    cancelada: { type: Boolean, default: false },

    // Ultima mensagem da SEFAZ ao tentar manifestar/baixar o XML completo
    mensagemManifestacao: { type: String },

    situacaoManifestacao: {
      type: String,
      enum: ['pendente', 'ciencia', 'confirmada', 'desconhecida', 'nao_realizada', 'nao_aplicavel'],
      default: 'nao_aplicavel',
    },

    // Conteudo
    // Conteudo (pode ser apagado conforme o plano do escritorio; ver services/retencao.js)
    xml: { type: String, required() { return !this.xmlApagadoEm; } },
    arquivoEm: { type: Date, default: Date.now }, // quando o XML (completo) chegou ao sistema
    baixadaEm: { type: Date }, // 1o download do XML pelo escritorio
    xmlApagadoEm: { type: Date }, // XML apagado pela regra de armazenamento do plano
    resumo: { type: Boolean, default: false }, // true = apenas resumo (resNFe), sem XML completo

    origem: { type: String, trim: true }, // ex: "sefaz-distdfe", "nfse-nacional", "nfse-ginfes"
  },
  { timestamps: true },
);

// Evita duplicar o mesmo documento para a mesma empresa.
notaFiscalSchema.index({ empresa: 1, chave: 1 }, { unique: true, partialFilterExpression: { chave: { $type: 'string' } } });
// Indices para a listagem, filtros e relatorios (por conta, tipo, papel e periodo).
notaFiscalSchema.index({ owner: 1, dataEmissao: -1 });
notaFiscalSchema.index({ owner: 1, tipo: 1, dataEmissao: -1 });
notaFiscalSchema.index({ owner: 1, papel: 1, dataEmissao: -1 });
notaFiscalSchema.index({ owner: 1, resumo: 1 });
notaFiscalSchema.index({ owner: 1, situacaoManifestacao: 1 });
notaFiscalSchema.index({ owner: 1, xmlApagadoEm: 1 });
notaFiscalSchema.index({ empresa: 1, nsu: 1 }, { unique: true, partialFilterExpression: { nsu: { $type: 'string' } } });

export const NotaFiscal = mongoose.model('NotaFiscal', notaFiscalSchema);
