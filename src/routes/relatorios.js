import { Router } from 'express';
import mongoose from 'mongoose';
import archiver from 'archiver';
import { escopo, escopoDaEmpresa } from '../middleware/escopoEmpresa.js';
import { requireAuth } from '../middleware/auth.js';
import { Empresa } from '../models/Empresa.js';
import { NotaFiscal } from '../models/NotaFiscal.js';
import { montarFiltroNotas, queryString, CATEGORIAS } from '../services/filtroNotas.js';
import { resumoMensal, porParceiro, porCfopNcm, gerarExcel } from '../services/relatorios.js';
import { nomeArquivoNota } from '../services/pdf/documentoPdf.js';
import { auditarEmpresa } from '../services/auditoriaFiscal.js';
import { calcularDre } from '../services/dreService.js';
import { gerarLayoutDominio, gerarLayoutQuestor, gerarLayoutAlterdata } from '../services/exportacaoContabil.js';
import { exigirRecurso } from '../middleware/assinatura.js';

const router = Router();
router.use(requireAuth);

/** Sem periodo informado, o relatorio considera o ano atual. */
function consultaComPadrao(query) {
  const q = { ...query };
  if (!q.mes && !q.ano && !q.de && !q.ate) q.ano = String(new Date().getFullYear());
  return q;
}

router.get('/', async (req, res) => {
  const q = consultaComPadrao(req.query);
  const { filtro, filtros } = montarFiltroNotas(q, req.conta, req.empresasPermitidas);
  const [meses, fornecedores, clientes, itens, empresas] = await Promise.all([
    resumoMensal(filtro),
    porParceiro(filtro, 'destinatario', 15),
    porParceiro(filtro, 'emitente', 15),
    porCfopNcm(filtro),
    Empresa.find({ owner: req.conta, ...escopoDaEmpresa(req) }).select('razaoSocial').sort('razaoSocial').lean(),
  ]);
  res.render('relatorios', {
    title: 'Relatórios',
    meses,
    fornecedores,
    clientes,
    itens,
    empresas,
    filtros,
    categorias: CATEGORIAS,
    qs: (extra) => queryString(filtros, { ...(req.base ? { empresa: '' } : {}), ...extra }),
  });
});

router.get('/excel', async (req, res, next) => {
  try {
    const { filtro } = montarFiltroNotas(consultaComPadrao(req.query), req.conta, req.empresasPermitidas);
    const buf = await gerarExcel(filtro);
    const agora = new Date().toISOString().slice(0, 10);
    res.attachment(`relatorio-notas-${agora}.xlsx`);
    res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(Buffer.from(buf));
  } catch (err) {
    next(err);
  }
});

// Pacote de Fechamento do Mês em 1 clique (ZIP com /Entradas, /Saidas, /Canceladas, /Eventos e Relatorio_Mensal.xlsx)
router.get('/fechamento', async (req, res, next) => {
  try {
    const q = { ...req.query };
    if (!q.mes && !q.ano && !q.de && !q.ate) {
      const hoje = new Date();
      const a = hoje.getFullYear();
      const m = String(hoje.getMonth() + 1).padStart(2, '0');
      q.mes = `${a}-${m}`;
    }
    const { filtro } = montarFiltroNotas(q, req.conta, req.empresasPermitidas);
    const mesIdent = q.mes || q.ano || new Date().toISOString().slice(0, 7);

    let empresaNome = 'escritorio';
    if (q.empresa && mongoose.isValidObjectId(q.empresa)) {
      const emp = await Empresa.findById(q.empresa).select('razaoSocial').lean();
      if (emp?.razaoSocial) empresaNome = emp.razaoSocial.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 25);
    }

    res.attachment(`fechamento-${empresaNome}-${mesIdent}.zip`);
    const zip = archiver('zip', { zlib: { level: 6 } });
    zip.on('warning', (err) => console.warn('[fechamento]', err.message));
    zip.on('error', (err) => {
      console.error('[fechamento]', err);
      res.destroy(err);
    });
    zip.pipe(res);

    // 1. Gera a planilha Excel com todos os dados fiscais e resumos no raiz do ZIP
    try {
      const bufExcel = await gerarExcel(filtro);
      zip.append(Buffer.from(bufExcel), { name: `Relatorio_Mensal_${mesIdent}.xlsx` });
    } catch (errExcel) {
      console.warn('[fechamento] erro ao gerar Excel:', errExcel.message);
      zip.append(`Erro ao gerar planilha Excel: ${errExcel.message}`, { name: 'ERRO_PLANILHA.txt' });
    }

    // 2. Agrupa os XMLs nas pastas /Entradas, /Saidas, /Canceladas, /Eventos
    const cursor = NotaFiscal.find(filtro).sort('dataEmissao').lean().cursor();
    for await (const nota of cursor) {
      if (!nota.xml) continue;
      const nomeBase = nomeArquivoNota(nota);
      let pasta = 'Outros';

      if (nota.tipo === 'evento') {
        pasta = 'Eventos';
      } else if (nota.cancelada) {
        pasta = 'Canceladas';
      } else if (nota.papel === 'destinatario') {
        pasta = 'Entradas';
      } else if (nota.papel === 'emitente') {
        pasta = 'Saidas';
      }

      zip.append(nota.xml, { name: `${pasta}/${nomeBase}.xml` });
    }

    await zip.finalize();
  } catch (err) {
    next(err);
  }
});

