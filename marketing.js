(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const dialog = $('marketing-dialog');
  const prefs = $('marketing-preferences');
  let client, verify, account = null, eligible = false, loading = false, request = 0;
  let welcomeNeeded = false, welcomeShown = false, expecting = false;
  function message(text, error = false, welcome = false) {
    const status = $(welcome ? 'marketing-welcome-status' : 'marketing-status');
    if (!status) return;
    status.textContent = text; status.dataset.error = String(error);
  }
  function sameAccount(expected) { return account?.id === expected?.id && account?.email === expected?.email; }
  function currentChoice(row, user) {
    return row && row.email_at_consent === user.email.toLowerCase() ? row : null;
  }
  async function readChoice(user) {
    const result = await client.from('marketing_preferences').select('email_at_consent,own_news,partner_offers,personalize').eq('user_id',user.id).maybeSingle();
    if (result.error) throw result.error;
    return currentChoice(result.data,user);
  }
  /* ── Account preferences panel (only on pages with the account card) ── */
  function syncProfile() {
    if (!prefs) return;
    const hasMail = $('marketing-own').checked || $('marketing-partners').checked;
    const permission = $('marketing-personalize');
    $('marketing-targeting').hidden = false;
    if (!hasMail) permission.checked = false;
    permission.disabled = loading || !hasMail;
    $('marketing-profile-fields').hidden = false;
    $('marketing-profile-fields').disabled = loading || !permission.checked;
    for (const field of ['age','province','city']) {
      const input = $('marketing-'+field);
      input.setCustomValidity('');
      if (!permission.checked) input.value = '';
    }
  }
  function fillProfile(choice, profile) {
    if (!prefs) return;
    $('marketing-personalize').checked = Boolean(choice?.personalize && profile);
    $('marketing-age').value = profile?.age_band || '';
    $('marketing-province').value = profile?.province_code || '';
    $('marketing-city').value = profile?.city || '';
    syncProfile();
  }
  function collectProfile(withdraw) {
    if (withdraw || !$('marketing-personalize').checked) return {personalize:false,age:null,province:null,city:null};
    const age = $('marketing-age'), province = $('marketing-province'), city = $('marketing-city');
    const cleanCity = city.value.trim().normalize('NFC').replace(/\s+/g,' ');
    age.setCustomValidity(age.value || province.value ? '' : 'Indica tu franja de edad o provincia, o desmarca la personalización.');
    province.setCustomValidity(!cleanCity || province.value ? '' : 'Elige la provincia de esta ciudad.');
    city.setCustomValidity(!cleanCity || (cleanCity.length <= 80 && /^[\p{L}][\p{L}\p{N} .'’/()\-]*$/u.test(cleanCity)) ? '' : 'Escribe solo el nombre de tu ciudad o municipio.');
    if (!$('marketing-form').reportValidity()) return null;
    return {personalize:true,age:age.value || null,province:province.value || null,city:cleanCity || null};
  }
  function setBusy(value) {
    loading = value;
    for (const id of ['marketing-save','marketing-withdraw','marketing-welcome-save','marketing-skip','auth-marketing-fields','marketing-own','marketing-partners'])
      if ($(id)) $(id).disabled = value;
    syncProfile();
  }
  /* ── Welcome dialog: only for accounts that never answered ── */
  function showWelcome() {
    if (!dialog || expecting || !eligible || !welcomeNeeded || welcomeShown || document.querySelector('dialog[open]')) return;
    welcomeShown = true;
    window.VigilanteAuthUI?.fill('auth-marketing', null);
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
    }
  }
  async function load() {
    if (!client || !account || loading || !prefs) return;
    const ticket = request, expected = account;
    setBusy(true); message('Cargando tus preferencias…');
    try {
      const choice = await readChoice(expected);
      let profile = null;
      if (choice?.personalize) {
        const result = await client.from('marketing_profiles').select('email_at_consent,age_band,province_code,city').eq('user_id',expected.id).maybeSingle();
        if (result.error) throw result.error;
        profile = currentChoice(result.data,expected);
      }
      if (ticket !== request || !sameAccount(expected)) return;
      $('marketing-own').checked = Boolean(choice?.own_news);
      $('marketing-partners').checked = Boolean(choice?.partner_offers);
      fillProfile(choice,profile);
      message(choice?.own_news || choice?.partner_offers ? 'Tienes una suscripción activa. Puedes cambiarla o darte de baja.' : 'No estás suscrito a publicidad.');
      setBusy(false);
    } catch (_) {
      if (ticket === request) {
        setBusy(false); $('marketing-save').disabled = true;
        message('No se pudieron cargar tus preferencias. Cierra este apartado y vuelve a abrirlo. También puedes solicitar la baja por correo.',true);
      }
    }
  }
  async function save(own, partners, profile, source, expected) {
    const user = await verify(true);
    if (!user || !sameAccount(expected) || user.id !== expected.id || user.email !== expected.email) throw new Error('verified_account_required');
    const previous = await readChoice(user);
    if (!sameAccount(expected)) throw new Error('account_changed');
    // The server stamps identity, verified email, wording and time. Its trigger
    // suppresses duplicate choices, which return no row and generate no event.
    const result = await client.rpc('save_marketing_choices',{p_user_id:expected.id,p_own_news:own,p_partner_offers:partners,
      p_personalize:profile.personalize,p_age_band:profile.age,p_province_code:profile.province,p_city:profile.city,p_source:source});
    if (result.error) throw result.error;
    if (!sameAccount(expected)) throw new Error('account_changed');
    if (result.data?.length) {
      for (const [field, category] of [['own_news','own'],['partner_offers','partner']]) {
        const before = Boolean(previous?.[field]), after = result.data[0][field];
        if (before !== after) window.VigilanteAnalytics?.track('marketing_' + category + (after ? '_opt_in' : '_opt_out'));
      }
    }
    return previous;
  }
  function profileFrom(choice) {
    const mail = Boolean(choice.own || choice.partners);
    const personalize = mail && Boolean(choice.personalize && choice.province);
    return {personalize, age:null, province: personalize ? choice.province : null, city:null};
  }
  window.VigilanteMarketing = {
    init(db, getUser) { client = db; verify = getUser; },
    // Called by the account flow while it records the choice made during sign-up.
    expectChoice() { expecting = true; },
    releaseChoice() { expecting = false; setTimeout(showWelcome, 0); },
    async applyChoice(choice) {
      try {
        const user = await verify(true);
        if (!user) throw new Error('verified_account_required');
        const own = Boolean(choice.own), partners = Boolean(choice.partners);
        // An empty sign-up choice never overwrites an earlier answer.
        const previous = await readChoice(user);
        if (previous && !own && !partners) { welcomeNeeded = false; return; }
        await save(own, partners, profileFrom(choice), 'account_activation', user);
        welcomeNeeded = false;
      } finally { expecting = false; }
    },
    setUser(user, member = false) {
      const changed = !sameAccount(user);
      if (!changed && eligible === member) return;
      if (changed) {
        request++; welcomeNeeded = false; welcomeShown = false;
        if (dialog?.open) dialog.close();
        if (prefs) {
          prefs.open = false;
          $('marketing-own').checked = false; $('marketing-partners').checked = false;
          fillProfile(null,null);
        }
        message(''); setBusy(false);
      }
      account = user; eligible = Boolean(user && member);
      if (prefs) prefs.hidden = !user;
      if (!eligible && dialog?.open) dialog.close();
      if (eligible) offerWelcome();
    }
  };
  // Ask after authentication without stacking dialogs or delaying member tools.
  document.addEventListener('close', () => { setTimeout(showWelcome,0); }, true);
  $('marketing-close')?.addEventListener('click', () => dialog.close());
  prefs?.addEventListener('toggle', () => { if (prefs.open) load(); });
  async function update(withdraw) {
    if (loading || !account) return;
    const own = !withdraw && $('marketing-own').checked;
    const partners = !withdraw && $('marketing-partners').checked;
    syncProfile();
    const profile = collectProfile(withdraw);
    if (!profile) return;
    const expected = account, ticket = ++request;
    setBusy(true); message('Guardando tu elección…');
    try {
      await save(own,partners,profile,'account_preferences',expected);
      if (ticket !== request) return;
      welcomeNeeded = false;
      $('marketing-own').checked = own; $('marketing-partners').checked = partners;
      fillProfile({personalize:profile.personalize},profile.personalize ? {age_band:profile.age,province_code:profile.province,city:profile.city} : null);
      message(own || partners ? 'Preferencias guardadas. Solo recibirás las categorías que has elegido.' : 'Preferencias guardadas: sin publicidad. Tu cuenta y tus herramientas siguen disponibles.');
    } catch (_) {
      if (ticket === request) message('No se pudo guardar tu elección. Reinténtalo o solicita la baja por correo.',true);
    } finally { if (ticket === request) setBusy(false); }
  }
  async function updateWelcome(skip) {
    if (loading || !account) return;
    const form = $('marketing-welcome-form');
    if (!skip && !form.reportValidity()) return;
    const choice = skip ? {own:false,partners:false} : window.VigilanteAuthUI.read('auth-marketing');
    const expected = account, ticket = ++request;
    setBusy(true); message('Guardando tu elección…',false,true);
    try {
      await save(Boolean(choice.own),Boolean(choice.partners),profileFrom(choice),'account_activation',expected);
      if (ticket !== request) return;
      welcomeNeeded = false;
      dialog.close();
      window.VigilanteAuthUI?.toast(choice.own || choice.partners ? 'Preferencias guardadas. Solo recibirás lo que has elegido.' : 'Preferencias guardadas: sin publicidad.');
    } catch (_) {
      if (ticket === request) message('No se pudo guardar tu elección. Puedes cerrar esta ventana y seguir usando la web.',true,true);
    } finally { if (ticket === request) setBusy(false); }
  }
  if (prefs) {
    $('marketing-form').addEventListener('submit', event => { event.preventDefault(); update(false); });
    $('marketing-withdraw').addEventListener('click', () => update(true));
    for (const field of ['own','partners','personalize','age','province','city']) $('marketing-'+field).addEventListener('input',syncProfile);
  }
  $('marketing-welcome-form')?.addEventListener('submit', event => { event.preventDefault(); updateWelcome(false); });
  $('marketing-skip')?.addEventListener('click', () => updateWelcome(true));
})();
