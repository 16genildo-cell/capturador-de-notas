import { Certidao } from '../../models/Certidao.js';
import { Empresa } from '../../models/Empresa.js';
import { emitirCndFederal, serproConfigurado } from './serproCnd.js';

/** Emite a certidao federal da empresa/pessoa e grava o resultado. */
export async function emitirFederalEmpresa(empresa) {
  const r = await emitirCndFederal(empresa.cnpj);
  return Certidao.create({
    empresa: empresa._id,
    owner: empresa.owner,
    esfera: 'federal',
    origem: 'serpro',
    situacao: r.situacao,
    descricao: r.descricao,
    codigoControle: r.codigoControle,
    dataEmissao: r.dataEmissao || new Date(),
    dataValidade: r.dataValidade,
    pdf: r.pdf,
    mensagem: r.mensagem,
  });
}

/**
 * Renova automaticamente as certidoes federais que vencem nos proximos `dias`
 * (ou que nunca foram emitidas). Usado pelo agendador diario.
 */
export async function renovarFederaisVencendo({ dias = 15 } = {}) {
  if (!serproConfigurado()) return { renovadas: 0, erros: 0, pulado: true };
  const limite = new Date(Date.now() + dias * 864e5);
  const empresas = await Empresa.find({ ativa: true }).lean();
  let renovadas = 0;
  let erros = 0;
  for (const e of empresas) {
    const vigente = await Certidao.findOne({
      empresa: e._id,
      esfera: 'federal',
      situacao: { $ne: 'nao_emitida' },
      dataValidade: { $gte: limite },
    }).lean();
    if (vigente) continue;
    // Evita repetir varias vezes no mesmo dia uma emissao que falhou.
    const tentativaHoje = await Certidao.exists({
      empresa: e._id,
      esfera: 'federal',
      origem: 'serpro',
      createdAt: { $gte: new Date(Date.now() - 20 * 3600e3) },
    });
    if (tentativaHoje) continue;
    try {
      await emitirFederalEmpresa(e);
      renovadas += 1;
    } catch (err) {
      erros += 1;
      console.error(`[certidoes] Falha ao renovar federal de ${e.razaoSocial}: ${err.message}`);
    }
  }
  return { renovadas, erros };
}
