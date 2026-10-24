import mongoose from 'mongoose';
import { env } from './env.js';

export async function connectDB() {
  mongoose.set('strictQuery', true);
  await mongoose.connect(env.mongoUri, {
    serverSelectionTimeoutMS: 10000,
  });
  console.log(`[db] Conectado ao MongoDB: ${env.mongoUri}`);
  return mongoose.connection;
}
