import mongoose from 'mongoose';
import { ProdutoNfe } from '../models/ProdutoNfe.js';
import { MovimentacaoEstoque } from '../models/MovimentacaoEstoque.js';

/**
 * Realiza uma movimentação de estoque e registra o histórico de auditoria.
 */
export async function movimentarEstoque({
  owner,
  empresa,
  produtoId,
  tipo, // 'entrada' | 'saida' | 'ajuste'
  quantidade,
  origem = 'manual',
  referenciaId = null,
  documentoNumero = '',
  motivo = '',
}) {
  if (!mongoose.isValidObjectId(produtoId)) return null;
  const prod = await ProdutoNfe.findById(produtoId);
  if (!prod) return null;
  if (prod.controlaEstoque === false) return prod;

  const qtd = Math.abs(Number(quantidade) || 0);
  const anterior = Number(prod.estoque || 0);
  let novo = anterior;

  if (tipo === 'entrada') {
    novo = anterior + qtd;
  } else if (tipo === 'saida') {
    novo = anterior - qtd;
  } else if (tipo === 'ajuste') {
    novo = qtd;
  }

  prod.estoque = Math.round(novo * 10000) / 10000;
  await prod.save();

  await MovimentacaoEstoque.create({
    owner: owner || prod.owner,
    empresa: empresa || prod.empresa,
    produto: prod._id,
    tipo,
    quantidade: qtd,
    estoqueAnterior: anterior,
    estoqueFinal: prod.estoque,
    origem,
    referenciaId,
    documentoNumero,
    motivo,
  });

  return prod;
}

/**
 * Dá baixa no estoque para todos os produtos de uma venda emitida.
 */
export async function abaterEstoqueVenda(emissao) {
  if (!emissao || !emissao.dados?.itens) return;
  for (const item of emissao.dados.itens) {
    if (!item.produtoId) continue;
    const qtd = Number(item.quantidade || 1);
    await movimentarEstoque({
      owner: emissao.owner,
      empresa: emissao.empresa?._id || emissao.empresa,
      produtoId: item.produtoId,
      tipo: 'saida',
      quantidade: qtd,
      origem: 'venda',
      referenciaId: emissao._id,
      documentoNumero: `${emissao.numero || ''}/${emissao.serie || ''}`,
      motivo: `Emissão ${emissao.modelo === '65' ? 'NFC-e' : 'NF-e'} nº ${emissao.numero}`,
    }).catch((err) => console.warn(`[estoque] erro ao abater item ${item.produtoId}:`, err.message));
  }
}

/**
 * Estorna o estoque quando uma nota/venda for cancelada na SEFAZ.
 */
export async function estornarEstoqueVenda(emissao, motivo = 'Cancelamento na SEFAZ') {
  if (!emissao || !emissao.dados?.itens) return;
  for (const item of emissao.dados.itens) {
    if (!item.produtoId) continue;
    const qtd = Number(item.quantidade || 1);
    await movimentarEstoque({
      owner: emissao.owner,
      empresa: emissao.empresa?._id || emissao.empresa,
      produtoId: item.produtoId,
      tipo: 'entrada',
      quantidade: qtd,
      origem: 'cancelamento',
      referenciaId: emissao._id,
      documentoNumero: `${emissao.numero || ''}/${emissao.serie || ''}`,
      motivo,
    }).catch((err) => console.warn(`[estoque] erro ao estornar item ${item.produtoId}:`, err.message));
  }
}
