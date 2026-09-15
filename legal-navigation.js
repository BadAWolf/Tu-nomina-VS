(function () {
  'use strict';
  var button = document.getElementById('menu-btn');
  var panel = document.getElementById('menu-panel');
  var overlay = document.getElementById('menu-overlay');
  var close = document.getElementById('menu-cerrar');
  if (!button || !panel || !overlay || !close) return;
  var background = Array.from(document.querySelectorAll('.topbar, .legal-content, .legal-footer, #cookie-banner'));
  var previousOverflow = '';
  var previousInert = [];
  var opened = false;

  function openMenu() {
    if (opened) return;
    opened = true;
    previousOverflow = document.body.style.overflow;
    previousInert = background.map(function (element) { return element.inert; });
    panel.inert = false;
    panel.removeAttribute('aria-hidden');
    panel.classList.add('abierto');
    overlay.classList.add('abierto');
    button.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
    close.focus();
    background.forEach(function (element) { element.inert = true; });
  }
  function closeMenu() {
    if (!opened) return;
    opened = false;
    background.forEach(function (element, i) { element.inert = previousInert[i]; });
    button.setAttribute('aria-expanded', 'false');
    button.focus();
    panel.inert = true;
    panel.setAttribute('aria-hidden', 'true');
    panel.classList.remove('abierto');
    overlay.classList.remove('abierto');
    document.body.style.overflow = previousOverflow;
  }
  button.addEventListener('click', openMenu);
  close.addEventListener('click', closeMenu);
  overlay.addEventListener('click', closeMenu);
  document.addEventListener('keydown', function (event) {
    if (!opened) return;
    if (event.key === 'Escape') { event.preventDefault(); closeMenu(); }
    if (event.key === 'Tab') {
      var items = panel.querySelectorAll('a[href], button');
      var first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    }
  });
  // Restore a usable page if the browser returns here from its back/forward cache.
  window.addEventListener('pagehide', closeMenu);
})();
