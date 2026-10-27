import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { sanitizarNoSql, cabecalhosSeguranca, rateLimiter } from '../src/middleware/seguranca.js';
import { validarXmlSeguro } from '../src/services/sefaz/parseDocumento.js';
import { encrypt, decryptString, recriptografar } from '../src/services/crypto/vault.js';

test('sanitizarNoSql: remove chaves com $ e chaves com ponto (.) recursivamente', () => {
  const req = {
    body: {
      email: 'usuario@teste.com',
      $where: 'sleep(5000)',
      filtro: {
        $gt: 10,
        normal: 'ok',
      },
      'usuario.admin': true,
      itens: [{ $ne: null, id: 123 }],
    },
    query: {
      $regex: '.*',
      pagina: '1',
    },
    params: {
      id: 'abc',
    },
  };

  let nextChamado = false;
  sanitizarNoSql(req, {}, () => {
    nextChamado = true;
  });

  assert.equal(nextChamado, true);
  // Campos maliciosos removidos
  assert.equal(req.body.$where, undefined);
  assert.equal(req.body.filtro.$gt, undefined);
  assert.equal(req.body['usuario.admin'], undefined);
  assert.equal(req.body.itens[0].$ne, undefined);
  assert.equal(req.query.$regex, undefined);

  // Campos legítimos preservados
  assert.equal(req.body.email, 'usuario@teste.com');
  assert.equal(req.body.filtro.normal, 'ok');
  assert.equal(req.body.itens[0].id, 123);
  assert.equal(req.query.pagina, '1');
  assert.equal(req.params.id, 'abc');
});

test('cabecalhosSeguranca: define CSP, anti-clickjacking, nosniff, Permissions-Policy e HSTS', () => {
  const headers = {};
  const req = {
    secure: true,
    get: (h) => (h.toLowerCase() === 'x-forwarded-proto' ? 'https' : null),
  };
  const res = {
    set: (k, v) => {
      headers[k.toLowerCase()] = v;
    },
  };

  let nextChamado = false;
  cabecalhosSeguranca(req, res, () => {
    nextChamado = true;
  });

  assert.equal(nextChamado, true);
  assert.ok(headers['content-security-policy'].includes("default-src 'self'"));
  assert.equal(headers['x-frame-options'], 'DENY');
  assert.equal(headers['x-content-type-options'], 'nosniff');
  assert.equal(headers['referrer-policy'], 'same-origin');
  assert.equal(headers['x-xss-protection'], '0');
  assert.ok(headers['permissions-policy'].includes('camera=()'));
  assert.ok(headers['strict-transport-security'].includes('max-age=31536000'));
});

test('validarXmlSeguro: bloqueia XXE e entidades externas, mas aceita XML fiscal normal', () => {
  // XML normal
  assert.doesNotThrow(() => {
    validarXmlSeguro('<NFe><infNFe><chNFe>123456</chNFe></infNFe></NFe>');
  });

  // XXE via DOCTYPE
  assert.throws(() => {
    validarXmlSeguro('<!DOCTYPE foo [<!ELEMENT foo ANY >]><foo>teste</foo>');
  }, /declarações DTD\/ENTITY não são permitidas/);

  // XXE via ENTITY
  assert.throws(() => {
    validarXmlSeguro('<!ENTITY xxe SYSTEM "file:///etc/passwd"><foo>&xxe;</foo>');
  }, /declarações DTD\/ENTITY não são permitidas/);
});

test('vault: versionamento v1 e suporte a rotação de chaves', () => {
  const chaveA = crypto.randomBytes(32).toString('hex');
  const chaveB = crypto.randomBytes(32).toString('hex');
  const segredo = 'SenhaForte123!@#';

  // 1) Criptografa com a Chave A
  const cifradoA = encrypt(segredo, { keyHex: chaveA, versao: 'v1' });
  assert.ok(cifradoA.startsWith('v1:'));

  // 2) Descriptografa com a Chave A
  const decifradoA = decryptString(cifradoA, { keyHex: chaveA });
  assert.equal(decifradoA, segredo);

  // 3) Descriptografia com chave errada falha
  assert.throws(() => {
    decryptString(cifradoA, { keyHex: chaveB });
  }, /Falha de autenticação ao descriptografar/);

  // 4) Rotação de chaves: recriptografar de Chave A para Chave B
  const cifradoB = recriptografar(cifradoA, chaveA, chaveB);
  assert.ok(cifradoB.startsWith('v1:'));

  const decifradoB = decryptString(cifradoB, { keyHex: chaveB });
  assert.equal(decifradoB, segredo);

  // 5) Compatibilidade com dados legados sem prefixo de versão
  const legadoSemVersao = encrypt(segredo, { keyHex: chaveA, versao: '' });
  assert.ok(!legadoSemVersao.includes(':'));
  const decifradoLegado = decryptString(legadoSemVersao, { keyHex: chaveA });
  assert.equal(decifradoLegado, segredo);
});

test('rateLimiter: bloqueia após exceder o limite na janela de tempo', async () => {
  const limiter = rateLimiter({ janelaMs: 1000, max: 2, prefixo: 'teste_rl' });
  const req = { ip: '10.0.0.1' };
  let statusResposta = 200;
  let corpoResposta = null;
  const res = {
    set: () => {},
    status: (code) => {
      statusResposta = code;
      return {
        json: (data) => {
          corpoResposta = data;
        },
      };
    },
  };

  let chamou1 = false;
  await limiter(req, res, () => {
    chamou1 = true;
  });
  assert.equal(chamou1, true);

  let chamou2 = false;
  await limiter(req, res, () => {
    chamou2 = true;
  });
  assert.equal(chamou2, true);

  let chamou3 = false;
  await limiter(req, res, () => {
    chamou3 = true;
  });
  assert.equal(chamou3, false);
  assert.equal(statusResposta, 429);
  assert.ok(corpoResposta.erro);
  assert.ok(corpoResposta.retryAfter >= 0);
});
