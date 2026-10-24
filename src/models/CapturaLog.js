import mongoose from 'mongoose';

/** Registro de cada execucao de captura (manual ou agendada). */
const capturaLogSchema = new mongoose.Schema(
  {
    empresa: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true, index: true },
    tipo: { type: String, enum: ['nfe', 'nfse', 'cte'], required: true },
    origem: { type: String, enum: ['manual', 'agendado'], default: 'manual' },
    status: { type: String, enum: ['sucesso', 'parcial', 'erro'], required: true },
    cStat: { type: String },
    ambiente: { type: String }, // producao | homologacao // codigo de retorno da SEFAZ (137, 138, 656...)
    novos: { type: Number, default: 0 },
    totalProcessado: { type: Number, default: 0 },
    ultimoNSU: { type: String },
    maxNSU: { type: String },
    mensagem: { type: String },
    detalhe: { type: String },
    duracaoMs: { type: Number, default: 0 },
  },
  { timestamps: true },
);

capturaLogSchema.index({ empresa: 1, tipo: 1, createdAt: -1 });

export const CapturaLog = mongoose.model('CapturaLog', capturaLogSchema);
