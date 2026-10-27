import { xmlToObj } from './sefaz/parseDocumento.js';
import { NotaFiscal } from '../models/NotaFiscal.js';

// NCMs que frequentemente pertencem ao regime de Substituição Tributária (ST)
const NCMS_SUJEITOS_ST = new Set([
  '2201', '2202', '2203', // Refrigerantes, águas, cervejas
  '2402',                 // Cigarros
  '2710',                 // Combustíveis e lubrificantes
  '3003', '3004',         // Medicamentos
  '3303', '3304', '3305', // Cosméticos e perfumaria
  '3401', '3402',         // Sabões e produtos de limpeza
  '4011',                 // Pneus
  '8708',                 // Autopeças
]);

const lista = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);

/**
 * Executa regras de auditoria fiscal preventiva em uma única nota fiscal.
 */
export function analisarNota(nota, xmlObj = null) {
  const alertas = [];
  if (!nota) return alertas;

  const isCancelada = Boolean(nota.cancelada || nota.statusSefaz === 'cancelada');
  const tipo = nota.tipo || nota.tipoDocumento || 'nfe';
  const papel = nota.papel || (nota.destinatarioCnpj && nota.destinatarioCnpj !== nota.emitenteCnpj ? 'destinatario' : 'emitente');
  const manifestacao = nota.situacaoManifestacao || nota.manifestacao || (papel === 'destinatario' ? 'pendente' : null);

  // 1. Alerta de nota cancelada
  if (isCancelada) {
    alertas.push({
      nivel: 'alto',
      tipo: 'cancelada',
      titulo: 'Documento Cancelado na SEFAZ',
      mensagem:
        papel === 'destinatario'
          ? 'Esta nota foi cancelada pelo fornecedor. Não realize o pagamento nem aproveite créditos fiscais deste documento.'
          : 'Esta nota fiscal foi cancelada na SEFAZ e não possui mais validade jurídica para circulação de mercadorias.',
    });
  }

  // 2. Alerta de prazo de manifestação
  if (tipo === 'nfe' && papel === 'destinatario' && !isCancelada) {
    if (['pendente', 'ciencia', null, undefined].includes(manifestacao)) {
      const diasEmissao = Math.floor((Date.now() - new Date(nota.dataEmissao).getTime()) / 864e5);
      if (diasEmissao >= 150) {
        alertas.push({
          nivel: 'alto',
          tipo: 'prazo_manifestacao',
          titulo: 'Prazo Limite de Manifestação',
          mensagem: `Nota emitida há ${diasEmissao} dias. O prazo legal para manifestar confirmação ou desconhecimento expira em 180 dias.`,
        });
      } else if (diasEmissao >= 90) {
        alertas.push({
          nivel: 'alerta',
          tipo: 'manifestacao_pendente',
          titulo: 'Manifestação Pendente',
          mensagem: `Documento aguardando confirmação definitiva de operação há ${diasEmissao} dias.`,
        });
      }
    }
  }

  // 3. Auditoria de itens e NCM x Substituição Tributária
  // A) Se itens foram passados diretamente como array
  if (Array.isArray(nota.itens) && nota.itens.length > 0) {
    for (const item of nota.itens) {
      const ncm = String(item.ncm || item.NCM || '').slice(0, 4);
      const cfop = String(item.cfop || item.CFOP || '');
      const csosn = String(item.csosn || item.CSOSN || item.cst || item.CST || '');

      const isNormalCfop = ['5102', '6102', '5101', '6101'].includes(cfop);
      const isStCsosn = ['500', '60'].includes(csosn);
      const isStNcm = NCMS_SUJEITOS_ST.has(ncm);

      if ((isStNcm && isNormalCfop) || (isNormalCfop && isStCsosn)) {
        alertas.push({
          nivel: 'alerta',
          tipo: 'st_inconsistente',
          titulo: `Potencial ICMS ST inconsistente (Item: ${item.descricao || item.xProd || item.codigo || ''})`,
          mensagem: `O item possui NCM/CSOSN associado a Substituição Tributária com CFOP normal (${cfop}). Verifique se não deveria ser 5405 / CSOSN 500 para evitar bitributação.`,
        });
        break;
      }
    }
  } else if (nota.xml && !nota.xmlApagadoEm) {
    // B) A partir do XML do documento
    try {
      const obj = xmlObj || xmlToObj(nota.xml);
      const nfe = obj?.nfeProc?.NFe || obj?.NFe;
      const inf = nfe?.infNFe;
      if (inf?.det) {
        const dets = lista(inf.det);
        for (const item of dets) {
          const p = item.prod || {};
          const ncm = String(p.NCM || '').slice(0, 4);
          const cfop = String(p.CFOP || '');

          if (NCMS_SUJEITOS_ST.has(ncm)) {
            // Se o NCM é tipicamente ST, mas está com CFOP de tributação normal (5102/6102)
            if (['5102', '6102', '5101', '6101'].includes(cfop)) {
              alertas.push({
                nivel: 'alerta',
                tipo: 'st_inconsistente',
                titulo: `Potencial ICMS ST não aplicado (Item: ${p.xProd || p.cProd})`,
                mensagem: `O NCM ${p.NCM} costuma estar sujeito à Substituição Tributária (ST). Verifique se o CFOP não deveria ser 5405 / CSOSN 500 para evitar bitributação.`,
              });
              break; // Alerta uma vez por nota para não poluir
            }
          }
        }
      }
    } catch {}
  }

  return alertas;
}

/**
 * Audita o conjunto de notas de uma empresa em um período e calcula o Score de Conformidade Fiscal.
 */
export async function auditarEmpresa(empresaId, owner, filtroData = {}) {
  const query = { empresa: empresaId, owner, ...filtroData };
  const notas = await NotaFiscal.find(query).select('tipo papel numero serie chave valorTotal dataEmissao cancelada situacaoManifestacao xml').lean();

  let criticos = 0;
  let alertasCount = 0;
  const ocorrencias = [];

  for (const n of notas) {
    const achados = analisarNota(n);
    if (achados.length) {
      ocorrencias.push({
        notaId: n._id,
        numero: n.numero,
        serie: n.serie,
        chave: n.chave,
        valorTotal: n.valorTotal,
        dataEmissao: n.dataEmissao,
        papel: n.papel,
        alertas: achados,
      });
      achados.forEach((a) => {
        if (a.nivel === 'critico') criticos += 1;
        else alertasCount += 1;
      });
    }
  }

  // Score de conformidade de 0 a 100
  let score = 100;
  score -= criticos * 15;
  score -= alertasCount * 5;
  if (score < 0) score = 0;

  const nivel = score >= 90 ? 'Excelente' : score >= 75 ? 'Bom' : score >= 50 ? 'Atenção' : 'Crítico';

  return {
    score,
    nivel,
    totalAuditadas: notas.length,
    totalOcorrencias: ocorrencias.length,
    criticos,
    alertasCount,
    ocorrencias: ocorrencias.slice(0, 100),
  };
}
