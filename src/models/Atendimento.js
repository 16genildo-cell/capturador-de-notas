import mongoose from 'mongoose';

/**
 * Atendimento do chat com o suporte. Cada escritorio tem no maximo um atendimento aberto;
 * a equipe da plataforma encerra (a conversa fica arquivada) e qualquer lado pode reabrir.
 * Mensagem nova sem atendimento aberto abre um novo, com o proximo numero.
 */
const atendimentoSchema = new mongoose.Schema(
  {
    numero: { type: Number, required: true, unique: true }, // #1, #2... (sequencia unica da plataforma)
    conta: { type: mongoose.Schema.Types.ObjectId, ref: 'Conta', required: true, index: true },
    status: { type: String, enum: ['aberto', 'encerrado'], default: 'aberto', index: true },
    abertoPor: { type: String, trim: true },
    encerradoEm: { type: Date },
    encerradoPor: { type: String, trim: true },
    reabertoEm: { type: Date },
    ultimaMensagemEm: { type: Date, default: Date.now },
  },
  { timestamps: true },
);
// So um atendimento aberto por escritorio (protege contra duas mensagens ao mesmo tempo).
atendimentoSchema.index({ conta: 1 }, { unique: true, partialFilterExpression: { status: 'aberto' }, name: 'um_aberto_por_conta' });
atendimentoSchema.index({ status: 1, ultimaMensagemEm: -1 });

export const Atendimento = mongoose.model('Atendimento', atendimentoSchema);
