import { Empresa } from '../models/Empresa.js';
import { Conta } from '../models/Conta.js';
import { capturarNFe } from './sefaz/distribuicaoDFe.js';
import { capturarCTe } from './sefaz/cteDistribuicao.js';
import { capturarNFSe } from './nfse/index.js';

const comoErro = (err) => ({ status: 'erro', novos: 0, mensagem: err.message });

/**
 * Trava por empresa: impede duas capturas simultaneas da mesma empresa
 * (ex.: dois cliques em "Capturar agora" / Filtrar), o que poderia gerar consultas
 * duplicadas e o bloqueio "656 - consumo indevido" da SEFAZ.
 */
const emAndamento = new Map(); // empresaId -> inicio (ms)
const TRAVA_MAX_MS = 30 * 60 * 1000; // libera travas "esquecidas" apos 30 min

export function capturaEmAndamento(empresaId) {
  const inicio = emAndamento.get(String(empresaId));
  if (!inicio) return false;
  if (Date.now() - inicio > TRAVA_MAX_MS) {
    emAndamento.delete(String(empresaId));
    return false;
  }
  return true;
}

export function liberarTravaCaptura(empresaId) {
  emAndamento.delete(String(empresaId));
}

/**
 * Captura os documentos de uma empresa/pessoa conforme o que esta marcado no cadastro:
 * NF-e (produtos), NFS-e (servicos) e CT-e (transporte).
 */
/**
 * tipos (opcional): so estes documentos nesta captura, ex.: ['nfe', 'cte'] (tela "Capturar").
 * Respeita tambem o cadastro da empresa e o plano do escritorio.
 */
export async function capturarEmpresa(empresaId, { origem = 'manual', tipos } = {}) {
  const id = String(empresaId);
  if (capturaEmAndamento(id)) {
    const aviso = { status: 'sucesso', novos: 0, mensagem: 'Já existe uma captura em andamento para esta empresa; aguarde ela terminar.' };
    return { nfe: aviso, nfse: null, cte: null, emAndamento: true };
  }
  emAndamento.set(id, Date.now());
  try {
    return await capturarEmpresaSemTrava(empresaId, { origem, tipos });
  } finally {
    emAndamento.delete(id);
  }
}

async function capturarEmpresaSemTrava(empresaId, { origem, tipos }) {
  const empresa = await Empresa.findById(empresaId).populate('certificado');
  if (!empresa) throw new Error('Empresa não encontrada.');
  if (!empresa.ativa) return { nfe: null, nfse: null, cte: null, aviso: 'Empresa inativa.' };

  const quer = { nfe: true, nfse: true, cte: true, ...(empresa.captura?.toObject?.() || empresa.captura || {}) };
  if (Array.isArray(tipos) && tipos.length) {
    for (const t of ['nfe', 'nfse', 'cte']) quer[t] = quer[t] && tipos.includes(t);
    if (!quer.nfe && !quer.nfse && !quer.cte) {
      return { nfe: null, nfse: null, cte: null, aviso: 'Nenhum dos tipos escolhidos está marcado para captura no cadastro desta empresa.' };
    }
  }
  // Tipos de documento liberados pelo plano do escritorio (conta sem registro: todos, como antes).
  const conta = await Conta.findById(empresa.owner);
  if (conta?.temRecurso) {
    quer.nfe = quer.nfe && conta.temRecurso('captura_nfe');
    quer.nfse = quer.nfse && conta.temRecurso('captura_nfse');
    quer.cte = quer.cte && conta.temRecurso('captura_cte');
    if (!quer.nfe && !quer.nfse && !quer.cte) {
      return { nfe: null, nfse: null, cte: null, aviso: 'O plano do escritório não inclui a captura destes documentos.' };
    }
  }
  const resultado = { nfe: null, nfse: null, cte: null };
  const semCert = { status: 'erro', novos: 0, mensagem: 'Sem certificado vinculado.' };

  if (quer.nfe) {
    resultado.nfe = empresa.certificado ? await capturarNFe(empresa, { origem }).catch(comoErro) : semCert;
  }
  if (quer.nfse) {
    resultado.nfse = await capturarNFSe(empresa, { origem }).catch(comoErro);
  }
  if (quer.cte) {
    resultado.cte = empresa.certificado ? await capturarCTe(empresa, { origem }).catch(comoErro) : semCert;
  }
  return resultado;
}

/**
 * Ids (string) das contas que podem usar o sistema agora (teste valido, em dia ou cortesia).
 * recurso: exige tambem essa funcionalidade no plano (ex.: 'alertas').
 */
export async function contasLiberadas(ownerIds, { recurso } = {}) {
  const ids = [...new Set(ownerIds.map(String))];
  const contas = await Conta.find({ _id: { $in: ids } });
  const porId = new Map(contas.map((c) => [String(c._id), c]));
  // Conta ainda sem registro (base antiga): continua liberada, como antes do SaaS.
  return new Set(ids.filter((id) => {
    const c = porId.get(id);
    if (!c) return true;
    return c.acesso().liberado && (!recurso || c.temRecurso(recurso));
  }));
}
