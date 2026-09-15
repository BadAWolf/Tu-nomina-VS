const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, '..');
const KEY = 'vigilante_install_v1';
const android = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36';
const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 Version/26.0 Mobile/15E148 Safari/604.1';
function setup(options = {}) {
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), {
    url: 'http://localhost:4173/', runScripts: 'outside-only', pretendToBeVisual: true
  });
  const w = dom.window, d = w.document;
  Object.defineProperty(w.navigator, 'userAgent', { value: options.ua ?? android });
  Object.defineProperty(w.navigator, 'maxTouchPoints', { value: options.touch ?? 5 });
  Object.defineProperty(w.navigator, 'standalone', { value: !!options.standalone });
  w.matchMedia = query => ({ matches: query.includes('standalone') ? !!options.standalone : options.coarse !== false, addEventListener() {} });
  const pending = new Map(); let serial = 0;
  w.setTimeout = (fn, delay) => { const id = ++serial; if (delay === 1200) pending.set(id, fn); return id; };
  w.clearTimeout = id => pending.delete(id);
  w.HTMLElement.prototype.scrollIntoView = () => {};
  w.alert = () => {};
  if (options.saved) w.localStorage.setItem(KEY, options.saved);
  if (options.legacy) w.localStorage.setItem('inst_aviso', options.legacy);
  if (options.blockedStorage) Object.defineProperty(w, 'localStorage', { get() { throw new Error('storage unavailable'); } });
  if (options.calculator) require('./load-calculator.cjs')(w);
  else w.eval(fs.readFileSync(path.join(root, 'install.js'), 'utf8'));
  w.cargarJsPDF = () => {};
  d.getElementById('cookie-banner').hidden = true;
  d.dispatchEvent(new w.Event('DOMContentLoaded'));
  const tick = () => { const jobs = [...pending.values()]; pending.clear(); jobs.forEach(fn => fn()); };
  const calc = (n = 1) => { for (let i = 0; i < n; i++) { w.VigilanteInstall.calculationCompleted(); tick(); } };
  const visible = () => !d.getElementById('inst-banner').hidden;
  const dismiss = () => d.getElementById('inst-luego').click();
  return { w, d, calc, tick, visible, dismiss, close: () => w.close() };
}
function offer(w, prompt = async () => {}, choice = Promise.resolve({ outcome: 'dismissed' })) {
  const event = new w.Event('beforeinstallprompt', { cancelable: true });
  event.prompt = prompt; event.userChoice = choice;
  w.dispatchEvent(event);
  return event;
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('Shows after the first calculation, then after ten more, without blocking the results', () => {
  const x = setup(); try {
    assert.equal(x.visible(), false);
    x.calc(); assert.equal(x.visible(), true); x.dismiss();
    for (let round = 0; round < 3; round++) {
      x.calc(9); assert.equal(x.visible(), false);
      x.calc(); assert.equal(x.visible(), true); x.dismiss();
    }
    assert.equal(x.d.getElementById('inst-banner').getAttribute('role'), 'region');
    assert.equal(x.d.querySelector('dialog[open]'), null);
  } finally { x.close(); }
});
test('Remembers a partial interval across visits and does not repeat on reload without dismissing', () => {
  let x = setup(); try {
    x.calc();
    let saved = x.w.localStorage.getItem(KEY);
    x.close(); x = setup({ saved });
    x.calc(4); assert.equal(x.visible(), false);
    saved = x.w.localStorage.getItem(KEY);
    x.close(); x = setup({ saved });
    x.calc(5); assert.equal(x.visible(), false);
    x.calc(); assert.equal(x.visible(), true);
  } finally { x.close(); }
});
test('Migrates old dismissed notices to ten calculations, respects old installations', () => {
  for (const legacy of ['visto', 'instalada']) {
    const x = setup({ legacy }); try {
      x.calc(9); assert.equal(x.visible(), false);
      x.calc(); assert.equal(x.visible(), legacy === 'visto');
    } finally { x.close(); }
  }
});
test('Does not advertise on desktop or in installed display mode; manual confirmation also stops reminders', () => {
  for (const options of [{ ua: 'Mozilla/5.0 Windows NT 10.0', touch: 0, coarse: false }, { standalone: true }]) {
    const x = setup(options); try { x.calc(30); assert.equal(x.visible(), false); } finally { x.close(); }
  }
  const x = setup(); try {
    x.calc(); x.d.getElementById('inst-ya').click(); x.calc(30);
    assert.equal(x.visible(), false);
  } finally { x.close(); }
});
test('Rapid calculations and dismissing a visible notice cannot leave queued reminders', () => {
  const x = setup(); try {
    for (let i = 0; i < 20; i++) x.w.VigilanteInstall.calculationCompleted();
    x.tick(); assert.equal(x.visible(), true);
    x.calc(15); x.dismiss(); x.tick(); assert.equal(x.visible(), false);
    x.calc(9); assert.equal(x.visible(), false);
    x.calc(); assert.equal(x.visible(), true);
    x.d.dispatchEvent(new x.w.KeyboardEvent('keydown', { key: 'Escape' }));
    assert.equal(x.visible(), false);
  } finally { x.close(); }
});
test('Cookie choice, account dialogs, menu and hidden tabs postpone a due notice until a later calculation', () => {
  const x = setup(); try {
    x.d.getElementById('cookie-banner').hidden = false;
    x.d.getElementById('cookie-banner').style.display = 'block';
    x.calc(); assert.equal(x.visible(), false);
    x.d.getElementById('cookie-banner').hidden = true;
    x.d.getElementById('auth-dialog').setAttribute('open', '');
    x.calc(); assert.equal(x.visible(), false);
    x.d.getElementById('auth-dialog').removeAttribute('open');
    x.d.getElementById('menu-panel').classList.add('abierto');
    x.calc(); assert.equal(x.visible(), false);
    x.d.getElementById('menu-panel').classList.remove('abierto');
    Object.defineProperty(x.d, 'visibilityState', { configurable: true, value: 'hidden' });
    x.calc(); assert.equal(x.visible(), false);
    Object.defineProperty(x.d, 'visibilityState', { configurable: true, value: 'visible' });
    x.calc(); assert.equal(x.visible(), true);
  } finally { x.close(); }
});
test('A late Android install offer upgrades the visible notice, requires a click and is used only once', async () => {
  const x = setup(); try {
    let prompts = 0;
    x.calc(); assert.ok(x.d.getElementById('inst-guide'));
    const event = offer(x.w, async () => { prompts++; });
    assert.equal(event.defaultPrevented, true);
    assert.equal(prompts, 0);
    x.d.getElementById('inst-instalar').click(); await settle();
    assert.equal(prompts, 1); assert.equal(x.visible(), false);
    x.calc(9); assert.equal(x.visible(), false);
    x.calc(); assert.ok(x.d.getElementById('inst-guide')); assert.equal(prompts, 1);
    x.dismiss(); offer(x.w); assert.equal(x.visible(), false);
    x.calc(10); assert.ok(x.d.getElementById('inst-instalar'));
  } finally { x.close(); }
});
test('Native install errors show a usable manual guide and a completed installation stops all reminders', async () => {
  const x = setup(); try {
    offer(x.w, async () => { throw new Error('browser unavailable'); });
    x.calc(); x.d.getElementById('inst-instalar').click(); await settle();
    assert.equal(x.visible(), true);
    assert.match(x.d.getElementById('inst-contenido').textContent, /No se ha podido abrir/);
    assert.ok(x.d.getElementById('inst-guide'));
    x.w.dispatchEvent(new x.w.Event('appinstalled'));
    assert.equal(x.visible(), false); x.calc(30); assert.equal(x.visible(), false);
    assert.equal(JSON.parse(x.w.localStorage.getItem(KEY)).installed, true);
  } finally { x.close(); }
});
test('An installation recorded in another tab hides the notice; a new browser offer can recover after uninstalling', () => {
  const x = setup(); try {
    x.calc();
    x.w.localStorage.setItem(KEY, JSON.stringify({ version: 1, shown: true, count: 0, installed: true }));
    x.w.dispatchEvent(new x.w.StorageEvent('storage', { key: KEY }));
    assert.equal(x.visible(), false);
    offer(x.w); x.calc(9); assert.equal(x.visible(), false);
    x.calc(); assert.equal(x.visible(), true);
  } finally { x.close(); }
});
test('iPhone Safari and Chrome guides use their supported Share flow; modern iPad is recognised', () => {
  for (const ua of [iphone, iphone.replace('Version/26.0', 'CriOS/130.0'), 'Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/605.1.15 Version/26.0 Safari/605.1.15']) {
    const x = setup({ ua }); try {
      x.calc(); const text = x.d.getElementById('inst-contenido').textContent;
      assert.match(text, /Compartir/); assert.match(text, /Abrir como app web/);
      assert.match(text, /Añadir a pantalla de inicio/);
      assert.ok(x.d.getElementById('inst-guide')); assert.equal(x.d.getElementById('inst-instalar'), null);
      if (ua.includes('CriOS')) assert.match(text, /Chrome u otro navegador compatible/);
      else { assert.match(text, /Más/); assert.match(text, /Editar acciones/); }
    } finally { x.close(); }
  }
});
test('Unavailable or malformed storage never breaks calculation or floods the current page', () => {
  for (const options of [{ blockedStorage: true }, { saved: '{bad' }, { saved: '{"version":1,"shown":true,"count":-3,"installed":false}' }]) {
    const x = setup(options); try {
      x.calc(); assert.equal(x.visible(), true); x.dismiss();
      x.calc(9); assert.equal(x.visible(), false); x.calc(); assert.equal(x.visible(), true);
    } finally { x.close(); }
  }
});
test('Only successful payroll, schedule, severance and sick-leave calculations advance the shared counter', () => {
  const x = setup({ legacy: 'visto', calculator: true }); try {
    const fixtures = require('./calculation-fixtures.json');
    for (const item of fixtures) {
      if (item.click) x.d.getElementById(item.click).click();
      for (const [id, value] of Object.entries(item.fields)) {
        x.d.getElementById(id).value = value;
        x.d.getElementById(id).dispatchEvent(new x.w.Event('change'));
      }
      x.w[item.fn + (item.fn === 'calcNomina' ? '' : 'Registrado')]();
    }
    assert.equal(JSON.parse(x.w.localStorage.getItem(KEY)).count, fixtures.length);
    x.d.getElementById('hTTotal').value = '-1'; x.w.calcNomina();
    assert.equal(JSON.parse(x.w.localStorage.getItem(KEY)).count, fixtures.length);
    x.w.CUAD[x.w.claveMes(x.w.calAnio, x.w.calMes)] = { '1': { tramos: [{ i: '08:00', f: '16:00' }], vac: false, fest: false } };
    x.d.getElementById('modo-cuadrante').click(); x.w.calcNomina();
    assert.equal(JSON.parse(x.w.localStorage.getItem(KEY)).count, fixtures.length + 1);
  } finally { x.close(); }
});
test('Manifest retains installed app identity and versioned Android/Apple icons resolve to correct PNG dimensions', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')));
  assert.equal(manifest.start_url, '/index.html'); assert.equal(manifest.id, '/index.html');
  assert.equal(manifest.scope, '/'); assert.equal(manifest.display, 'standalone');
  for (const icon of manifest.icons) {
    const url = new URL(icon.src, 'https://calculadoravigilante.com/');
    assert.ok(url.searchParams.get('v'));
    const png = fs.readFileSync(path.join(root, url.pathname));
    assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, icon.sizes);
  }
  for (const file of fs.readdirSync(root).filter(file => file.endsWith('.html'))) {
    const dom = new JSDOM(fs.readFileSync(path.join(root, file), 'utf8'));
    try {
      const link = dom.window.document.querySelector('link[rel="apple-touch-icon"]');
      assert.match(link.getAttribute('href'), /apple-touch-icon\.png\?v=/);
      const png = fs.readFileSync(path.join(root, link.getAttribute('href').split('?')[0]));
      assert.equal(png.readUInt32BE(16), 180); assert.equal(png.readUInt32BE(20), 180);
    } finally { dom.window.close(); }
  }
});
