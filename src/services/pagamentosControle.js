import mongoose from 'mongoose';
import { Conta } from '../models/Conta.js';
import { User } from '../models/User.js';
import { PagamentoMensal } from '../models/PagamentoMensal.js';
import { PLANOS, brl } from '../config/planos.js';
import { formatarDocumento } from '../utils/documento.js';

const MESES_NOMES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

/** Retorna a competência atual no fuso de Brasília no formato 'AAAA-MM'. */
export function obterMesAtual() {
  const agora = new Date();
  const formatador = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
  });
  return formatador.format(agora);
}

/** Formata uma competência 'AAAA-MM' como 'Outubro de 2026'. */
export function formatarMesNome(mesStr) {
  if (!mesStr || !/^\d{4}-\d{2}$/.test(mesStr)) return mesStr || '';
  const [ano, mes] = mesStr.split('-').map(Number);
  const nome = MESES_NOMES[mes - 1] || '';
  return `${nome} de ${ano}`;
}

/** Gera a lista de competências para seleção (anteriores e próximas). */
export function listarCompetencias(mesSelecionado) {
  const [anoAtual, mesAtualNum] = (mesSelecionado || obterMesAtual()).split('-').map(Number);
  const lista = [];

  // 12 meses para trás e 3 meses para a frente
  for (let i = -12; i <= 3; i += 1) {
    const d = new Date(anoAtual, mesAtualNum - 1 + i, 1);
    const a = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const id = `${a}-${m}`;
    lista.push({
      id,
      nome: `${MESES_NOMES[d.getMonth()]} de ${a}`,
      ano: a,
      mes: d.getMonth() + 1,
      atual: id === obterMesAtual(),
      selecionado: id === mesSelecionado,
    });
  }

  // Ordena do mais recente para o mais antigo
  return lista.reverse();
}

/**
 * Consulta todas as contas e cruza com a tabela de pagamentos mensais da competência informada.
 * Retorna as estatísticas consolidadas e a listagem filtrada para a tela ou relatório.
 */
export async function obterControlePagamentos({ mes, status = 'todos', q = '' } = {}) {
  const mesRef = mes && /^\d{4}-\d{2}$/.test(mes) ? mes : obterMesAtual();

  // Busca todas as contas (escritórios) cadastradas
  const contas = await Conta.find({ status: { $ne: 'cancelada' } }).sort('nome').lean();
  const ids = contas.map((c) => c._id);

  // Busca dados dos usuários donos para garantir e-mail e telefone
  const donos = await User.find({ _id: { $in: ids } }).select('_id nome email telefone').lean();
  const donoMap = new Map(donos.map((d) => [String(d._id), d]));

  // Busca os pagamentos já registrados para este mês
  const pagamentos = await PagamentoMensal.find({ mes: mesRef, conta: { $in: ids } }).lean();
  const pagMap = new Map(pagamentos.map((p) => [String(p.conta), p]));

  // Monta lista unificada
  const itensCompletos = contas.map((c) => {
    const cid = String(c._id);
    const dono = donoMap.get(cid) || {};
    const plano = (c.plano && PLANOS[c.plano]) || null;
    const pag = pagMap.get(cid) || null;

    const valorPlano = plano?.preco || 0;
    const valorCobrado = pag && pag.valor != null ? pag.valor : valorPlano;
    const pago = Boolean(pag && pag.pago);

    return {
      contaId: cid,
      nome: c.nome,
      documento: c.documento ? formatarDocumento(c.documento) : '',
      documentoPuro: c.documento || '',
      email: c.emailCobranca || dono.email || '-',
      telefone: c.telefone || dono.telefone || '',
      responsavel: dono.nome || c.nome,
      planoCodigo: c.plano || 'sem_plano',
      planoNome: plano ? plano.nome : (c.status === 'cortesia' ? 'Cortesia' : 'Sem plano'),
      planoPreco: valorPlano,
      statusConta: c.status,
      // Dados do pagamento mensal
      pagamentoId: pag ? String(pag._id) : null,
      mes: mesRef,
      valor: valorCobrado,
      pago,
      pagoEm: pag?.pagoEm || null,
      formaPagamento: pag?.formaPagamento || 'pix',
      confirmadoPor: pag?.confirmadoPor || null,
      observacoes: pag?.observacoes || '',
    };
  });

  // Estatísticas globais do mês (antes dos filtros de visualização)
  const totalContas = itensCompletos.length;
  const totalPagos = itensCompletos.filter((x) => x.pago).length;
  const totalPendentes = totalContas - totalPagos;
  const valorTotalEsperado = itensCompletos.reduce((acc, x) => acc + (x.valor || 0), 0);
  const valorTotalPago = itensCompletos.filter((x) => x.pago).reduce((acc, x) => acc + (x.valor || 0), 0);
  const valorTotalPendente = valorTotalEsperado - valorTotalPago;
  const percentualPago = totalContas > 0 ? Math.round((totalPagos / totalContas) * 100) : 0;

  const estatisticas = {
    totalContas,
    totalPagos,
    totalPendentes,
    valorTotalEsperado,
    valorTotalPago,
    valorTotalPendente,
    percentualPago,
  };

  // Aplicação dos filtros para a listagem
  let itensFiltrados = [...itensCompletos];

  if (status === 'pagos' || status === 'pago') {
    itensFiltrados = itensFiltrados.filter((x) => x.pago);
  } else if (status === 'pendentes' || status === 'pendente') {
    itensFiltrados = itensFiltrados.filter((x) => !x.pago);
  }

  const termo = String(q || '').trim().toLowerCase();
  if (termo) {
    itensFiltrados = itensFiltrados.filter((x) => {
      const nDoc = String(x.documentoPuro || '').replace(/\D/g, '');
      const tPuro = termo.replace(/\D/g, '');
      return (
        x.nome.toLowerCase().includes(termo) ||
        x.email.toLowerCase().includes(termo) ||
        x.responsavel.toLowerCase().includes(termo) ||
        x.telefone.includes(termo) ||
        (tPuro && nDoc.includes(tPuro))
      );
    });
  }

  // Ordenação: primeiro os pendentes, depois por ordem alfabética de nome
  itensFiltrados.sort((a, b) => {
    if (a.pago !== b.pago) return a.pago ? 1 : -1;
    return a.nome.localeCompare(b.nome);
  });

  return {
    mes: mesRef,
    mesFormatado: formatarMesNome(mesRef),
    estatisticas,
    itens: itensFiltrados,
    mesesDisponiveis: listarCompetencias(mesRef),
    filtros: {
      mes: mesRef,
      status: status || 'todos',
      q: q || '',
    },
  };
}

