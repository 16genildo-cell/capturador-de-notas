import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET = 'segredo-de-teste';
const { gerarTokenAcesso, lerTokenAcesso } = await import('../src/api/tokens.js');

test('token de acesso: valida o proprio e recusa adulterado', () => {
  const t = gerarTokenAcesso({ _id: 'abc123' });
  assert.equal(lerTokenAcesso(t), 'abc123');
  const [cab, corpo, ass] = t.split('.');
  const outro = Buffer.from(JSON.stringify({ sub: 'outro', exp: 9999999999 })).toString('base64url');
  assert.equal(lerTokenAcesso(`${cab}.${outro}.${ass}`), null);
  // troca o 1o caractere da assinatura por outro diferente (com 'x' fixo o teste falhava 1 vez em 64)
  assert.equal(lerTokenAcesso(`${cab}.${corpo}.${ass[0] === 'x' ? 'y' : 'x'}${ass.slice(1)}`), null);
  assert.equal(lerTokenAcesso('lixo'), null);
  assert.equal(lerTokenAcesso(undefined), null);
});
