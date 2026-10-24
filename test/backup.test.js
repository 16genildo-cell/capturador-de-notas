import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import mongoose from 'mongoose';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-backup-'));
process.env.BACKUP_DIR = dir;
const { fazerBackup, restaurarBackup, listarBackups } = await import('../src/services/backup.js');

test('backup e restauracao preservam ObjectId, datas e binarios (sem sessoes)', async () => {
  const id = new mongoose.Types.ObjectId();
  const dados = {
    notafiscals: [{ _id: id, data: new Date('2026-10-01T10:00:00Z'), pdf: new mongoose.mongo.Binary(Buffer.from('abc')) }],
    sessions: [{ _id: 's' }],
  };
  const restaurado = {};
  const db = {
    listCollections: () => ({ toArray: async () => Object.keys(dados).map((name) => ({ name })) }),
    collection: (n) => ({
      find: () => (async function* () { yield* dados[n]; })(),
      deleteMany: async () => { restaurado[n] = []; },
      insertMany: async (docs) => { restaurado[n].push(...docs); },
    }),
  };
  const r = await fazerBackup(db);
  assert.deepEqual(Object.keys(r.contagem), ['notafiscals']);
  assert.equal(listarBackups().length, 1);
  await restaurarBackup(r.dir, db);
  const doc = restaurado.notafiscals[0];
  assert.ok(doc._id.equals(id));
  assert.ok(doc.data instanceof Date);
  assert.equal(Buffer.from(doc.pdf.buffer).toString(), 'abc');
  fs.rmSync(dir, { recursive: true, force: true });
});
