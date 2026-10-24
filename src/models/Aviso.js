import mongoose from 'mongoose';

/**
 * Aviso do dono da plataforma para todos os escritorios (aparece no topo do Painel).
 * Fica visivel de "inicio" ate "fim" (fim vazio = ate ser apagado).
 */
const avisoSchema = new mongoose.Schema(
  {
    titulo: { type: String, trim: true, required: true, maxlength: 120 },
    texto: { type: String, trim: true, default: '', maxlength: 1000 },
    tipo: { type: String, enum: ['info', 'importante', 'manutencao'], default: 'info' },
    // Para quem: todos os escritorios, so os com acesso liberado, ou so os bloqueados
    // (sem acesso: bloqueado, pausado, vencido, inadimplente apos a carencia, teste encerrado, cancelado).
    para: { type: String, enum: ['todos', 'ativos', 'bloqueados'], default: 'todos' },
    inicio: { type: Date, default: Date.now, index: true },
    fim: { type: Date, default: null, index: true },
    criadoPor: { type: String, trim: true },
  },
  { timestamps: true },
);

export const Aviso = mongoose.model('Aviso', avisoSchema);
