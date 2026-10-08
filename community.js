/* Comunidad abierta: cualquiera entra sin cuenta. La invitación se pide a la base de
   datos al pulsar el botón y nunca se escribe en el HTML ni en el repositorio. */
(function () {
  'use strict';
  const button=document.getElementById('community-access');
  if (!button) return;
  const status=document.getElementById('community-status');
  let busy=false;
  // Lectura anónima con la clave publicable: la política de la tabla solo deja ver la invitación activa.
  async function invitation(){
    const config=window.VIGILANTE_AUTH_CONFIG;
    if(!config)throw Error('config');
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),10000);
    try{
      const response=await fetch(config.url+'/rest/v1/community_links?select=invite_url&slug=eq.whatsapp&limit=1',
        {headers:{apikey:config.publishableKey,Authorization:'Bearer '+config.publishableKey},signal:controller.signal});
      if(!response.ok)throw Error('http_'+response.status);
      const rows=await response.json();
      return Array.isArray(rows)&&rows[0]?.invite_url||null;
    }finally{clearTimeout(timer);}
  }
  async function reveal(){
    if(busy)return;
    busy=true;button.disabled=true;status.textContent='Abriendo WhatsApp…';
    try{
      const invite=await invitation();
      if(!invite){status.textContent='El acceso no está disponible en este momento. Puedes volver a intentarlo más tarde.';return;}
      const url=new URL(invite);
      // Solo se abre una invitación real de WhatsApp, sin parámetros añadidos.
      if(url.origin!=='https://chat.whatsapp.com' || !/^\/[A-Za-z0-9]{10,64}$/.test(url.pathname) || url.search || url.hash)throw Error('invalid_invite');
      window.VigilanteAnalytics?.track('community_open');
      status.textContent='';
      location.assign(url.href);
    }catch(_){status.textContent='No se ha podido abrir la comunidad. Vuelve a intentarlo en un momento.';}
    finally{busy=false;button.disabled=false;}
  }
  button.addEventListener('click',reveal);
})();
