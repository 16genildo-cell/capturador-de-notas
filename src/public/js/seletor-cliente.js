/**
 * Seletor de cliente com busca.
 * Transforma <select data-seletor-cliente> num campo onde se digita o nome ou o CNPJ/CPF.
 * O <select> original continua no formulario (escondido) e recebe o valor escolhido,
 * entao sem JavaScript a pagina segue funcionando com o select comum.
 *
 * Opcoes do <select>: value = id; texto = razao social; data-doc = CNPJ/CPF formatado.
 * Atributos opcionais: data-enviar (envia o formulario ao escolher), data-placeholder.
 */
(function () {
  var MIN_LETRAS = 3;
  var MAX_ITENS = 50;
  var soDigitos = function (t) { return String(t || '').replace(/\D/g, ''); };
  var normal = function (t) { return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); };

  function montar(select) {
    var opcoes = Array.prototype.filter.call(select.options, function (o) { return o.value; }).map(function (o) {
      return { id: o.value, nome: o.text, doc: o.getAttribute('data-doc') || '', chave: normal(o.text), digitos: soDigitos(o.getAttribute('data-doc')) };
    });
    var rotuloVazio = (select.options[0] && !select.options[0].value) ? select.options[0].text : 'Todos os clientes';
    var poucos = opcoes.length <= 15; // com poucos clientes, a lista aparece inteira ao clicar

    var caixa = document.createElement('div');
    caixa.className = 'seletor-cliente';
    caixa.innerHTML =
      '<div class="sc-campo">' +
        '<svg class="sc-lupa" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>' +
        '<input type="text" autocomplete="off" spellcheck="false" role="combobox" aria-autocomplete="list" aria-expanded="false" />' +
        '<button type="button" class="sc-limpar" aria-label="Limpar cliente" title="Limpar" hidden>&times;</button>' +
        '<button type="button" class="sc-seta" aria-label="Mostrar clientes" tabindex="-1"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m6 9 6 6 6-6"/></svg></button>' +
      '</div>' +
      '<ul class="sc-lista" role="listbox" hidden></ul>';
    select.parentNode.insertBefore(caixa, select);
    select.hidden = true;
    select.tabIndex = -1;

    var input = caixa.querySelector('input');
    var lista = caixa.querySelector('.sc-lista');
    var limpar = caixa.querySelector('.sc-limpar');
    var seta = caixa.querySelector('.sc-seta');
    var idLista = 'sc-' + Math.random().toString(36).slice(2);
    lista.id = idLista;
    input.setAttribute('aria-controls', idLista);
    if (select.id) { input.id = select.id + '-busca'; var lbl = document.querySelector('label[for="' + select.id + '"]'); if (lbl) lbl.htmlFor = input.id; }
    input.placeholder = select.getAttribute('data-placeholder') || ('Digite pelo menos ' + MIN_LETRAS + ' letras do nome ou o CNPJ/CPF');

    var itens = [];
    var ativo = -1;

    function atual() { return opcoes.find(function (o) { return o.id === select.value; }) || null; }
    function mostrarAtual() {
      var a = atual();
      input.value = a ? a.nome : '';
      limpar.hidden = !a;
      caixa.classList.toggle('sc-escolhido', Boolean(a));
    }

    function filtrar(termo) {
      var t = normal(termo).trim();
      var d = soDigitos(termo);
      if (!t) return poucos ? opcoes.slice() : null;
      if (t.length < MIN_LETRAS && d.length < MIN_LETRAS) return null;
      return opcoes.filter(function (o) { return o.chave.indexOf(t) !== -1 || (d.length >= MIN_LETRAS && o.digitos.indexOf(d) !== -1); });
    }

    function abrir(termo) {
      var achados = filtrar(termo);
      lista.innerHTML = '';
      itens = [];
      ativo = -1;
      if (achados === null) {
        lista.innerHTML = '<li class="sc-aviso">Digite pelo menos ' + MIN_LETRAS + ' caracteres para buscar entre ' + opcoes.length + ' clientes.</li>';
      } else {
        if (!normal(termo).trim()) adicionar({ id: '', nome: rotuloVazio, doc: '' }, true);
        achados.slice(0, MAX_ITENS).forEach(function (o) { adicionar(o); });
        if (!achados.length) lista.insertAdjacentHTML('beforeend', '<li class="sc-aviso">Nenhum cliente encontrado.</li>');
        if (achados.length > MAX_ITENS) lista.insertAdjacentHTML('beforeend', '<li class="sc-aviso">Mostrando ' + MAX_ITENS + ' de ' + achados.length + '. Continue digitando para refinar.</li>');
      }
      lista.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      var sel = itens.findIndex(function (li) { return li.dataset.id === select.value; });
      if (sel >= 0) marcar(sel, true);
    }

    function adicionar(o, todos) {
      var li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.id = idLista + '-' + itens.length;
      li.dataset.id = o.id;
      li.className = 'sc-item' + (todos ? ' sc-todos' : '') + (o.id === select.value ? ' sc-marcado' : '');
      var nome = document.createElement('span');
      nome.className = 'sc-nome';
      nome.textContent = o.nome;
      li.appendChild(nome);
      if (o.doc) { var doc = document.createElement('span'); doc.className = 'sc-doc'; doc.textContent = o.doc; li.appendChild(doc); }
      li.addEventListener('mousedown', function (ev) { ev.preventDefault(); escolher(o.id); });
      lista.appendChild(li);
      itens.push(li);
    }

    function fechar() {
      lista.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
    }

    function marcar(i, semRolar) {
      if (!itens.length) return;
      if (ativo >= 0 && itens[ativo]) itens[ativo].classList.remove('sc-ativo');
      ativo = (i + itens.length) % itens.length;
      itens[ativo].classList.add('sc-ativo');
      input.setAttribute('aria-activedescendant', itens[ativo].id);
      if (!semRolar) itens[ativo].scrollIntoView({ block: 'nearest' });
    }

    function escolher(id) {
      var mudou = select.value !== id;
      select.value = id;
      mostrarAtual();
      fechar();
      if (mudou) {
        select.dispatchEvent(new Event('change', { bubbles: true }));
        if (select.hasAttribute('data-enviar') && select.form) {
          caixa.classList.add('sc-carregando');
          if (select.form.requestSubmit) select.form.requestSubmit(); else select.form.submit();
        }
      }
    }

    input.addEventListener('focus', function () { input.select(); abrir(''); });
    input.addEventListener('input', function () { abrir(input.value); });
    input.addEventListener('blur', function () { setTimeout(function () { fechar(); mostrarAtual(); }, 120); });
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'ArrowDown') { ev.preventDefault(); if (lista.hidden) abrir(input.value); marcar(ativo + 1); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); marcar(ativo - 1); }
      else if (ev.key === 'Enter') {
        if (!lista.hidden && ativo >= 0) { ev.preventDefault(); escolher(itens[ativo].dataset.id); }
        else if (!lista.hidden && itens.length === 1) { ev.preventDefault(); escolher(itens[0].dataset.id); }
      } else if (ev.key === 'Escape') { fechar(); mostrarAtual(); }
    });
    limpar.addEventListener('click', function () { escolher(''); input.focus(); });
    seta.addEventListener('mousedown', function (ev) { ev.preventDefault(); if (lista.hidden) { input.focus(); } else { fechar(); } });

    mostrarAtual();
  }

  document.querySelectorAll('select[data-seletor-cliente]').forEach(montar);
})();
