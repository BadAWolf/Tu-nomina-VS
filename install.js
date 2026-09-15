(function () {
  'use strict';
  const KEY = 'vigilante_install_v1';
  const INTERVAL = 10;
  let state = { version: 1, shown: false, count: 0, installed: false };
  let deferredPrompt = null, timer = null, prompting = false, previousFocus = null;
  const byId = id => document.getElementById(id);
  const ios = () => /iPad|iPhone|iPod/.test(navigator.userAgent || '') ||
    (/Macintosh/.test(navigator.userAgent || '') && navigator.maxTouchPoints > 1);
  const mobile = () => ios() || /Android/.test(navigator.userAgent || '') ||
    (navigator.maxTouchPoints > 0 && window.matchMedia?.('(pointer: coarse)').matches);
  const standalone = () => navigator.standalone === true ||
    !!window.matchMedia?.('(display-mode: standalone)').matches;

  function read() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved?.version === 1 && typeof saved.shown === 'boolean' &&
            typeof saved.installed === 'boolean' && Number.isInteger(saved.count) &&
            saved.count >= 0 && saved.count <= INTERVAL) return saved;
      } else {
        const legacy = localStorage.getItem('inst_aviso');
        if (legacy === 'instalada') return { version: 1, shown: true, count: 0, installed: true };
        if (legacy === 'visto' && !state.shown) return { ...state, shown: true };
      }
    } catch (_) { /* Private browsing / storage unavailable: keep this page's counter. */ }
    return state;
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (_) {}
  }
  function due() { return state.count >= (state.shown ? INTERVAL : 1); }
  function visible() { return !!byId('inst-banner')?.classList.contains('visible'); }
  function hide() {
    if (timer !== null) { clearTimeout(timer); timer = null; }
    const banner = byId('inst-banner');
    if (!banner) return;
    const restoreFocus = banner.contains(document.activeElement);
    banner.classList.remove('visible');
    banner.hidden = true;
    if (restoreFocus && previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  }
  function dismiss() {
    state = read();
    state.count = 0;
    state.shown = true;
    save();
    hide();
  }
  function installed() {
    state = { version: 1, shown: true, count: 0, installed: true };
    save();
    deferredPrompt = null;
    hide();
  }
  function occupied() {
    const cookies = byId('cookie-banner');
    return document.visibilityState === 'hidden' || !!document.querySelector('dialog[open]') ||
      !!byId('menu-panel')?.classList.contains('abierto') ||
      !!(cookies && !cookies.hidden && getComputedStyle(cookies).display !== 'none');
  }
  function show() {
    const banner = byId('inst-banner');
    if (!banner) return;
    previousFocus = document.activeElement;
    banner.hidden = false;
    banner.classList.add('visible');
  }
  function guide() {
    const ua = navigator.userAgent || '';
    let steps, note = '';
    if (ios()) {
      const safari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA|Instagram|FBAN|FBAV/.test(ua);
      steps = safari ?
        ['En Safari, toca <strong>Compartir</strong>. Si no lo ves, abre primero el botón <strong>Más (…)</strong>.',
         'En la lista de acciones, elige <strong>Añadir a pantalla de inicio</strong>.',
         'Si aparece <strong>Abrir como app web</strong>, actívalo. Confirma con <strong>Añadir</strong>.'] :
        ['En Chrome u otro navegador compatible, abre <strong>Compartir</strong>.',
         'Busca <strong>Añadir a pantalla de inicio</strong>.',
         'Si aparece <strong>Abrir como app web</strong>, actívalo y pulsa <strong>Añadir</strong>.'];
      note = safari ?
        'Si falta la opción, busca <strong>Editar acciones</strong> al final de la lista. Si has abierto el enlace dentro de otra app, ábrelo en Safari.' :
        'Si tu navegador o una app como Instagram no ofrece esa opción, copia la dirección y ábrela en Safari. Allí toca <strong>Compartir</strong> (o <strong>Más → Compartir</strong>).';
    } else {
      steps = ['Abre el <strong>menú del navegador (⋮ o ☰)</strong>.',
        'Busca <strong>Añadir a pantalla de inicio</strong> o <strong>Instalar aplicación</strong>.',
        'Confirma con <strong>Añadir</strong> o <strong>Instalar</strong>, según indique tu teléfono.'];
      note = 'Si estás dentro de otra app o no encuentras la opción, abre esta página en Chrome y usa su menú.';
    }
    return '<details class="inst-guide" id="inst-guide"><summary>Ver cómo añadirla' + (ios() ? ' en iPhone o iPad' : '') + '</summary>' +
      '<ol class="inst-pasos">' + steps.map(step => '<li>' + step + '</li>').join('') + '</ol>' +
      '<p class="inst-help">' + note + '</p></details>';
  }
  function render(error) {
    const content = byId('inst-contenido');
    if (!content) return;
    byId('inst-sub').textContent = 'Abre la calculadora de un toque desde tu pantalla de inicio.';
    content.innerHTML = (error ? '<p class="inst-help" role="status">No se ha podido abrir el instalador. Puedes añadirla desde el menú del navegador.</p>' : '') +
      (deferredPrompt && !ios() ? '<button type="button" class="inst-btn" id="inst-instalar">Añadir a la pantalla de inicio</button>' : guide()) +
      '<div class="inst-actions"><button type="button" class="inst-secondary" id="inst-luego">Ahora no</button>' +
      '<button type="button" class="inst-secondary" id="inst-ya">Ya la tengo</button></div>' +
      '<p class="inst-note">Si lo dejas para luego, te lo recordaremos dentro de 10 cálculos.</p>';
    byId('inst-luego').addEventListener('click', dismiss);
    byId('inst-ya').addEventListener('click', installed);
    byId('inst-instalar')?.addEventListener('click', async function () {
      if (!deferredPrompt || prompting) return;
      const event = deferredPrompt;
      deferredPrompt = null; // Each browser event can be used only once.
      prompting = true;
      dismiss();
      try {
        await event.prompt(); // Must run directly from the user's click.
        await event.userChoice;
        // appinstalled, rather than merely accepting the dialog, confirms installation.
      } catch (_) {
        state = read();
        if (!state.installed && !standalone()) { render(true); show(); }
      } finally { prompting = false; }
    });
  }
  function calculationCompleted() {
    if (!mobile()) return;
    state = read();
    if (standalone()) { if (!state.installed) installed(); return; }
    if (state.installed || visible() || prompting) return;
    state.count = Math.min(INTERVAL, state.count + 1);
    save();
    if (!due() || timer !== null) return;
    timer = setTimeout(function () {
      timer = null;
      state = read();
      if (state.installed || standalone() || !due() || occupied() || visible() || !byId('inst-contenido')) return;
      render(false);
      show();
      state.shown = true;
      state.count = 0;
      save(); // Showing it also counts: reloading cannot cause another immediate notice.
    }, 1200);
  }

  state = read();
  window.addEventListener('beforeinstallprompt', function (event) {
    if (!mobile() || ios()) return;
    event.preventDefault();
    deferredPrompt = event;
    state = read();
    // Chrome only offers installation if it considers the app not installed.
    if (state.installed && !standalone()) {
      state = { version: 1, shown: true, count: 0, installed: false };
      save();
      try { localStorage.removeItem('inst_aviso'); } catch (_) {}
    }
    // A late browser event upgrades the existing notice, never opens a new one.
    if (visible() && !byId('inst-guide')?.open) render(false);
  });
  window.addEventListener('appinstalled', installed);
  window.addEventListener('storage', function (event) {
    if (event.key === KEY || event.key === 'inst_aviso') {
      state = read();
      if (state.installed) hide();
    }
  });
  function init() {
    byId('inst-cerrar')?.addEventListener('click', dismiss);
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && visible() && !document.querySelector('dialog[open]')) dismiss();
    });
    const mode = window.matchMedia?.('(display-mode: standalone)');
    mode?.addEventListener?.('change', () => { if (standalone()) installed(); });
    if (standalone()) installed();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
  window.VigilanteInstall = Object.freeze({ calculationCompleted });
})();
