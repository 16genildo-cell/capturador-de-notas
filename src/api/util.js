import mongoose from 'mongoose';
import { PLANOS } from '../config/planos.js';

const semInfinito = (n) => (n === Infinity ? null : n);

/** Erro com status HTTP para a API. */
export function falha(status, mensagem, codigo) {
  const e = new Error(mensagem);
  e.status = status;
  if (codigo) e.codigo = codigo;
  return e;
}

export function soAdmin(req) {
  if (req.user.role !== 'admin') throw falha(403, 'Ação permitida apenas para administradores.');
}

export function idValido(id) {
  if (!mongoose.isValidObjectId(id)) throw falha(404, 'Não encontrado.');
  return id;
}

/** Dados da conta que o frontend pode ver. */
export function contaPublica(conta) {
  const limite = conta.limiteEmpresas();
  const plano = conta.plano ? PLANOS[conta.plano] || null : null;
  return {
    id: String(conta._id),
    nome: conta.nome,
    documento: conta.documento,
    emailCobranca: conta.emailCobranca,
    telefone: conta.telefone,
    status: conta.status,
    // So o que o escritorio pode ver do plano (sem ordem/arquivado/publico).
    plano: plano && {
      id: plano.id, nome: plano.nome, descricao: plano.descricao, preco: plano.preco, periodo: plano.periodo, rotuloPeriodo: plano.rotuloPeriodo,
      empresas: plano.empresas, usuarios: plano.usuarios, funcionalidades: plano.funcionalidades,
    },
    testeAte: conta.testeAte,
    pagoAte: conta.pagoAte,
    limiteEmpresas: semInfinito(limite),
    limiteUsuarios: semInfinito(conta.limiteUsuarios()),
    // Funcionalidades liberadas pelo plano (o site esconde o que nao estiver aqui).
    recursos: conta.recursos(),
    armazenamento: { ...conta.armazenamento(), rotulo: plano?.rotuloArmazenamento || 'Guarda as notas sempre' },
    acesso: conta.acesso(),
    temAssinatura: Boolean(conta.asaas?.subscriptionId),
    linkPagamento: conta.asaas?.linkPagamento || null,
    config: { cienciaAutomatica: Boolean(conta.config?.cienciaAutomatica), alertasPara: conta.config?.alertasPara || [] },
  };
}
