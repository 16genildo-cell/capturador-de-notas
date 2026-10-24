/** Utilitarios para CPF/CNPJ (contribuinte pessoa fisica ou juridica). */

export function soDigitos(v) {
  return String(v ?? '').replace(/\D/g, '');
}

/** 'PF' para CPF (11 digitos), 'PJ' para CNPJ (14 digitos), '' se nenhum dos dois. */
export function tipoPessoa(doc) {
  const d = soDigitos(doc);
  if (d.length === 11) return 'PF';
  if (d.length === 14) return 'PJ';
  return '';
}

export function validarCPF(cpf) {
  const d = soDigitos(cpf);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  for (const t of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < t; i += 1) soma += Number(d[i]) * (t + 1 - i);
    const dv = ((soma * 10) % 11) % 10;
    if (dv !== Number(d[t])) return false;
  }
  return true;
}

export function validarCNPJ(cnpj) {
  const d = soDigitos(cnpj);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const calc = (base) => {
    const pesos = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const soma = pesos.reduce((acc, p, i) => acc + Number(base[i]) * p, 0);
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(d.slice(0, 12)) === Number(d[12]) && calc(d.slice(0, 13)) === Number(d[13]);
}

/** Valida e normaliza um CPF/CNPJ; lanca erro com mensagem amigavel se invalido. */
export function normalizarDocumento(doc) {
  const d = soDigitos(doc);
  if (d.length === 11) {
    if (!validarCPF(d)) throw new Error(`CPF invalido: ${doc}`);
    return d;
  }
  if (d.length === 14) {
    if (!validarCNPJ(d)) throw new Error(`CNPJ invalido: ${doc}`);
    return d;
  }
  throw new Error('Informe um CNPJ (14 digitos) ou um CPF (11 digitos).');
}

export function formatarDocumento(doc) {
  const d = soDigitos(doc);
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  if (d.length === 14) {
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  }
  return d;
}

/** Tag XML do interessado nos web services da SEFAZ: <CPF>...</CPF> ou <CNPJ>...</CNPJ>. */
export function tagDocumento(doc) {
  const d = soDigitos(doc);
  return tipoPessoa(d) === 'PF' ? `<CPF>${d}</CPF>` : `<CNPJ>${d}</CNPJ>`;
}
