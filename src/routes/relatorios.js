import { Router } from 'express';
import { escopo, escopoDaEmpresa } from '../middleware/escopoEmpresa.js';
import { requireAuth } from '../middleware/auth.js';
import { Empresa } from '../models/Empresa.js';
import { montarFiltroNotas, queryString, CATEGORIAS } from '../services/filtroNotas.js';
import { resumoMensal, porParceiro, porCfopNcm, gerarExcel } from '../services/relatorios.js';

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

export default router;