/**
 * Registra o "OK" de pagamento de um escritório para a competência informada.
 * Atualiza também a Conta para situação ativa e estende o pagoAte se aplicável.
 */
export async function confirmarPagamento(contaId, mes, { valor, formaPagamento = 'pix', observacoes = '', adminEmail = 'admin', atualizarAcesso = true } = {}) {
  if (!mongoose.isValidObjectId(contaId)) throw new Error('ID do escritório inválido.');
  if (!mes || !/^\d{4}-\d{2}$/.test(mes)) throw new Error('Mês de referência inválido (use AAAA-MM).');

  const conta = await Conta.findById(contaId);
  if (!conta) throw new Error('Escritório não encontrado.');

  const valorNum = Math.max(0, Number(valor != null && valor !== '' ? valor : (conta.planoAtual()?.preco || 0)));

  // Atualiza ou insere o registro em PagamentoMensal
  const pag = await PagamentoMensal.findOneAndUpdate(
    { conta: conta._id, mes },
    {
      $set: {
        valor: valorNum,
        pago: true,
        pagoEm: new Date(),
        formaPagamento: formaPagamento || 'pix',
        confirmadoPor: adminEmail,
        observacoes: String(observacoes || '').trim(),
      },
    },
    { new: true, upsert: true, runValidators: true },
  );

  // Se solicitado, regulariza o acesso da conta
  if (atualizarAcesso) {
    let alterouConta = false;

    // Se estiver em atraso ou teste/pendente, ativa
    if (['inadimplente', 'pendente', 'teste'].includes(conta.status)) {
      conta.status = 'ativa';
      alterouConta = true;
    }

    // Calcula final do mês da competência para garantir que pagoAte esteja em dia
    const [a, m] = mes.split('-').map(Number);
    const fimDoMesPago = new Date(a, m, 0, 23, 59, 59); // último dia do mês
    if (!conta.pagoAte || conta.pagoAte < fimDoMesPago) {
      conta.pagoAte = fimDoMesPago;
      alterouConta = true;
    }

    conta.registrar(
      'pagamento-mensal-ok',
      `Pagamento de ${formatarMesNome(mes)} confirmado por ${adminEmail} (R$ ${brl(valorNum)} via ${formaPagamento.toUpperCase()})`,
      adminEmail,
    );

    await conta.save();
  }

  return pag;
}

/**
 * Desmarca o pagamento de um escritório para a competência informada (retorna para pendente).
 */