// Auditoria Fiscal Preventiva (Malha Fina)
router.get('/auditoria', exigirRecurso('auditoria_fiscal'), async (req, res, next) => {
  try {
    const empresas = await Empresa.find({ owner: req.conta, ...escopoDaEmpresa(req) }).select('razaoSocial').sort('razaoSocial').lean();
    const selId = req.query.empresa || empresas[0]?._id;
    const empresaSel = empresas.find((e) => String(e._id) === String(selId)) || empresas[0] || null;

    let resultado = { score: 100, nivel: 'Excelente', totalAuditadas: 0, totalOcorrencias: 0, criticos: 0, alertasCount: 0, ocorrencias: [] };
    if (empresaSel) {
      resultado = await auditarEmpresa(empresaSel._id, req.conta);
    }

    res.render('auditoria', {
      title: 'Auditoria Fiscal Preventiva',
      empresas,
      empresaSel,
      resultado,
    });
  } catch (err) {
    next(err);
  }
});

// Demonstrativo de Resultado do Exercício (DRE Gerencial)
router.get('/dre', exigirRecurso('dre_gerencial'), async (req, res, next) => {
  try {
    const empresas = await Empresa.find({ owner: req.conta, ...escopoDaEmpresa(req) }).select('razaoSocial').sort('razaoSocial').lean();
    const selId = req.query.empresa || empresas[0]?._id;
    const empresaSel = empresas.find((e) => String(e._id) === String(selId)) || empresas[0] || null;

    const ano = Number(req.query.ano) || new Date().getFullYear();
    const mes = req.query.mes ? String(req.query.mes).padStart(2, '0') : '';

    let inicio, fim;
    if (mes) {
      inicio = new Date(Date.UTC(ano, Number(mes) - 1, 1, 0, 0, 0));
      fim = new Date(Date.UTC(ano, Number(mes), 0, 23, 59, 59, 999));
    } else {
      inicio = new Date(Date.UTC(ano, 0, 1, 0, 0, 0));
      fim = new Date(Date.UTC(ano, 11, 31, 23, 59, 59, 999));
    }

    const dre = await calcularDre({
      owner: req.conta,
      empresaId: empresaSel?._id,
      inicio,
      fim,
    });

    res.render('dre', {
      title: 'DRE Gerencial',
      empresas,
      empresaSel,
      dre,
      filtros: { ano: String(ano), mes },
    });
  } catch (err) {
    next(err);
  }
});

// Exportação direta para Softwares Contábeis (Domínio, Questor, Alterdata)
router.get('/exportar-sistema', exigirRecurso('exportacao_sistemas'), async (req, res, next) => {
  try {
    const sistema = String(req.query.sistema || 'dominio').toLowerCase();
    const q = { ...req.query };
    if (!q.mes && !q.ano && !q.de && !q.ate) {
      const hoje = new Date();
      q.mes = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
    }
    const { filtro } = montarFiltroNotas(q, req.conta, req.empresasPermitidas);
    const notas = await NotaFiscal.find(filtro).sort('dataEmissao').populate('empresa', 'razaoSocial').lean();

    const mesIdent = q.mes || q.ano || 'periodo';
    let empresaNome = 'escritorio';
    if (q.empresa && mongoose.isValidObjectId(q.empresa)) {
      const emp = await Empresa.findById(q.empresa).select('razaoSocial').lean();
      if (emp?.razaoSocial) empresaNome = emp.razaoSocial.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 20);
    }

    res.attachment(`exportacao-${sistema}-${empresaNome}-${mesIdent}.zip`);
    const zip = archiver('zip', { zlib: { level: 6 } });
    zip.on('error', (err) => res.destroy(err));
    zip.pipe(res);

    // Gera o arquivo de integração específico do software
    let arquivoTexto = '';
    let nomeArquivoTexto = 'importacao.txt';
    if (sistema === 'questor') {
      arquivoTexto = gerarLayoutQuestor(notas);
      nomeArquivoTexto = `questor_fiscal_${mesIdent}.csv`;
    } else if (sistema === 'alterdata') {
      arquivoTexto = gerarLayoutAlterdata(notas);
      nomeArquivoTexto = `alterdata_pack_${mesIdent}.txt`;
    } else {
      arquivoTexto = gerarLayoutDominio(notas);
      nomeArquivoTexto = `dominio_sistemas_${mesIdent}.txt`;
    }

    zip.append(arquivoTexto, { name: nomeArquivoTexto });

    // Inclui os XMLs nas pastas organizadas
    for (const n of notas) {
      if (!n.xml) continue;
      let pasta = 'Entradas';
      if (n.tipo === 'evento') pasta = 'Eventos';
      else if (n.cancelada) pasta = 'Canceladas';
      else if (n.papel === 'emitente') pasta = 'Saidas';
      zip.append(n.xml, { name: `${pasta}/${nomeArquivoNota(n)}.xml` });
    }

    await zip.finalize();
  } catch (err) {
    next(err);
  }
});

export default router;
