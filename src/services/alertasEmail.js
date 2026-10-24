import { NotaFiscal } from '../models/NotaFiscal.js';
import { Certificado } from '../models/Certificado.js';
import { enviarEmail, montarHtml, emailConfigurado } from './email.js';
import { prazoManifestacao } from './sefaz/manifestacao.js';
import { destinatariosDaConta } from './contas.js';
import { Conta } from '../models/Conta.js';
import { contasLiberadas } from './capturaService.js';
import { env } from '../config/env.js';
import { enviarPushConta, pushConfigurado } from './push.js';

const brl = (v) => (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBR = (d) => new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
const nome = () => env.saas.nomeProduto;

/** Agrupa uma lista por conta (campo owner). */
function porConta(lista) {
  const mapa = new Map();
  for (const item of lista) {
    const k = String(item.owner);
    if (!mapa.has(k)) mapa.set(k, []);
    mapa.get(k).push(item);
  }
  return mapa;
}

/** Avisa a conta por e-mail e, se houver app instalado, por notificacao push. */
async function enviarParaConta(owner, assunto, html, push) {
  const conta = await Conta.findById(owner);
  if (conta?.temRecurso && !conta.temRecurso('alertas')) return false;
  let ok = false;
  if (push) {
    ok = (await enviarPushConta(owner, push).catch((err) => console.error('[push]', err.message))) > 0;
  }
  if (emailConfigurado()) {
    const para = await destinatariosDaConta(owner);
    if (para.length) ok = (await enviarEmail({ assunto, html, para })) || ok;
  }
  return ok;
}

/**
 * Alerta diario por conta: certificados vencendo (aviso em 30, 15, 7, 3, 1 e 0 dias;
 * vencidos as segundas) e NF-e recebidas cujo prazo de manifestacao termina em ate 15 dias.
 */
export async function alertaDiario() {
  if (!emailConfigurado() && !pushConfigurado()) return 0;
  const agora = Date.now();
  const marcos = new Set([30, 15, 7, 3, 1, 0]);
  const segunda = new Date().getDay() === 1;

  const certs = await Certificado.find({ ativo: true, validoAte: { $lt: new Date(agora + 31 * 864e5) } }).lean();
  const limite = new Date(agora - (180 - 15) * 864e5); // emitidas ha mais de 165 dias
  const pendentes = await NotaFiscal.find({
    tipo: 'nfe',
    papel: 'destinatario',
    cancelada: { $ne: true },
    situacaoManifestacao: { $in: ['pendente', 'ciencia'] },
    dataEmissao: { $lte: limite, $gte: new Date(agora - 180 * 864e5) },
  })
    .select('owner numero emitenteNome valorTotal dataEmissao')
    .limit(2000)
    .lean();

  const certsPorConta = porConta(certs);
  const notasPorConta = porConta(pendentes);
  const contas = [...new Set([...certsPorConta.keys(), ...notasPorConta.keys()])];
  const liberadas = await contasLiberadas(contas);

  let enviados = 0;
  for (const owner of contas) {
    if (!liberadas.has(owner)) continue;
    const itensCert = [];
    for (const c of certsPorConta.get(owner) || []) {
      const dias = Math.ceil((new Date(c.validoAte).getTime() - agora) / 864e5);
      if (dias < 0 && segunda) itensCert.push(`${c.apelido}: VENCIDO desde ${dataBR(c.validoAte)} - a captura está parada`);
      else if (marcos.has(dias)) itensCert.push(`${c.apelido}: vence em ${dias} dia(s) (${dataBR(c.validoAte)})`);
    }
    const itensPrazo = (notasPorConta.get(owner) || []).slice(0, 100).map(
      (n) => `NF-e ${n.numero || ''} - ${n.emitenteNome || ''} (${brl(n.valorTotal)}): prazo até ${dataBR(prazoManifestacao(n.dataEmissao))}`,
    );
    if (!itensCert.length && !itensPrazo.length) continue;
    const html = montarHtml(`Atenção: prazos do ${nome()}`, [
      { titulo: 'Certificados digitais', itens: itensCert },
      { titulo: 'NF-e aguardando manifestação (prazo terminando)', itens: itensPrazo },
    ], `${nome()} - ${env.appUrl}`);
    try {
      const push = {
        titulo: itensCert.length ? 'Certificado digital vencendo' : 'Prazo de manifestação',
        texto: (itensCert[0] || itensPrazo[0]) + (itensCert.length + itensPrazo.length > 1 ? ` (+${itensCert.length + itensPrazo.length - 1})` : ''),
        dados: { tela: itensCert.length ? 'certificados' : 'notas' },
      };
      if (await enviarParaConta(owner, `${nome()}: certificados e prazos`, html, push)) enviados += 1;
    } catch (err) {
      console.error(`[email] alerta diario conta ${owner}:`, err.message);
    }
  }
  return enviados;
}
