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
  var lifecycle = ['pagehide', 'beforeprint', 'visibilitychange'];
  function finish() {
    animations.forEach(function (animation) { animation.cancel(); });
    lifecycle.forEach(function (event) { window.removeEventListener(event, finish); });
    if (motion.removeEventListener) motion.removeEventListener('change', finish);
  }

  try {
    // Only the heading moves; the calculator fades in without changing the
    // containing block of its desktop advertisements or its layout dimensions.
    [
      ['.topbar .brand', 0, 4, 0.55, 900],
      ['.wrap > header .header-label', 40, 4, 0, 980],
      ['.wrap > header h1', 80, 8, 0, 1120],
      ['.wrap > header .header-sub', 180, 6, 0, 1080],
      ['.wrap > header .header-story', 280, 6, 0, 1080],
      ['.tab-selector', 340, 0, 0.8, 1060],
      ['#view-nomina', 340, 0, 0.86, 1060]
    ].forEach(function (step) {
      var element = document.querySelector(step[0]);
      if (!element) return;
      var from = { opacity: step[3] }, to = { opacity: 1 };
      if (step[2]) {
        from.transform = 'translateY(' + step[2] + 'px)';
        to.transform = 'translateY(0)';
      }
      animations.push(element.animate([from, to], {
        duration: step[4], delay: step[1], easing: 'cubic-bezier(.22,.55,.35,1)', fill: 'backwards'
      }));
    });
    if (!animations.length) return;
    // Controls stay readable and interactive throughout. Ordinary input/scroll
    // must not cancel animations: cancellation would snap the heading into place.
    // Lifecycle and accessibility changes still restore the default view at once.
    lifecycle.forEach(function (event) { window.addEventListener(event, finish); });
    if (motion.addEventListener) motion.addEventListener('change', finish);
    animations[animations.length - 1].onfinish = finish;
  } catch (_) { finish(); }
})();
