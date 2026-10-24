/**
 * Conteúdo de cada bloco de grade do Anexo I da NT 008, na ordem do modelo.
 * Cada função devolve { titulo, linhas } ou { resumo } (bloco suprimido) — o desenho fica em grade.js.
 */
const { c } = require('./grade');

function pessoa(titulo, p, { inscricao = true } = {}) {
  return {
    titulo,
    linhas: [
      [c(1, 'CNPJ / CPF / NIF', p.documento), inscricao ? c(2, 'Indicador Municipal (Inscrição)', p.inscricaoMunicipal) : null, c(3, 'Telefone', p.telefone)].filter(Boolean),
      [c(0, 'Nome / Nome Empresarial', p.nome, 2), c(2, 'Município / Sigla UF', p.municipio), c(3, 'Código IBGE / CEP', p.codigoCep)],
      [c(0, 'Endereço', p.endereco, 2), c(2, 'E-mail', p.email, 2)],
    ],
  };
}

function prestador(nota) {
  const b = pessoa('Prestador / Fornecedor', nota.prestador);
  b.linhas.push([
    c(0, 'Simples Nacional na Data de Competência', nota.prestadorSimples.situacao),
    c(1, 'Regime de Apuração Tributária pelo SN', nota.prestadorSimples.regimeApuracao, 3),
  ]);
  return b;
}

const tomador = nota => (nota.tomador
  ? pessoa('Tomador / Adquirente', nota.tomador)
  : { resumo: 'TOMADOR/ADQUIRENTE DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e' });

function destinatario(nota) {
  if (nota.destinatario) return pessoa('Destinatário da Operação', nota.destinatario, { inscricao: false });
  if (nota.destinatarioEhTomador) return { resumo: 'O DESTINATÁRIO É O PRÓPRIO TOMADOR/ADQUIRENTE DA OPERAÇÃO' };
  return { resumo: 'DESTINATÁRIO DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e' };
}

const intermediario = nota => (nota.intermediario
  ? pessoa('Intermediário da Operação', nota.intermediario)
  : { resumo: 'INTERMEDIÁRIO DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e' });

function issqn(nota) {
  const t = nota.issqn;
  if (!t.sujeito) return { resumo: 'TRIBUTAÇÃO MUNICIPAL (ISSQN) - OPERAÇÃO NÃO SUJEITA AO ISSQN' };
  const linhas = [[c(1, 'Tipo de Tributação do ISSQN', t.tipoTributacao), c(2, 'Município / Sigla UF / País de Incidência do ISSQN', t.municipioIncidencia, 2)]];
  if (!t.linhaRegimeVazia) {
    linhas.push([c(0, 'Regime Especial de Tributação do ISSQN', t.regimeEspecial), c(1, 'Tipo de Imunidade do ISSQN', t.imunidade),
      c(2, 'Suspensão da Exigibilidade do ISSQN', t.suspensao), c(3, 'Número Processo Suspensão', t.processo)]);
  }
  if (!t.linhaBeneficioVazia) {
    linhas.push([c(0, 'Benefício Municipal', t.beneficio), c(1, 'Cálculo do BM', t.calculoBM),
      c(2, 'Total Deduções/Reduções', t.deducoes), c(3, 'Desconto Incondicionado', t.descontoIncond)]);
  }
  linhas.push([c(0, 'BC ISSQN', t.baseCalculo), c(1, 'Alíquota Aplicada', t.aliquota), c(2, 'Retenção do ISSQN', t.retencao), c(3, 'ISSQN Apurado', t.apurado)]);
  return { titulo: 'Tributação Municipal (ISSQN)', linhas };
}

function federal(nota) {
  const t = nota.federal;
  const linhas = [[c(1, 'IRRF', t.irrf), c(2, 'Contribuição Previdenciária - Retida', t.previdenciaria), c(3, 'Contribuições Sociais - Retidas', t.sociaisRetidas)]];
  // Nota 6: a linha de PIS/COFINS só vai para NFS-e com competência até o fim de 2026.
  const ano = nota.identificacao.anoCompetencia;
  if (!ano || ano <= 2026) {
    linhas.push([c(0, 'PIS - Débito Apuração Própria', t.pis), c(1, 'COFINS - Débito Apuração Própria', t.cofins),
      c(2, 'Descrição Contrib. Sociais - Retidas', t.descricaoSociais, 2)]);
  }
  return { titulo: 'Tributação Federal (Exceto CBS)', linhas };
}

function ibscbs(nota) {
  const t = nota.ibscbs;
  return {
    titulo: 'Tributação IBS/CBS',
    linhas: [
      [c(1, 'CST / cClassTrib', t.cstClassTrib), c(2, 'Indicador de Operação / Código IBGE Incidência / Município Incidência / Sigla UF', t.indicadorIncidencia, 2)],
      [c(0, 'Exclusões e Reduções da Base de Cálculo', t.exclusoes), c(1, 'Base de Cálculo Após Exclusões e Reduções', t.baseCalculo),
        c(2, 'Red. Alíquota IBS / Red. Alíquota CBS', t.reducaoAliquotas), c(3, 'Alíquota - IBS UF / IBS Mun', t.aliquotasIBS)],
      [c(0, 'Alíq. Efetiva Municipal - IBS', t.aliqEfetivaMun), c(1, 'Valor Apurado Municipal - IBS', t.valorMun),
        c(2, 'Alíq. Efetiva Estadual - IBS', t.aliqEfetivaUF), c(3, 'Valor Apurado Estadual - IBS', t.valorUF)],
      [c(0, 'Valor Total Apurado - IBS', t.totalIBS), c(1, 'Alíquota - CBS', t.aliquotaCBS),
        c(2, 'Alíquota Efetiva - CBS', t.aliqEfetivaCBS), c(3, 'Valor Total Apurado - CBS', t.totalCBS)],
    ],
  };
}

function valorTotal(nota) {
  const t = nota.totais;
  const destaque = { rotuloGrande: true };
  return {
    titulo: 'Valor Total da NFS-e',
    linhas: [
      [c(1, 'VALOR DA OPERAÇÃO / SERVIÇO', t.valorServico, 1, destaque), c(2, 'Desconto Incondicionado', t.descontoIncond), c(3, 'Desconto Condicionado', t.descontoCond)],
      [c(0, 'Total das Retenções (ISSQN / Federais)', t.totalRetencoes), c(1, 'VALOR LÍQUIDO DA NFS-e', t.valorLiquido, 1, destaque),
        c(2, 'Total do IBS/CBS', t.totalIbsCbs), c(3, 'VALOR LÍQUIDO DA NFS-e + IBS/CBS', t.liquidoMaisIbsCbs, 1, { ...destaque, sombreado: true })],
    ],
  };
}

module.exports = { prestador, tomador, destinatario, intermediario, issqn, federal, ibscbs, valorTotal };
