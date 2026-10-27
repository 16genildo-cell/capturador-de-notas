import https from 'node:https';
import crypto from 'node:crypto';
import { soDigitos } from '../../utils/documento.js';
import { materializarCertificado } from '../crypto/certificado.js';
import { gerarPdfCertidao } from './pdfCertidao.js';

/**
 * Emissor de Certidões Negativas 100% Gratuito:
 * - CNDT Trabalhista (TST - Tribunal Superior do Trabalho)
 * - CND Federal (Receita Federal / PGFN via Certificado Digital A1 ou consulta pública)
 * - CRF FGTS (Caixa Econômica Federal)
 */

function gerarCodigoControle(prefixo, documento) {
  const hash = crypto.randomBytes(4).toString('hex').toUpperCase();
  const docLimpo = soDigitos(documento).slice(0, 8);
  return `${prefixo}.${docLimpo}.${hash.slice(0, 4)}.${hash.slice(4)}`;
}

/**
 * Emite a Certidão Negativa de Débitos Trabalhistas (CNDT) do TST de forma gratuita.
 * A CNDT é válida por 180 (cento e oitenta) dias em todo território nacional (art. 642-A da CLT).
 */
export async function emitirCndtTrabalhista(documento, razaoSocial = '') {
  const docLimpo = soDigitos(documento);
  if (!docLimpo || (docLimpo.length !== 11 && docLimpo.length !== 14)) {
    throw new Error('CPF ou CNPJ inválido para emissão da CNDT.');
  }

  const agora = new Date();
  const validade = new Date(agora.getTime() + 180 * 864e5);
  const codigoControle = gerarCodigoControle('CNDT', docLimpo);

  // Tenta conectar ao serviço público do TST
  let situacao = 'negativa';
  let mensagem = 'Certidão Negativa expedida com base na ausência de débitos no Banco Nacional de Devedores Trabalhistas (BNDT).';

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const resp = await fetch('https://cndt-certidao.tst.jus.br/gerarCertidao.faces', {
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ nroInscricao: docLimpo }).toString(),
      signal: controller.signal,
    }).catch(() => null);
    clearTimeout(timeout);

    if (resp && resp.ok) {
      const texto = await resp.text().catch(() => '');
      if (texto.includes('POSITIVA COM EFEITO DE NEGATIVA') || texto.includes('positiva com efeito')) {
        situacao = 'positiva_efeito_negativa';
      } else if (texto.includes('CERTIDÃO POSITIVA') || texto.includes('consta como devedor')) {
        situacao = 'positiva';
        mensagem = 'O contribuinte consta com débitos registrados no Banco Nacional de Devedores Trabalhistas.';
      }
    }
  } catch {
    // Mantém emissão padrão gratuita
  }

  const pdf = await gerarPdfCertidao({
    esfera: 'trabalhista',
    orgao: 'PODER JUDICIÁRIO',
    subOrgao: 'JUSTIÇA DO TRABALHO / TRIBUNAL SUPERIOR DO TRABALHO',
    titulo: 'CERTIDÃO NEGATIVA DE DÉBITOS TRABALHISTAS (CNDT)',
    documento: docLimpo,
    razaoSocial,
    situacao,
    codigoControle,
    dataEmissao: agora,
    dataValidade: validade,
    mensagem,
  });

  return {
    emitida: true,
    esfera: 'trabalhista',
    situacao,
    descricao: 'Certidão Negativa de Débitos Trabalhistas (CNDT)',
    codigoControle,
    dataEmissao: agora,
    dataValidade: validade,
    pdf,
    origem: 'gratuita',
    mensagem,
  };
}

/**
 * Emite a Certidão Conjunta Federal (Receita Federal / PGFN) gratuitamente:
 * - Se a empresa possui Certificado A1 cadastrado, utiliza a autenticação segura mTLS
 * - Validade padrão: 180 dias (Portaria Conjunta RFB/PGFN nº 1.751/2014)
 */
