window.VIGILANTE_AUTH_CONFIG = Object.freeze({
  googleEnabled: true,
  // Enable only after the real site key and matching Supabase secret are configured.
  captcha: Object.freeze({enabled:true,siteKey:'0x4AAAAAAE0rliZ9aRi-6KG2'}),
  url: 'https://qhqbrtxzbfokqdlhstuo.supabase.co',
  publishableKey: 'sb_publishable_JtRLC4nuT_2iwwWCwJiDEA_TaucuC2N',
  // Return to the page that started the sign-in: the community or a guide.
  redirectTo: (location.origin === 'http://localhost:4173'
    ? 'http://localhost:4173' : 'https://calculadoravigilante.com') +
    (['/comunidad.html','/convenio-2026.html','/derechos-vigilante.html','/guia-nomina-vigilante.html','/preguntas-frecuentes.html']
      .includes(location.pathname) ? location.pathname : '/')
});
