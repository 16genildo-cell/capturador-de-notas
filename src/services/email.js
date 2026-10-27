import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

/**
 * Envio de alertas por e-mail (opcional). Configure no .env:
 *   SMTP_HOST, SMTP_PORT (587 ou 465), SMTP_USUARIO, SMTP_SENHA, SMTP_REMETENTE
 *   ALERTA_EMAIL_PARA (opcional; padrao: e-mails dos administradores)
 */
let transporte = null;

export function emailConfigurado() {
  return Boolean(env.smtp.host && env.smtp.remetente);
}

function obterTransporte() {
  if (!transporte) {
    transporte = nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.porta,
      secure: env.smtp.porta === 465,
      auth: env.smtp.usuario ? { user: env.smtp.usuario, pass: env.smtp.senha } : undefined,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
  }
  return transporte;
}

/**
 * Sem destinatario explicito, o e-mail vai so para a equipe da plataforma
 * (ALERTA_EMAIL_PARA ou PLATAFORMA_ADMINS) - nunca para clientes de outras contas.
 */
async function destinatarios() {
  if (env.smtp.para.length) return env.smtp.para;
  return env.saas.plataformaAdmins;
}

const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** Monta um e-mail simples em HTML a partir de secoes { titulo, itens[] }. */
export function montarHtml(titulo, secoes, rodape = '') {
  const corpo = secoes
    .filter((s) => s.itens?.length)
    .map(
      (s) =>
        `<h3 style="margin:18px 0 6px;font-size:15px;color:#111">${esc(s.titulo)}</h3>` +
        `<ul style="margin:0;padding-left:18px;color:#333">${s.itens.map((i) => `<li style="margin:3px 0">${esc(i)}</li>`).join('')}</ul>`,
    )
    .join('');
  return (
    `<div style="font-family:Arial,sans-serif;font-size:14px;max-width:640px">` +
    `<h2 style="font-size:18px;color:#1d4ed8;margin:0 0 8px">${esc(titulo)}</h2>${corpo}` +
    `<p style="color:#888;font-size:12px;margin-top:22px">${esc(rodape || `${env.saas.nomeProduto} - alerta automatico`)}</p></div>`
  );
}

/** Envia um e-mail. Sem SMTP configurado, apenas registra no log e retorna false. */
export async function enviarEmail({ assunto, html, texto, para, attachments }) {
  if (!emailConfigurado()) return false;
  const lista = Array.isArray(para) ? para : (para ? [para] : await destinatarios());
  if (!lista.length) return false;
  await obterTransporte().sendMail({
    from: env.smtp.remetente,
    to: lista.join(', '),
    subject: assunto,
    html,
    text: texto || html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    ...(attachments?.length ? { attachments } : {}),
  });
  return true;
}
