import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import { garantirPrimeiroUsuario } from '../services/bootstrapAdmin.js';

/**
 * Cria o usuario administrador inicial com os dados do .env
 * (ADMIN_NOME, ADMIN_EMAIL, ADMIN_SENHA).
 * O servidor ja faz isso automaticamente ao iniciar; este script
 * serve para criar o usuario sem subir a aplicacao.
 *
 * Uso: npm run seed
 */
async function main() {
  await connectDB();

  const resultado = await garantirPrimeiroUsuario();
  if (resultado.motivo === 'ja-existem-usuarios') {
    console.log('Ja existem usuarios cadastrados; nada a fazer.');
  }

  await mongoose.disconnect();
  process.exit(resultado.motivo === 'env-ausente' ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
