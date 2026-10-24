import mongoose from 'mongoose';

/**
 * Sessao de login da API (web React ou app). Guarda so o hash do token de renovacao;
 * cada renovacao troca o token (rotacao). Sair apaga a sessao.
 */
const sessaoSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    refreshHash: { type: String, required: true, unique: true },
    expiraEm: { type: Date, required: true },
    cliente: { type: String, trim: true }, // "web", "android", "ios"
    ip: { type: String },
    ultimoUso: { type: Date, default: Date.now },
  },
  { timestamps: true },
);
sessaoSchema.index({ expiraEm: 1 }, { expireAfterSeconds: 0 });

export const SessaoApi = mongoose.model('SessaoApi', sessaoSchema);
