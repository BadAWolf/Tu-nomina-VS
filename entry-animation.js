(function () {
  'use strict';
  // Presentation only. The page remains visible and usable if this file is late,
  // unavailable, or the browser does not support animations/session storage.
  if (!document.body.classList.contains('calculator-page') || !Element.prototype.animate || !window.matchMedia) return;
  try {
    if (sessionStorage.getItem('vigilante_entry_seen')) return;
    sessionStorage.setItem('vigilante_entry_seen', '1');
  } catch (_) { return; }

  var motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  var navigation = performance.getEntriesByType('navigation')[0];
  var firstPaint = performance.getEntriesByType('paint').find(function (entry) { return entry.name === 'first-contentful-paint'; });
  if (motion.matches || document.hidden || window.scrollY > 0 || location.hash || location.search ||
      (navigation && navigation.type !== 'navigate') || performance.now() > 1500 ||
      (firstPaint && performance.now() - firstPaint.startTime > 100) ||
      (document.activeElement && document.activeElement !== document.body)) return;

  var animations = [];
  var interactions = ['pointerdown', 'keydown', 'focusin', 'scroll', 'pagehide', 'beforeprint', 'visibilitychange'];
  function finish() {
    animations.forEach(function (animation) { animation.cancel(); });
    interactions.forEach(function (event) { window.removeEventListener(event, finish, true); });
    if (motion.removeEventListener) motion.removeEventListener('change', finish);
  }

  try {
    // Only the heading moves; the calculator fades in without changing the
    // containing block of its desktop advertisements or its layout dimensions.
    [
      ['.topbar .brand', 0, 6],
      ['.wrap > header .header-label', 0, 6],
      ['.wrap > header h1', 50, 10],
      ['.wrap > header .header-sub', 120, 8],
      ['.wrap > header .header-story', 190, 8],
      ['.tab-selector', 260, 0],
      ['#view-nomina', 320, 0]
    ].forEach(function (step) {
      var element = document.querySelector(step[0]);
      if (!element) return;
      var from = { opacity: 0.15 }, to = { opacity: 1 };
      if (step[2]) {
        from.transform = 'translateY(' + step[2] + 'px)';
        to.transform = 'translateY(0)';
      }
      animations.push(element.animate([from, to], {
        duration: 440, delay: step[1], easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'backwards'
      }));
    });
    if (!animations.length) return;
    // Any intent to use the page ends the effect immediately, without consuming
    // that click, keystroke or scroll. Finished animations leave no inline styles.
    interactions.forEach(function (event) { window.addEventListener(event, finish, { capture: true, passive: true }); });
    if (motion.addEventListener) motion.addEventListener('change', finish);
    animations[animations.length - 1].onfinish = finish;
  } catch (_) { finish(); }
})();
