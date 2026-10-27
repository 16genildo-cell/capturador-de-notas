import mongoose from 'mongoose';

/**
 * Produto cadastrado de uma empresa, usado na NF-e e na NFC-e.
 * A classificacao fiscal (NCM, CFOP, CSOSN) deve ser conferida pelo contador.
 */
const produtoSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    empresa: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true, index: true },
    codigo: { type: String, required: true, trim: true },
    descricao: { type: String, required: true, trim: true },
    gtin: { type: String, trim: true, default: '' }, // codigo de barras (vazio = SEM GTIN)
    ncm: { type: String, required: true, trim: true },
    cest: { type: String, trim: true, default: '' },
    unidade: { type: String, trim: true, default: 'UN' },
    preco: { type: Number, default: 0 },
    // CFOP para venda dentro do estado (5xxx). Fora do estado o sistema usa o 6xxx equivalente.
    cfop: { type: String, trim: true, default: '5102' },
    origem: { type: String, default: '0' }, // 0 = nacional
    csosn: { type: String, default: '102' }, // Simples Nacional
    // Regime normal (CRT 3): CST e aliquota do ICMS
    cstIcms: { type: String, default: '' },
    aliqIcms: { type: Number, default: 0 },
    pTotTrib: { type: Number, default: 0 }, // % aproximado de tributos (Lei 12.741/2012)
    ativo: { type: Boolean, default: true },
    totalVendido: { type: Number, default: 0 },
    estoque: { type: Number, default: 0 },
    estoqueMinimo: { type: Number, default: 0 },
    controlaEstoque: { type: Boolean, default: true },
  },
  { timestamps: true },
);
produtoSchema.index({ owner: 1, empresa: 1, codigo: 1 });

export const ProdutoNfe = mongoose.model('ProdutoNfe', produtoSchema);
