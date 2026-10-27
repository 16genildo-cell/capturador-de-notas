import AdmZip from 'adm-zip';
import { xmlToObj } from './sefaz/parseDocumento.js';
import { salvarDocumento } from './sefaz/distribuicaoDFe.js';
import { salvarCte } from './sefaz/cteDistribuicao.js';
import { salvarDocumentoNfse } from './nfse/index.js';
import { soDigitos } from '../utils/documento.js';

/**
 * Importacao de XMLs (NF-e/NFC-e, NFS-e nacional, CT-e e eventos) enviados pelo usuario,
 * soltos ou dentro de arquivos .zip. Serve para as notas que a SEFAZ nao entrega pela
 * captura, como as notas de VENDA emitidas pela propria empresa.
 */
const LIMITE_ARQUIVOS = 5000;
const LIMITE_TAMANHO_XML = 10 * 1024 * 1024; // 10 MB por arquivo
const LIMITE_TOTAL_DESCOMPACTADO = 100 * 1024 * 1024; // 100 MB total (protecao contra zip bomb)

function doc(p) {
  return p ? soDigitos(p.CNPJ || p.CPF || '') : '';
}

/** Identifica o tipo do XML e os CNPJ/CPF envolvidos (para achar a empresa). */
export function identificarXml(xml) {
  if (typeof xml === 'string' && (/<!ENTITY/i.test(xml) || /<!DOCTYPE/i.test(xml))) {
    return { tipo: null, motivo: 'XML rejeitado por conter declarações DTD/ENTITY não permitidas' };
  }

  let obj;
  try {
    obj = xmlToObj(xml);
  } catch (err) {
    return { tipo: null, motivo: err.message || 'XML invalido' };
  }

  const nfe = obj?.nfeProc?.NFe || obj?.NFe;
  if (nfe) {
    const inf = nfe.infNFe || {};
    return { tipo: 'nfe', docs: [doc(inf.emit), doc(inf.dest)], autorizada: Boolean(obj?.nfeProc?.protNFe) };
  }
  if (obj?.resNFe) return { tipo: 'nfe', docs: [], motivo: 'resumo de NF-e (sem dados do destinatario)' };
  if (obj?.procEventoNFe || obj?.resEvento || obj?.evento?.infEvento?.chNFe) {
    const ev = obj?.procEventoNFe?.evento?.infEvento || obj?.resEvento || obj?.evento?.infEvento || {};
    return { tipo: 'evento-nfe', docs: [soDigitos(ev.CNPJ || ev.CPF || ''), String(ev.chNFe || '').slice(6, 20)] };
  }

  const nfse = obj?.NFSe?.infNFSe;
  if (nfse) {
    const dps = nfse.DPS?.infDPS || {};
    return { tipo: 'nfse', docs: [doc(nfse.emit), doc(dps.prest), doc(dps.toma), doc(dps.interm)] };
  }
  if (obj?.evento?.infEvento?.pedRegEvento) {
    const ch = String(obj.evento.infEvento.pedRegEvento.infPedReg?.chNFSe || '');
    return { tipo: 'evento-nfse', docs: [soDigitos(obj.evento.infEvento.pedRegEvento.infPedReg?.CNPJAutor || '')], chave: ch };
  }

  const cte = obj?.cteProc?.CTe || obj?.CTe || obj?.cteOSProc?.CTeOS || obj?.CTeOS;
  if (cte) {
    const inf = cte.infCte || cte.infCTe || {};
    return {
      tipo: 'cte',
      docs: [doc(inf.emit), doc(inf.rem), doc(inf.dest), doc(inf.exped), doc(inf.receb), doc(inf.ide?.toma4)],
    };
  }
  if (obj?.procEventoCTe) {
    const ev = obj.procEventoCTe.eventoCTe?.infEvento || {};
    return { tipo: 'evento-cte', docs: [soDigitos(ev.CNPJ || ''), String(ev.chCTe || '').slice(6, 20)] };
  }

  return { tipo: null, motivo: 'tipo de documento nao reconhecido' };
}

/**
 * Empresas cadastradas que aparecem no documento: CNPJ/CPF exato; se nenhuma,
 * a mesma raiz de CNPJ (filial). Um documento entre duas empresas cadastradas
 * (ex.: venda da matriz para a filial) e gravado para as duas.
 */
export function escolherEmpresas(empresas, docs) {
  const lista = [...new Set(docs.filter(Boolean))];
  const exatas = empresas.filter((x) => lista.includes(soDigitos(x.cnpj)));
  if (exatas.length) return exatas;
  const raizes = lista.filter((x) => x.length === 14).map((x) => x.slice(0, 8));
  return empresas.filter((x) => soDigitos(x.cnpj).length === 14 && raizes.includes(soDigitos(x.cnpj).slice(0, 8))).slice(0, 1);
}

