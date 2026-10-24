import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import { sincronizarAdmin } from '../services/bootstrapAdmin.js';

/**
 * Redefine o acesso do administrador da plataforma com os dados do .env
 * (ADMIN_EMAIL e ADMIN_SENHA). Use quando nao conseguir entrar com esses dados:
 *
 *   npm run admin:senha
 *
 * Se o usuario ja existe, a senha dele passa a ser a ADMIN_SENHA; se nao existe, ele e criado.
 * Depois reinicie a API (o bloqueio por tentativas erradas e zerado ao reiniciar).
 */
async function main() {
  await connectDB();
  const r = await sincronizarAdmin();
  if (r.acao === 'criado') {
    console.log(`\nOK: administrador ${r.email} criado com a senha do .env.`);
  } else {
    console.log(`\nOK: a senha de ${r.email} agora e a ADMIN_SENHA do .env (usuario reativado e com perfil administrador).`);
  }
  console.log('Reinicie a API e entre com esse e-mail e essa senha.\n');
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(`\nNao foi possivel redefinir o administrador: ${err.message}\n`);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
