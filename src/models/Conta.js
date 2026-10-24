import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { PLANOS, TESTE, TODAS_FUNCIONALIDADES } from '../config/planos.js';

/**
 * Conta de cliente do SaaS (o "inquilino"). Todos os dados (empresas, certificados,
 * notas...) ja eram separados pelo campo `owner` = id do usuario dono da conta;
 * por isso o _id da Conta e o proprio id desse usuario: nada precisa ser migrado.
 *
 * Situacoes:
 *  - teste        : periodo gratis (ate testeAte)
 *  - pendente     : escolheu um plano e aguarda o 1o pagamento (acesso enquanto o teste valer)
 *  - ativa        : pagamento em dia (ate pagoAte + carencia)
 *  - inadimplente : pagamento atrasado (acesso ate pagoAte + carencia)
 *  - cancelada    : assinatura cancelada (acesso ate pagoAte)
 *  - pausada      : pausada pelo dono da plataforma (sem acesso; ao retomar, os dias que
 *                   faltavam do periodo sao devolvidos)
 *  - suspensa     : bloqueada pelo dono da plataforma
 *  - cortesia     : liberada sem cobranca (contas antigas / parceiros)
 */
const STATUS = ['teste', 'pendente', 'ativa', 'inadimplente', 'cancelada', 'pausada', 'suspensa', 'cortesia'];

const historicoSchema = new mongoose.Schema(
  {
    em: { type: Date, default: Date.now },
    acao: { type: String, trim: true },
    detalhe: { type: String, trim: true },
    por: { type: String, trim: true }, // e-mail de quem fez (dono da plataforma) ou "sistema"
  },
  { _id: false },
);

const contaSchema = new mongoose.Schema(
  {
    _id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // = id do usuario dono
    nome: { type: String, trim: true, required: true },
    documento: { type: String, trim: true }, // CPF/CNPJ de quem paga (obrigatorio no Asaas)
    emailCobranca: { type: String, trim: true, lowercase: true },
    telefone: { type: String, trim: true },

    // Codigo do plano (colecao "planos"). null = sem plano (teste padrao ou cortesia).
    plano: { type: String, trim: true, default: null, index: true },
    status: { type: String, enum: STATUS, default: 'teste', index: true },
    testeAte: { type: Date },
    pagoAte: { type: Date },
    // Pausa e bloqueio: situacao para onde a conta volta ao retomar/desbloquear.
    statusAnterior: { type: String, enum: [...STATUS, null], default: null },
    pausadaEm: { type: Date },
    // Limites especiais (cortesia/negociacao). Vazio = limite do plano.
    limiteEmpresasManual: { type: Number, default: null },
    limiteUsuariosManual: { type: Number, default: null },

    asaas: {
      customerId: { type: String, trim: true },
      subscriptionId: { type: String, trim: true, index: true },
      ultimoPagamentoId: { type: String, trim: true },
      linkPagamento: { type: String, trim: true },
    },

    config: {
      // Quem recebe os alertas desta conta. Vazio = administradores da conta.
      alertasPara: { type: [String], default: [] },
    },

    aceiteTermosEm: { type: Date },
    aceiteTermosIp: { type: String },
    observacao: { type: String, trim: true }, // anotacao interna do dono da plataforma
    // Acoes do dono da plataforma sobre o plano e a situacao (mais recentes por ultimo).
    historico: { type: [historicoSchema], default: [] },
  },
  { timestamps: true },
);

/** Plano da conta (do cache) ou null. */
contaSchema.methods.planoAtual = function planoAtual() {
  return (this.plano && PLANOS[this.plano]) || null;
};

/** Quantas empresas (CNPJ/CPF) a conta pode ter. */
contaSchema.methods.limiteEmpresas = function limiteEmpresas() {
  if (this.limiteEmpresasManual != null) return this.limiteEmpresasManual;
  const plano = this.planoAtual();
  if (plano) return plano.empresas ?? Infinity;
  if (this.status === 'cortesia') return Infinity;
  return TESTE.empresas;
};

