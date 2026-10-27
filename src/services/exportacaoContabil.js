import { soDigitos, formatarDocumento } from '../utils/documento.js';

/**
 * Gera os arquivos de integração direta para os principais softwares contábeis do Brasil.
 */

const dataFmt = (d) => {
  if (!d) return '';
  const dt = new Date(d);
  const dia = String(dt.getDate()).padStart(2, '0');
  const mes = String(dt.getMonth() + 1).padStart(2, '0');
  const ano = dt.getFullYear();
  return `${dia}/${mes}/${ano}`;
};

const numFmt = (n) => Number(n || 0).toFixed(2).replace('.', ',');

/**
 * Layout de Importação Fiscal - Domínio Sistemas (TXT padrão SPED Fiscal / Domínio)
 */
export function gerarLayoutDominio(notas, cnpjEmpresa = '') {
  const linhas = [
    '|0000|DOMINIO_SISTEMAS_FISCAL|1.00|',
  ];

  for (const n of notas) {
    const modelo = n.modelo || (n.tipo === 'nfce' ? '65' : n.tipo === 'nfse' ? '00' : '55');
    const chave = n.chave || n.chaveNota || '';
    const cancelada = n.cancelada || n.statusSefaz === 'cancelada' ? 'S' : 'N';
    const emitCnpj = soDigitos(n.emitenteCnpjCpf || n.emitenteCnpj);
    const destCnpj = soDigitos(n.destinatarioCnpjCpf || n.destinatarioCnpj);
    const isSaida = n.papel === 'emitente' || (cnpjEmpresa && soDigitos(emitCnpj) === soDigitos(cnpjEmpresa));
    const indOper = isSaida ? '1' : '0'; // 0 = Entrada, 1 = Saída
    const indEmit = isSaida ? '0' : '1'; // 0 = Emissão própria, 1 = Terceiros

    linhas.push(
      [
        '',
        'C100',
        indOper,
        indEmit,
        modelo,
        n.serie || '1',
        n.numero || '',
        dataFmt(n.dataEmissao),
        emitCnpj,
        destCnpj,
        numFmt(n.valorTotal || n.totais?.valorTotal),
        cancelada,
        chave,
        '',
      ].join('|'),
    );
  }

  return linhas.join('\r\n');
}

/**
 * Layout de Importação Fiscal - Questor Sistemas
 */
export function gerarLayoutQuestor(notas, cnpjEmpresa = '') {
  const linhas = [
    'QUESTOR_FISCAL_V1;REGISTRO;OPERACAO;MODELO;SERIE;NUMERO;DATA_EMISSAO;CNPJ_EMIT;CNPJ_DEST;VALOR_TOTAL;SITUACAO;CHAVE_ACESSO',
  ];

  for (const n of notas) {
    const isSaida = n.papel === 'emitente' || (cnpjEmpresa && soDigitos(n.emitenteCnpjCpf || n.emitenteCnpj) === soDigitos(cnpjEmpresa));
    linhas.push(
      [
        'NF',
        isSaida ? 'SAIDA' : 'ENTRADA',
        n.modelo || (n.tipo === 'nfce' ? '65' : '55'),
        n.serie || '1',
        n.numero || '',
        dataFmt(n.dataEmissao),
        soDigitos(n.emitenteCnpjCpf || n.emitenteCnpj),
        soDigitos(n.destinatarioCnpjCpf || n.destinatarioCnpj),
        numFmt(n.valorTotal || n.totais?.valorTotal),
        n.cancelada || n.statusSefaz === 'cancelada' ? 'CANCELADA' : 'REGULAR',
        n.chave || '',
      ].join(';'),
    );
  }

  return `\ufeff${linhas.join('\r\n')}`;
}

/**
 * Layout de Importação Fiscal - Alterdata Pack
 */
export function gerarLayoutAlterdata(notas, cnpjEmpresa = '') {
  const linhas = [
    '[ALTERDATA_PACK_NOTAS]',
  ];

  for (const n of notas) {
    const isSaida = n.papel === 'emitente' || (cnpjEmpresa && soDigitos(n.emitenteCnpjCpf || n.emitenteCnpj) === soDigitos(cnpjEmpresa));
    linhas.push(
      [
        'NFE',
        n.numero || '',
        n.serie || '1',
        isSaida ? '0' : '1', // 0 = Própria/Saída, 1 = Terceiros/Entrada
        n.modelo || '55',
        dataFmt(n.dataEmissao),
        soDigitos(n.emitenteCnpjCpf || n.emitenteCnpj),
        soDigitos(n.destinatarioCnpjCpf || n.destinatarioCnpj),
        numFmt(n.valorTotal || n.totais?.valorTotal),
        n.cancelada || n.statusSefaz === 'cancelada' ? 'C' : 'N',
        n.chave || '',
      ].join(';'),
    );
  }

  return linhas.join('\r\n');
}
