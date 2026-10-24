import mongoose from 'mongoose';

/**
 * Mensagem enviada pelo formulario "Fale com a gente" da pagina inicial.
 * Aparece para o dono da plataforma no painel /plataforma (caixa "Mensagens do site").
 */
const mensagemSchema = new mongoose.Schema(
  {
    nome: { type: String, trim: true, required: true, maxlength: 120 },
    email: { type: String, trim: true, lowercase: true, required: true, maxlength: 160 },
    telefone: { type: String, trim: true, maxlength: 40 },
    escritorio: { type: String, trim: true, maxlength: 160 },
    qtdClientes: { type: String, trim: true, maxlength: 40 },
    mensagem: { type: String, trim: true, required: true, maxlength: 3000 },
    ip: { type: String },
    origem: { type: String, trim: true, default: 'site' }, // 'site' (painel antigo) ou 'web' (React)
    lida: { type: Boolean, default: false, index: true },
    arquivada: { type: Boolean, default: false, index: true },
  },
  { timestamps: true },
);
mensagemSchema.index({ createdAt: -1 });

export const MensagemContato = mongoose.model('MensagemContato', mensagemSchema);
