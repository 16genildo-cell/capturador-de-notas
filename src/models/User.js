import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

/**
 * Usuario do sistema.
 *  - role "admin": acesso total (certificados, empresas, usuarios, manifestacao).
 *  - role "operador": equipe do escritorio; consulta notas, roda capturas, baixa XML/PDF e da ciencia.
 *  - role "cliente": cliente do escritorio; so consulta/baixa as notas dos CNPJs liberados a ele.
 * Todos os usuarios de uma mesma "conta" enxergam os mesmos dados. O primeiro
 * administrador e o dono da conta (conta = null => a conta e ele mesmo).
 */
const userSchema = new mongoose.Schema(
  {
    nome: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    senhaHash: { type: String, required: true },
    role: { type: String, enum: ['admin', 'operador', 'cliente'], default: 'operador' },
    conta: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    ativo: { type: Boolean, default: true },
    // Acesso por empresa (vale para operadores; administradores veem todas).
    //  todasEmpresas = true  -> ve todas as empresas da conta (padrao, como antes)
    //  todasEmpresas = false -> ve somente as empresas listadas em `empresas`
    todasEmpresas: { type: Boolean, default: true },
    empresas: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Empresa' }],
    ultimoLogin: { type: Date },
    // Recuperacao de senha: guarda so o hash do token enviado por e-mail.
    resetTokenHash: { type: String, index: true, sparse: true },
    resetExpira: { type: Date },
  },
  { timestamps: true },
);

userSchema.methods.verificarSenha = function verificarSenha(senha) {
  return bcrypt.compare(senha, this.senhaHash);
};

/**
 * Empresas que o usuario pode ver: null = todas (administradores e operadores sem restricao);
 * senao, a lista de ids permitidos (pode ser vazia = nenhuma).
 */
export function empresasPermitidas(user) {
  if (!user || user.role === 'admin') return null;
  // O cliente do escritorio sempre fica limitado aos CNPJs dele.
  if (user.role !== 'cliente' && user.todasEmpresas !== false) return null;
  return (user.empresas || []).map((id) => new mongoose.Types.ObjectId(String(id)));
}

/** Id da conta (dona dos dados) a que o usuario pertence. */
export function contaDoUsuario(user) {
  return user.conta || user._id;
}

export function validarSenha(senha) {
  if (!senha || String(senha).length < 8) throw new Error('A senha deve ter ao menos 8 caracteres.');
}

userSchema.statics.hashSenha = (senha) => bcrypt.hash(senha, 10);

userSchema.statics.criar = async function criar({ nome, email, senha, role = 'operador', conta = null, todasEmpresas = true, empresas = [] }) {
  const senhaHash = await bcrypt.hash(senha, 10);
  return this.create({ nome, email, senhaHash, role, conta, todasEmpresas, empresas });
};

export const User = mongoose.model('User', userSchema);
