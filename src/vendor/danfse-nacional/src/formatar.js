/**
 * Formatação dos conteúdos do DANFSe (máscaras da NT 008, item 2.4.5). Tudo PURO.
 * Campo sem informação no XML vira traço (NT 008, nota 12) — quem decide é `ou()`.
 */
const VAZIO = '-';

const temValor = v => v != null && String(v).trim() !== '';
const ou = (v, alt = VAZIO) => (temValor(v) ? String(v) : alt);
const digitos = v => String(v || '').replace(/\D/g, '');

/** nn.nnn.nnn/nnnn-nn */
function cnpj(v) {
  const d = digitos(v);
  return d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : ou(v);
}

/** nnn.nnn.nnn-nn */
function cpf(v) {
  const d = digitos(v);
  return d.length === 11 ? d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4') : ou(v);
}

/** nn.nnn-nnn */
function cep(v) {
  const d = digitos(v);
  return d.length === 8 ? d.replace(/^(\d{2})(\d{3})(\d{3})$/, '$1.$2-$3') : ou(v);
}

/** (dd) nnnn-nnnn ou (dd) nnnnn-nnnn; outro formato sai como veio. */
function telefone(v) {
  const d = digitos(v);
  if (d.length === 10) return d.replace(/^(\d{2})(\d{4})(\d{4})$/, '($1) $2-$3');
  if (d.length === 11) return d.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3');
  return ou(v);
}

/** Número decimal do XML ('1234.5') → '1.234,50'. Sem valor → null (quem chama decide o traço). */
function decimal(v, casas = 2) {
  if (!temValor(v)) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return n.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

const reais = v => (temValor(v) ? `R$ ${decimal(v)}` : VAZIO);
const percentual = v => (temValor(v) ? `${decimal(v)}%` : VAZIO);

/** '2026-09-09' ou '2026-09-09T14:46:31-03:00' → '09/09/2026'. Não converte fuso: vale o que está no XML. */
function data(v) {
  const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ou(v);
}

/** '2026-09-09T14:46:31-03:00' → '09/09/2026 14:46:31' (hora local do XML). */
function dataHora(v) {
  const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}:${m[6]}` : ou(v);
}

/** Código de tributação nacional '171901' → '17.19.01'. */
function codTribNac(v) {
  const d = digitos(v);
  return d.length === 6 ? d.replace(/^(\d{2})(\d{2})(\d{2})$/, '$1.$2.$3') : ou(v);
}

/** NBS '113022100' → '1.1302.21.00'. */
function nbs(v) {
  const d = digitos(v);
  return d.length === 9 ? d.replace(/^(\d)(\d{4})(\d{2})(\d{2})$/, '$1.$2.$3.$4') : ou(v);
}

/** Código IBGE '3550308' → '35.50308' (como o DANFSe do portal nacional). */
function ibge(v) {
  const d = digitos(v);
  return d.length === 7 ? `${d.slice(0, 2)}.${d.slice(2)}` : ou(v);
}

/**
 * Limite de caracteres da NT 008 (coluna "Tam. do Campo", item 2.4.5): passou, corta EXATAMENTE em `n`
 * caracteres e acrescenta "..." — igual ao DANFSe do portal nacional. Traço e vazio passam direto.
 */
const limitar = (v, n) => (temValor(v) && String(v).length > n ? String(v).slice(0, n) + '...' : v);

/** Descrição de um código pela tabela do leiaute; código fora da tabela sai como veio. */
const descricao = (tabela, codigo) => (temValor(codigo) ? tabela[codigo] || String(codigo) : VAZIO);

/** Junta partes com o separador, ignorando as vazias; nada preenchido → traço. */
function juntar(partes, sep = ' / ') {
  const cheias = partes.filter(temValor).map(String);
  return cheias.length ? cheias.join(sep) : VAZIO;
}

/** Junta TODAS as partes, com traço no lugar das vazias: '17.19.01 / -' (como o portal nacional). */
const compor = (partes, sep = ' / ') => partes.map(p => ou(p)).join(sep);

module.exports = {
  VAZIO, temValor, ou, digitos, cnpj, cpf, cep, telefone, decimal, reais, percentual,
  data, dataHora, codTribNac, nbs, ibge, descricao, juntar, compor, limitar,
};
