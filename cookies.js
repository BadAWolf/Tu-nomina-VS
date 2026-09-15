(function () {
  'use strict';
  const key='vigilante_cookie_preferences_v1', maxAge=180*24*60*60*1000;
  let preferences=null;
  try{preferences=JSON.parse(localStorage.getItem(key));}catch(_){}
  if(!preferences || preferences.version!==1 || typeof preferences.analytics!=='boolean' || !Number.isFinite(preferences.savedAt) || preferences.savedAt>Date.now() || Date.now()-preferences.savedAt>maxAge)preferences=null;
  let analyticsLoaded=false;
  const production = location.protocol === 'https:' && ['calculadoravigilante.com','www.calculadoravigilante.com'].includes(location.hostname);
  const authCallback=()=>/access_token=|refresh_token=|error_description=|type=recovery|[?&]code=|unsubscribe=/.test(location.hash+location.search);
  function pageData(){
    let referrer='';
    try{referrer=new URL(document.referrer).origin+'/';}catch(_){}
    return {page_location:location.origin+location.pathname,page_referrer:referrer,page_title:document.title};
  }
  function loadAnalytics(){
    if(!production || authCallback() || analyticsLoaded || !preferences || !preferences.analytics)return;
    analyticsLoaded=true;
    window.dataLayer=window.dataLayer||[];
    window.gtag=function(){window.dataLayer.push(arguments);};
    window.gtag('consent','default',{ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied',analytics_storage:'granted'});
    window.gtag('js',new Date());
    window.gtag('config','G-NMM3MRRZ6B',{allow_google_signals:false,allow_ad_personalization_signals:false,cookie_expires:15552000,cookie_update:false,send_page_view:false,...pageData()});
    window.gtag('event','page_view',pageData());
    const script=document.createElement('script');script.async=true;
    script.src='https://www.googletagmanager.com/gtag/js?id=G-NMM3MRRZ6B';document.head.appendChild(script);
  }
  // Only fixed event names and a fixed method enum can leave the calculator.
  // No email, account ID, salary, calendar, free text or historical event queue.
  window.VigilanteAnalytics = Object.freeze({track(name, details={}){
    if(!['sign_up_start','sign_up','login','calculation_complete','pdf_export'].includes(name) || !production || authCallback() || !preferences?.analytics)return false;
    loadAnalytics();
    if(!analyticsLoaded)return false;
    const params=pageData();
    if(['Google','Email','Share','Download'].includes(details.method))params.method=details.method;
    window.gtag('event',name,params);
    return true;
  }});
  function save(analytics){
    const wasActive=Boolean(preferences&&preferences.analytics);
    preferences={version:1,analytics:Boolean(analytics),savedAt:Date.now()};
    try{localStorage.setItem(key,JSON.stringify(preferences));}catch(_){}
    document.getElementById('cookie-banner').hidden=true;
    if(wasActive&&!analytics){
      if(window.gtag)window.gtag('consent','update',{analytics_storage:'denied'});
      document.cookie.split(';').forEach(part=>{
        const name=part.trim().split('=')[0];
        if(!/^_ga($|_)/.test(name))return;
        document.cookie=name+'=; Max-Age=0; path=/';
        const host=location.hostname.split('.');
        for(let i=0;i<host.length-1;i++)document.cookie=name+'=; Max-Age=0; path=/; domain=.'+host.slice(i).join('.');
      });
      location.reload();
    }else loadAnalytics();
  }
  window.acceptCookies=()=>save(true);
  window.rejectCookies=()=>save(false);
  window.openCookieSettings=()=>{document.getElementById('cookie-banner').hidden=false;document.getElementById('cookie-reject').focus();};
  function init(){
    const banner=document.getElementById('cookie-banner');
    if(!banner)return;
    banner.removeAttribute('style');banner.hidden=Boolean(preferences);
    document.querySelectorAll('[data-cookie-settings]').forEach(button=>button.addEventListener('click',window.openCookieSettings));
    document.querySelectorAll('[data-cookie-choice]').forEach(button=>button.addEventListener('click',()=>save(button.dataset.cookieChoice==='accept')));
    loadAnalytics();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
