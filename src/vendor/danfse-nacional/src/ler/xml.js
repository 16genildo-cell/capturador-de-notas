/**
 * Leitura do XML da NFS-e sem depender de prefixo de namespace (o ADN manda com xmlns padrão,
 * sistemas municipais às vezes com ns2: na assinatura). Caminhos por nome local: 'DPS/infDPS/prest/CNPJ'.
 */
const { DOMParser } = require('@xmldom/xmldom');

function parse(xml) {
  const texto = Buffer.isBuffer(xml) ? xml.toString('utf8') : String(xml || '');
  if (!texto.trim()) throw new TypeError('XML vazio.');
  const erros = [];
  let doc;
  try {
    doc = new DOMParser({ onError: (nivel, msg) => { if (nivel !== 'warning') erros.push(msg); } })
      .parseFromString(texto.replace(/^﻿/, ''), 'text/xml');
  } catch (err) {
    erros.push(err.message);   // o xmldom 0.9 lança em erro fatal
  }
  if (erros.length || !doc || !doc.documentElement) throw new TypeError(`XML inválido: ${erros[0] || 'sem elemento raiz'}`);
  return doc.documentElement;
}

const filhos = no => (no ? Array.from(no.childNodes || []).filter(n => n.nodeType === 1) : []);
const nomeLocal = no => no.localName || String(no.nodeName).replace(/^.*:/, '');

/** Primeiro elemento no caminho (ou null). */
function no(raiz, caminho) {
  let atual = raiz;
  for (const parte of String(caminho).split('/').filter(Boolean)) {
    atual = filhos(atual).find(f => nomeLocal(f) === parte) || null;
    if (!atual) return null;
  }
  return atual;
}

/** Todos os elementos com o último nome do caminho, abaixo do penúltimo. */
function nos(raiz, caminho) {
  const partes = String(caminho).split('/').filter(Boolean);
  const ultimo = partes.pop();
  const pai = partes.length ? no(raiz, partes.join('/')) : raiz;
  return filhos(pai).filter(f => nomeLocal(f) === ultimo);
}

/** Texto (aparado) do elemento no caminho; ausente ou vazio → null. */
function texto(raiz, caminho) {
  const alvo = no(raiz, caminho);
  const t = alvo ? String(alvo.textContent || '').trim() : '';
  return t === '' ? null : t;
}

/** Leitor preso a um nó: const L = leitor(infDPS); L('prest/CNPJ'). L.no('toma') devolve outro leitor. */
function leitor(raiz) {
  const L = caminho => texto(raiz, caminho);
  L.raiz = raiz;
  L.existe = caminho => !!no(raiz, caminho);
  L.no = caminho => { const n = no(raiz, caminho); return n ? leitor(n) : null; };
  L.todos = caminho => nos(raiz, caminho).map(leitor);
  L.valor = () => { const t = raiz ? String(raiz.textContent || '').trim() : ''; return t === '' ? null : t; };
  L.attr = nome => (raiz && raiz.getAttribute ? raiz.getAttribute(nome) || null : null);
  return L;
}

module.exports = { parse, leitor, nomeLocal };
