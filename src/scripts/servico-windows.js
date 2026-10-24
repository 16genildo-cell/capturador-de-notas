import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

/**
 * Instala/remove o Captura Total como SERVICO DO WINDOWS: o sistema passa a iniciar
 * junto com o computador (mesmo sem ninguem logado) e reinicia sozinho se cair.
 *
 * Uso (abra o PowerShell COMO ADMINISTRADOR, na pasta do projeto):
 *   npm install node-windows@1.0.0-beta.8 --no-save
 *   npm run servico:instalar
 *   npm run servico:remover
 *
 * Antes de instalar, pare o "npm run dev" (os dois usariam a mesma porta).
 */
const require = createRequire(import.meta.url);
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const acao = process.argv[2];

if (process.platform !== 'win32') {
  console.error('Este script e apenas para Windows.');
  process.exit(1);
}

let Service;
try {
  ({ Service } = require('node-windows'));
} catch {
  console.error('Pacote "node-windows" nao instalado. Rode primeiro:\n  npm install node-windows@1.0.0-beta.8 --no-save');
  process.exit(1);
}

const svc = new Service({
  name: 'CapturaTotal',
  description: 'Captura Total - captura automatica de notas fiscais (NF-e, NFS-e, CT-e).',
  script: path.join(raiz, 'src', 'server.js'),
  workingDirectory: raiz, // para o .env ser encontrado
  nodeOptions: [],
  wait: 5, // segundos antes de reiniciar apos uma queda
  grow: 0.5,
  maxRestarts: 10,
});

svc.on('install', () => {
  console.log('Servico "CapturaTotal" instalado. Iniciando...');
  svc.start();
});
svc.on('start', () => console.log('Servico iniciado. Acesse http://localhost:' + (process.env.PORT || 3000)));
svc.on('alreadyinstalled', () => console.log('O servico ja esta instalado. Para reinstalar, rode servico:remover antes.'));
svc.on('uninstall', () => console.log('Servico removido.'));
svc.on('error', (err) => console.error('Erro:', err));

if (acao === 'instalar') svc.install();
else if (acao === 'remover') svc.uninstall();
else console.log('Uso: npm run servico:instalar | npm run servico:remover');
