import mongoose from 'mongoose';

/**
 * Plano do SaaS, criado e editado pelo dono da plataforma (Plataforma > Planos).
 * O _id e um codigo curto (ex.: "basico", "profissional-anual") guardado em Conta.plano.
 */
const planoSchema = new mongoose.Schema(
  {
    _id: { type: String, trim: true },
    nome: { type: String, trim: true, required: true },
    descricao: { type: String, trim: true, default: '' },
    preco: { type: Number, min: 0, default: 0 }, // valor cobrado a cada periodo
    periodo: {
      quantidade: { type: Number, min: 1, default: 1 },
      unidade: { type: String, enum: ['dia', 'mes'], default: 'mes' },
    },
    limiteEmpresas: { type: Number, min: 0, default: null }, // CNPJs/CPFs; null = ilimitado
    limiteUsuarios: { type: Number, min: 1, default: null }, // equipe (admin + operador); null = ilimitado
    diasGratis: { type: Number, min: 0, max: 365, default: 0 }, // 0 = sem periodo gratis
    funcionalidades: { type: [String], default: [] },
    // Armazenamento do XML das notas: dias apos a captura (null = sempre) e/ou apagar ao baixar.
    retencaoDias: { type: Number, min: 1, default: null },
    apagarAoBaixar: { type: Boolean, default: false },
    ativo: { type: Boolean, default: true }, // false = arquivado (nao pode ser atribuido a novas contas)
    publico: { type: Boolean, default: true }, // aparece na pagina inicial do site
    destaque: { type: Boolean, default: false },
    ordem: { type: Number, default: 0 },
  },
  { timestamps: true, collection: 'planos' },
);

export const Plano = mongoose.model('Plano', planoSchema);
