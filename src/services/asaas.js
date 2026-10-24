import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { PLANOS, somarPeriodo } from '../config/planos.js';
import { Conta } from '../models/Conta.js';
import { EventoCobranca } from '../models/EventoCobranca.js';

/**
 * Integracao com o Asaas (cobranca recorrente por Pix, boleto ou cartao).
 * Documentacao: https://docs.asaas.com
 *
 * Fluxo:
 *  1. Cliente escolhe um plano -> cria (uma vez) o cliente no Asaas e a assinatura mensal.
 *     billingType UNDEFINED: o cliente escolhe Pix, boleto ou cartao na pagina da fatura.
 *  2. O 1o vencimento e o fim do teste gratis (ou hoje, se o teste ja acabou).
 *  3. O webhook /webhooks/asaas atualiza a conta: pago -> ativa; atrasado -> inadimplente.
 */
const BASES = {
  sandbox: 'https://api-sandbox.asaas.com/v3',
  producao: 'https://api.asaas.com/v3',
};

let fetchImpl = (...a) => fetch(...a);
/** Para testes: troca o fetch usado nas chamadas a API. */
export function _definirFetch(fn) {
  fetchImpl = fn;
}

export function asaasConfigurado() {
  return Boolean(env.asaas.apiKey);
}

async function api(metodo, caminho, corpo) {
  if (!asaasConfigurado()) throw new Error('Cobrança não configurada (ASAAS_API_KEY).');
  const base = env.asaas.url || BASES[env.asaas.ambiente] || BASES.sandbox;
  const resp = await fetchImpl(`${base}${caminho}`, {
    method: metodo,
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': env.saas.nomeProduto,
      access_token: env.asaas.apiKey,
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const texto = await resp.text();
  let dados = {};
  try {
    dados = texto ? JSON.parse(texto) : {};
  } catch {
    dados = { bruto: texto };
  }
  if (!resp.ok) {
    const msg = dados.errors?.map((e) => e.description).join('; ') || `HTTP ${resp.status}`;
    throw new Error(`Asaas: ${msg}`);
  }
  return dados;
}

const dataISO = (d) => new Date(d).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

/** Ciclo do Asaas para o periodo do plano (o Asaas so aceita estes ciclos). */
export function cicloAsaas(periodo) {
  const p = periodo || { quantidade: 1, unidade: 'mes' };
  const k = `${p.quantidade}${p.unidade}`;
  const ciclos = { '7dia': 'WEEKLY', '15dia': 'BIWEEKLY', '14dia': 'BIWEEKLY', '1mes': 'MONTHLY', '2mes': 'BIMONTHLY', '3mes': 'QUARTERLY', '6mes': 'SEMIANNUALLY', '12mes': 'YEARLY' };
  return ciclos[k] || null;
}

/** Fim do periodo pago a partir do vencimento AAAA-MM-DD, conforme o plano da conta. */
export function fimDoPeriodo(dataAAAAMMDD, plano) {
  if (!plano?.periodo || (plano.periodo.unidade === 'mes' && plano.periodo.quantidade === 1)) return somarMes(dataAAAAMMDD);
  if (plano.periodo.unidade === 'mes') return somarMes(dataAAAAMMDD, plano.periodo.quantidade);
  const [a, m, d] = String(dataAAAAMMDD).slice(0, 10).split('-').map(Number);
  return somarPeriodo(new Date(Date.UTC(a, m - 1, d, 23, 59, 59)), plano.periodo);
}

/** Soma meses a uma data AAAA-MM-DD (fim do periodo pago). */
export function somarMes(dataAAAAMMDD, meses = 1) {
  const [a, m, d] = String(dataAAAAMMDD).slice(0, 10).split('-').map(Number);
  const r = new Date(Date.UTC(a, m - 1 + meses, d, 23, 59, 59));
  // 31/01 + 1 mes -> 28/02 (e nao 03/03)
  if (r.getUTCDate() !== d) r.setUTCDate(0);
  return r;
}

async function garantirCliente(conta) {
  if (conta.asaas?.customerId) return conta.asaas.customerId;
  if (!conta.documento) throw new Error('Informe o CNPJ/CPF de cobrança em "Dados da conta" antes de assinar.');
  const c = await api('POST', '/customers', {
    name: conta.nome,
    cpfCnpj: conta.documento,
    email: conta.emailCobranca || undefined,
    mobilePhone: conta.telefone || undefined,
    externalReference: String(conta._id),
    notificationDisabled: false,
  });
  conta.set('asaas.customerId', c.id);
  await conta.save();
  return c.id;
}

/** Proxima fatura em aberto da assinatura (link para o cliente pagar). */
export async function linkFaturaAberta(conta) {
  if (!conta.asaas?.subscriptionId) return null;
  const r = await api('GET', `/subscriptions/${conta.asaas.subscriptionId}/payments?status=PENDING&limit=10`);
  const atrasada = await api('GET', `/subscriptions/${conta.asaas.subscriptionId}/payments?status=OVERDUE&limit=10`);
  const lista = [...(atrasada.data || []), ...(r.data || [])].sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
  const p = lista[0];
  if (!p) return null;
  conta.set('asaas.linkPagamento', p.invoiceUrl);
  await conta.save();
  return { url: p.invoiceUrl, vencimento: p.dueDate, valor: p.value, status: p.status };
}

/**
 * Assina (ou troca) o plano da conta.
 * @returns {Promise<{ link: string|null }>}
 */
export async function assinarPlano(conta, planoId) {
  const plano = PLANOS[planoId];
  if (!plano) throw new Error('Plano inválido.');
  const customer = await garantirCliente(conta);
  const ciclo = cicloAsaas(plano.periodo);
  if (!ciclo) throw new Error(`O Asaas não cobra no período "${plano.rotuloPeriodo}". Use semanal, 15 dias, mensal, bimestral, trimestral, semestral ou anual, ou registre os pagamentos manualmente.`);
  const descricao = `${env.saas.nomeProduto} - plano ${plano.nome}${plano.empresas != null ? ` (ate ${plano.empresas} empresas)` : ''}`;

  if (conta.asaas?.subscriptionId && conta.status !== 'cancelada') {
    // Troca de plano: novo valor vale para as faturas em aberto e as proximas.
    await api('POST', `/subscriptions/${conta.asaas.subscriptionId}`, {
      value: plano.preco,
      cycle: ciclo,
      description: descricao,
      updatePendingPayments: true,
    });
    conta.plano = planoId;
    await conta.save();
  } else {
    const fimTeste = conta.testeAte && conta.testeAte.getTime() > Date.now() ? conta.testeAte : new Date();
    const assinatura = await api('POST', '/subscriptions', {
      customer,
      billingType: 'UNDEFINED',
      value: plano.preco,
      nextDueDate: dataISO(fimTeste),
      cycle: ciclo,
      description: descricao,
      externalReference: String(conta._id),
    });
    conta.plano = planoId;
    conta.set('asaas.subscriptionId', assinatura.id);
    if (!['ativa', 'cortesia'].includes(conta.status)) conta.status = 'pendente';
    await conta.save();
  }
  const fatura = await linkFaturaAberta(conta).catch(() => null);
  return { link: fatura?.url || null };
}

/** Cancela a assinatura. O acesso continua ate o fim do periodo ja pago. */
export async function cancelarAssinatura(conta) {
  if (conta.asaas?.subscriptionId) {
    await api('DELETE', `/subscriptions/${conta.asaas.subscriptionId}`);
  }
  conta.status = conta.status === 'cortesia' ? 'cortesia' : 'cancelada';
  conta.set('asaas.subscriptionId', undefined);
  conta.set('asaas.linkPagamento', undefined);
  await conta.save();
}

/** Valida o token enviado pelo Asaas no cabecalho asaas-access-token. */
export function webhookAutentico(token) {
  const esperado = env.asaas.webhookToken;
  if (!esperado) return false;
  const a = Buffer.from(String(token || ''));
  const b = Buffer.from(esperado);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function contaDoEvento(corpo) {
  const pag = corpo.payment || {};
  const sub = corpo.subscription || {};
  const subId = pag.subscription || sub.id;
  const ref = pag.externalReference || sub.externalReference;
  if (subId) {
    const c = await Conta.findOne({ 'asaas.subscriptionId': subId });
    if (c) return c;
  }
  if (ref && /^[a-f0-9]{24}$/.test(ref)) return Conta.findById(ref);
  if (pag.customer) return Conta.findOne({ 'asaas.customerId': pag.customer });
  return null;
}

/**
 * Processa um evento do webhook (idempotente: o mesmo id de evento so e aplicado uma vez).
 * @returns {Promise<string>} o que foi feito (para log)
 */
export async function processarEvento(corpo) {
  const idEvento = corpo?.id || `${corpo?.event}:${corpo?.payment?.id || corpo?.subscription?.id}:${corpo?.dateCreated}`;
  try {
    await EventoCobranca.create({ _id: idEvento, evento: corpo?.event, dados: corpo });
  } catch (err) {
    if (err.code === 11000) return 'duplicado';
    throw err;
  }

  try {
    return await aplicarEvento(idEvento, corpo);
  } catch (err) {
    // Libera o id para o Asaas reenviar e o evento ser aplicado depois.
    await EventoCobranca.deleteOne({ _id: idEvento }).catch(() => {});
    throw err;
  }
}

async function aplicarEvento(idEvento, corpo) {
  const conta = await contaDoEvento(corpo || {});
  if (!conta) return 'conta-nao-encontrada';
  await EventoCobranca.updateOne({ _id: idEvento }, { conta: conta._id });

  const pag = corpo.payment || {};
  switch (corpo.event) {
    case 'PAYMENT_CONFIRMED':
    case 'PAYMENT_RECEIVED': {
      const fim = fimDoPeriodo(pag.dueDate || dataISO(new Date()), PLANOS[conta.plano]);
      if (!conta.pagoAte || conta.pagoAte < fim) conta.pagoAte = fim;
      if (conta.status !== 'cortesia') conta.status = 'ativa';
      conta.set('asaas.ultimoPagamentoId', pag.id);
      conta.set('asaas.linkPagamento', undefined);
      break;
    }
    case 'PAYMENT_OVERDUE':
      if (['ativa', 'pendente', 'teste'].includes(conta.status)) conta.status = 'inadimplente';
      if (!conta.pagoAte && conta.testeAte) conta.pagoAte = conta.testeAte;
      conta.set('asaas.linkPagamento', pag.invoiceUrl);
      break;
    case 'PAYMENT_REFUNDED':
    case 'PAYMENT_CHARGEBACK_REQUESTED':
      if (conta.status === 'ativa') conta.status = 'inadimplente';
      break;
    case 'PAYMENT_CREATED':
      if (pag.invoiceUrl) conta.set('asaas.linkPagamento', pag.invoiceUrl);
      break;
    case 'SUBSCRIPTION_DELETED':
    case 'SUBSCRIPTION_INACTIVATED':
      if (conta.status !== 'cortesia') conta.status = 'cancelada';
      conta.set('asaas.subscriptionId', undefined);
      break;
    default:
      return `ignorado:${corpo.event}`;
  }
  await conta.save();
  return `${corpo.event}:${conta.status}`;
}
