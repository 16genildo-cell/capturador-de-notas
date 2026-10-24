import mongoose from 'mongoose';

/** Celular que recebe notificacoes push (token do Firebase Cloud Messaging). */
const dispositivoSchema = new mongoose.Schema(
  {
    token: { type: String, required: true, unique: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    conta: { type: mongoose.Schema.Types.ObjectId, ref: 'Conta', required: true, index: true },
    plataforma: { type: String, enum: ['android', 'ios', 'web'], default: 'android' },
  },
  { timestamps: true },
);

export const Dispositivo = mongoose.model('Dispositivo', dispositivoSchema);
