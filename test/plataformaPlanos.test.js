import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import expressLayouts from 'express-ejs-layouts';
import { fileURLToPath } from 'node:url';
import './helpers.js';

process.env.ADMIN_EMAIL = 'dono@plataforma.com';
const { Plano } = await import('../src/models/Plano.js');
const { Conta } = await import('../src/models/Conta.js');
const { default: plataformaRoutes } = await import('../src/routes/plataforma.js');
const { aplicarPlanos } = await import('../src/config/planos.js');

const bancoPlanos = new Map();
bancoPlanos.set('basico', {
  _id: 'basico',
  nome: 'Inicial',
  descricao: 'Plano inicial',
  preco: 79.9,
  periodo: { quantidade: 1, unidade: 'mes' },
  limiteEmpresas: 3,
  limiteUsuarios: null,
  diasGratis: 14,
  funcionalidades: ['captura_nfe'],
  retencaoDias: null,
  apagarAoBaixar: false,
  ativo: true,
  publico: true,
  destaque: false,
  ordem: 1,
});

Plano.find = () => ({
  lean: async () => Array.from(bancoPlanos.values()),
});
Plano.findById = async (id) => {
  const p = bancoPlanos.get(String(id));
  if (!p) return null;
  return {
    ...p,
    set(dados) { Object.assign(this, dados); },
    save: async function() { bancoPlanos.set(String(id), { ...this }); return this; },
  };
};
Plano.exists = async (q) => bancoPlanos.has(String(q._id));
Plano.create = async (dados) => {
  const id = String(dados._id);
  const doc = { ...dados, _id: id };
  bancoPlanos.set(id, doc);
  return {
    ...doc,
    toObject() { return { ...doc }; },
  };
};
Plano.deleteOne = async (q) => {
  bancoPlanos.delete(String(q._id));
};
Conta.aggregate = async () => [];
Conta.countDocuments = async () => 0;

function montar(sessao = { userId: 'dono-123' }) {
  const app = express();
  const viewsDir = fileURLToPath(new URL('../src/views', import.meta.url));
  app.set('views', viewsDir);
  app.set('view engine', 'ejs');
  app.use(expressLayouts);
  app.set('layout', 'layout');
  app.use(express.urlencoded({ extended: true }));
  app.use((req, res, next) => {
    req.session = Object.assign(sessao, { save: (cb) => cb?.() });
    req.user = { _id: 'dono-123', nome: 'Dono', email: 'dono@plataforma.com', role: 'admin', ativo: true };
    req.ehPlataforma = true;
    res.locals.user = req.user;
    res.locals.ehPlataforma = true;
    res.locals.currentPath = req.path;
    res.locals.queryAtual = req.query;
    res.locals.flash = req.session.flash || null;
    delete req.session.flash;
    next();
  });
  app.use('/plataforma', plataformaRoutes);
  return new Promise((ok) => { const s = app.listen(0, () => ok(s)); });
}

test('plataforma/planos: visualiza, cria, edita, arquiva e exclui pacotes', async () => {
  const s = await montar();
  const url = (p) => `http://127.0.0.1:${s.address().port}${p}`;

  try {
    // 1) Visualizar lista de pacotes
    const resGet = await fetch(url('/plataforma/planos'));
    assert.equal(resGet.status, 200);
    const html = await resGet.text();
    assert.ok(html.includes('Pacotes e Planos cadastrados'));
    assert.ok(html.includes('Novo pacote de plano'));
    // Confere se as novas caixas de selecao (checkboxes) aparecem no formulario
    assert.ok(html.includes('value="auditoria_fiscal"'), 'deve ter checkbox para auditoria_fiscal');
    assert.ok(html.includes('value="dre_gerencial"'), 'deve ter checkbox para dre_gerencial');
    assert.ok(html.includes('value="exportacao_sistemas"'), 'deve ter checkbox para exportacao_sistemas');
    assert.ok(html.includes('value="solicitacoes_documentos"'), 'deve ter checkbox para solicitacoes_documentos');
    assert.ok(html.includes('value="monitor_cnd"'), 'deve ter checkbox para monitor_cnd');
    assert.ok(html.includes('value="controle_estoque"'), 'deve ter checkbox para controle_estoque');

    // 2) Criar um novo pacote via POST
    const formCriar = new URLSearchParams({
      nome: 'Pacote Especial',
      codigo: 'pacote-especial',
      descricao: 'Descricao teste',
      preco: '129.90',
      periodo: 'mensal',
      limiteEmpresas: '10',
      limiteUsuarios: '3',
      diasGratis: '7',
      ordem: '10',
      ativo: 'true',
      publico: 'true',
      funcionalidades: 'captura_nfe',
    });

    const resCriar = await fetch(url('/plataforma/planos'), {
      method: 'POST',
      body: formCriar,
      redirect: 'manual',
    });
    assert.equal(resCriar.status, 302);
    assert.equal(resCriar.headers.get('location'), '/plataforma/planos');

    const planoCriado = bancoPlanos.get('pacote-especial');
    assert.ok(planoCriado, 'O pacote criado deve existir no banco de dados');
    assert.equal(planoCriado.nome, 'Pacote Especial');
    assert.equal(planoCriado.preco, 129.9);
    assert.equal(planoCriado.limiteEmpresas, 10);
    assert.equal(planoCriado.limiteUsuarios, 3);
    assert.equal(planoCriado.ativo, true);

    // 3) Editar o pacote
    const formEditar = new URLSearchParams({
      nome: 'Pacote Especial Editado',
      preco: '149.90',
      periodo: 'mensal',
      limiteEmpresas: '15',
      limiteUsuarios: '5',
      diasGratis: '0',
      ordem: '10',
      ativo: 'true',
      publico: 'true',
      funcionalidades: 'captura_nfe',
    });

    const resEditar = await fetch(url('/plataforma/planos/pacote-especial'), {
      method: 'POST',
      body: formEditar,
      redirect: 'manual',
    });
    assert.equal(resEditar.status, 302);

    const planoEditado = bancoPlanos.get('pacote-especial');
    assert.equal(planoEditado.nome, 'Pacote Especial Editado');
    assert.equal(planoEditado.preco, 149.9);
    assert.equal(planoEditado.limiteEmpresas, 15);

    // 4) Alternar ativo/arquivado (toggle)
    const resToggle = await fetch(url('/plataforma/planos/pacote-especial/toggle'), {
      method: 'POST',
      redirect: 'manual',
    });
    assert.equal(resToggle.status, 302);

    const planoArquivado = bancoPlanos.get('pacote-especial');
    assert.equal(planoArquivado.ativo, false);

    // 5) Excluir o pacote
    const resExcluir = await fetch(url('/plataforma/planos/pacote-especial/excluir'), {
      method: 'POST',
      redirect: 'manual',
    });
    assert.equal(resExcluir.status, 302);

    const planoExcluido = bancoPlanos.get('pacote-especial');
    assert.equal(planoExcluido, undefined, 'O pacote deve ter sido removido');
  } finally {
    s.close();
  }
});
