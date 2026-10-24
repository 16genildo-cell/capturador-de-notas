import mongoose from 'mongoose';

/**
 * Monta o filtro do MongoDB a partir dos parametros da tela de notas
 * (usado na listagem e na exportacao em lote).
 *
 * Parametros aceitos (query string):
 *  categoria: produtos | servicos | cte | eventos   (vazio = todos os documentos, sem eventos)
 *             varias separadas por virgula: "produtos,cte"
 *  capturadasDesde: data/hora ISO; so as notas que chegaram ao sistema a partir dela (tela "Capturar")
 *  papel:     tomadas (recebidas/entrada) | prestadas (emitidas/saida)
 *  mes:       AAAA-MM        ano: AAAA        de / ate: AAAA-MM-DD   (pela data de emissao)
 *  situacao:  ativas | canceladas | resumo | completas
 *  empresa:   id da empresa/pessoa             q: texto livre
 */
export const CATEGORIAS = {
  produtos: { rotulo: 'Produtos (NF-e / NFC-e)', tipos: ['nfe', 'nfce'] },
  servicos: { rotulo: 'Servicos (NFS-e)', tipos: ['nfse'] },
  cte: { rotulo: 'Transporte (CT-e)', tipos: ['cte'] },
  eventos: { rotulo: 'Eventos', tipos: ['evento'] },
};

const FUSO = '-03:00'; // Brasilia

function inicioDoDia(data) {
  return new Date(`${data}T00:00:00${FUSO}`);
}

/**
 * @param permitidas ids das empresas que o usuario pode ver (null = todas)
 */
export function montarFiltroNotas(query, owner, permitidas = null) {
  const f = {
    categoria: String(query.categoria || ''),
    papel: String(query.papel || ''),
    mes: String(query.mes || ''),
    ano: String(query.ano || ''),
    de: String(query.de || ''),
    ate: String(query.ate || ''),
    situacao: String(query.situacao || ''),
    empresa: String(query.empresa || ''),
    q: String(query.q || '').trim(),
    capturadasDesde: String(query.capturadasDesde || ''),
  };
  // Compatibilidade com links antigos (?tipo=nfse, ?papel=destinatario, ?resumo=1)
  if (!f.categoria && query.tipo) {
    f.categoria = { nfe: 'produtos', nfce: 'produtos', nfse: 'servicos', cte: 'cte', evento: 'eventos' }[query.tipo] || '';
  }
  if (f.papel === 'destinatario') f.papel = 'tomadas';
  if (f.papel === 'emitente') f.papel = 'prestadas';
  if (!f.situacao && query.resumo === '1') f.situacao = 'resumo';

  const filtro = { owner };

  // Tipo de documento
  const cats = f.categoria.split(',').filter((c) => CATEGORIAS[c]);
  if (cats.length) filtro.tipo = { $in: cats.flatMap((c) => CATEGORIAS[c].tipos) };
  else filtro.tipo = { $ne: 'evento' };

  // So o que chegou numa captura (data/hora em que o XML entrou no sistema)
  const desde = f.capturadasDesde ? new Date(f.capturadasDesde) : null;
  if (desde && !Number.isNaN(desde.getTime())) filtro.arquivoEm = { $gte: desde };
  else f.capturadasDesde = '';

  // Tomadas x prestadas
  if (f.papel === 'tomadas') filtro.papel = 'destinatario';
  if (f.papel === 'prestadas') filtro.papel = 'emitente';

  // Periodo (data de emissao). Prioridade: intervalo > mes > ano.
  let inicio = null;
  let fim = null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(f.de) || /^\d{4}-\d{2}-\d{2}$/.test(f.ate)) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(f.de)) inicio = inicioDoDia(f.de);
    if (/^\d{4}-\d{2}-\d{2}$/.test(f.ate)) fim = new Date(inicioDoDia(f.ate).getTime() + 864e5);
  } else if (/^\d{4}-\d{2}$/.test(f.mes)) {
    const [a, m] = f.mes.split('-').map(Number);
    inicio = inicioDoDia(`${a}-${String(m).padStart(2, '0')}-01`);
    const prox = m === 12 ? `${a + 1}-01-01` : `${a}-${String(m + 1).padStart(2, '0')}-01`;
    fim = inicioDoDia(prox);
  } else if (/^\d{4}$/.test(f.ano)) {
    inicio = inicioDoDia(`${f.ano}-01-01`);
    fim = inicioDoDia(`${Number(f.ano) + 1}-01-01`);
  }
  if (inicio || fim) {
    filtro.dataEmissao = {};
    if (inicio) filtro.dataEmissao.$gte = inicio;
    if (fim) filtro.dataEmissao.$lt = fim;
  }

  // Situacao
  if (f.situacao === 'ativas') filtro.cancelada = { $ne: true };
  if (f.situacao === 'canceladas') filtro.cancelada = true;
  if (f.situacao === 'resumo') filtro.resumo = true;
  if (f.situacao === 'completas') filtro.resumo = { $ne: true };
  if (f.situacao === 'manifestar') {
    // NF-e recebidas ainda sem manifestacao conclusiva (prazo: 180 dias da emissao)
    filtro.tipo = { $in: ['nfe'] };
    filtro.papel = 'destinatario';
    filtro.cancelada = { $ne: true };
    filtro.situacaoManifestacao = { $in: ['pendente', 'ciencia'] };
  }

  if (f.empresa && mongoose.isValidObjectId(f.empresa)) filtro.empresa = new mongoose.Types.ObjectId(f.empresa);
  // Operador restrito: so as empresas permitidas (uma empresa fora da lista e ignorada).
  if (permitidas) {
    const pedidaPermitida = filtro.empresa && permitidas.some((id) => String(id) === String(filtro.empresa));
    if (!pedidaPermitida) {
      filtro.empresa = { $in: permitidas };
      f.empresa = '';
    }
  }

  // Texto livre: nome, CPF/CNPJ, numero ou chave
  if (f.q) {
    const texto = new RegExp(f.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const digitos = f.q.replace(/\D/g, '');
    filtro.$or = [
      { chave: texto },
      { chaveNota: texto },
      { numero: texto },
      { emitenteNome: texto },
      { destinatarioNome: texto },
    ];
    if (digitos.length >= 3) {
      const d = new RegExp(digitos);
      filtro.$or.push({ chave: d }, { emitenteCnpjCpf: d }, { destinatarioCnpjCpf: d }, { numero: d });
    }
  }

  return { filtro, filtros: f };
}

/** Query string com os filtros atuais (para paginacao e links de exportacao). */
export function queryString(filtros, extra = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...filtros, ...extra })) {
    if (v !== undefined && v !== null && v !== '') p.set(k, v);
  }
  return p.toString();
}
