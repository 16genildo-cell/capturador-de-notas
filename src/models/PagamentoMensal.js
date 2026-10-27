import mongoose from 'mongoose';

/**
 * Registro de controle de pagamento mensal de cada escritório cliente da plataforma.
 * Permite ao administrador dar OK nos escritórios que pagaram a mensalidade de cada mês
 * e gerar relatórios de adimplentes e inadimplentes.
 */
const pagamentoMensalSchema = new mongoose.Schema(
  {
    conta: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Conta',
      required: true,
      index: true,
    },
    // Formato 'AAAA-MM' (ex: '2026-10')
    mes: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    ano: {
      type: Number,
      index: true,
    },
    mesNumero: {
      type: Number,
      min: 1,
      max: 12,
    },
    // Valor cobrado / pago da mensalidade
    valor: {
      type: Number,
      default: 0,
    },
    // Status do pagamento
    pago: {
      type: Boolean,
      default: false,
      index: true,
    },
    // Data em que o pagamento foi realizado / confirmado
    pagoEm: {
      type: Date,
      default: null,
    },
    // Forma utilizada no pagamento
    formaPagamento: {
      type: String,
      enum: ['pix', 'boleto', 'cartao', 'transferencia', 'dinheiro', 'outro'],
      default: 'pix',
    },
    // Quem confirmou o pagamento (e-mail do administrador)
    confirmadoPor: {
      type: String,
      trim: true,
    },
    // Observação adicional (ex: número do comprovante, desconto negociado, etc.)
    observacoes: {
      type: String,
      trim: true,
      maxlength: 1000,
    },
  },
  { timestamps: true },
);

// Cada escritório tem no máximo 1 registro por mês de referência
pagamentoMensalSchema.index({ conta: 1, mes: 1 }, { unique: true });

// Pre-save para preencher ano e mesNumero automaticamente
pagamentoMensalSchema.pre('save', function (next) {
  if (this.mes && /^\d{4}-\d{2}$/.test(this.mes)) {
    const [a, m] = this.mes.split('-').map(Number);
    this.ano = a;
    this.mesNumero = m;
  }
  next();
});

export const PagamentoMensal = mongoose.model('PagamentoMensal', pagamentoMensalSchema);
