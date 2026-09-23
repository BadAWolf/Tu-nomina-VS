(function () {
  'use strict';
  // The same cached file runs twice: arm before any body can paint, then start
  // after the complete content, without waiting for account/advertising scripts.
  var readyEvent = 'vigilante:entry-ready';
  if (document.currentScript && document.currentScript.hasAttribute('data-entry-start')) {
    document.dispatchEvent(new Event(readyEvent));
    return;
  }
  var root = document.documentElement;
  if (document.body || !Element.prototype.animate || !window.matchMedia) return;
  var motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  var navigation = performance.getEntriesByType('navigation')[0];
  if (motion.matches || document.hidden || location.hash || location.search ||
      (navigation && navigation.type !== 'navigate')) return;
  try {
    if (sessionStorage.getItem('vigilante_entry_seen')) return;
    sessionStorage.setItem('vigilante_entry_seen', '1');
  } catch (_) { return; }

  var animations = [], lowerAnimations = [], frame, timeout, finished = false;
  var lifecycle = ['pagehide', 'beforeprint', 'visibilitychange'];
  function finish() {
    finished = true;
    clearTimeout(timeout);
    cancelAnimationFrame(frame);
    root.classList.remove('entry-preparing');
    animations.forEach(function (animation) { animation.cancel(); });
    document.removeEventListener(readyEvent, ready);
    document.removeEventListener('focusin', revealControls);
    document.removeEventListener('pointerdown', revealControls, true);
    lifecycle.forEach(function (event) { window.removeEventListener(event, finish); });
    if (motion.removeEventListener) motion.removeEventListener('change', finish);
  }
  function revealControls(event) {
    if (!event.target || !event.target.closest) return;
    if (event.target.closest('.calculator-page .wrap > :not(header), .calculator-page > .legal-footer')) {
      if (!animations.length) { finish(); return; }
      lowerAnimations.forEach(function (animation) {
        if (animation.playState !== 'finished' && animation.playState !== 'idle') animation.finish();
      });
    }
  }
  function ready() {
    document.removeEventListener(readyEvent, ready);
    frame = requestAnimationFrame(start);
  }
  function start() {
    if (finished) return;
    if (motion.matches || document.hidden || window.scrollY > 0 ||
        (document.activeElement && document.activeElement !== document.body)) { finish(); return; }
    try {
      var clock = document.timeline.currentTime;
      [
        ['.topbar .brand', 0, 4, 0.55, 900],
        ['.wrap > header .header-label', 40, 4, 0, 980],
        ['.wrap > header h1', 80, 8, 0, 1120],
        ['.wrap > header .header-sub', 260, 6, 0, 1000],
        ['.wrap > header .header-story', 340, 6, 0, 1000],
        ['.calculator-page .wrap > :not(header), .calculator-page > .legal-footer', 650, 0, 0, 850, true]
      ].forEach(function (step) {
        document.querySelectorAll(step[0]).forEach(function (element) {
          var from = { opacity: step[3] }, to = { opacity: 1 };
          if (step[2]) { from.transform = 'translateY(' + step[2] + 'px)'; to.transform = 'translateY(0)'; }
          var animation = element.animate([from, to], {
            duration: step[4], delay: step[1], easing: 'cubic-bezier(.25,.1,.25,1)', fill: 'backwards'
          });
          // One clock for all borders, backgrounds, controls and lower sections.
          animation.startTime = clock;
          animations.push(animation);
          if (step[5]) lowerAnimations.push(animation);
        });
      });
      // CSS and animations exchange responsibility in the same frame: no flash.
      root.classList.remove('entry-preparing');
      clearTimeout(timeout);
      timeout = setTimeout(finish, 1600);
    } catch (_) { finish(); }
  }
  try {
    // Fail open even if the bottom marker is blocked or the HTML is interrupted.
    timeout = setTimeout(finish, 2500);
    document.addEventListener(readyEvent, ready);
    document.addEventListener('focusin', revealControls);
    document.addEventListener('pointerdown', revealControls, { capture: true, passive: true });
    lifecycle.forEach(function (event) { window.addEventListener(event, finish); });
    if (motion.addEventListener) motion.addEventListener('change', finish);
    root.classList.add('entry-preparing');
  } catch (_) { finish(); }
})();
