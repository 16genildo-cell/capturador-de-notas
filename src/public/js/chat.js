/* Chat interno com o suporte (painel antigo). Tempo real por Server-Sent Events. */
(function () {
  var raiz = document.getElementById('chat');
  if (!raiz) return;
  var modo = raiz.dataset.modo; // 'escritorio' | 'suporte'
  var lista = raiz.querySelector('[data-mensagens]');
  var form = raiz.querySelector('[data-form]');
  var campo = form.querySelector('textarea');
  var estado = raiz.querySelector('[data-estado]');
  var conversas = raiz.querySelector('[data-conversas]');
  var titulo = raiz.querySelector('[data-titulo]');
  var contaAtual = raiz.dataset.conta || null;
  var ids = {};

  function fmt(d) {
    return new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }
  function json(url, opt) {
    opt = opt || {};
    opt.headers = { 'Content-Type': 'application/json' };
    opt.credentials = 'same-origin';
    return fetch(url, opt).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error(j.erro || 'Erro ' + r.status);
        return j;
      });
    });
  }
  function aviso(t) {
    estado.textContent = t;
    estado.className = 'chat-estado';
  }
  function base() {
    return modo === 'suporte' ? '/chat/suporte/' + contaAtual : '/chat';
  }
  function vazio(texto) {
    var p = document.createElement('p');
    p.className = 'muted chat-vazio';
    p.textContent = texto;
    lista.appendChild(p);
  }
  function bolha(m) {
    if (ids[m._id]) return;
    ids[m._id] = true;
    var v = lista.querySelector('.chat-vazio');
    if (v) v.remove();
    var minha = modo === 'suporte' ? m.deSuporte : !m.deSuporte;
    var el = document.createElement('div');
    el.className = 'chat-msg ' + (minha ? 'chat-minha' : 'chat-outra');
    var meta = document.createElement('div');
    meta.className = 'chat-meta';
    meta.textContent = m.autorNome + ' · ' + fmt(m.createdAt);
    var txt = document.createElement('div');
    txt.className = 'chat-texto';
    txt.textContent = m.texto;
    el.appendChild(meta);
    if (m.texto) el.appendChild(txt);
    if (m.sistema) {
      el.className = 'chat-msg';
      el.style.alignSelf = 'center';
      el.style.fontSize = '.78rem';
      el.style.color = '#6b7280';
    }
    // Anexo (PDF ou imagem) enviado pelo site novo
    if (m.anexo) {
      var link = document.createElement('a');
      link.href = (modo === 'suporte' ? '/chat/suporte/anexos/' : '/chat/anexos/') + m.anexo.id;
      link.target = '_blank';
      link.rel = 'noopener';
      link.className = 'link';
      link.textContent = '📎 ' + m.anexo.nome;
      el.appendChild(link);
    }
    lista.appendChild(el);
    lista.scrollTop = lista.scrollHeight;
  }
  function marcarLidas() {
    if (document.hidden || (modo === 'suporte' && !contaAtual)) return;
    json(base() + '/lidas', { method: 'POST', body: '{}' }).catch(function () {});
  }
  function carregar() {
    lista.innerHTML = '';
    ids = {};
    if (modo === 'suporte' && !contaAtual) {
      form.hidden = true;
      vazio('Escolha uma conversa ao lado.');
      return Promise.resolve();
    }
    form.hidden = false;
    return json(base() + '/mensagens').then(function (j) {
      if (!j.itens.length) vazio('Nenhuma mensagem ainda. Escreva abaixo.');
      j.itens.forEach(bolha);
      marcarLidas();
    });
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var texto = campo.value.trim();
    if (!texto) return;
    var b = form.querySelector('button');
    b.disabled = true;
    json(base() + '/mensagens', { method: 'POST', body: JSON.stringify({ texto: texto }) })
      .then(function (j) {
        bolha(j.mensagem);
        campo.value = '';
        if (conversas) atualizarConversa(j.mensagem);
      })
      .catch(function (err) { aviso(err.message); })
      .then(function () {
        b.disabled = false;
        campo.focus();
      });
  });
  campo.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (form.requestSubmit) form.requestSubmit();
      else form.dispatchEvent(new Event('submit', { cancelable: true }));
    }
  });

  // ---- lista de conversas (equipe da plataforma)
  function itemConversa(c) {
    var el = conversas.querySelector('[data-conta="' + c.conta + '"]');
    if (!el) {
      el = document.createElement('a');
      el.href = '?conta=' + c.conta;
      el.className = 'chat-conversa';
      el.setAttribute('data-conta', c.conta);
      el.addEventListener('click', function (e) {
        e.preventDefault();
        abrir(c.conta, el.dataset.nome);
      });
      conversas.appendChild(el);
    }
    el.dataset.nome = c.nome;
    el.dataset.naoLidas = String(c.naoLidas || 0);
    el.classList.toggle('ativa', c.conta === contaAtual);
    el.innerHTML = '';
    var n = document.createElement('strong');
    n.textContent = c.nome;
    el.appendChild(n);
    if (c.naoLidas) {
      var t = document.createElement('span');
      t.className = 'tag tag-warn';
      t.textContent = c.naoLidas;
      el.appendChild(document.createTextNode(' '));
      el.appendChild(t);
    }
    var u = document.createElement('div');
    u.className = 'muted small';
    u.textContent = c.ultima ? (c.ultima.deSuporte ? 'Voce: ' : '') + c.ultima.texto.slice(0, 70) : 'sem mensagens';
    el.appendChild(u);
    return el;
  }
  function carregarConversas() {
    if (!conversas) return Promise.resolve();
    return json('/chat/suporte/conversas').then(function (j) {
      conversas.innerHTML = '';
      var itens = j.itens;
      if (contaAtual && !itens.some(function (c) { return c.conta === contaAtual; })) {
        itens.unshift({ conta: contaAtual, nome: raiz.dataset.nome || 'Escritorio', naoLidas: 0, ultima: null });
      }
      if (!itens.length) {
        var p = document.createElement('p');
        p.className = 'muted small';
        p.textContent = 'Nenhuma conversa ainda.';
        conversas.appendChild(p);
      }
      itens.forEach(itemConversa);
    });
  }
  function atualizarConversa(m) {
    var el = conversas.querySelector('[data-conta="' + m.conta + '"]');
    if (!el) return carregarConversas();
    var aberta = m.conta === contaAtual && !document.hidden;
    var nl = Number(el.dataset.naoLidas || 0);
    var novo = itemConversa({ conta: m.conta, nome: el.dataset.nome, naoLidas: !m.deSuporte && !aberta ? nl + 1 : aberta ? 0 : nl, ultima: m });
    conversas.insertBefore(novo, conversas.firstChild);
  }
  function abrir(conta, nome) {
    contaAtual = conta;
    if (titulo) titulo.textContent = nome || '';
    history.replaceState(null, '', '?conta=' + conta);
    var el = conversas.querySelector('[data-conta="' + conta + '"]');
    if (el) itemConversa({ conta: conta, nome: el.dataset.nome, naoLidas: 0, ultima: null });
    carregarConversas().then(carregar).catch(function (err) { aviso(err.message); });
  }

  // ---- tempo real
  function conectar() {
    var es = new EventSource(modo === 'suporte' ? '/chat/suporte/eventos' : '/chat/eventos');
    es.addEventListener('pronto', function () {
      estado.textContent = 'Conectado';
      estado.className = 'chat-estado ok';
    });
    es.addEventListener('mensagem', function (ev) {
      var m = JSON.parse(ev.data);
      if (conversas) atualizarConversa(m);
      if (modo === 'suporte' && m.conta !== contaAtual) return;
      bolha(m);
      var doOutroLado = modo === 'suporte' ? !m.deSuporte : m.deSuporte;
      if (doOutroLado) marcarLidas();
    });
    es.onerror = function () { aviso('Reconectando...'); };
  }

  document.addEventListener('visibilitychange', marcarLidas);
  carregarConversas()
    .then(carregar)
    .catch(function (err) { aviso(err.message); });
  conectar();
})();
