/* Comunidad abierta: cualquiera entra sin cuenta. La invitación se pide a la base de
   datos al pulsar el botón y nunca se escribe en el HTML ni en el repositorio. */
(function () {
  'use strict';
  const button=document.getElementById('community-access');
  if (!button) return;
  const status=document.getElementById('community-status');
  let busy=false;
  const clientReady=new Promise(resolve=>{
    // auth.js crea el cliente de Supabase y lo comparte aquí.
    window.VigilanteCommunity={init(db){resolve(db);},setUser(){}};
  });
  const timeout=ms=>new Promise((_,reject)=>setTimeout(()=>reject(Error('timeout')),ms));
  async function reveal(){
    if(busy)return;
    busy=true;button.disabled=true;status.textContent='Abriendo WhatsApp…';
    try{
      const client=await Promise.race([clientReady,timeout(10000)]);
      const result=await client.from('community_links').select('invite_url').eq('slug','whatsapp').maybeSingle();
      if(result.error)throw result.error;
      if(!result.data?.invite_url){status.textContent='El acceso no está disponible en este momento. Puedes volver a intentarlo más tarde.';return;}
      const url=new URL(result.data.invite_url);
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
