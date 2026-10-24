import mongoose from 'mongoose';

/** Eventos recebidos do Asaas (historico e controle de duplicidade). Guardados por 1 ano. */
const eventoSchema = new mongoose.Schema(
  {
    _id: { type: String }, // id do evento no Asaas
    evento: { type: String, index: true },
    conta: { type: mongoose.Schema.Types.ObjectId, ref: 'Conta', index: true },
    dados: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true },
);
eventoSchema.index({ createdAt: 1 }, { expireAfterSeconds: 365 * 24 * 3600 });

export const EventoCobranca = mongoose.model('EventoCobranca', eventoSchema);
