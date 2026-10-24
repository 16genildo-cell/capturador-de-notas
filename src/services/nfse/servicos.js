import { ServicoNfse } from '../../models/ServicoNfse.js';
import { emitirNfse, validarDados, dataHoraBrasilia } from './emissao.js';
import { soDigitos } from '../../utils/documento.js';

const MESES = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** Troca {mes}, {ano} e {competencia} pela competencia (AAAA-MM-DD) da emissao. */
export function preencherModelo(texto, competencia) {
  const [ano, mes] = String(competencia).split('-');
  return String(texto || '')
    .replace(/\{mes\}/gi, MESES[Number(mes) - 1] || '')
    .replace(/\{ano\}/gi, ano || '')
    .replace(/\{competencia\}/gi, mes && ano ? `${mes}/${ano}` : '');
}

/** Converte o formulario de cadastro em documento do servico. */
export function servicoDoFormulario(b) {
  const numero = (v) => {
    const s = String(v ?? '').trim();
    if (!s) return null;
    const n = Number(s.replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : NaN;
  };
  return {
    nome: String(b.nome || '').trim(),
    ativo: b.ativo !== 'off',
    cTribNac: soDigitos(b.cTribNac),
    cNBS: soDigitos(b.cNBS),
    descricao: String(b.descricao || '').trim(),
    valor: numero(b.valor),
    cLocPrestacao: soDigitos(b.cLocPrestacao),
    issRetido: b.issRetido === 'on',
    naoIncidencia: b.naoIncidencia === 'on',
    aliquota: numero(b.aliquota),
    infoComplementar: String(b.infoComplementar || '').trim(),
    tomador: {
      tipo: ['cpf', 'cnpj', 'nenhum', 'perguntar'].includes(b.tomadorTipo) ? b.tomadorTipo : 'perguntar',
      documento: soDigitos(b.tomadorDocumento),
      nome: String(b.tomadorNome || '').trim(),
      email: String(b.tomadorEmail || '').trim(),
      cep: soDigitos(b.tomadorCep),
      cMun: soDigitos(b.tomadorCMun),
      cidade: String(b.tomadorCidade || '').trim(),
      logradouro: String(b.tomadorLogradouro || '').trim(),
      numero: String(b.tomadorNumero || '').trim(),
      complemento: String(b.tomadorComplemento || '').trim(),
      bairro: String(b.tomadorBairro || '').trim(),
    },
  };
}

/** Monta os dados de emissao a partir do servico e do que foi informado na hora. */
export function dadosDaEmissao(servico, extra = {}) {
  const competencia = /^\d{4}-\d{2}-\d{2}$/.test(extra.competencia || '') ? extra.competencia : dataHoraBrasilia().slice(0, 10);
  const t = servico.tomador || {};
  const tomador =
    t.tipo === 'perguntar'
      ? {
          tipo: soDigitos(extra.tomadorDocumento).length === 14 ? 'cnpj' : soDigitos(extra.tomadorDocumento).length === 11 ? 'cpf' : 'nenhum',
          documento: extra.tomadorDocumento,
          nome: extra.tomadorNome,
          email: extra.tomadorEmail,
        }
      : { ...t };
  return {
    tomador,
    cTribNac: servico.cTribNac,
    cNBS: servico.cNBS,
    descricao: preencherModelo(servico.descricao, competencia),
    cLocPrestacao: servico.cLocPrestacao,
    competencia,
    valor: servico.valor > 0 ? servico.valor : extra.valor,
    desconto: 0,
    issRetido: servico.issRetido,
    naoIncidencia: servico.naoIncidencia,
    aliquota: servico.aliquota ?? '',
    infoComplementar: preencherModelo(servico.infoComplementar, competencia),
  };
}

/**
 * Confere se o servico esta completo o bastante para emitir (usa as mesmas regras da emissao,
 * simulando valor e tomador quando eles serao informados na hora). Lanca erro com a lista.
 */
export function validarServico(dados, empresa) {
  const cfg = empresa.emissaoNfse?.toObject?.() || empresa.emissaoNfse || {};
  if (!dados.nome) throw Object.assign(new Error('Informe um nome para o servico.'), { lista: ['Informe um nome para o servico.'] });
  if (Number.isNaN(dados.valor) || (dados.valor !== null && dados.valor <= 0)) {
    throw Object.assign(new Error('Valor invalido.'), { lista: ['Valor invalido (deixe vazio para informar na hora).'] });
  }
  const simulado = dadosDaEmissao(
    { ...dados, tomador: dados.tomador.tipo === 'perguntar' ? { tipo: 'nenhum' } : dados.tomador, valor: dados.valor ?? 1 },
    {},
  );
  validarDados(simulado, cfg, empresa);
}

/** Emite a NFS-e de um servico cadastrado. */
export async function emitirServico(servicoId, owner, extra, { usuarioId, empresa } = {}) {
  const servico = await ServicoNfse.findOne({ _id: servicoId, owner, ...(empresa ? { empresa } : {}) });
  if (!servico) throw new Error('Servico nao encontrado.');
  if (!servico.ativo) throw new Error('Este servico esta desativado.');
  if (servico.tomador?.tipo === 'perguntar' && !soDigitos(extra.tomadorDocumento) && extra.semTomador !== 'on') {
    throw new Error('Informe o CPF/CNPJ do cliente (ou marque "sem tomador").');
  }
  const docInformado = soDigitos(extra.tomadorDocumento);
  if (servico.tomador?.tipo === 'perguntar' && docInformado && ![11, 14].includes(docInformado.length)) {
    throw new Error('CPF/CNPJ do cliente invalido: informe 11 (CPF) ou 14 (CNPJ) digitos.');
  }
  const dados = dadosDaEmissao(servico.toObject(), extra);
  const emissao = await emitirNfse(servico.empresa, dados, { usuarioId });
  if (emissao.status === 'autorizada') {
    await ServicoNfse.updateOne({ _id: servico._id }, { ultimaEmissao: new Date(), $inc: { totalEmitidas: 1 } });
  }
  return emissao;
}
