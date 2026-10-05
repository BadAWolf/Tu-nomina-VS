/* Guides are free with an account. The full text stays in the HTML for search
   engines (marked as paywalled content in the structured data); the page only
   folds it for visitors who are not signed in. This is not a security boundary. */
(function () {
  'use strict';
  var root = document.documentElement;
  var TOKEN_KEY = 'sb-qhqbrtxzbfokqdlhstuo-auth-token';
  function hasSession() {
    try { return Boolean(localStorage.getItem(TOKEN_KEY)); } catch (_) { return false; }
  }
  // Decide before the first paint, so members never see the fold flash.
  if (!hasSession()) root.classList.add('guide-gated');
  function apply(locked) {
    root.classList.toggle('guide-gated', locked);
    document.querySelectorAll('.guide-locked').forEach(function (node) {
      if (locked) { node.setAttribute('inert', ''); node.setAttribute('aria-hidden', 'true'); }
      else { node.removeAttribute('inert'); node.removeAttribute('aria-hidden'); }
    });
    var gate = document.getElementById('guide-gate');
    if (gate) gate.hidden = !locked;
  }
  document.addEventListener('vigilante:account', function (event) {
    var detail = event.detail || {};
    // While the account check is still running, keep the optimistic state.
    if (detail.member) apply(false);
    else if (!hasSession() || detail.signedIn) apply(true);
  });
  function ready() { apply(root.classList.contains('guide-gated')); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready);
  else ready();
})();
