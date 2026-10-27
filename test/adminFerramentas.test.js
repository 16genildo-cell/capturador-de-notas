import { test } from 'node:test';
import assert from 'node:assert/strict';
import { env } from '../src/config/env.js';
import { capturaEmAndamento, liberarTravaCaptura } from '../src/services/capturaService.js';
import { _definirFetch, sincronizarAssinatura } from '../src/services/asaas.js';
import { Conta } from '../src/models/Conta.js';

test('capturaEmAndamento e liberarTravaCaptura: controle da trava de execução', async () => {
  const empresaId = 'empresa_teste_123';
  // Começa sem trava
  assert.equal(capturaEmAndamento(empresaId), false);

  // Simula início de captura manual
  liberarTravaCaptura(empresaId);
  assert.equal(capturaEmAndamento(empresaId), false);
});

test('sincronizarAssinatura: atualiza status para ativa quando há pagamento confirmado no Asaas', async () => {
  // Configura chave e fetch mock para o Asaas
  env.asaas.apiKey = 'chave_teste_asaas';

  _definirFetch(async (url) => {
    const caminho = String(url);
    if (caminho.includes('/payments')) {
      return {
        ok: true,
        text: async () =>
          JSON.stringify({
            data: [
              {
                id: 'pay_999',
                status: 'CONFIRMED',
                value: 149.9,
                dueDate: '2026-11-20',
              },
            ],
          }),
      };
    }
    // GET /subscriptions/:id
    return {
      ok: true,
      text: async () => JSON.stringify({ id: 'sub_123', status: 'ACTIVE' }),
    };
  });

  const conta = new Conta({
    nome: 'Escritório Modelo',
    status: 'inadimplente',
    plano: 'profissional',
    asaas: { subscriptionId: 'sub_123' },
  });

  // Não salva no mongo real no teste unitário, apenas testa o método
  conta.save = async () => {};

  const resultado = await sincronizarAssinatura(conta);

  assert.equal(resultado.statusAnterior, 'inadimplente');
  assert.equal(resultado.statusAtual, 'ativa');
  assert.ok(conta.pagoAte);
  assert.ok(resultado.ultimoPagamento.includes('CONFIRMED'));
});

test('serproConfigurado: nao lanca erro mesmo com env vazio ou preenchido', async () => {
  const { serproConfigurado } = await import('../src/services/certidoes/serproCnd.js');
  // Nao deve lancar excecao com variaveis ausentes
  assert.equal(typeof serproConfigurado(), 'boolean');
});
