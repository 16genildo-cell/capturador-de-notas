import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import { fazerBackup } from '../services/backup.js';

/** Uso: npm run backup */
await connectDB();
const r = await fazerBackup();
console.log(`Backup criado em ${r.dir}`);
console.log(r.contagem);
await mongoose.disconnect();
