(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const version = '2026-09-15-marketing-v1';
  const dialog = $('marketing-dialog');
  let client, verify, account = null, eligible = false, loading = false, request = 0;
  let welcomeNeeded = false, welcomeShown = false;
  function message(text, error = false, welcome = false) {
    const status = $(welcome ? 'marketing-welcome-status' : 'marketing-status');
    status.textContent = text; status.dataset.error = String(error);
  }
  function sameAccount(expected) { return account?.id === expected?.id && account?.email === expected?.email; }
  function currentChoice(row, user) {
    return row && row.email_at_consent === user.email.toLowerCase() ? row : null;
  }
  async function readChoice(user) {
    const result = await client.from('marketing_preferences').select('email_at_consent,own_news,partner_offers').eq('user_id',user.id).maybeSingle();
    if (result.error) throw result.error;
    return currentChoice(result.data,user);
  }
  function setBusy(value) {
    loading = value;
    for (const id of ['marketing-save','marketing-withdraw','marketing-welcome-save','marketing-skip','auth-marketing-fields']) $(id).disabled = value;
    $('marketing-own').disabled = value; $('marketing-partners').disabled = value;
  }
  function showWelcome() {
    if (!eligible || !welcomeNeeded || welcomeShown || document.querySelector('dialog[open]')) return;
    welcomeShown = true;
    $('auth-marketing-own').checked = false; $('auth-marketing-partners').checked = false;
    message('',false,true);
    dialog.showModal();
    $('marketing-close').focus();
  }
  async function offerWelcome() {
    const expected = account, ticket = request;
    try {
      const choice = await readChoice(expected);
      if (ticket !== request || !sameAccount(expected) || !eligible) return;
      welcomeNeeded = !choice;
      showWelcome();
    } catch (_) {
      // A failed read is not an absent choice: never overwrite an existing refusal.
      if (ticket === request) message('No se pudieron consultar tus preferencias. Abre este apartado para reintentarlo.',true);
    }
  }
  async function load() {
    if (!client || !account || loading) return;
    const ticket = request, expected = account;
    setBusy(true); message('Cargando tus preferencias…');
    try {
      const choice = await readChoice(expected);
      if (ticket !== request || !sameAccount(expected)) return;
      $('marketing-own').checked = Boolean(choice?.own_news);
      $('marketing-partners').checked = Boolean(choice?.partner_offers);
      message(choice?.own_news || choice?.partner_offers ? 'Tienes una suscripción activa. Puedes cambiarla o darte de baja.' : 'No estás suscrito a publicidad.');
      setBusy(false);
    } catch (_) {
      if (ticket === request) {
        setBusy(false); $('marketing-save').disabled = true;
        message('No se pudieron cargar tus preferencias. Cierra este apartado y vuelve a abrirlo. También puedes solicitar la baja por correo.',true);
      }
    }
  }
  async function save(own, partners, source, expected) {
    const user = await verify(true);
    if (!user || !sameAccount(expected) || user.id !== expected.id || user.email !== expected.email) throw new Error('verified_account_required');
    const previous = await readChoice(user);
    if (!sameAccount(expected)) throw new Error('account_changed');
    // The server stamps identity, verified email, wording and time. Its trigger
    // suppresses duplicate choices, which return no row and generate no event.
    const result = await client.from('marketing_consent_events').insert({own_news:own, partner_offers:partners, version, source}).select('own_news,partner_offers');
    if (result.error) throw result.error;
    if (!sameAccount(expected)) throw new Error('account_changed');
    if (result.data?.length) {
      for (const [field, category] of [['own_news','own'],['partner_offers','partner']]) {
        const before = Boolean(previous?.[field]), after = result.data[0][field];
        if (before !== after) window.VigilanteAnalytics?.track('marketing_' + category + (after ? '_opt_in' : '_opt_out'));
      }
    }
  }
  window.VigilanteMarketing = {
    init(db, getUser) { client = db; verify = getUser; },
    setUser(user, member = false) {
      const changed = !sameAccount(user);
      if (!changed && eligible === member) return;
      if (changed) {
        request++; welcomeNeeded = false; welcomeShown = false;
        if (dialog.open) dialog.close();
        $('marketing-preferences').open = false;
        $('marketing-own').checked = false; $('marketing-partners').checked = false;
        message(''); setBusy(false);
      }
      account = user; eligible = Boolean(user && member);
      $('marketing-preferences').hidden = !user;
      if (!eligible && dialog.open) dialog.close();
      if (eligible) offerWelcome();
    }
  };
  // Ask after authentication without stacking dialogs or delaying member tools.
  document.addEventListener('close', () => { setTimeout(showWelcome,0); }, true);
  $('marketing-close').addEventListener('click', () => dialog.close());
  $('marketing-preferences').addEventListener('toggle', () => { if ($('marketing-preferences').open) load(); });
  async function update(withdraw, welcome = false) {
    if (loading || !account) return;
    const expected = account, ticket = ++request;
    const own = !withdraw && $(welcome ? 'auth-marketing-own' : 'marketing-own').checked;
    const partners = !withdraw && $(welcome ? 'auth-marketing-partners' : 'marketing-partners').checked;
    setBusy(true); message('Guardando tu elección…',false,welcome);
    try {
      await save(own,partners,welcome ? 'account_activation' : 'account_preferences',expected);
      if (ticket !== request) return;
      welcomeNeeded = false;
      $('marketing-own').checked = own; $('marketing-partners').checked = partners;
      const text = own || partners ? 'Preferencias guardadas. Solo recibirás las categorías que has elegido.' : 'Preferencias guardadas: sin publicidad. Tu cuenta y tus herramientas siguen disponibles.';
      message(text);
      if (welcome) { dialog.close(); $('account-notice').textContent = text; }
    } catch (_) {
      if (ticket === request) message('No se pudo guardar tu elección. Reinténtalo o solicita la baja por correo. Tu cuenta sigue activa y puedes cerrar esta ventana para continuar.',true,welcome);
    } finally { if (ticket === request) setBusy(false); }
  }
  $('marketing-form').addEventListener('submit', event => { event.preventDefault(); update(false); });
  $('marketing-withdraw').addEventListener('click', () => update(true));
  $('marketing-welcome-form').addEventListener('submit', event => { event.preventDefault(); update(false,true); });
  $('marketing-skip').addEventListener('click', () => update(true,true));
})();
