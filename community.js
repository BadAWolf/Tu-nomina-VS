/* The invitation is delivered by member-only database permissions, never HTML. */
(function () {
  'use strict';
  const button=document.getElementById('community-access');
  if (!button) return;
  const status=document.getElementById('community-status');
  let client,verify,account=null,member=false,generation=0,busy=false;
  function same(user){return member && user?.id===account?.id && user?.email===account?.email;}
  async function reveal(){
    if(busy || !client)return;
    const ticket=generation,expected=account;
    busy=true;button.disabled=true;status.textContent='Abriendo WhatsApp…';
    try{
      const user=await verify(true);
      if(ticket!==generation || !same(user) || user.id!==expected?.id)throw Error('account_changed');
      const result=await client.from('community_links').select('invite_url').eq('slug','whatsapp').maybeSingle();
      if(ticket!==generation || !same(user))return;
      if(result.error)throw result.error;
      if(!result.data?.invite_url){status.textContent='El acceso no está disponible en este momento. Puedes volver a intentarlo más tarde.';return;}
      const url=new URL(result.data.invite_url);
      if(url.origin!=='https://chat.whatsapp.com' || !/^\/[A-Za-z0-9]{10,64}$/.test(url.pathname) || url.search || url.hash)throw Error('invalid_invite');
      window.VigilanteAnalytics?.track('community_open');
      location.assign(url.href);
    }catch(_){if(ticket===generation){status.textContent='No se ha podido comprobar el acceso. Inicia sesión con una cuenta confirmada o vuelve a intentarlo.';}}
    finally{if(ticket===generation){busy=false;button.disabled=false;}}
  }
  window.VigilanteCommunity={
    init(db,getUser){client=db;verify=getUser;},
    setUser(user,eligible){
      const changed=user?.id!==account?.id || user?.email!==account?.email || member!==eligible;
      account=user;member=Boolean(user&&eligible);
      if(changed){generation++;busy=false;button.disabled=false;status.textContent=member?'Tu cuenta está activa. El botón te lleva directamente a WhatsApp.':'';}
      button.textContent='Abrir comunidad en WhatsApp';
    }
  };
  button.addEventListener('click',()=>window.VigilanteAuth?.require(reveal));
})();
