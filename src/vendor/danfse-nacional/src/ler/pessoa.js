/**
 * Blocos de pessoa do DANFSe (prestador, tomador, destinatário, intermediário) — NT 008, itens 2.1.3 a 2.1.6.
 * Recebe o leitor do grupo no XML (prest, toma, interm, IBSCBS/dest) e devolve os textos prontos.
 */
const f = require('../formatar');
const { municipio } = require('../dados/municipios');

function documento(P) {
  if (P('CNPJ')) return f.cnpj(P('CNPJ'));
  if (P('CPF')) return f.cpf(P('CPF'));
  if (P('NIF')) return P('NIF');
  return f.VAZIO;
}

/** Endereço nacional (end/endNac) ou exterior (end/endExt). */
function local(P) {
  const nac = P.no('end/endNac');
  if (nac) {
    const m = municipio(nac('cMun'));
    return {
      municipio: f.juntar([m && m.nome, m && m.uf]),
      codigoCep: f.juntar([nac('cMun') && f.ibge(nac('cMun')), nac('CEP') && f.cep(nac('CEP'))]),
    };
  }
  const ext = P.no('end/endExt');
  if (ext) {
    return {
      municipio: f.juntar([ext('xCidade'), ext('xEstProvReg'), ext('cPais')]),
      codigoCep: f.juntar([ext('cPais'), ext('cEndPost')]),
    };
  }
  return { municipio: f.VAZIO, codigoCep: f.VAZIO };
}

const endereco = P => f.juntar([P('end/xLgr'), P('end/nro'), P('end/xCpl'), P('end/xBairro')], ', ');

/** Grupo ausente → null (o bloco sai como "NÃO IDENTIFICADO NA NFS-e"). */
function pessoa(P) {
  if (!P) return null;
  return {
    documento: documento(P),
    inscricaoMunicipal: f.ou(P('IM')),
    telefone: f.telefone(P('fone')),
    nome: f.limitar(f.ou(P('xNome')), 77),
    ...local(P),
    endereco: f.limitar(endereco(P), 77),
    email: f.ou(P('email')),
  };
}

/**
 * Prestador: o DPS muitas vezes traz só CNPJ/fone/email (o Emissor Nacional não repete nome e endereço),
 * e o grupo infNFSe/emit tem o cadastro. Quando o emitente é o próprio prestador, completa pelo emit.
 */
function prestador(PR, EM, prestadorEmitiu) {
  const base = pessoa(PR);
  if (!EM || !prestadorEmitiu) return base;
  const traco = v => !v || v === f.VAZIO;
  const m = municipio(EM('enderNac/cMun'));
  const doEmit = {
    documento: EM('CNPJ') ? f.cnpj(EM('CNPJ')) : f.cpf(EM('CPF')),
    inscricaoMunicipal: f.ou(EM('IM')),
    telefone: f.telefone(EM('fone')),
    nome: f.limitar(f.ou(EM('xNome')), 77),
    municipio: f.juntar([m ? m.nome : null, EM('enderNac/UF')]),
    codigoCep: f.juntar([EM('enderNac/cMun') && f.ibge(EM('enderNac/cMun')), EM('enderNac/CEP') && f.cep(EM('enderNac/CEP'))]),
    endereco: f.limitar(f.juntar([EM('enderNac/xLgr'), EM('enderNac/nro'), EM('enderNac/xCpl'), EM('enderNac/xBairro')], ', '), 77),
    email: f.ou(EM('email')),
  };
  const final = { ...doEmit };
  if (base) for (const [k, v] of Object.entries(base)) if (!traco(v)) final[k] = v;
  return final;
}

module.exports = { pessoa, prestador };
