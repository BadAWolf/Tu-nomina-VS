(function () {
  'use strict';
  // Only editorial pages. No registration forms, payroll, leave or PDF data.
  const pages=new Set(['/convenio-2026.html','/derechos-vigilante.html','/guia-nomina-vigilante.html','/preguntas-frecuentes.html']);
  const production=location.protocol==='https:' && ['calculadoravigilante.com','www.calculadoravigilante.com'].includes(location.hostname);
  const params=new URLSearchParams(location.search);
  const cleanURL=Array.from(params.keys()).every(key=>['fc','fctype'].includes(key)) && (!location.hash || location.hash==='#privacidad-publicitaria');
  if(!production || !pages.has(location.pathname) || !cleanURL || window.top!==window.self)return;
  const client='ca-pub-6334238097806445';
  let started=false, requested=false, allowed=false, revoking=false, pendingPrivacy=false;
  const queue=window.adsbygoogle=window.adsbygoogle||[];
  queue.pauseAdRequests=1;
  // Contextual ads only. We never build ad audiences from account data.
  queue.requestNonPersonalizedAds=1;
  function hideAds(){
    queue.pauseAdRequests=1;allowed=false;
    document.querySelectorAll('[data-ad-placement]').forEach(section=>{section.hidden=true;});
  }
  function renderAds(){
    if(!allowed || requested)return;
    const sections=Array.from(document.querySelectorAll('[data-ad-placement]'));
    if(!sections.length)return;
    requested=true;
    sections.forEach(section=>{
      section.hidden=false;
      const ad=section.querySelector('.adsbygoogle');
      if(ad && window.MutationObserver){
        const observer=new MutationObserver(()=>{
          if(ad.getAttribute('data-ad-status')==='unfilled'){section.hidden=true;observer.disconnect();}
        });
        observer.observe(ad,{attributes:true,attributeFilter:['data-ad-status']});
      }
      queue.push({});
    });
    queue.pauseAdRequests=0;
  }
  function consentChanged(tc, success){
    if(!success || tc?.cmpStatus==='error'){hideAds();return;}
    if(!['tcloaded','useractioncomplete'].includes(tc?.eventStatus))return;
    if(revoking && tc.eventStatus!=='useractioncomplete')return;
    // Unknown jurisdictions/choices fail closed. Google also validates the full
    // TC string. A refusal never falls back to limited ads or tracking cookies.
    const basic=[2,7,9,10].every(id=>tc.purpose?.consents?.[id]===true || tc.purpose?.legitimateInterests?.[id]===true);
    const next=tc.gdprApplies===true && tc.vendor?.consents?.[755]===true && tc.purpose?.consents?.[1]===true && basic;
    if(revoking && tc.eventStatus==='useractioncomplete' && requested){
      hideAds();location.reload();return;
    }
    revoking=false;
    if(!next){hideAds();return;}
    allowed=true;renderAds();
  }
  function start(){
    if(started || !window.VigilantePrivacy?.hasAnalyticsChoice())return;
    started=true;
    window.googlefc=window.googlefc||{};
    window.googlefc.callbackQueue=window.googlefc.callbackQueue||[];
    window.googlefc.callbackQueue.push({CONSENT_API_READY:function(){
      if(typeof window.__tcfapi==='function')window.__tcfapi('addEventListener',2,consentChanged);
      if(pendingPrivacy){pendingPrivacy=false;window.googlefc.showRevocationMessage?.();}
    }});
    const script=document.createElement('script');
    script.async=true;script.crossOrigin='anonymous';
    script.src='https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client='+client;
    script.addEventListener('error',hideAds,{once:true});
    document.head.appendChild(script);
  }
  function openPrivacy(event){
    event?.preventDefault();hideAds();revoking=true;start();
    if(!started){pendingPrivacy=true;window.openCookieSettings?.();return;}
    window.googlefc.callbackQueue.push({CONSENT_API_READY:function(){
      if(typeof window.googlefc.showRevocationMessage==='function')window.googlefc.showRevocationMessage();
    }});
  }
  function init(){
    document.querySelectorAll('[data-ad-privacy]').forEach(button=>button.addEventListener('click',openPrivacy));
    window.addEventListener('vigilante:analytics-choice',start);
    start();
    if(location.hash==='#privacidad-publicitaria')openPrivacy();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
