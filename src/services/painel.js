import { Empresa } from '../models/Empresa.js';
import { NotaFiscal } from '../models/NotaFiscal.js';
import { CapturaLog } from '../models/CapturaLog.js';
import { Certificado } from '../models/Certificado.js';
import { resumoMensal } from './relatorios.js';

/** Numeros do painel inicial de uma conta (usado pelo site e pela API). */
export async function montarPainel(owner, permitidas = null) {
  // Operador restrito: so as empresas permitidas a ele.
  const re = permitidas ? { empresa: { $in: permitidas } } : {};
  const reEmp = permitidas ? { _id: { $in: permitidas } } : {};
  const idsEmpresas = await Empresa.find({ owner, ...reEmp }).distinct('_id');
  const [totalEmpresas, totalNotas, agg, ultimasNotas, ultimosLogs] = await Promise.all([
    Empresa.countDocuments({ owner, ...reEmp }),
    NotaFiscal.countDocuments({ owner, ...re, tipo: { $ne: 'evento' } }),
    NotaFiscal.aggregate([
      { $match: { owner, ...re, cancelada: { $ne: true } } },
      { $group: { _id: '$tipo', qtd: { $sum: 1 }, valor: { $sum: '$valorTotal' } } },
    ]),
    NotaFiscal.find({ owner, ...re }).select('-xml').sort('-createdAt').limit(8).populate('empresa', 'razaoSocial').lean(),
    CapturaLog.find({ empresa: { $in: idsEmpresas } }).sort('-createdAt').limit(6).populate('empresa', 'razaoSocial').lean(),
  ]);

  const porTipo = { nfe: 0, nfce: 0, nfse: 0, cte: 0, evento: 0 };
  const porTipoValor = {};
  let valorTotal = 0;
  for (const g of agg) {
    porTipo[g._id] = g.qtd;
    if (g._id === 'evento') continue;
    porTipoValor[g._id] = g.valor || 0;
    valorTotal += g.valor || 0;
  }

  // Ultimos 12 meses (entradas x saidas)
  const inicio12 = new Date();
  inicio12.setMonth(inicio12.getMonth() - 11, 1);
  inicio12.setHours(0, 0, 0, 0);
  const meses = await resumoMensal({ owner, ...re, tipo: { $ne: 'evento' }, dataEmissao: { $gte: inicio12 } });
  const [pendentesManifestacao, resumos] = await Promise.all([
    NotaFiscal.countDocuments({ owner, ...re, tipo: 'nfe', papel: 'destinatario', cancelada: { $ne: true }, situacaoManifestacao: { $in: ['pendente', 'ciencia'] } }),
    NotaFiscal.countDocuments({ owner, ...re, resumo: true, cancelada: { $ne: true } }),
  ]);

  const limiteCert = new Date(Date.now() + 30 * 864e5);
  const certsVencendo = await Certificado.find({ owner, ativo: true, validoAte: { $lt: limiteCert } })
    .select('apelido titular cnpjCpf validoAte')
    .sort('validoAte')
    .lean();

  const certificadosAlerta = certsVencendo.map((c) => ({
    _id: c._id,
    apelido: c.apelido,
    titular: c.titular,
    validoAte: c.validoAte,
    vencido: new Date(c.validoAte).getTime() < Date.now(),
    diasParaVencer: Math.ceil((new Date(c.validoAte).getTime() - Date.now()) / 864e5),
  }));

  return {
    meses,
    pendencias: { manifestacao: pendentesManifestacao, resumos },
    certificadosAlerta,
    stats: { totalEmpresas, totalNotas, valorTotal, porTipo, porTipoValor },
    ultimasNotas,
    ultimosLogs,
  };
}
