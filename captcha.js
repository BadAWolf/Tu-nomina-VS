/* Turnstile tokens are checked by Supabase, never trusted as authorization here. */
(function(){
  'use strict';
  const config=window.VIGILANTE_AUTH_CONFIG.captcha||{},box=document.getElementById('auth-captcha');
  const host=document.getElementById('auth-captcha-widget'),notice=document.getElementById('auth-captcha-status');
  let widget=null,token='',verifiedAt=0,active=false,revision=0,loading=null,currentMode='signin';
  function clear(){token='';verifiedAt=0;}
  function fail(){clear();notice.textContent='No se ha podido completar la comprobación. Reinténtalo o revisa tu conexión.';}
  function load(){
    if(window.turnstile)return Promise.resolve();
    if(loading)return loading;
    loading=new Promise((resolve,reject)=>{
      const script=document.createElement('script');script.async=true;script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      const timer=setTimeout(()=>{script.remove();loading=null;reject(new Error('captcha_load'));},12000);
      script.onload=()=>{clearTimeout(timer);if(window.turnstile)resolve();else{loading=null;reject(new Error('captcha_load'));}};
      script.onerror=()=>{clearTimeout(timer);script.remove();loading=null;reject(new Error('captcha_load'));};
      document.head.appendChild(script);
    });
    return loading;
  }
  function close(){
    active=false;revision++;clear();box.hidden=true;
    if(widget!==null&&window.turnstile)window.turnstile.remove(widget);
    widget=null;host.replaceChildren();notice.textContent='';
  }
  async function show(mode){
    close();
    currentMode=mode;
    if(!config.enabled||!['signup','signin','reset'].includes(mode))return;
    active=true;box.hidden=false;notice.textContent='Preparando comprobación de seguridad…';
    const request=revision;
    try{
      if(!config.siteKey)throw new Error('captcha_config');
      await load();if(!active||request!==revision)return;
      widget=window.turnstile.render(host,{
        sitekey:config.siteKey,theme:'light',language:'es',size:'flexible',action:mode,
        'response-field':false,
        callback:value=>{if(active&&request===revision){token=value;verifiedAt=Date.now();notice.textContent='Comprobación completada.';}},
        'expired-callback':()=>{if(active&&request===revision){clear();notice.textContent='La comprobación ha caducado. Vuelve a intentarlo.';}},
        'error-callback':()=>{if(active&&request===revision)fail();},
        'timeout-callback':()=>{if(active&&request===revision)fail();}
      });
    }catch(_){if(active&&request===revision)fail();}
  }
  function take(){
    if(!config.enabled)return undefined;
    if(!active||!token||Date.now()-verifiedAt>270000){clear();throw Object.assign(new Error('captcha_required'),{code:'captcha_required'});}
    const value=token;clear();return value;
  }
  function reset(){clear();if(active&&widget!==null&&window.turnstile){notice.textContent='';window.turnstile.reset(widget);}}
  document.getElementById('auth-captcha-retry').addEventListener('click',()=>{if(widget===null)show(currentMode);else reset();});
  window.VigilanteCaptcha=Object.freeze({show,close,take,reset});
})();
