import { xmlToObj } from './sefaz/parseDocumento.js';
import { formatarDocumento } from '../utils/documento.js';

/**
 * Extrai do XML os dados mostrados na tela de detalhe da nota:
 * blocos de informacoes, itens (NF-e), servico (NFS-e) ou componentes (CT-e) e totais.
 */
const lista = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
const t = (v) => (v === undefined || v === null ? '' : String(v));
const doc = (p) => (p ? formatarDocumento(p.CNPJ || p.CPF || '') : '');
const end = (e) =>
  e
    ? [[e.xLgr, e.nro].filter(Boolean).join(', '), e.xBairro, [e.xMun, e.UF].filter(Boolean).join('/'), e.CEP].filter(Boolean).join(' - ')
    : '';

function detalheNFe(obj) {
  const nfe = obj?.nfeProc?.NFe || obj?.NFe;
  if (!nfe) return null;
  const inf = nfe.infNFe || {};
  const ide = inf.ide || {};
  const tot = inf.total?.ICMSTot || {};
  const prot = obj?.nfeProc?.protNFe?.infProt || {};
  return {
    blocos: [
      {
        titulo: 'Emitente',
        campos: [['Nome', inf.emit?.xNome], ['CNPJ/CPF', doc(inf.emit)], ['IE', inf.emit?.IE], ['Endereco', end(inf.emit?.enderEmit)]],
      },
      {
        titulo: 'Destinatario',
        campos: [['Nome', inf.dest?.xNome], ['CNPJ/CPF', doc(inf.dest)], ['IE', inf.dest?.IE], ['Endereco', end(inf.dest?.enderDest)]],
      },
      {
        titulo: 'Operacao',
        campos: [
          ['Natureza', ide.natOp],
          ['Tipo', ide.tpNF === '0' ? 'Entrada' : 'Saida'],
          ['Modelo / serie', `${t(ide.mod)} / ${t(ide.serie)}`],
          ['Protocolo', [prot.nProt, prot.dhRecbto ? new Date(prot.dhRecbto).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : ''].filter(Boolean).join(' em ')],
        ],
      },
    ],
    colunas: ['Codigo', 'Descricao', 'NCM', 'CFOP', 'Un', 'Qtd', 'Vl. unit.', 'Vl. total'],
    numericas: [5, 6, 7],
    itens: lista(inf.det).map((d) => {
      const p = d.prod || {};
      return [p.cProd, p.xProd, p.NCM, p.CFOP, p.uCom, Number(p.qCom), Number(p.vUnCom), Number(p.vProd)];
    }),
    totais: [
      ['Produtos', tot.vProd], ['Frete', tot.vFrete], ['Desconto', tot.vDesc], ['ICMS', tot.vICMS],
      ['ICMS ST', tot.vST], ['IPI', tot.vIPI], ['Total da nota', tot.vNF],
    ],
    observacoes: [inf.infAdic?.infCpl, inf.infAdic?.infAdFisco].filter(Boolean).join('\n'),
  };
}

function detalheNFSe(obj) {
  const inf = obj?.NFSe?.infNFSe;
  if (!inf) return null;
  const dps = inf.DPS?.infDPS || {};
  const v = inf.valores || {};
  return {
    blocos: [
      { titulo: 'Prestador', campos: [['Nome', inf.emit?.xNome || dps.prest?.xNome], ['CNPJ/CPF', doc(inf.emit) || doc(dps.prest)], ['Inscricao municipal', inf.emit?.IM]] },
      { titulo: 'Tomador', campos: [['Nome', dps.toma?.xNome], ['CNPJ/CPF', doc(dps.toma)], ['E-mail', dps.toma?.email]] },
      {
        titulo: 'Servico',
        campos: [
          ['Codigo nacional', dps.serv?.cServ?.cTribNac],
          ['Local da prestacao', inf.xLocPrestacao],
          ['Competencia', dps.dCompet],
          ['Descricao', dps.serv?.cServ?.xDescServ],
        ],
      },
    ],
    colunas: [],
    itens: [],
    totais: [
      ['Valor do servico', dps.valores?.vServPrest?.vServ], ['Base de calculo', v.vBC], ['Aliquota ISS (%)', v.pAliqAplic],
      ['ISS', v.vISSQN], ['Retencoes', v.vTotalRet], ['Valor liquido', v.vLiq],
    ],
    observacoes: t(dps.infoCompl?.xInfComp),
  };
}

function detalheCTe(obj) {
  const cte = obj?.cteProc?.CTe || obj?.CTe || obj?.cteOSProc?.CTeOS || obj?.CTeOS;
  if (!cte) return null;
  const inf = cte.infCte || cte.infCTe || {};
  const ide = inf.ide || {};
  return {
    blocos: [
      { titulo: 'Transportador', campos: [['Nome', inf.emit?.xNome], ['CNPJ', doc(inf.emit)], ['IE', inf.emit?.IE]] },
      {
        titulo: 'Prestacao',
        campos: [
          ['Inicio', [ide.xMunIni, ide.UFIni].filter(Boolean).join('/')],
          ['Fim', [ide.xMunFim, ide.UFFim].filter(Boolean).join('/')],
          ['CFOP', ide.CFOP],
          ['Carga', inf.infCTeNorm?.infCarga?.proPred],
        ],
      },
      { titulo: 'Remetente / destinatario', campos: [['Remetente', inf.rem?.xNome], ['CNPJ/CPF', doc(inf.rem)], ['Destinatario', inf.dest?.xNome], ['CNPJ/CPF ', doc(inf.dest)]] },
    ],
    colunas: ['Componente', 'Valor'],
    numericas: [1],
    itens: lista(inf.vPrest?.Comp).map((c) => [c.xNome, Number(c.vComp)]),
    totais: [['Valor da prestacao', inf.vPrest?.vTPrest], ['Valor a receber', inf.vPrest?.vRec], ['Valor da carga', inf.infCTeNorm?.infCarga?.vCarga]],
    observacoes: t(inf.compl?.xObs),
  };
}

function detalheResumo(obj) {
  const r = obj?.resNFe;
  if (!r) return null;
  return {
    blocos: [{ titulo: 'Emitente', campos: [['Nome', r.xNome], ['CNPJ/CPF', formatarDocumento(r.CNPJ || r.CPF || '')], ['IE', r.IE]] }],
    colunas: [],
    itens: [],
    totais: [['Valor da nota', r.vNF]],
    observacoes: 'Apenas o resumo da nota esta disponivel. De ciencia para baixar o XML completo com os itens.',
  };
}

export function detalharDocumento(nota) {
  let obj;
  try {
    obj = xmlToObj(nota.xml || '');
  } catch {
    return null;
  }
  const d = detalheNFe(obj) || detalheNFSe(obj) || detalheCTe(obj) || detalheResumo(obj);
  if (!d) return null;
  d.blocos = d.blocos.map((b) => ({ ...b, campos: b.campos.filter(([, v]) => v !== undefined && v !== null && v !== '') }));
  // Mostra os totais preenchidos; os principais aparecem mesmo zerados.
  const principal = /total|liquido|receber|valor do servico|valor da nota/i;
  d.totais = d.totais.filter(([k, v]) => v !== undefined && v !== null && v !== '' && (Number(v) !== 0 || principal.test(k)));
  return d;
}
