import { Certificado } from '../models/Certificado.js';

/**
 * Para usuarios logados, disponibiliza nas views os certificados vencidos ou que
 * vencem nos proximos 30 dias (sem certificado valido a captura para).
 */
export async function alertaCertificados(req, res, next) {
  res.locals.alertaCertificados = [];
  // Operador restrito a algumas empresas nao ve os certificados da conta.
  if (!req.user || req.method !== 'GET' || req.empresasPermitidas) return next();
  try {
    const limite = new Date(Date.now() + 30 * 864e5);
    const certs = await Certificado.find({ owner: req.conta, ativo: true, validoAte: { $lt: limite } })
      .select('apelido validoAte')
      .sort('validoAte')
      .lean();
    res.locals.alertaCertificados = certs.map((c) => ({
      apelido: c.apelido,
      validoAte: c.validoAte,
      vencido: new Date(c.validoAte).getTime() < Date.now(),
      dias: Math.ceil((new Date(c.validoAte).getTime() - Date.now()) / 864e5),
    }));
  } catch (err) {
    console.error('[alertas] certificados:', err.message);
  }
  next();
}
