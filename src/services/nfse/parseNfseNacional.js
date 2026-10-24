import { xmlToObj } from '../sefaz/parseDocumento.js';
import { soDigitos } from '../../utils/documento.js';

/**
 * Interpreta os documentos do padrao nacional da NFS-e (leiaute SPED/NFS-e nacional):
 *  - NFSe  > infNFSe (nota)          -> { tipo: 'nfse', ... }
 *  - evento > infEvento (ex.: cancelamento 101101) -> { tipo: 'evento', ... }
 */

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function data(v) {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function docDe(pessoa) {
  if (!pessoa) return '';
  return String(pessoa.CNPJ || pessoa.CPF || pessoa.NIF || '');
}

/** Procura recursivamente a primeira chave cujo nome comeca com o prefixo. */
function acharChave(obj, prefixo) {
  if (!obj || typeof obj !== 'object') return null;
  for (const k of Object.keys(obj)) {
    if (k.startsWith(prefixo)) return k;
    const sub = acharChave(obj[k], prefixo);
    if (sub) return sub;
  }
  return null;
}

export function resumirNfseNacional(xml, docContribuinte) {
  const obj = xmlToObj(xml);
  const meu = soDigitos(docContribuinte);

  const inf = obj?.NFSe?.infNFSe;
  if (inf) {
    const dps = inf.DPS?.infDPS || {};
    const prest = inf.emit || dps.prest || {};
    const toma = dps.toma || {};
    const docPrest = docDe(prest);
    const docToma = docDe(toma);
    const chave = String(inf['@_Id'] || '').replace(/^NFS/, '');

    let papel = 'desconhecido';
    if (meu && soDigitos(docPrest) === meu) papel = 'emitente';
    else if (meu && soDigitos(docToma) === meu) papel = 'destinatario';
    else if (meu && soDigitos(docDe(dps.interm)) === meu) papel = 'destinatario';

    return {
      tipo: 'nfse',
      xml,
      resumo: false,
      chave,
      numero: String(inf.nNFSe || ''),
      serie: String(dps.serie || ''),
      emitenteCnpjCpf: docPrest,
      emitenteNome: String(prest.xNome || ''),
      destinatarioCnpjCpf: docToma,
      destinatarioNome: String(toma.xNome || ''),
      valorTotal: num(dps.valores?.vServPrest?.vServ ?? inf.valores?.vLiq),
      dataEmissao: data(dps.dhEmi || inf.dhProc),
      papel,
      origem: 'nfse-nacional',
    };
  }

  const ev = obj?.evento?.infEvento;
  if (ev) {
    const ped = ev.pedRegEvento?.infPedReg || {};
    const tagEvento = acharChave(ped, 'e') || '';
    const tpEvento = (tagEvento.match(/^e(\d{6})$/) || [])[1] || '';
    return {
      tipo: 'evento',
      xml,
      resumo: false,
      chaveNota: String(ped.chNFSe || ''),
      numero: tpEvento,
      tpEvento,
      dataEmissao: data(ev.dhProc || ped.dhEvento),
      origem: 'nfse-nacional',
    };
  }

  return { tipo: 'evento', xml, resumo: false, origem: 'nfse-nacional' };
}

/** Codigos de evento da NFS-e nacional que cancelam a nota. */
export const EVENTOS_CANCELAMENTO_NFSE = new Set(['101101', '105102']);
