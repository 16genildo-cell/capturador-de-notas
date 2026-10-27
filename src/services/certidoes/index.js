import { Certidao } from '../../models/Certidao.js';
import { Empresa } from '../../models/Empresa.js';
import { emitirCndFederal, serproConfigurado } from './serproCnd.js';
import { emitirCndGratuita, emitirCndFederalGratuita, emitirCndtTrabalhista, emitirCrfFgtsGratuita } from './cndGratuitaService.js';
import { tipoPessoa } from '../../utils/documento.js';

/**
 * Emite a certidão federal da empresa/pessoa e grava o resultado.
 * Se a API Serpro estiver configurada e contratada, utiliza-a;
 * caso contrário, utiliza o motor gratuito (com Certificado Digital A1 ou consulta pública).
 */
export async function emitirFederalEmpresa(empresa) {
  let r;
  let origem = 'gratuita';

  if (serproConfigurado()) {
    try {
      r = await emitirCndFederal(empresa.cnpj);
      origem = 'serpro';
    } catch (err) {
      console.warn(`[certidoes] Serpro falhou (${err.message}), usando canal gratuito para ${empresa.razaoSocial}...`);
      r = await emitirCndFederalGratuita(empresa);
    }
  } else {
    r = await emitirCndFederalGratuita(empresa);
  }

  return Certidao.create({
    empresa: empresa._id,
    owner: empresa.owner,
    esfera: 'federal',
    origem,
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
 * Emite qualquer CND pelos canais gratuitos automatizados (Trabalhista, Federal, FGTS).
 */
export async function emitirCndGratuitaEmpresa(empresa, esfera) {
  const r = await emitirCndGratuita(empresa, esfera);
  return Certidao.create({
    empresa: empresa._id,
    owner: empresa.owner,
    esfera,
    origem: 'gratuita',
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
 * Emite todas as certidões gratuitas possíveis da empresa de uma só vez (Federal, Trabalhista e FGTS).
 */
export async function emitirTodasGratuitasEmpresa(empresa) {
  const esferas = ['trabalhista', 'federal'];
  if (tipoPessoa(empresa.cnpj) !== 'PF') {
    esferas.push('fgts');
  }

  const resultados = [];
  for (const esf of esferas) {
    try {
      const c = await emitirCndGratuitaEmpresa(empresa, esf);
      resultados.push({ esfera: esf, ok: true, certidao: c });
    } catch (err) {
      resultados.push({ esfera: esf, ok: false, erro: err.message });
    }
  }
  return resultados;
}

/**
 * Renova automaticamente todas as certidões (federais, trabalhistas e fgts)
 * que vencem nos próximos `dias` (ou que nunca foram emitidas).
 * Utilizado tanto pelo painel quanto pelo agendador diário.
 */
export async function renovarTodasVencendo({ dias = 15, owner = null } = {}) {
  const limite = new Date(Date.now() + dias * 864e5);
  const filtroEmpresas = { ativa: { $ne: false } };
  if (owner) filtroEmpresas.owner = owner;

  const empresas = await Empresa.find(filtroEmpresas).populate('certificado').lean();
  let renovadas = 0;
  let erros = 0;

  for (const e of empresas) {
    const esferasParaChecar = ['federal', 'trabalhista'];
    if (tipoPessoa(e.cnpj) !== 'PF') esferasParaChecar.push('fgts');

    for (const esfera of esferasParaChecar) {
      const vigente = await Certidao.findOne({
        empresa: e._id,
        esfera,
        situacao: { $ne: 'nao_emitida' },
        dataValidade: { $gte: limite },
      }).lean();

      if (vigente) continue;

      // Evita disparar repetidas vezes no mesmo dia para uma que já falhou
      const tentativaHoje = await Certidao.exists({
        empresa: e._id,
        esfera,
        createdAt: { $gte: new Date(Date.now() - 12 * 3600e3) },
      });
      if (tentativaHoje) continue;

      try {
        if (esfera === 'federal') {
          await emitirFederalEmpresa(e);
        } else {
          await emitirCndGratuitaEmpresa(e, esfera);
        }
        renovadas += 1;
      } catch (err) {
        erros += 1;
        console.error(`[certidoes] Falha ao renovar certidão ${esfera} de ${e.razaoSocial}: ${err.message}`);
      }
    }
  }

  return { renovadas, erros };
}

/**
 * Mantido para compatibilidade com rotinas anteriores.
 */
export async function renovarFederaisVencendo(opts) {
  return renovarTodasVencendo(opts);
}

