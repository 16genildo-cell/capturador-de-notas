import mongoose from 'mongoose';

/** Sequencias numericas (ex.: numero do atendimento). */
const contadorSchema = new mongoose.Schema({ _id: { type: String }, seq: { type: Number, default: 0 } }, { versionKey: false });

contadorSchema.statics.proximo = async function proximo(nome) {
  const c = await this.findOneAndUpdate({ _id: nome }, { $inc: { seq: 1 } }, { upsert: true, new: true });
  return c.seq;
};

export const Contador = mongoose.model('Contador', contadorSchema);