export async function desmarcarPagamento(contaId, mes, { adminEmail = 'admin' } = {}) {
  if (!mongoose.isValidObjectId(contaId)) throw new Error('ID do escritório inválido.');
  if (!mes || !/^\d{4}-\d{2}$/.test(mes)) throw new Error('Mês de referência inválido.');

  const pag = await PagamentoMensal.findOne({ conta: contaId, mes });
  if (!pag) throw new Error('Registro de pagamento não encontrado.');

  pag.pago = false;
  pag.pagoEm = null;
  pag.confirmadoPor = adminEmail;
  pag.observacoes = pag.observacoes
    ? `${pag.observacoes} | Pagamento desmarcado por ${adminEmail} em ${new Date().toLocaleDateString('pt-BR')}`
    : `Pagamento desmarcado por ${adminEmail}`;

  await pag.save();

  // Registra no histórico da conta
  const conta = await Conta.findById(contaId);
  if (conta) {
    conta.registrar(
      'pagamento-desmarcado',
      `Pagamento de ${formatarMesNome(mes)} desmarcado por ${adminEmail}`,
      adminEmail,
    );
    await conta.save();
  }

  return pag;
}

/**
 * Suspende o serviço/acesso de um escritório por falta de pagamento.
 */
export async function suspenderConta(contaId, { motivo, adminEmail = 'admin', mes } = {}) {
  if (!mongoose.isValidObjectId(contaId)) throw new Error('ID do escritório inválido.');

  const conta = await Conta.findById(contaId);
  if (!conta) throw new Error('Escritório não encontrado.');
  if (conta.status === 'suspensa') throw new Error('O escritório já está com o serviço suspenso.');

  conta.statusAnterior = conta.status === 'pausada' ? conta.statusAnterior : conta.status;
  conta.pausadaEm = undefined;
  conta.status = 'suspensa';

  const detalhe = motivo || `Serviço suspenso por falta de pagamento${mes ? ` da competência ${formatarMesNome(mes)}` : ''}`;
  conta.registrar('suspensao-falta-pagamento', detalhe, adminEmail);
  await conta.save();

  return conta;
}

/**
 * Reativa o serviço/acesso de um escritório que estava suspenso.
 */
export async function reativarConta(contaId, { adminEmail = 'admin', mes } = {}) {
  if (!mongoose.isValidObjectId(contaId)) throw new Error('ID do escritório inválido.');

  const conta = await Conta.findById(contaId);
  if (!conta) throw new Error('Escritório não encontrado.');

  conta.status = conta.statusAnterior && !['suspensa', 'pausada'].includes(conta.statusAnterior)
    ? conta.statusAnterior
    : 'ativa';
  conta.statusAnterior = null;
  conta.pausadaEm = undefined;

  const detalhe = `Serviço reativado por ${adminEmail}${mes ? ` (competência ${formatarMesNome(mes)})` : ''}`;
  conta.registrar('reativacao-servico', detalhe, adminEmail);
  await conta.save();

  return conta;
}

/**
 * Gera um arquivo CSV formatado com BOM UTF-8 compatível com Excel.
 */
export function gerarCsvPagamentos(dados) {
  const cabecalho = [
    'Escritorio',
    'Documento',
    'Responsavel',
    'Telefone',
    'Email',
    'Plano',
    'Competencia',
    'Valor (R$)',
    'Situacao',
    'Data Pagamento',
    'Forma Pagamento',
    'Confirmado Por',
    'Observacoes',
  ];

  const escapeCsv = (str) => {
    const s = String(str || '').replace(/"/g, '""');
    return `"${s}"`;
  };

  const linhas = [cabecalho.join(';')];

  dados.itens.forEach((i) => {
    const dPag = i.pagoEm
      ? new Date(i.pagoEm).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
      : '-';

    linhas.push([
      escapeCsv(i.nome),
      escapeCsv(i.documento),
      escapeCsv(i.responsavel),
      escapeCsv(i.telefone),
      escapeCsv(i.email),
      escapeCsv(i.planoNome),
      escapeCsv(dados.mesFormatado),
      escapeCsv(brl(i.valor)),
      escapeCsv(i.pago ? 'PAGO' : 'PENDENTE'),
      escapeCsv(dPag),
      escapeCsv(i.pago ? i.formaPagamento.toUpperCase() : '-'),
      escapeCsv(i.confirmadoPor || '-'),
      escapeCsv(i.observacoes || ''),
    ].join(';'));
  });

  // Linha de totais
  linhas.push('');
  linhas.push([
    escapeCsv('TOTAL GERAL'),
    '', '', '', '', '',
    escapeCsv(`Total: ${dados.estatisticas.totalContas} | Pagos: ${dados.estatisticas.totalPagos} | Pendentes: ${dados.estatisticas.totalPendentes}`),
    escapeCsv(brl(dados.estatisticas.valorTotalEsperado)),
    escapeCsv(`Adimplência: ${dados.estatisticas.percentualPago}%`),
    '', '', '', '',
  ].join(';'));

  return '\uFEFF' + linhas.join('\r\n');
}
