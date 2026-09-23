const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const code = fs.readFileSync(path.join(root, 'entry-animation.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const lowerSelector = '.calculator-page .wrap > :not(header), .calculator-page > .legal-footer';
const lifecycle = ['pagehide', 'beforeprint', 'visibilitychange'];
const watchedEvents = new Set([...lifecycle, 'vigilante:entry-ready', 'focusin', 'pointerdown']);

// Use the real page tree, but detach its body before executing the head phase.
// Timers, frames and WAAPI are controlled so failure and interaction races can
// be checked without relying on wall time or jsdom's absent rendering engine.
function setup(options = {}) {
  const w = new JSDOM(html, {
    url: options.url || 'https://calculadoravigilante.com/',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  }).window;
  const document = w.document;
  const body = document.body;
  body.remove();
  const animations = [], timers = new Map(), frames = new Map(), listeners = [];
  const motionListeners = new Set();
  let nextId = 1, currentScript = document.querySelector('script[src^="entry-animation.js"]');
  let timelineReads = 0;
  const motion = {
    matches: Boolean(options.reducedMotion),
    addEventListener(type, fn) { if (type === 'change') motionListeners.add(fn); },
    removeEventListener(type, fn) { if (type === 'change') motionListeners.delete(fn); }
  };
  for (const target of [w, document]) {
    const add = target.addEventListener.bind(target), remove = target.removeEventListener.bind(target);
    target.addEventListener = (type, fn, config) => {
      const capture = typeof config === 'boolean' ? config : Boolean(config && config.capture);
      if (watchedEvents.has(type)) listeners.push({ target, type, fn, capture });
      return add(type, fn, config);
    };
    target.removeEventListener = (type, fn, config) => {
      const capture = typeof config === 'boolean' ? config : Boolean(config && config.capture);
      const index = listeners.findIndex(item => item.target === target && item.type === type && item.fn === fn && item.capture === capture);
      if (index !== -1) listeners.splice(index, 1);
      return remove(type, fn, config);
    };
  }
  Object.defineProperty(document, 'currentScript', { configurable: true, get: () => currentScript });
  Object.defineProperty(document, 'hidden', { configurable: true, value: Boolean(options.hidden) });
  Object.defineProperty(document, 'timeline', { value: {
    get currentTime() { timelineReads++; return 321.25; }
  } });
  w.performance.getEntriesByType = type => type === 'navigation' ? [{ type: options.navigation || 'navigate' }] : [];
  w.matchMedia = options.noMatchMedia ? undefined : () => motion;
  w.setTimeout = (fn, delay) => { const id = nextId++; timers.set(id, { fn, delay }); return id; };
  w.clearTimeout = id => timers.delete(id);
  w.requestAnimationFrame = fn => { const id = nextId++; frames.set(id, fn); return id; };
  w.cancelAnimationFrame = id => frames.delete(id);
  w.Element.prototype.animate = options.noAnimations ? undefined : function (keyframes, timing) {
    if (options.throwAnimationAt === animations.length + 1) throw new Error('Animation unavailable');
    const animation = {
      effect: { target: this }, keyframes, timing, playState: 'running', cancelCount: 0, finishCount: 0,
      preparedAtCreation: document.documentElement.classList.contains('entry-preparing'),
      cancel() { this.playState = 'idle'; this.cancelCount++; },
      finish() { this.playState = 'finished'; this.finishCount++; }
    };
    animations.push(animation);
    return animation;
  };
  if (options.seen) w.sessionStorage.setItem('vigilante_entry_seen', '1');
  if (options.storageFailure) {
    w.Storage.prototype[options.storageFailure] = () => { throw new Error('Storage unavailable'); };
  }
  const api = {
    w, document, body, animations, timers, frames, listeners, motionListeners, motion,
    get timelineReads() { return timelineReads; },
    attachBody() { if (!document.body) document.documentElement.appendChild(body); },
    head() { currentScript = document.head.querySelector('script[src^="entry-animation.js"]'); w.eval(code); },
    ready() {
      api.attachBody();
      currentScript = document.querySelector('script[data-entry-start]');
      w.eval(code);
    },
    frame() {
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach(fn => fn(321.25));
    },
    timeout() {
      assert.equal(timers.size, 1, 'one bounded fail-open or completion timer');
      const [id, timer] = [...timers][0];
      timers.delete(id);
      timer.fn();
    },
    start() { api.ready(); api.frame(); },
    close() { w.close(); }
  };
  if (!options.deferHead) api.head();
  return api;
}

function assertReleased(page) {
  assert.equal(page.document.documentElement.classList.contains('entry-preparing'), false);
  assert.equal(page.timers.size, 0);
  assert.equal(page.frames.size, 0);
  assert.equal(page.listeners.length, 0, 'all entry listeners are removed');
  assert.equal(page.motionListeners.size, 0);
  assert.ok(page.animations.every(animation => animation.playState === 'idle'));
}

test('Prepaint and start markers are synchronous, integrity checked, and bracket all animated content', () => {
  const w = new JSDOM(html).window;
  try {
    const scripts = [...w.document.querySelectorAll('script[src^="entry-animation.js"]')];
    assert.equal(scripts.length, 2);
    assert.equal(scripts[0].parentElement, w.document.head);
    assert.equal(scripts[0].hasAttribute('data-entry-start'), false);
    assert.equal(scripts[1].hasAttribute('data-entry-start'), true);
    const expectedHash = 'sha256-' + crypto.createHash('sha256').update(code).digest('base64');
    for (const script of scripts) {
      assert.equal(script.hasAttribute('async'), false);
      assert.equal(script.hasAttribute('defer'), false);
      assert.equal(script.getAttribute('type'), null);
      assert.equal(script.getAttribute('integrity'), expectedHash);
      assert.equal(script.textContent.trim(), '');
      assert.equal(script.src, scripts[0].src);
    }
    assert.ok(w.document.querySelector('meta[http-equiv="Content-Security-Policy"]').content.includes("'" + expectedHash + "'"));
    assert.ok(w.document.getElementById('entry-initial-state').compareDocumentPosition(scripts[0]) & w.Node.DOCUMENT_POSITION_FOLLOWING);
    for (const target of w.document.querySelectorAll(lowerSelector)) {
      assert.ok(target.compareDocumentPosition(scripts[1]) & w.Node.DOCUMENT_POSITION_FOLLOWING);
    }
  } finally { w.close(); }
});

test('Critical CSS is opt-in and keeps lower sections free of new containing blocks', () => {
  const w = new JSDOM(html).window;
  try {
    const document = w.document;
    assert.equal(document.documentElement.classList.contains('entry-preparing'), false);
    const mediaRules = [...document.getElementById('entry-initial-state').sheet.cssRules];
    const preparing = mediaRules.find(rule => rule.conditionText === '(prefers-reduced-motion: no-preference)');
    const immediate = mediaRules.find(rule => rule.conditionText.includes('print'));
    assert.ok(preparing && immediate);
    for (const rule of preparing.cssRules) assert.ok(rule.selectorText.includes('html.entry-preparing'));
    document.documentElement.classList.add('entry-preparing');
    for (const target of document.querySelectorAll(lowerSelector)) {
      const rules = [...preparing.cssRules].filter(rule => target.matches(rule.selectorText));
      assert.equal(rules.length, 1, 'every lower block has one initial state');
      assert.equal(rules[0].style.opacity, '0');
      for (const property of ['transform', 'filter', 'perspective', 'contain', 'will-change', 'position']) {
        assert.equal(rules[0].style.getPropertyValue(property), '', property + ' must not move desktop ad containing blocks');
      }
    }
    const override = immediate.cssRules[0];
    assert.equal(override.style.opacity, '1');
    assert.equal(override.style.getPropertyPriority('opacity'), 'important');
    assert.equal(override.style.transform, 'none');
    assert.equal(override.style.getPropertyPriority('transform'), 'important');
  } finally { w.close(); }
});

test('Head arms without a body; bottom marker transfers opacity to animations in one frame and one clock', () => {
  const page = setup();
  try {
    assert.equal(page.document.body, null);
    assert.equal(page.document.documentElement.classList.contains('entry-preparing'), true);
    assert.equal(page.w.sessionStorage.getItem('vigilante_entry_seen'), '1');
    assert.equal(page.animations.length, 0);
    page.ready();
    assert.equal(page.document.documentElement.classList.contains('entry-preparing'), true);
    assert.equal(page.animations.length, 0, 'initial CSS stays responsible until the frame');
    page.frame();
    const lower = [...page.document.querySelectorAll(lowerSelector)];
    assert.equal(page.animations.length, lower.length + 5);
    assert.equal(page.timelineReads, 1);
    assert.ok(page.animations.every(animation => animation.startTime === 321.25 && animation.preparedAtCreation));
    assert.equal(page.document.documentElement.classList.contains('entry-preparing'), false);
    for (const target of lower) {
      const animation = page.animations.find(item => item.effect.target === target);
      assert.ok(animation, 'all lower blocks fade, including initially hidden tabs');
      assert.equal(animation.keyframes[0].opacity, 0);
      assert.equal(animation.keyframes[1].opacity, 1);
      assert.equal(animation.timing.fill, 'backwards');
      assert.ok(animation.keyframes.every(frame => Object.keys(frame).every(key => key === 'opacity')));
    }
    const lowerTimings = new Set(page.animations.filter(item => lower.includes(item.effect.target)).map(item => JSON.stringify(item.timing)));
    assert.equal(lowerTimings.size, 1, 'borders, backgrounds and every lower section share timing');
    page.ready(); page.frame();
    assert.equal(page.animations.length, lower.length + 5, 'duplicate readiness cannot restart the sequence');
    page.timeout();
    assertReleased(page);
  } finally { page.close(); }
});

test('An interrupted document fails visible and a late bottom marker cannot hide it again', () => {
  const page = setup();
  try {
    assert.ok([...page.timers.values()][0].delay <= 2500);
    page.timeout();
    assertReleased(page);
    page.start();
    assert.equal(page.animations.length, 0);
    assertReleased(page);
  } finally { page.close(); }
});

test('Reduced motion, repeat visits, restored navigation and unavailable storage do not arm', () => {
  const cases = [
    { reducedMotion: true }, { seen: true }, { navigation: 'reload' }, { navigation: 'back_forward' },
    { hidden: true }, { storageFailure: 'getItem' }, { storageFailure: 'setItem' },
    { noAnimations: true }, { noMatchMedia: true },
    { url: 'https://calculadoravigilante.com/#cuenta' },
    { url: 'https://calculadoravigilante.com/?code=access-return' }
  ];
  for (const options of cases) {
    const page = setup(options);
    try {
      assertReleased(page);
      page.start();
      assert.equal(page.animations.length, 0, JSON.stringify(options));
      assertReleased(page);
    } finally { page.close(); }
  }
});

test('Executing the arming phase after the body exists never makes already visible content disappear', () => {
  const page = setup({ deferHead: true });
  try {
    page.attachBody(); page.head(); page.start();
    assert.equal(page.animations.length, 0);
    assertReleased(page);
  } finally { page.close(); }
});

test('Scroll restoration and deliberate focus before the first frame skip the entry', () => {
  for (const reason of ['scroll', 'focus', 'motion', 'hidden']) {
    const page = setup();
    try {
      page.ready();
      if (reason === 'scroll') page.w.scrollY = 200;
      if (reason === 'focus') page.document.querySelector('.topbar .brand').focus();
      if (reason === 'motion') page.motion.matches = true;
      if (reason === 'hidden') Object.defineProperty(page.document, 'hidden', { value: true });
      page.frame();
      assert.equal(page.animations.length, 0, reason);
      assertReleased(page);
    } finally { page.close(); }
  }
});

test('Focusing lower controls while preparing reveals immediately and cancels pending startup', () => {
  const page = setup();
  try {
    page.ready();
    page.document.getElementById('n-contrato').focus();
    assertReleased(page);
    page.frame();
    assert.equal(page.animations.length, 0);
  } finally { page.close(); }
});

test('Focus and direct pointer use reveal all lower content while leaving heading motion intact', () => {
  for (const interaction of ['focus', 'pointer']) {
    const page = setup();
    try {
      page.start();
      const control = page.document.getElementById('n-contrato');
      if (interaction === 'focus') control.focus();
      else control.dispatchEvent(new page.w.Event('pointerdown', { bubbles: true }));
      const lower = page.animations.filter(item => item.effect.target.matches(lowerSelector));
      const heading = page.animations.filter(item => !item.effect.target.matches(lowerSelector));
      assert.ok(lower.every(item => item.playState === 'finished' && item.finishCount === 1));
      assert.ok(heading.every(item => item.playState === 'running' && item.cancelCount === 0));
      assert.equal(control.disabled, false);
      page.timeout();
      assertReleased(page);
    } finally { page.close(); }
  }
});

test('Scrolling and topbar use leave a running entry uninterrupted', () => {
  const page = setup();
  try {
    page.start();
    page.w.dispatchEvent(new page.w.Event('scroll'));
    page.document.getElementById('menu-btn').dispatchEvent(new page.w.Event('pointerdown', { bubbles: true }));
    assert.ok(page.animations.every(item => item.playState === 'running'));
    page.timeout();
    assertReleased(page);
  } finally { page.close(); }
});

test('Leaving, printing, hiding or changing motion restores content and removes every listener', () => {
  for (const event of [...lifecycle, 'motion-change']) {
    for (const running of [false, true]) {
      const page = setup();
      try {
        if (running) page.start();
        if (event === 'motion-change') [...page.motionListeners].forEach(fn => fn());
        else if (event === 'visibilitychange') page.document.dispatchEvent(new page.w.Event(event, { bubbles: true }));
        else page.w.dispatchEvent(new page.w.Event(event));
        assertReleased(page);
        const count = page.animations.length;
        page.start();
        assert.equal(page.animations.length, count, 'cleanup prevents a subsequent readiness replay');
        assertReleased(page);
      } finally { page.close(); }
    }
  }
});

test('A partially failed animation startup restores the page and cancels created effects', () => {
  const page = setup({ throwAnimationAt: 3 });
  try {
    page.start();
    assert.equal(page.animations.length, 2);
    assertReleased(page);
    assert.ok(page.animations.every(item => item.cancelCount === 1));
  } finally { page.close(); }
});
