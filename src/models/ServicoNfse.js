import mongoose from 'mongoose';

/**
 * Servico cadastrado de uma empresa, usado para emitir NFS-e com um clique.
 * Pode ter tomador e valor fixos (ex.: mensalidade de um contrato) ou deixar
 * para informar na hora ("perguntar").
 */
const servicoSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    empresa: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true, index: true },
    nome: { type: String, required: true, trim: true }, // apelido do botao, ex.: "Mensalidade - Cliente X"
    ativo: { type: Boolean, default: true },

    cTribNac: { type: String, required: true, trim: true },
    cNBS: { type: String, trim: true },
    // Aceita {mes}, {ano} e {competencia} (mm/aaaa), trocados na hora da emissao
    descricao: { type: String, required: true, trim: true },
    valor: { type: Number, default: null }, // vazio = perguntar na hora
    cLocPrestacao: { type: String, trim: true },
    issRetido: { type: Boolean, default: false },
    naoIncidencia: { type: Boolean, default: false },
    aliquota: { type: Number, default: null }, // so ME/EPP
    infoComplementar: { type: String, trim: true },

    tomador: {
      tipo: { type: String, enum: ['cpf', 'cnpj', 'nenhum', 'perguntar'], default: 'perguntar' },
      documento: String,
      nome: String,
      email: String,
      fone: String,
      cep: String,
      cMun: String,
      cidade: String,
      logradouro: String,
      numero: String,
      complemento: String,
      bairro: String,
    },

    ultimaEmissao: { type: Date },
    totalEmitidas: { type: Number, default: 0 },
  },
  { timestamps: true },
);

servicoSchema.index({ owner: 1, empresa: 1, nome: 1 });

/** O que falta informar na hora de emitir (para mostrar so esses campos no botao). */
servicoSchema.virtual('pendencias').get(function pendencias() {
  return {
    valor: !(this.valor > 0),
    tomador: this.tomador?.tipo === 'perguntar',
  };
});
servicoSchema.set('toObject', { virtuals: true });
servicoSchema.set('toJSON', { virtuals: true });

export const ServicoNfse = mongoose.model('ServicoNfse', servicoSchema);