export function escolherEmpresa(empresas, docs) {
  return escolherEmpresas(empresas, docs)[0] || null;
}

/** Extrai os XMLs de uma lista de arquivos enviados (xml soltos e zips, inclusive zip dentro de zip). */
export function extrairXmls(arquivos) {
  const saida = [];
  let totalBytes = 0;

  const visitar = (nome, buf, nivel = 0) => {
    if (saida.length >= LIMITE_ARQUIVOS) return;
    if (totalBytes > LIMITE_TOTAL_DESCOMPACTADO) {
      saida.push({ nome, erro: 'Limite total de descompactação excedido (possível Zip Bomb)' });
      return;
    }
    if (buf.length > LIMITE_TAMANHO_XML) {
      saida.push({ nome, erro: 'Arquivo individual excede o limite de 10 MB' });
      return;
    }

    if (/\.zip$/i.test(nome) || (buf[0] === 0x50 && buf[1] === 0x4b)) {
      if (nivel > 2) return;
      let zip;
      try {
        zip = new AdmZip(buf);
      } catch {
        saida.push({ nome, erro: 'ZIP invalido ou corrompido' });
        return;
      }
      for (const entrada of zip.getEntries()) {
        if (entrada.isDirectory) continue;
        if (!/\.(xml|zip)$/i.test(entrada.entryName)) continue;
        const dados = entrada.getData();
        totalBytes += dados.length;
        visitar(`${nome}/${entrada.entryName}`, dados, nivel + 1);
      }
      return;
    }
    if (/\.xml$/i.test(nome) || buf.slice(0, 200).toString('utf8').includes('<')) {
      saida.push({ nome, xml: buf.toString('utf8').replace(/^﻿/, '').trim() });
    }
  };
  for (const a of arquivos) visitar(a.originalname, a.buffer);
  return saida;
}

/**
 * Importa os XMLs para as empresas da conta.
 * @param empresas lista de empresas da conta (documentos mongoose ou lean com _id, owner, cnpj)
 * @param empresaForcada se informada, todos os documentos vao para ela
 */
export async function importarArquivos(arquivos, empresas, { empresaForcada = null } = {}) {
  const xmls = extrairXmls(arquivos);
  const resumo = { total: xmls.length, novos: 0, atualizados: 0, duplicados: 0, eventos: 0, semEmpresa: 0, invalidos: 0 };
  const detalhes = [];

  for (const item of xmls) {
    if (item.erro) {
      resumo.invalidos += 1;
      detalhes.push({ nome: item.nome, resultado: 'erro', motivo: item.erro });
      continue;
    }
    const id = identificarXml(item.xml);
    if (!id.tipo) {
      resumo.invalidos += 1;
      detalhes.push({ nome: item.nome, resultado: 'ignorado', motivo: id.motivo });
      continue;
    }
    const alvos = empresaForcada ? [empresaForcada] : escolherEmpresas(empresas, id.docs || []);
    if (alvos.length === 0) {
      resumo.semEmpresa += 1;
      detalhes.push({ nome: item.nome, resultado: 'sem empresa', motivo: 'Nenhuma empresa cadastrada aparece neste documento' });
      continue;
    }

    for (const empresa of alvos) {
      try {
        let r;
        if (id.tipo === 'nfe' || id.tipo === 'evento-nfe') r = await salvarDocumento(empresa, { xml: item.xml, origem: 'importacao' });
        else if (id.tipo === 'nfse' || id.tipo === 'evento-nfse') r = await salvarDocumentoNfse(empresa, { xml: item.xml, origem: 'importacao' });
        else r = await salvarCte(empresa, { xml: item.xml, origem: 'importacao' });

        if (id.tipo.startsWith('evento')) {
          resumo.eventos += 1;
          detalhes.push({ nome: item.nome, resultado: 'evento aplicado', empresa: empresa.razaoSocial });
        } else if (r === 'novo') {
          resumo.novos += 1;
          detalhes.push({ nome: item.nome, resultado: 'importado', empresa: empresa.razaoSocial });
        } else if (r === 'atualizado') {
          resumo.atualizados += 1;
          detalhes.push({ nome: item.nome, resultado: 'resumo trocado pelo XML completo', empresa: empresa.razaoSocial });
        } else {
          resumo.duplicados += 1;
          detalhes.push({ nome: item.nome, resultado: 'ja existia', empresa: empresa.razaoSocial });
        }
      } catch (err) {
        resumo.invalidos += 1;
        detalhes.push({ nome: item.nome, resultado: 'erro', motivo: err.message });
      }
    }
  }
  return { resumo, detalhes };
}
