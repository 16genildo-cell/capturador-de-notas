import { Router } from 'express';
import { escopo, escopoDaEmpresa } from '../middleware/escopoEmpresa.js';
import multer from 'multer';
import mongoose from 'mongoose';
import { requireAdmin } from '../middleware/auth.js';
import { Empresa } from '../models/Empresa.js';
import { importarArquivos } from '../services/importacao.js';

const router = Router();
router.use(requireAdmin);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024, files: 500 },
  fileFilter: (req, file, cb) => {
    const nome = String(file.originalname || '').toLowerCase();
    if (nome.endsWith('.xml') || nome.endsWith('.zip')) {
      cb(null, true);
    } else {
      cb(new Error('Apenas arquivos .xml ou .zip são permitidos na importação.'));
    }
  },
});

router.get('/', async (req, res) => {
  const empresas = await Empresa.find({ owner: req.conta, ...escopoDaEmpresa(req) }).select('razaoSocial cnpj').sort('razaoSocial').lean();
  res.render('importar', { title: 'Importar XML', empresas, resultado: null });
});

router.post('/', upload.array('arquivos'), async (req, res) => {
  // Na pagina da empresa, so ela entra na deteccao (ou recebe tudo, se pedir "forcar").
  const empresas = await Empresa.find({ owner: req.conta, ...escopoDaEmpresa(req) }).sort('razaoSocial');
  try {
    if (!req.files?.length) throw new Error('Selecione ao menos um arquivo .xml ou .zip.');
    let empresaForcada = null;
    if (req.empresaEscopo) {
      if (req.body.empresa === 'forcar') empresaForcada = empresas[0] || null;
    } else if (req.body.empresa) {
      if (!mongoose.isValidObjectId(req.body.empresa)) throw new Error('Empresa inválida.');
      empresaForcada = empresas.find((e) => String(e._id) === req.body.empresa) || null;
      if (!empresaForcada) throw new Error('Empresa não encontrada.');
    }
    const resultado = await importarArquivos(req.files, empresas, { empresaForcada });
    res.render('importar', {
      title: 'Importar XML',
      empresas: empresas.map((e) => ({ _id: e._id, razaoSocial: e.razaoSocial })),
      resultado,
    });
  } catch (err) {
    req.session.flash = { type: 'erro', msg: err.message };
    res.redirect(`${req.base}/importar`);
  }
});

export default router;
