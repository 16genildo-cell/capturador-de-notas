/**
 * Nome e UF do município pelo código IBGE de 7 dígitos.
 * municipios.json é gerado por scripts/gerar-municipios.js (API oficial do IBGE) — nunca editar à mão.
 * A UF sai dos 2 primeiros dígitos do código (código da UF no IBGE).
 */
const NOMES = require('./municipios.json');

const UF_POR_CODIGO = {
  11: 'RO', 12: 'AC', 13: 'AM', 14: 'RR', 15: 'PA', 16: 'AP', 17: 'TO',
  21: 'MA', 22: 'PI', 23: 'CE', 24: 'RN', 25: 'PB', 26: 'PE', 27: 'AL', 28: 'SE', 29: 'BA',
  31: 'MG', 32: 'ES', 33: 'RJ', 35: 'SP',
  41: 'PR', 42: 'SC', 43: 'RS',
  50: 'MS', 51: 'MT', 52: 'GO', 53: 'DF',
};

/** '4205407' → { nome: 'Florianópolis', uf: 'SC' }; código desconhecido → null. */
function municipio(codigo) {
  const cod = String(codigo || '').trim();
  if (!/^\d{7}$/.test(cod)) return null;
  const uf = UF_POR_CODIGO[cod.slice(0, 2)] || null;
  const nome = NOMES[cod] || null;
  return nome || uf ? { nome, uf } : null;
}

module.exports = { municipio, UF_POR_CODIGO };
