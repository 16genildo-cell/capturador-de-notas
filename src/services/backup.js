import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import readline from 'node:readline';
import { once } from 'node:events';
import mongoose from 'mongoose';
import { env } from '../config/env.js';

const { EJSON } = mongoose.mongo.BSON;

/**
 * Backup do banco em arquivos .jsonl.gz (um por colecao), dentro de
 * BACKUP_DIR/backup-AAAA-MM-DD_HH-MM/. Mantem os BACKUP_MANTER mais recentes.
 * Nao depende do mongodump: roda com o proprio Node.
 */
const IGNORAR = new Set(['sessions']);

function carimbo(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  const local = new Date(d.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  return `${local.getFullYear()}-${p(local.getMonth() + 1)}-${p(local.getDate())}_${p(local.getHours())}-${p(local.getMinutes())}`;
}

export function pastaBackups() {
  return path.resolve(env.backup.dir);
}

export function listarBackups() {
  const base = pastaBackups();
  if (!fs.existsSync(base)) return [];
  return fs
    .readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith('backup-'))
    .map((d) => {
      const dir = path.join(base, d.name);
      const arquivos = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl.gz'));
      const bytes = arquivos.reduce((a, f) => a + fs.statSync(path.join(dir, f)).size, 0);
      const info = fs.existsSync(path.join(dir, 'info.json'))
        ? JSON.parse(fs.readFileSync(path.join(dir, 'info.json'), 'utf8'))
        : {};
      return { nome: d.name, dir, bytes, colecoes: arquivos.length, ...info };
    })
    .sort((a, b) => (a.nome < b.nome ? 1 : -1));
}

export async function fazerBackup(db = mongoose.connection.db) {
  const inicio = Date.now();
  const dir = path.join(pastaBackups(), `backup-${carimbo()}`);
  fs.mkdirSync(dir, { recursive: true });

  const contagem = {};
  const colecoes = (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name);
  for (const nome of colecoes) {
    if (IGNORAR.has(nome) || nome.startsWith('system.')) continue;
    const gz = zlib.createGzip();
    const saida = fs.createWriteStream(path.join(dir, `${nome}.jsonl.gz`));
    gz.pipe(saida);
    let n = 0;
    for await (const doc of db.collection(nome).find({})) {
      if (!gz.write(`${EJSON.stringify(doc, { relaxed: false })}\n`)) await once(gz, 'drain');
      n += 1;
    }
    gz.end();
    await once(saida, 'finish');
    contagem[nome] = n;
  }
  const info = { criadoEm: new Date().toISOString(), contagem, duracaoMs: Date.now() - inicio };
  fs.writeFileSync(path.join(dir, 'info.json'), JSON.stringify(info, null, 2));

  // Rotacao: apaga os mais antigos
  const todos = listarBackups();
  for (const b of todos.slice(env.backup.manter)) fs.rmSync(b.dir, { recursive: true, force: true });

  return { dir, ...info };
}

/** Restaura um backup (SUBSTITUI os dados atuais das colecoes contidas nele). */
export async function restaurarBackup(dir, db = mongoose.connection.db) {
  const arquivos = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl.gz'));
  if (arquivos.length === 0) throw new Error(`Nenhum arquivo de backup em ${dir}`);
  const resultado = {};
  for (const arq of arquivos) {
    const nome = arq.replace(/\.jsonl\.gz$/, '');
    const col = db.collection(nome);
    await col.deleteMany({});
    const rl = readline.createInterface({ input: fs.createReadStream(path.join(dir, arq)).pipe(zlib.createGunzip()) });
    let lote = [];
    let n = 0;
    for await (const linha of rl) {
      if (!linha.trim()) continue;
      lote.push(EJSON.parse(linha, { relaxed: false }));
      if (lote.length >= 500) {
        await col.insertMany(lote, { ordered: false });
        n += lote.length;
        lote = [];
      }
    }
    if (lote.length) {
      await col.insertMany(lote, { ordered: false });
      n += lote.length;
    }
    resultado[nome] = n;
  }
  return resultado;
}
