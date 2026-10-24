import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import { Conta } from '../models/Conta.js';
import { Empresa } from '../models/Empresa.js';
import { Plano } from '../models/Plano.js';
import { carregarPlanos } from '../services/planos.js';
import { PLANOS, TESTE } from '../config/planos.js';

/**
 * Mostra, para cada escritorio, o plano, o limite de CNPJs e de onde esse limite vem.
 * Uso: npm run diagnostico
 */
const txt = (n) => (n === Infinity ? 'ilimitado' : String(n));

async function main() {
  await connectDB();
  await carregarPlanos();
  const planos = await Plano.find({}).lean();
  console.log(`\nPlanos no banco (${planos.length}):`);
  for (const p of planos) console.log(`  - ${p._id}: "${p.nome}" -> ${p.limiteEmpresas ?? 'ilimitado'} CNPJs${p.ativo === false ? ' (arquivado)' : ''}`);

  const contas = await Conta.find({}).sort('nome');
  console.log(`\nEscritorios (${contas.length}):`);
  for (const c of contas) {
    const usados = await Empresa.countDocuments({ owner: c._id });
    const limite = c.limiteEmpresas();
    let motivo;
    if (c.limiteEmpresasManual != null) motivo = `limite especial definido no escritorio (${c.limiteEmpresasManual})`;
    else if (c.plano && !PLANOS[c.plano]) motivo = `PLANO "${c.plano}" NAO EXISTE MAIS -> caiu no teste padrao (${TESTE.empresas})`;
    else if (c.plano) motivo = `do plano "${PLANOS[c.plano].nome}"`;
    else if (c.status === 'cortesia') motivo = 'cortesia sem plano (ilimitado)';
    else motivo = `SEM PLANO -> teste padrao (${TESTE.empresas})`;
    console.log(`  - ${c.nome} [${c.status}] plano=${c.plano || '-'}  CNPJs: ${usados}/${txt(limite)}  <- ${motivo}`);
  }
  console.log('');
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Erro:', err.message);
  process.exit(1);
});
