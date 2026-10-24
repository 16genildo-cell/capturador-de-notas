import { Router } from 'express';
import multer from 'multer';
import { Certificado } from '../models/Certificado.js';
import { requireAdmin } from '../middleware/auth.js';
import { lerPfx } from '../services/crypto/certificado.js';
import { encrypt } from '../services/crypto/vault.js';

const router = Router();
router.use(requireAdmin);

// Guarda o .pfx em memoria (nunca em disco em texto puro).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
});

router.get('/', async (req, res) => {
  const certificados = (await Certificado.find({ owner: req.conta }).sort('-createdAt')).map((c) =>
    c.toObject(),
  );
  res.render('certificados/lista', { title: 'Certificados', certificados });
});

router.get('/novo', (req, res) => {
  res.render('certificados/form', { title: 'Enviar certificado A1' });
});

router.post('/', upload.single('pfx'), async (req, res) => {
  try {
    const { apelido, senha } = req.body;
    if (!req.file) throw new Error('Envie o arquivo .pfx/.p12.');
    if (!senha) throw new Error('Informe a senha do certificado.');

    // Valida e extrai metadados (tambem confirma que a senha esta correta).
    const info = lerPfx(req.file.buffer, senha);

    const cert = await Certificado.create({
      owner: req.conta,
      apelido: apelido?.trim() || info.titular || 'Certificado A1',
      titular: info.titular,
      cnpjCpf: info.cnpjCpf,
      emissor: info.emissor,
      validoDe: info.validoDe,
      validoAte: info.validoAte,
      pfxCriptografado: encrypt(req.file.buffer),
      senhaCriptografada: encrypt(senha),
    });

    req.session.flash = {
      type: 'ok',
      msg: 'Certificado enviado e validado. Agora cadastre a empresa e vincule este certificado.',
    };
    res.redirect(`/empresas/nova?certificado=${cert._id}`);
  } catch (err) {
    req.session.flash = {
      type: 'erro',
      msg: `Não foi possível ler o certificado: ${err.message}. Verifique o arquivo e a senha.`,
    };
    res.redirect('/certificados/novo');
  }
});

router.post('/:id/excluir', async (req, res) => {
  await Certificado.deleteOne({ _id: req.params.id, owner: req.conta });
  req.session.flash = { type: 'ok', msg: 'Certificado removido.' };
  res.redirect('/certificados');
});

export default router;