/** Quantos usuarios da equipe (administradores + equipe) a conta pode ter. */
contaSchema.methods.limiteUsuarios = function limiteUsuarios() {
  if (this.limiteUsuariosManual != null) return this.limiteUsuariosManual;
  return this.planoAtual()?.usuarios ?? Infinity;
};

/** Funcionalidades liberadas. Sem plano (teste padrao/cortesia): todas, como antes. */
contaSchema.methods.recursos = function recursos() {
  const plano = this.planoAtual();
  return plano ? plano.funcionalidades : TODAS_FUNCIONALIDADES;
};

contaSchema.methods.temRecurso = function temRecurso(id) {
  return this.recursos().includes(id);
};

/** Por quanto tempo o XML das notas fica guardado. Sem plano: guarda sempre (como antes). */
contaSchema.methods.armazenamento = function armazenamento() {
  return this.planoAtual()?.armazenamento || { dias: null, apagarAoBaixar: false };
};

/** Registra uma acao no historico (guarda as 100 ultimas). */
contaSchema.methods.registrar = function registrar(acao, detalhe, por) {
  this.historico.push({ em: new Date(), acao, detalhe, por: por || 'sistema' });
  if (this.historico.length > 100) this.historico.splice(0, this.historico.length - 100);
};

const DIA = 864e5;

/**
 * A conta pode usar o sistema agora?
 * @returns {{ liberado: boolean, motivo: string, aviso?: string, diasRestantes?: number }}
 */
contaSchema.methods.acesso = function acesso(agora = Date.now()) {
  const carencia = env.saas.carenciaDias * DIA;
  const ate = (d) => (d ? new Date(d).getTime() : 0);
  const dias = (t) => Math.max(0, Math.ceil((t - agora) / DIA));
  switch (this.status) {
    case 'cortesia':
      return { liberado: true, motivo: 'cortesia' };
    case 'ativa':
      if (!this.pagoAte || ate(this.pagoAte) + carencia > agora) return { liberado: true, motivo: 'ativa' };
      return { liberado: false, motivo: 'vencida' };
    case 'teste':
    case 'pendente': {
      const fim = ate(this.testeAte);
      if (fim > agora) {
        const d = dias(fim);
        return { liberado: true, motivo: this.status, diasRestantes: d, aviso: `Período grátis: ${d} dia(s) restante(s).` };
      }
      return { liberado: false, motivo: 'teste-encerrado' };
    }
    case 'inadimplente': {
      const fim = ate(this.pagoAte) + carencia;
      if (fim > agora) return { liberado: true, motivo: 'inadimplente', aviso: `Pagamento em atraso. O acesso será bloqueado em ${dias(fim)} dia(s).` };
      return { liberado: false, motivo: 'inadimplente' };
    }
    case 'cancelada': {
      const fim = ate(this.pagoAte);
      if (fim > agora) return { liberado: true, motivo: 'cancelada', aviso: `Assinatura cancelada. Acesso até ${new Date(fim).toLocaleDateString('pt-BR')}.` };
      return { liberado: false, motivo: 'cancelada' };
    }
    case 'pausada':
      return { liberado: false, motivo: 'pausada' };
    default:
      return { liberado: false, motivo: 'suspensa' };
  }
};

/** Cria a conta de um novo cliente, ja em periodo de teste. */
contaSchema.statics.criarTeste = function criarTeste({ donoId, nome, documento, email, ip }) {
  return this.create({
    _id: donoId,
    nome,
    documento,
    emailCobranca: email,
    status: 'teste',
    testeAte: new Date(Date.now() + TESTE.dias * DIA),
    aceiteTermosEm: new Date(),
    aceiteTermosIp: ip,
  });
};

export const STATUS_CONTA = STATUS;
export const Conta = mongoose.model('Conta', contaSchema);