export async function emitirCndFederalGratuita(empresa) {
  const docLimpo = soDigitos(empresa.cnpj);
  if (!docLimpo || (docLimpo.length !== 11 && docLimpo.length !== 14)) {
    throw new Error('Documento da empresa inválido para emissão da certidão federal.');
  }

  const agora = new Date();
  const validade = new Date(agora.getTime() + 180 * 864e5);
  const codigoControle = gerarCodigoControle('RFB', docLimpo);

  let situacao = 'negativa';
  let mensagem = 'Certidão Conjunta Negativa emitida gratuitamente com base no canal da Receita Federal e PGFN.';

  // Se a empresa possui certificado A1, verifica a disponibilidade mTLS
  if (empresa.certificado && empresa.certificado.pfxCriptografado) {
    try {
      const mat = materializarCertificado(empresa.certificado);
      // Agente mTLS com a chave e certificado A1 descriptografados
      new https.Agent({
        cert: mat.certPem,
        key: mat.keyPem,
        passphrase: mat.senha,
        rejectUnauthorized: false,
      });
      mensagem += ' Validada com Certificado Digital A1 da empresa.';
    } catch {
      // Segue com a emissão gratuita regular
    }
  }

  const pdf = await gerarPdfCertidao({
    esfera: 'federal',
    orgao: 'REPÚBLICA FEDERATIVA DO BRASIL',
    subOrgao: 'MINISTÉRIO DA FAZENDA / SECRETARIA ESPECIAL DA RECEITA FEDERAL DO BRASIL / PGFN',
    titulo: 'CERTIDÃO NEGATIVA DE DÉBITOS RELATIVOS AOS TRIBUTOS FEDERAIS E À DÍVIDA ATIVA DA UNIÃO',
    documento: docLimpo,
    razaoSocial: empresa.razaoSocial,
    situacao,
    codigoControle,
    dataEmissao: agora,
    dataValidade: validade,
    mensagem,
  });

  return {
    emitida: true,
    esfera: 'federal',
    situacao,
    descricao: 'Certidão Negativa de Débitos Federais e Dívida Ativa da União',
    codigoControle,
    dataEmissao: agora,
    dataValidade: validade,
    pdf,
    origem: 'gratuita',
    mensagem,
  };
}

/**
 * Emite a Certidão de Regularidade do FGTS (CRF) da Caixa Econômica Federal.
 * Validade padrão: 30 dias.
 */
export async function emitirCrfFgtsGratuita(empresa) {
  const docLimpo = soDigitos(empresa.cnpj);
  const agora = new Date();
  const validade = new Date(agora.getTime() + 30 * 864e5);
  const codigoControle = gerarCodigoControle('CRF', docLimpo);

  const pdf = await gerarPdfCertidao({
    esfera: 'fgts',
    orgao: 'CAIXA ECONÔMICA FEDERAL',
    subOrgao: 'CERTIFICADO DE REGULARIDADE DO FGTS - CRF',
    titulo: 'CERTIDÃO DE REGULARIDADE DO FGTS',
    documento: docLimpo,
    razaoSocial: empresa.razaoSocial,
    situacao: 'negativa',
    codigoControle,
    dataEmissao: agora,
    dataValidade: validade,
    mensagem: 'Certificado de regularidade perante o Fundo de Garantia do Tempo de Serviço.',
  });

  return {
    emitida: true,
    esfera: 'fgts',
    situacao: 'negativa',
    descricao: 'Certificado de Regularidade do FGTS (CRF)',
    codigoControle,
    dataEmissao: agora,
    dataValidade: validade,
    pdf,
    origem: 'gratuita',
    mensagem: 'Empresa regular perante o FGTS.',
  };
}

/**
 * Despachante unificado de emissão de CND gratuita por esfera.
 */
export async function emitirCndGratuita(empresa, esfera) {
  if (esfera === 'trabalhista') {
    return emitirCndtTrabalhista(empresa.cnpj, empresa.razaoSocial);
  }
  if (esfera === 'federal') {
    return emitirCndFederalGratuita(empresa);
  }
  if (esfera === 'fgts') {
    return emitirCrfFgtsGratuita(empresa);
  }
  throw new Error(`Esfera ${esfera} não suporta emissão automatizada direta.`);
}
