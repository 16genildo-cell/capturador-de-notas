import mongoose from 'mongoose';

/**
 * Mensagem do chat interno entre o escritorio (seus administradores) e a equipe da plataforma.
 * Cada mensagem pertence a um atendimento numerado (ver Atendimento.js).
 * Pode ter texto, um anexo (PDF/imagem) ou ambos; "sistema" = aviso automatico (encerrado, reaberto).
 */
const chatSchema = new mongoose.Schema(
  {
    conta: { type: mongoose.Schema.Types.ObjectId, ref: 'Conta', required: true },
    atendimento: { type: mongoose.Schema.Types.ObjectId, ref: 'Atendimento', index: true },
    numeroAtendimento: { type: Number },
    autor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    autorNome: { type: String, trim: true, required: true },
    deSuporte: { type: Boolean, default: false }, // true = enviada pela equipe da plataforma
    sistema: { type: Boolean, default: false },
    texto: { type: String, trim: true, maxlength: 2000, default: '' },
    anexo: {
      id: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatAnexo' },
      nome: { type: String, trim: true },
      tipo: { type: String, trim: true },
      tamanho: { type: Number },
    },
    lidaPeloEscritorio: { type: Boolean, default: false },
    lidaPeloSuporte: { type: Boolean, default: false },
  },
  { timestamps: true },
);
chatSchema.pre('validate', function exigeConteudo(next) {
  if (!this.texto && !this.anexo?.id && !this.sistema) this.invalidate('texto', 'Escreva a mensagem ou anexe um arquivo.');
  next();
});
chatSchema.index({ conta: 1, createdAt: -1 });
chatSchema.index({ deSuporte: 1, lidaPeloSuporte: 1 });

export const ChatMensagem = mongoose.model('ChatMensagem', chatSchema);
