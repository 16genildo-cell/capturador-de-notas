import mongoose from 'mongoose';

/**
 * Solicitação de documentos e tarefas entre o escritório de contabilidade e seus clientes.
 */
const solicitacaoDocumentoSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    empresa: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true, index: true },
    titulo: { type: String, required: true, trim: true },
    descricao: { type: String, trim: true, default: '' },
    prazo: { type: Date },
    status: {
      type: String,
      enum: ['pendente', 'enviado', 'aprovado', 'rejeitado'],
      default: 'pendente',
      index: true,
    },
    arquivo: {
      nome: { type: String },
      mimetype: { type: String },
      tamanho: { type: Number },
      conteudoBase64: { type: String },
      enviadoEm: { type: Date },
    },
    observacao: { type: String, trim: true, default: '' },
    solicitadoPor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

solicitacaoDocumentoSchema.index({ owner: 1, empresa: 1, status: 1 });

export const SolicitacaoDocumento = mongoose.model('SolicitacaoDocumento', solicitacaoDocumentoSchema);
