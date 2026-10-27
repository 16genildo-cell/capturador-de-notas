import cron from 'node-cron';
import { env } from '../../config/env.js';
import { fazerBackup } from '../backup.js';
import { alertaDiario } from '../alertasEmail.js';
import { emailConfigurado } from '../email.js';
import { pushConfigurado } from '../push.js';
import { limparArquivos } from '../retencao.js';
import { renovarTodasVencendo } from '../certidoes/index.js';

/**
 * Estado das tarefas automaticas (exibido na pagina Saude do sistema).
 * A busca de notas e sempre manual (botao Filtrar com certificado ou "Capturar agora").
 */
export const estadoTarefas = {
  backup: { ativa: false, agenda: env.backup.cron, ultima: null, resultado: null, erro: null, rodando: false },
};

const tarefas = [];

export async function executarBackupAgendado() {
  const st = estadoTarefas.backup;
  if (st.rodando) return;
  st.rodando = true;
  try {
    const r = await fazerBackup();
    st.resultado = r.dir;
    st.erro = null;
    console.log(`[backup] Backup criado em ${r.dir}`);
  } catch (err) {
    st.erro = err.message;
    console.error('[backup] Falha no backup:', err.message);
  } finally {
    st.ultima = new Date();
    st.rodando = false;
  }
}

function agendar(nome, expressao, fn) {
  if (!cron.validate(expressao)) {
    console.error(`[scheduler] Expressao cron inválida para ${nome}: "${expressao}".`);
    return false;
  }
  tarefas.push(cron.schedule(expressao, fn, { timezone: 'America/Sao_Paulo' }));
  return true;
}

/** Inicia as tarefas automaticas conforme o .env (nenhuma delas busca notas). */
export function startScheduler() {
  if (emailConfigurado() || pushConfigurado()) {
    agendar('alertas', '50 7 * * *', () =>
      alertaDiario().catch((err) => console.error('[email] alerta diario:', err.message)),
    );
    console.log('[email] Alertas por e-mail ativos.');
  }

  // Armazenamento das notas conforme o plano (apaga os XMLs vencidos ou ja baixados)
  agendar('armazenamento', '20 * * * *', () =>
    limparArquivos().catch((err) => console.error('[armazenamento]', err.message)),
  );

  // Monitoramento e renovação automática de Certidões Negativas (diário às 06:00)
  agendar('certidoes', '0 6 * * *', () =>
    renovarTodasVencendo({ dias: 15 }).catch((err) => console.error('[certidoes] renovacao:', err.message)),
  );

  if (env.backup.ativo) {
    estadoTarefas.backup.ativa = agendar('backup', env.backup.cron, executarBackupAgendado);
    if (estadoTarefas.backup.ativa) console.log(`[backup] Backup automático ativo. Agenda: "${env.backup.cron}".`);
  }
}

export function stopScheduler() {
  for (const t of tarefas) t.stop();
}
