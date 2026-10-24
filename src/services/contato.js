import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { MensagemContato } from '../models/MensagemContato.js';
import { dentroDoLimite } from '../middleware/seguranca.js';
import { enviarEmail, montarHtml } from './email.js';

/** Faixas de "quantos clientes o escritorio tem" (campo opcional do formulario). */
export const FAIXAS_CLIENTES = ['até 10', '11 a 30', '31 a 100', 'mais de 100'];

const LIMITE_POR_HORA = 5;

/**
 * Registra uma mensagem do formulario de contato da pagina inicial.
 * Protecoes: campo escondido anti-robo (`site`), limite de envios por IP e validacao dos campos.
 * Avisa a equipe da plataforma por e-mail (se o SMTP estiver configurado), sem bloquear o envio.
 * @returns {Promise<MensagemContato|null>} null quando o envio foi descartado como robo
 */
export async function registrarContato(dados = {}, { ip, origem = 'site' } = {}) {
  // Robo preencheu o campo escondido: finge que deu certo e descarta.
  if (String(dados.site || '').trim()) return null;
  if (!dentroDoLimite(`contato|${ip}`, LIMITE_POR_HORA, 60 * 60 * 1000)) {
    throw new Error('Recebemos varias mensagens deste endereço. Tente de novo mais tarde ou escreva para o nosso e-mail.');
  }

  const nome = String(dados.nome || '').trim().slice(0, 120);
  const email = String(dados.email || '').trim().toLowerCase().slice(0, 160);
  const telefone = String(dados.telefone || '').trim().slice(0, 40);
  const escritorio = String(dados.escritorio || '').trim().slice(0, 160);
  const qtdClientes = FAIXAS_CLIENTES.includes(dados.qtdClientes) ? dados.qtdClientes : '';
  const mensagem = String(dados.mensagem || '').trim().slice(0, 3000);

  if (!nome) throw new Error('Informe o seu nome.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Informe um e-mail válido para a resposta.');
  if (mensagem.length < 5) throw new Error('Escreva a sua mensagem.');

  const m = await MensagemContato.create({ nome, email, telefone, escritorio, qtdClientes, mensagem, ip, origem });

  // Aviso para a equipe da plataforma (ALERTA_EMAIL_PARA ou PLATAFORMA_ADMINS).
  enviarEmail({
    assunto: `${env.saas.nomeProduto}: nova mensagem do site - ${nome}`,
    html: montarHtml('Nova mensagem pelo formulario do site', [
      {
        titulo: 'Contato',
        itens: [
          `Nome: ${nome}`,
          `E-mail: ${email}`,
          telefone && `Telefone: ${telefone}`,
          escritorio && `Escritorio: ${escritorio}`,
          qtdClientes && `Clientes: ${qtdClientes}`,
        ].filter(Boolean),
      },
      { titulo: 'Mensagem', itens: [mensagem] },
    ], `Veja e responda em ${env.appUrl}/plataforma`),
  }).catch((err) => console.error('[email] contato:', err.message));

  return m;
}

/** Mensagens para o painel da plataforma. filtro: 'novas' | 'todas' | 'arquivadas'. */
export async function listarMensagens(filtro = 'novas', limite = 100) {
  const q = filtro === 'arquivadas' ? { arquivada: true } : filtro === 'todas' ? { arquivada: false } : { arquivada: false, lida: false };
  const [itens, naoLidas, total] = await Promise.all([
    MensagemContato.find(q).sort('-createdAt').limit(limite).lean(),
    MensagemContato.countDocuments({ arquivada: false, lida: false }),
    MensagemContato.countDocuments({ arquivada: false }),
  ]);
  return { itens, naoLidas, total, filtro: ['todas', 'arquivadas'].includes(filtro) ? filtro : 'novas' };
}

export function contarNaoLidas() {
  return MensagemContato.countDocuments({ arquivada: false, lida: false });
}

/** Acoes do painel: lida, naoLida, arquivar, desarquivar, excluir. */
export async function acaoMensagem(id, acao) {
  if (!mongoose.isValidObjectId(id)) throw new Error('Mensagem inválida.');
  if (acao === 'excluir') {
    const r = await MensagemContato.deleteOne({ _id: id });
    if (!r.deletedCount) throw new Error('Mensagem não encontrada.');
    return 'Mensagem excluida.';
  }
  const mudancas = {
    lida: { lida: true },
    naoLida: { lida: false },
    arquivar: { arquivada: true, lida: true },
    desarquivar: { arquivada: false },
  }[acao];
  if (!mudancas) throw new Error('Ação inválida.');
  const m = await MensagemContato.findByIdAndUpdate(id, mudancas, { new: true });
  if (!m) throw new Error('Mensagem não encontrada.');
  return { lida: 'Marcada como lida.', naoLida: 'Marcada como não lida.', arquivar: 'Mensagem arquivada.', desarquivar: 'Mensagem de volta na caixa.' }[acao];
}
