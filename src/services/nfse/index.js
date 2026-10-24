import { NfseNacionalAdapter } from './adapters/nacional.js';
import { ExemploMunicipalAdapter } from './adapters/exemploMunicipal.js';
import { resumirNfseNacional, EVENTOS_CANCELAMENTO_NFSE } from './parseNfseNacional.js';
import { obterCertificadoEmpresa } from '../sefaz/distribuicaoDFe.js';
import { Empresa } from '../../models/Empresa.js';
import { NotaFiscal } from '../../models/NotaFiscal.js';
import { CapturaLog } from '../../models/CapturaLog.js';

/**
 * Registro de adaptadores de NFS-e, indexado pela chave do provedor.
 * Para adicionar um municipio novo: crie o adaptador em ./adapters e registre aqui.
 */
const REGISTRO = new Map([
  ['nacional', new NfseNacionalAdapter()],
  ['exemplo', new ExemploMunicipalAdapter()],
]);

export function listarProvedores() {
  return [...REGISTRO.keys()];
}

export function getAdapter(nome) {
  return REGISTRO.get((nome || 'nacional').toLowerCase());
}

/**
 * Grava um documento do Ambiente Nacional da NFS-e.
 * O NSU recebe o prefixo "nfse:" para nao colidir com os NSUs da NF-e da mesma empresa.
 */
export async function salvarDocumentoNfse(empresa, { nsu, xml, origem }) {
  const dados = resumirNfseNacional(xml, empresa.cnpj);
  const base = { empresa: empresa._id, owner: empresa.owner, ...dados };
  if (origem) base.origem = origem;
  if (nsu) base.nsu = `nfse:${nsu}`;

  if (dados.tipo === 'evento') {
    if (dados.chaveNota && EVENTOS_CANCELAMENTO_NFSE.has(dados.tpEvento)) {
      await NotaFiscal.updateOne({ empresa: empresa._id, chave: dados.chaveNota }, { cancelada: true });
    }
    if (!nsu) return 'duplicado';
  } else if (dados.chave) {
    const existe = await NotaFiscal.exists({ empresa: empresa._id, chave: dados.chave });
    if (existe) return 'duplicado';
  }

  try {
    await NotaFiscal.create(base);
    return 'novo';
  } catch (err) {
    if (err.code === 11000) return 'duplicado';
    throw err;
  }
}

/** Captura NFS-e de uma empresa/pessoa usando o adaptador do provedor configurado. */
export async function capturarNFSe(empresa, { origem = 'manual' } = {}) {
  const inicio = Date.now();
  const provedor = empresa.nfseMunicipal?.provedor || 'nacional';
  const adapter = getAdapter(provedor);

  if (!adapter) {
    const msg = `Provedor de NFS-e desconhecido: ${provedor}`;
    await CapturaLog.create({ empresa: empresa._id, tipo: 'nfse', origem, status: 'erro', mensagem: msg });
    return { status: 'erro', novos: 0, mensagem: msg };
  }

  let status = 'sucesso';
  let novos = 0;
  let total = 0;
  let mensagem = '';

  try {
    const certificado = empresa.certificado ? await obterCertificadoEmpresa(empresa) : null;

    if (typeof adapter.capturarIncremental === 'function') {
      const r = await adapter.capturarIncremental({
        empresa,
        certificado,
        salvar: (doc) => salvarDocumentoNfse(empresa, doc),
        atualizarNSU: async (nsu) => {
          empresa.ultimoNSUNfse = nsu;
          await Empresa.updateOne({ _id: empresa._id }, { ultimoNSUNfse: nsu });
        },
      });
      novos = r.novos;
      total = r.total;
      mensagem = r.aviso;
    } else {
      // Adaptadores municipais: devolvem a lista de notas ja no formato padronizado.
      const { notas = [], aviso } = await adapter.capturar({ empresa, certificado });
      for (const nota of notas) {
        total += 1;
        try {
          await NotaFiscal.create({ empresa: empresa._id, owner: empresa.owner, tipo: 'nfse', ...nota });
          novos += 1;
        } catch (err) {
          if (err.code !== 11000) throw err; // ignora duplicatas
        }
      }
      mensagem = aviso || `${novos} nota(s) capturada(s).`;
    }
  } catch (err) {
    status = novos > 0 ? 'parcial' : 'erro';
    mensagem = err.message;
  }

  await CapturaLog.create({
    empresa: empresa._id,
    tipo: 'nfse',
    origem,
    status,
    novos,
    totalProcessado: total,
    ultimoNSU: empresa.ultimoNSUNfse,
    mensagem,
    duracaoMs: Date.now() - inicio,
  });

  return { status, novos, mensagem };
}
