import mongoose from 'mongoose';

const rateLimitRegistroSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true }, // ex.: "login:127.0.0.1|user@email.com" ou "rate:127.0.0.1"
    contagem: { type: Number, default: 0 },
    bloqueadoAte: { type: Date, default: null },
    expiraEm: { type: Date, required: true, index: { expires: 0 } },
  },
  { timestamps: true }
);

export const RateLimitRegistro =
  mongoose.models.RateLimitRegistro || mongoose.model('RateLimitRegistro', rateLimitRegistroSchema);
