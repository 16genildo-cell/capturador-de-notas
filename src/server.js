import { env } from './config/env.js';
import { connectDB } from './config/db.js';
import { createApp } from './app.js';
import { garantirPrimeiroUsuario } from './services/bootstrapAdmin.js';
import { executarMigracoes } from './services/migracoes.js';
import { startScheduler } from './services/scheduler/index.js';

async function main() {
  await connectDB();
  await garantirPrimeiroUsuario();
  await executarMigracoes();

  const app = createApp();

  app.listen(env.port, () => {
    console.log(`[web] Captura Total rodando em http://localhost:${env.port}`);
    console.log(`[web] Ambiente SEFAZ: ${env.sefazAmbiente}`);
  });

  // Backup diario, alertas e limpeza do armazenamento (a busca de notas e sempre manual).
  startScheduler();
}

// Rede de seguranca: um erro nao tratado de uma conta nao derruba o sistema para as outras.
process.on('unhandledRejection', (err) => console.error('[erro] promessa rejeitada sem tratamento:', err));

// Encerramento limpo (Ctrl+C ou parada do servico do Windows)
for (const sinal of ['SIGINT', 'SIGTERM']) {
  process.on(sinal, () => {
    console.log(`[web] Encerrando (${sinal})...`);
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('Falha ao iniciar o servidor:', err);
  process.exit(1);
});
