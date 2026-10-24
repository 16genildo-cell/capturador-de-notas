import path from 'node:path';
import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import { listarBackups, restaurarBackup } from '../services/backup.js';

/**
 * Uso:
 *   npm run restaurar                      -> lista os backups disponiveis
 *   npm run restaurar -- backup-AAAA-MM-DD_HH-MM --confirmar
 * ATENCAO: substitui os dados atuais pelos do backup. Pare o servidor antes.
 */
const [nome, confirmar] = process.argv.slice(2);
const backups = listarBackups();

if (!nome) {
  console.log('Backups disponiveis (mais recente primeiro):');
  for (const b of backups) console.log(`  ${b.nome}  (${(b.bytes / 1024 / 1024).toFixed(1)} MB)`);
  console.log('\nPara restaurar: npm run restaurar -- <nome> --confirmar');
  process.exit(0);
}
const alvo = backups.find((b) => b.nome === path.basename(nome));
if (!alvo) {
  console.error(`Backup nao encontrado: ${nome}`);
  process.exit(1);
}
if (confirmar !== '--confirmar') {
  console.error('Isto vai SUBSTITUIR os dados atuais. Repita o comando com --confirmar para prosseguir.');
  process.exit(1);
}
await connectDB();
console.log(await restaurarBackup(alvo.dir));
console.log('Restauracao concluida. Inicie o servidor novamente.');
await mongoose.disconnect();
