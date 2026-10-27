import mongoose from 'mongoose';

/**
 * Histórico de movimentações de estoque vinculadas a operações fiscais ou ajustes manuais.
 */
const movimentacaoEstoqueSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    empresa: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true, index: true },
    produto: { type: mongoose.Schema.Types.ObjectId, ref: 'ProdutoNfe', required: true, index: true },
    tipo: { type: String, enum: ['entrada', 'saida', 'ajuste'], required: true },
    quantidade: { type: Number, required: true },
    estoqueAnterior: { type: Number, default: 0 },
    estoqueFinal: { type: Number, default: 0 },
    origem: {
      type: String,
      enum: ['venda', 'cancelamento', 'xml_entrada', 'manual'],
      default: 'manual',
    },
    referenciaId: { type: mongoose.Schema.Types.ObjectId }, // Id da EmissaoNfe ou NotaFiscal
    documentoNumero: { type: String, default: '' },
    motivo: { type: String, trim: true, default: '' },
  },
  { timestamps: true },
);

movimentacaoEstoqueSchema.index({ empresa: 1, produto: 1, createdAt: -1 });

export const MovimentacaoEstoque = mongoose.model('MovimentacaoEstoque', movimentacaoEstoqueSchema);
