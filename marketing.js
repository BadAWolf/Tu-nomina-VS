(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const version = '2026-09-15-marketing-v1';
  let client, verify, account = null, loading = false, request = 0;
  const status = $('marketing-status');
  function message(text, error = false) { status.textContent = text; status.dataset.error = String(error); }
  function currentChoice(row, user) {
    return row && row.email_at_consent === user.email.toLowerCase() ? row : {own_news:false, partner_offers:false};
  }
  async function load() {
    if (!client || !account || loading) return;
    loading = true; const ticket = ++request, id = account.id;
    $('marketing-save').disabled = true; $('marketing-withdraw').disabled = true;
    message('Cargando tus preferencias…');
    try {
      const result = await client.from('marketing_preferences').select('email_at_consent,own_news,partner_offers').eq('user_id',id).maybeSingle();
      if (ticket !== request || account?.id !== id) return;
      if (result.error) throw result.error;
      const choice = currentChoice(result.data, account);
      $('marketing-own').checked = choice.own_news;
      $('marketing-partners').checked = choice.partner_offers;
      message(choice.own_news || choice.partner_offers ? 'Tienes una suscripción activa. Puedes cambiarla o darte de baja.' : 'No estás suscrito a publicidad.');
      $('marketing-save').disabled = false;
    } catch (_) {
      if (ticket === request) message('No se pudieron cargar tus preferencias. Cierra este apartado y vuelve a abrirlo. También puedes solicitar la baja por correo.',true);
    } finally {
      if (ticket === request) { loading = false; $('marketing-withdraw').disabled = false; }
    }
  }
  async function save(own, partners, source) {
    const result = await client.from('marketing_consent_events').insert({own_news:own, partner_offers:partners, version, source});
    if (result.error) throw result.error;
  }
  window.VigilanteMarketing = {
    init(db, getUser) { client = db; verify = getUser; },
    setUser(user) {
      if (account?.id === user?.id && account?.email === user?.email) return;
      account = user; request++; loading = false;
      $('marketing-preferences').hidden = !user;
      $('marketing-preferences').open = false;
      $('marketing-own').checked = false; $('marketing-partners').checked = false; message('');
    },
    resetActivation() { $('auth-marketing-own').checked = false; $('auth-marketing-partners').checked = false; },
    async activate() {
      if (!account) throw new Error('verified_account_required');
      await save($('auth-marketing-own').checked,$('auth-marketing-partners').checked,'account_activation');
    }
  };
  $('marketing-preferences').addEventListener('toggle', () => { if ($('marketing-preferences').open) load(); });
  async function update(withdraw) {
    if (loading) return;
    loading = true;
    const own = withdraw ? false : $('marketing-own').checked;
    const partners = withdraw ? false : $('marketing-partners').checked;
    $('marketing-save').disabled = true; $('marketing-withdraw').disabled = true;
    message('Guardando tus preferencias…');
    try {
      const user = await verify(true);
      if (!user) throw new Error('verified_account_required');
      await save(own,partners,'account_preferences');
      $('marketing-own').checked = own; $('marketing-partners').checked = partners;
      message(own || partners ? 'Preferencias guardadas. Solo recibirás las categorías que has elegido.' : 'Baja guardada. No recibirás publicidad; tu cuenta y tus herramientas siguen disponibles.');
    } catch (_) { message('No se pudo guardar el cambio. Reinténtalo o solicita la baja por correo; no la hemos marcado como completada.',true); }
    finally { loading = false; $('marketing-save').disabled = false; $('marketing-withdraw').disabled = false; }
  }
  $('marketing-form').addEventListener('submit', event => { event.preventDefault(); update(false); });
  $('marketing-withdraw').addEventListener('click', () => update(true));
})();
