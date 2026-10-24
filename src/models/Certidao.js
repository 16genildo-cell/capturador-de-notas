import mongoose from 'mongoose';

/**
 * Certidao (negativa de debitos ou equivalente) de uma empresa/pessoa.
 * Pode vir da emissao automatica (API Serpro - federal) ou ser enviada manualmente (PDF).
 */
export const ESFERAS = {
  federal: 'Federal (Receita/PGFN)',
  estadual: 'Estadual (SEFAZ)',
  municipal: 'Municipal (Prefeitura)',
  fgts: 'FGTS (CRF - Caixa)',
  trabalhista: 'Trabalhista (CNDT - TST)',
};

export const SITUACOES = {
  negativa: 'Negativa',
  positiva_efeito_negativa: 'Positiva com efeitos de negativa',
  positiva: 'Positiva (com debitos)',
  nao_emitida: 'Não emitida',
};

const certidaoSchema = new mongoose.Schema(
  {
    empresa: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true, index: true },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    esfera: { type: String, enum: Object.keys(ESFERAS), required: true },
    situacao: { type: String, enum: Object.keys(SITUACOES), default: 'negativa' },
    descricao: { type: String, trim: true }, // tipo da certidao conforme o orgao
    codigoControle: { type: String, trim: true },
    dataEmissao: { type: Date },
    dataValidade: { type: Date, index: true },
    pdf: { type: Buffer }, // arquivo da certidao
    origem: { type: String, enum: ['serpro', 'manual'], default: 'manual' },
    mensagem: { type: String }, // retorno do orgao (ex.: motivo de nao emissao)
  },
  { timestamps: true },
);

/** 'vencida' | 'vencendo' (ate 15 dias) | 'valida' | 'sem_validade' */
export function statusValidade(dataValidade, dias = 15) {
  if (!dataValidade) return 'sem_validade';
  const fimDoDia = new Date(dataValidade).getTime() + 864e5;
  const agora = Date.now();
  if (fimDoDia < agora) return 'vencida';
  if (fimDoDia - agora < dias * 864e5) return 'vencendo';
  return 'valida';
}

export const Certidao = mongoose.model('Certidao', certidaoSchema);
