import cron from 'node-cron';
import { env } from '../../config/env.js';
import { capturarTodas } from '../capturaService.js';
import { fazerBackup } from '../backup.js';
import { alertaPosCaptura, alertaDiario } from '../alertasEmail.js';
import { emailConfigurado } from '../email.js';
import { pushConfigurado } from '../push.js';
import { limparArquivos } from '../retencao.js';

/** Estado das tarefas automaticas (exibido na pagina Saude do sistema). */
export const estadoTarefas = {
  captura: { ativa: false, agenda: env.schedulerCron, ultima: null, resultado: null, erro: null, rodando: false },
  backup: { ativa: false, agenda: env.backup.cron, ultima: null, resultado: null, erro: null, rodando: false },
};

const tarefas = [];
const aoConcluirCaptura = [];

/** Permite a outros modulos (ex.: alertas por e-mail) reagir ao fim da captura automatica. */
export function aoFinalizarCaptura(fn) {
  aoConcluirCaptura.push(fn);
}

export async function executarCapturaAgendada() {
  const st = estadoTarefas.captura;
  if (st.rodando) return;
  st.rodando = true;
  const inicio = new Date();
  console.log(`[scheduler] Iniciando captura automática (${new Date().toISOString()})`);
  try {
    const resultados = await capturarTodas({ origem: 'agendado' });
    const totalNovos = resultados.reduce(
      (acc, r) => acc + (r.nfe?.novos || 0) + (r.nfse?.novos || 0) + (r.cte?.novos || 0),
      0,
    );
    st.resultado = `${resultados.length} empresa(s), ${totalNovos} documento(s) novo(s)`;
    st.erro = null;
    console.log(`[scheduler] Captura concluída. ${st.resultado}.`);
    await alertaPosCaptura(resultados, inicio).catch((err) => console.error('[email] pos-captura:', err.message));
    for (const fn of aoConcluirCaptura) {
      await Promise.resolve(fn(resultados)).catch((err) => console.error('[scheduler] pos-captura:', err.message));
    }
  } catch (err) {
    st.erro = err.message;
    console.error('[scheduler] Erro na captura automática:', err.message);
  } finally {
    st.ultima = new Date();
    st.rodando = false;
  }
}

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

/** Inicia as tarefas automaticas conforme o .env. */
export function startScheduler() {
  if (env.schedulerEnabled) {
    estadoTarefas.captura.ativa = agendar('captura', env.schedulerCron, executarCapturaAgendada);
    if (estadoTarefas.captura.ativa) console.log(`[scheduler] Captura automática ativa. Agenda: "${env.schedulerCron}".`);
  } else {
    console.log('[scheduler] Captura automática desativada (SCHEDULER_ENABLED=false).');
  }

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

  if (env.backup.ativo) {
    estadoTarefas.backup.ativa = agendar('backup', env.backup.cron, executarBackupAgendado);
    if (estadoTarefas.backup.ativa) console.log(`[backup] Backup automático ativo. Agenda: "${env.backup.cron}".`);
  }
}

export function stopScheduler() {
  for (const t of tarefas) t.stop();
}
