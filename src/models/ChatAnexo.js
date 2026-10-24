import mongoose from 'mongoose';

/** Arquivo (PDF ou imagem) enviado no chat com o suporte. Ate 10 MB, guardado no banco. */
const chatAnexoSchema = new mongoose.Schema(
  {
    conta: { type: mongoose.Schema.Types.ObjectId, ref: 'Conta', required: true, index: true },
    nome: { type: String, trim: true, required: true },
    tipo: { type: String, enum: ['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp'], required: true },
    tamanho: { type: Number, required: true },
    dados: { type: Buffer, required: true },
  },
  { timestamps: true },
);

export const ChatAnexo = mongoose.model('ChatAnexo', chatAnexoSchema);
