import dotenv from 'dotenv';

dotenv.config();

function required(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Variavel de ambiente obrigatoria ausente: ${name}`);
  }
  return value;
}

export const env = {
  port: Number(process.env.PORT || 3000),
  mongoUri: required('MONGODB_URI', 'mongodb://127.0.0.1:27017/captura_total'),
  sessionSecret: required('SESSION_SECRET', 'dev-secret-inseguro-troque'),
  certEncryptionKey: process.env.CERT_ENCRYPTION_KEY || '',
  sefazAmbiente: (process.env.SEFAZ_AMBIENTE || 'homologacao').toLowerCase(),
  schedulerEnabled: String(process.env.SCHEDULER_ENABLED || 'true') === 'true',
  schedulerCron: process.env.SCHEDULER_CRON || '0 * * * *',
  isProd: process.env.NODE_ENV === 'production',
  // Arquivo .pem com a cadeia de certificados ICP-Brasil (opcional).
  sefazCaFile: (process.env.SEFAZ_CA_FILE || '').trim(),
  // Validar o certificado do servidor da SEFAZ (deixe true; false so como ultimo recurso).
  sefazTlsVerificar: String(process.env.SEFAZ_TLS_VERIFICAR || 'true') !== 'false',
  // Enviar "Ciencia da Operacao" automaticamente para notas que chegam so como resumo,
  // liberando o download do XML completo (como fazem vFisco e similares).
  // Backup automatico do banco
  backup: {
    ativo: String(process.env.BACKUP_ATIVO || 'true') === 'true',
    dir: process.env.BACKUP_DIR || './backups',
    manter: Math.max(1, Number(process.env.BACKUP_MANTER || 14)),
    cron: process.env.BACKUP_CRON || '30 2 * * *', // todo dia 02:30
  },
  // E-mail de alertas (opcional)
  smtp: {
    host: (process.env.SMTP_HOST || '').trim(),
    porta: Number(process.env.SMTP_PORT || 587),
    usuario: (process.env.SMTP_USUARIO || '').trim(),
    senha: process.env.SMTP_SENHA || '',
    remetente: (process.env.SMTP_REMETENTE || process.env.SMTP_USUARIO || '').trim(),
    para: (process.env.ALERTA_EMAIL_PARA || '').split(/[,;]/).map((s) => s.trim()).filter(Boolean),
  },
  // Padrao para contas novas (cada conta pode mudar em "Minha conta").
  cienciaAutomatica: String(process.env.SEFAZ_CIENCIA_AUTOMATICA || 'false') === 'true',
  // Endereco publico do sistema (links nos e-mails, retorno do pagamento).
  appUrl: (process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/+$/, ''),
  // Endereco do frontend web (React). Links de e-mail (nova senha) apontam para ele.
  webUrl: (process.env.WEB_URL || process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/+$/, ''),
  // Origens autorizadas a chamar a API pelo navegador (CORS). WEB_URL entra automaticamente.
  corsOrigins: [process.env.WEB_URL || '', ...(process.env.CORS_ORIGINS || '').split(/[,;\s]+/)]
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean),
  // Assinatura dos tokens da API (web e app). Padrao: derivado do SESSION_SECRET.
  jwtSecret: process.env.JWT_SECRET || `api:${process.env.SESSION_SECRET || 'dev-secret-inseguro-troque'}`,
  // Notificacoes push (Firebase Cloud Messaging): JSON da conta de servico, numa linha.
  firebaseServiceAccount: (process.env.FIREBASE_SERVICE_ACCOUNT || '').trim(),
  // Atras de proxy (Render, Railway, Nginx): necessario para cookie seguro e IP real.
  trustProxy: String(process.env.TRUST_PROXY || (process.env.NODE_ENV === 'production' ? 'true' : 'false')) === 'true',
  // SaaS
  saas: {
    // Cadastro publico FECHADO: so o dono da plataforma cria contas (painel /plataforma).
    // A variavel CADASTRO_ABERTO do .env e ignorada de proposito. Para reabrir o
    // autocadastro no futuro, troque false por: String(process.env.CADASTRO_ABERTO) === 'true'
    cadastroAberto: false,
    trialDias: Math.max(0, Number(process.env.TESTE_DIAS || 14)),
    // Dias de tolerancia apos o vencimento antes de bloquear o acesso.
    carenciaDias: Math.max(0, Number(process.env.CARENCIA_DIAS || 5)),
    // E-mails dos donos da plataforma (painel /plataforma). O ADMIN_EMAIL entra automaticamente.
    plataformaAdmins: [process.env.ADMIN_EMAIL || process.env.SEED_EMAIL || '', ...(process.env.PLATAFORMA_ADMINS || '').split(/[,;]/)]
      .map((s) => s.toLowerCase().trim())
      .filter(Boolean),
    nomeProduto: (process.env.NOME_PRODUTO || 'Captura Total').trim(),
    emailSuporte: (process.env.EMAIL_SUPORTE || '').trim(),
  },
  // Cobranca recorrente pelo Asaas
  asaas: {
    apiKey: (process.env.ASAAS_API_KEY || '').trim(),
    // "sandbox" (testes) ou "producao"
    ambiente: (process.env.ASAAS_AMBIENTE || 'sandbox').toLowerCase(),
    // Token que voce define ao cadastrar o webhook no painel do Asaas
    webhookToken: (process.env.ASAAS_WEBHOOK_TOKEN || '').trim(),
    // Opcional: outra URL da API (testes automatizados)
    url: (process.env.ASAAS_URL || '').trim(),
  },
  // Primeiro usuario (administrador) criado automaticamente se o banco estiver vazio.
  // SEED_EMAIL/SEED_SENHA sao aceitos como nomes antigos, por compatibilidade.
  admin: {
    nome: (process.env.ADMIN_NOME || 'Administrador').trim(),
    email: (process.env.ADMIN_EMAIL || process.env.SEED_EMAIL || '').toLowerCase().trim(),
    senha: process.env.ADMIN_SENHA || process.env.SEED_SENHA || '',
  },
};

/** Codigo numerico do ambiente conforme a SEFAZ: 1 = producao, 2 = homologacao. */
export function tpAmb() {
  return env.sefazAmbiente === 'producao' ? 1 : 2;
}
