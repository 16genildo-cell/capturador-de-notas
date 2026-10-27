import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import { env } from '../config/env.js';
import { Certificado } from '../models/Certificado.js';
import { recriptografar } from '../services/crypto/vault.js';

/**
 * Script de manutencao para rotacionar a chave mestre do cofre (CERT_ENCRYPTION_KEY).
 *
 * Como usar:
 *   node src/scripts/rotacionar-chave-certificados.js <CHAVE_ANTIGA_HEX> <CHAVE_NOVA_HEX>
 *
 * Ou via variaveis de ambiente:
 *   CERT_ENCRYPTION_KEY_OLD=<CHAVE_ANTIGA> CERT_ENCRYPTION_KEY=<CHAVE_NOVA> npm run certs:rotacionar
 */
async function main() {
  const chaveAntiga = (process.argv[2] || env.certEncryptionKeyOld || '').trim();
  const chaveNova = (process.argv[3] || env.certEncryptionKey || '').trim();

  if (!chaveAntiga || chaveAntiga.length !== 64) {
    console.error('ERRO: Informe a chave antiga em formato hexadecimal (64 caracteres/32 bytes).');
    console.error('Exemplo: node src/scripts/rotacionar-chave-certificados.js <chave_antiga> <chave_nova>');
    process.exit(1);
  }

  if (!chaveNova || chaveNova.length !== 64) {
    console.error('ERRO: Informe a nova chave em formato hexadecimal (64 caracteres/32 bytes).');
    process.exit(1);
  }

  if (chaveAntiga === chaveNova) {
    console.error('ERRO: A chave antiga e a nova chave são idênticas. Nada a fazer.');
    process.exit(1);
  }

  console.log('[vault] Conectando ao MongoDB...');
  await connectDB();

  const certificados = await Certificado.find({});
  console.log(`[vault] Encontrados ${certificados.length} certificados para re-criptografia.`);

  let atualizados = 0;
  let erros = 0;

  for (const cert of certificados) {
    try {
      let alterado = false;
      if (cert.pfxCriptografado) {
        cert.pfxCriptografado = recriptografar(cert.pfxCriptografado, chaveAntiga, chaveNova);
        alterado = true;
      }
      if (cert.senhaCriptografada) {
        cert.senhaCriptografada = recriptografar(cert.senhaCriptografada, chaveAntiga, chaveNova);
        alterado = true;
      }
      if (alterado) {
        await cert.save();
        atualizados += 1;
        console.log(`[vault] OK: Certificado "${cert.apelido}" (${cert.cnpjCpf}) atualizado.`);
      }
    } catch (err) {
      erros += 1;
      console.error(`[vault] ERRO ao re-criptografar certificado "${cert.apelido}" (${cert.cnpjCpf}): ${err.message}`);
    }
  }

  console.log('\n--- Resumo da Rotação de Chaves ---');
  console.log(`Total analisado : ${certificados.length}`);
  console.log(`Atualizados     : ${atualizados}`);
  console.log(`Erros           : ${erros}`);
  console.log('-----------------------------------\n');

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('\nFalha inesperada na rotação de certificados:', err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
