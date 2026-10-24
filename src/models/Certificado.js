import mongoose from 'mongoose';

/**
 * Armazena um certificado digital A1 (.pfx/.p12).
 * O conteudo do arquivo e a senha NUNCA sao gravados em texto puro:
 * sao criptografados com AES-256-GCM (ver services/crypto/vault.js).
 */
const certificadoSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    apelido: { type: String, required: true, trim: true },

    // Metadados extraidos do certificado (seguros para exibir)
    titular: { type: String, trim: true },
    cnpjCpf: { type: String, trim: true },
    emissor: { type: String, trim: true },
    validoDe: { type: Date },
    validoAte: { type: Date },

    // Blob criptografado do arquivo .pfx (base64 de { iv, tag, data })
    pfxCriptografado: { type: String, required: true },
    // Senha do .pfx criptografada
    senhaCriptografada: { type: String, required: true },

    ativo: { type: Boolean, default: true },
  },
  { timestamps: true },
);

certificadoSchema.virtual('vencido').get(function vencido() {
  return this.validoAte ? this.validoAte.getTime() < Date.now() : false;
});

certificadoSchema.virtual('diasParaVencer').get(function diasParaVencer() {
  if (!this.validoAte) return null;
  return Math.ceil((this.validoAte.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
});

certificadoSchema.set('toJSON', { virtuals: true });
certificadoSchema.set('toObject', { virtuals: true });

certificadoSchema.index({ owner: 1, validoAte: 1 });

export const Certificado = mongoose.model('Certificado', certificadoSchema);
