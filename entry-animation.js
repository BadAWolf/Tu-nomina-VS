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
  var lowerAnimations = [];
  var lifecycle = ['pagehide', 'beforeprint', 'visibilitychange'];
  function finish() {
    animations.forEach(function (animation) { animation.cancel(); });
    lifecycle.forEach(function (event) { window.removeEventListener(event, finish); });
    document.removeEventListener('focusin', revealControls);
    document.removeEventListener('pointerdown', revealControls, true);
    if (motion.removeEventListener) motion.removeEventListener('change', finish);
  }
  function revealControls(event) {
    // A keyboard user or a quick tap can use the form immediately. Reveal only
    // the lower content, leaving the heading's smooth transition undisturbed.
    if (!event.target || !event.target.nodeType) return;
    if (lowerAnimations.some(function (animation) { return animation.effect.target.contains(event.target); })) {
      lowerAnimations.forEach(function (animation) {
        if (animation.playState !== 'finished' && animation.playState !== 'idle') animation.finish();
      });
    }
  }

  try {
    // Only the heading moves; the calculator fades in without changing the
    // containing block of its desktop advertisements or its layout dimensions.
    [
      ['.topbar .brand', 0, 4, 0.55, 900],
      ['.wrap > header .header-label', 40, 4, 0, 980],
      ['.wrap > header h1', 80, 8, 0, 1120],
      ['.wrap > header .header-sub', 260, 6, 0, 1000],
      ['.wrap > header .header-story', 340, 6, 0, 1000],
      ['.calculator-page .wrap > :not(header), .calculator-page > .legal-footer', 650, 0, 0, 750, true]
    ].forEach(function (step) {
      document.querySelectorAll(step[0]).forEach(function (element) {
        var from = { opacity: step[3] }, to = { opacity: 1 };
        if (step[2]) {
          from.transform = 'translateY(' + step[2] + 'px)';
          to.transform = 'translateY(0)';
        }
        var animation = element.animate([from, to], {
          duration: step[4], delay: step[1], easing: 'cubic-bezier(.22,.55,.35,1)', fill: 'backwards'
        });
        animations.push(animation);
        if (step[5]) lowerAnimations.push(animation);
      });
    });
    if (!animations.length) return;
    // The whole lower page starts transparent, then follows the description.
    // Scrolling does not interrupt the sequence; intentional control use reveals
    // the form immediately. No wrappers, layout changes or disabled controls.
    lifecycle.forEach(function (event) { window.addEventListener(event, finish); });
    document.addEventListener('focusin', revealControls);
    document.addEventListener('pointerdown', revealControls, { capture: true, passive: true });
    if (motion.addEventListener) motion.addEventListener('change', finish);
    var remaining = animations.length;
    animations.forEach(function (animation) {
      animation.onfinish = function () { if (--remaining === 0) finish(); };
    });
  } catch (_) { finish(); }
})();
