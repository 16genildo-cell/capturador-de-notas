import { env } from '../../config/env.js';
import { tipoPessoa } from '../../utils/documento.js';

/**
 * Emissao da Certidao Negativa de Debitos FEDERAL (conjunta RFB/PGFN) pela API oficial
 * "Consulta CND" do Serpro (paga por consulta; contratada na Loja Serpro).
 *
 * Credenciais no .env:
 *   SERPRO_CND_CONSUMER_KEY / SERPRO_CND_CONSUMER_SECRET  (do contrato na Loja Serpro)
 *   SERPRO_CND_URL   (opcional) endpoint da API; padrao: gateway de producao
 *
 * Requisicao: { TipoContribuinte, ContribuinteConsulta, CodigoIdentificacao, GerarCertidaoPdf, Chave? }
 * Resposta:   { Status, Mensagem, Chave?, Certidao: { TipoCertidao, CodigoControle, DataEmissao,
 *               DataValidade, DocumentoPdf (base64) } }
 * Status: 1 encontrada, 2 emitida, 3 nao emitida, 4 situacao cadastral impeditiva,
 *         5/6 repetir, 7 consulta demorada (repetir com a Chave), 8+ erros.
 */
const TOKEN_URL = 'https://gateway.apiserpro.serpro.gov.br/token';
const CND_URL_PADRAO = 'https://gateway.apiserpro.serpro.gov.br/consulta-cnd/v1/certidao';

let tokenCache = { valor: null, expira: 0 };

export function serproConfigurado() {
  return Boolean(env.serproCnd.key && env.serproCnd.secret);
}

async function obterToken() {
  if (tokenCache.valor && Date.now() < tokenCache.expira - 60_000) return tokenCache.valor;
  const basic = Buffer.from(`${env.serproCnd.key}:${env.serproCnd.secret}`).toString('base64');
  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok || !json.access_token) {
    throw new Error(`Serpro recusou as credenciais da API CND (HTTP ${resp.status}). Confira SERPRO_CND_CONSUMER_KEY/SECRET no .env.`);
  }
  tokenCache = { valor: json.access_token, expira: Date.now() + Number(json.expires_in || 3600) * 1000 };
  return tokenCache.valor;
}

const MENSAGENS_STATUS = {
  3: 'Certidao nao emitida: ha pendencias na Receita Federal ou PGFN.',
  4: 'Certidao nao emitida: situacao cadastral impeditiva.',
  8: 'Contribuinte nao cadastrado na Receita Federal.',
  9: 'Parametros invalidos.',
  11: 'CNPJ/CPF invalido.',
  12: 'Codigo de identificacao invalido.',
};

/** Converte o retorno da API no formato do model Certidao. */
export function interpretarRetornoSerpro(json) {
  const status = Number(json.Status);
  const c = json.Certidao || {};
  const tipo = String(c.TipoCertidao || '').toLowerCase();

  let situacao = 'nao_emitida';
  if (status === 1 || status === 2) {
    if (tipo.includes('efeito')) situacao = 'positiva_efeito_negativa';
    else if (tipo.includes('positiva')) situacao = 'positiva';
    else situacao = 'negativa';
  }

  return {
    status,
    emitida: status === 1 || status === 2,
    situacao,
    descricao: c.TipoCertidao || '',
    codigoControle: c.CodigoControle || '',
    // Datas do Serpro vem no horario de Brasilia, sem fuso.
    dataEmissao: c.DataEmissao
      ? new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(c.DataEmissao) ? c.DataEmissao : `${c.DataEmissao}-03:00`)
      : undefined,
    dataValidade: c.DataValidade ? new Date(`${String(c.DataValidade).slice(0, 10)}T12:00:00-03:00`) : undefined,
    pdf: c.DocumentoPdf ? Buffer.from(c.DocumentoPdf, 'base64') : undefined,
    mensagem: [json.Mensagem, MENSAGENS_STATUS[status]].filter(Boolean).join(' '),
  };
}

/** Emite (ou recupera a vigente) certidao federal de um CNPJ/CPF. */
export async function emitirCndFederal(documento) {
  if (!serproConfigurado()) {
    throw new Error(
      'Emissao automatica da certidao federal nao configurada. Contrate a API "Consulta CND" na Loja Serpro ' +
        'e preencha SERPRO_CND_CONSUMER_KEY e SERPRO_CND_CONSUMER_SECRET no .env.',
    );
  }
  const pf = tipoPessoa(documento) === 'PF';
  const corpo = {
    TipoContribuinte: pf ? 2 : 1,
    ContribuinteConsulta: documento,
    CodigoIdentificacao: pf ? '9202' : '9201',
    GerarCertidaoPdf: true,
  };

  const url = env.serproCnd.url || CND_URL_PADRAO;
  for (let tentativa = 0; tentativa < 8; tentativa += 1) {
    const token = await obterToken();
    const resp = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(corpo),
    });
    if (resp.status === 401) {
      tokenCache = { valor: null, expira: 0 };
      continue;
    }
    if (resp.status === 403) throw new Error('Serpro: acesso negado (HTTP 403). Confira se o contrato da API CND esta ativo.');
    const json = await resp.json().catch(() => null);
    if (!json || json.Status === undefined) {
      throw new Error(`Resposta inesperada do Serpro (HTTP ${resp.status}).`);
    }
    const status = Number(json.Status);
    if (status === 7 && json.Chave) {
      corpo.Chave = json.Chave; // consulta demorada: repetir com a chave
      await new Promise((ok) => setTimeout(ok, 1500));
      continue;
    }
    if (status === 5 || status === 6) {
      await new Promise((ok) => setTimeout(ok, 2000));
      continue;
    }
    return interpretarRetornoSerpro(json);
  }
  throw new Error('O Serpro nao concluiu a emissao da certidao. Tente novamente em alguns minutos.');
}
