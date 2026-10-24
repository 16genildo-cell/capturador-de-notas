import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  // Mantem TODOS os valores como string: chaves de acesso, CNPJ e NSU sao
  // numeros longos que, convertidos para Number, perderiam precisao.
  parseTagValue: false,
  parseAttributeValue: false,
});

/** Converte um XML (string) em objeto JS. */
export function xmlToObj(xml) {
  return parser.parse(xml);
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * A partir do XML de um documento vindo da Distribuicao DF-e, extrai o resumo
 * para indexar no dashboard e identifica o tipo. Suporta:
 *  - nfeProc / NFe (documento completo)
 *  - resNFe (resumo da NF-e)
 *  - resEvento / procEventoNFe (eventos)
 */
export function resumirDocumento(xml, cnpjEmpresa) {
  const obj = xmlToObj(xml);
  const base = { xml, resumo: false, tipo: 'nfe', papel: 'desconhecido' };

  // Documento completo de NF-e
  const nfe = obj?.nfeProc?.NFe || obj?.NFe;
  if (nfe) {
    const inf = nfe.infNFe || {};
    const ide = inf.ide || {};
    const emit = inf.emit || {};
    const dest = inf.dest || {};
    const total = inf.total?.ICMSTot || {};
    const chave = (inf['@_Id'] || '').replace(/^NFe/, '');
    const modelo = String(ide.mod || '55');
    return {
      ...base,
      tipo: modelo === '65' ? 'nfce' : 'nfe',
      chave,
      modelo,
      numero: String(ide.nNF || ''),
      serie: String(ide.serie || ''),
      emitenteCnpjCpf: emit.CNPJ || emit.CPF || '',
      emitenteNome: emit.xNome || '',
      destinatarioCnpjCpf: dest.CNPJ || dest.CPF || '',
      destinatarioNome: dest.xNome || '',
      valorTotal: num(total.vNF),
      dataEmissao: parseData(ide.dhEmi || ide.dEmi),
      papel: definirPapel(cnpjEmpresa, emit.CNPJ || emit.CPF, dest.CNPJ || dest.CPF),
    };
  }

  // Resumo da NF-e (resNFe) - quando ainda nao ha direito ao XML completo
  const res = obj?.resNFe;
  if (res) {
    return {
      ...base,
      resumo: true,
      tipo: 'nfe',
      chave: String(res.chNFe || ''),
      emitenteCnpjCpf: res.CNPJ || res.CPF || '',
      emitenteNome: res.xNome || '',
      valorTotal: num(res.vNF),
      dataEmissao: parseData(res.dhEmi),
      situacaoManifestacao: 'pendente',
      papel: 'destinatario',
    };
  }

  // Evento (resumo ou processado)
  const resEv = obj?.resEvento;
  const procEv = obj?.procEventoNFe?.evento?.infEvento || obj?.procEventoNFe?.evento;
  if (resEv || procEv) {
    const ev = resEv || procEv || {};
    // Eventos usam "chaveNota" (e nao "chave") para nao colidir com a propria nota:
    // a mesma chave pode ter a nota e varios eventos (ciencia, cancelamento, CC-e...).
    return {
      ...base,
      tipo: 'evento',
      resumo: Boolean(resEv),
      chaveNota: String(ev.chNFe || ''),
      numero: String(ev.tpEvento || ''),
      tpEvento: String(ev.tpEvento || ''),
      emitenteCnpjCpf: ev.CNPJ || ev.CPF || '',
      dataEmissao: parseData(ev.dhEvento || ev.dhRecbto),
    };
  }

  // Desconhecido: guarda o XML cru mesmo assim
  return base;
}

function soDigitos(v) {
  return String(v ?? '').replace(/\D/g, '');
}

function definirPapel(cnpjEmpresa, emit, dest) {
  const e = soDigitos(cnpjEmpresa);
  if (e && soDigitos(emit) === e) return 'emitente';
  if (e && soDigitos(dest) === e) return 'destinatario';
  return 'desconhecido';
}

function parseData(v) {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}
