import mongoose from 'mongoose';

/** Cada tentativa de emissao de NF-e (55) ou NFC-e (65), com o XML e os eventos. */
const eventoSchema = new mongoose.Schema(
  {
    tipo: { type: String }, // 110111 cancelamento | 110110 carta de correcao
    seq: { type: Number },
    texto: { type: String },
    protocolo: { type: String },
    cStat: { type: String },
    xMotivo: { type: String },
    xml: { type: String },
    data: { type: Date, default: Date.now },
  },
  { _id: false },
);

const emissaoNfeSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    empresa: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true, index: true },
    usuario: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    modelo: { type: String, enum: ['55', '65'], required: true },
    ambiente: { type: String, enum: ['producao', 'homologacao'], required: true },
    serie: { type: String },
    numero: { type: Number },
    chave: { type: String, index: true },
    status: {
      type: String,
      enum: ['autorizada', 'rejeitada', 'denegada', 'sem_resposta', 'cancelada', 'contingencia'],
      required: true,
    },
    cStat: { type: String },
    xMotivo: { type: String },
    protocolo: { type: String },
    dataAutorizacao: { type: Date },
    destNome: { type: String },
    destDocumento: { type: String },
    valor: { type: Number, default: 0 },
    qtdItens: { type: Number, default: 0 },
    xml: { type: String }, // nfeProc quando autorizada; senao o XML enviado
    erros: [String],
    eventos: [eventoSchema],
    nota: { type: mongoose.Schema.Types.ObjectId, ref: 'NotaFiscal' },
    dados: { type: mongoose.Schema.Types.Mixed }, // venda como foi digitada (para repetir)
  },
  { timestamps: true },
);
emissaoNfeSchema.index({ owner: 1, empresa: 1, createdAt: -1 });
emissaoNfeSchema.index({ empresa: 1, ambiente: 1, modelo: 1, serie: 1, numero: 1 });

export const EmissaoNfe = mongoose.model('EmissaoNfe', emissaoNfeSchema);
