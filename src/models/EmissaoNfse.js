import mongoose from 'mongoose';

/**
 * Historico de emissoes de NFS-e pelo Emissor Nacional (Sefin Nacional),
 * inclusive as rejeitadas, para conferencia e reenvio.
 */
const emissaoSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    empresa: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true, index: true },
    usuario: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    ambiente: { type: String, enum: ['producao', 'homologacao'], required: true },
    serie: { type: String, required: true },
    nDPS: { type: Number, required: true },
    dpsId: { type: String, required: true, index: true },
    status: { type: String, enum: ['autorizada', 'rejeitada', 'sem_resposta', 'cancelada'], required: true },
    chaveAcesso: { type: String, index: true },
    nota: { type: mongoose.Schema.Types.ObjectId, ref: 'NotaFiscal' },
    erros: [{ type: String }],
    alertas: [{ type: String }],
    // Resumo para a listagem
    tomadorNome: { type: String },
    tomadorDocumento: { type: String },
    descricao: { type: String },
    valor: { type: Number },
    competencia: { type: String },
    // XMLs
    dpsXml: { type: String },
    nfseXml: { type: String },
    eventoCancelamentoXml: { type: String },
    // Dados do formulario (para "emitir de novo" a partir desta)
    dados: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true },
);

emissaoSchema.index({ owner: 1, createdAt: -1 });

export const EmissaoNfse = mongoose.model('EmissaoNfse', emissaoSchema);
