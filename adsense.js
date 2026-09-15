(function () {
  'use strict';
  // Fixed public placements only. Never read account, payroll or leave values.
  const calculator=['/','/index.html'].includes(location.pathname);
  const pages=new Set(['/','/index.html','/convenio-2026.html','/derechos-vigilante.html','/guia-nomina-vigilante.html','/preguntas-frecuentes.html']);
  const production=location.protocol==='https:' && ['calculadoravigilante.com','www.calculadoravigilante.com'].includes(location.hostname);
  const params=new URLSearchParams(location.search);
  const preview=params.get('fc')==='alwaysshow';
  const cleanURL=Array.from(params.keys()).every(key=>['fc','fctype'].includes(key)) && (!location.hash || location.hash==='#privacidad-publicitaria');
  if(!production || !pages.has(location.pathname) || !cleanURL || window.top!==window.self)return;
  const client='ca-pub-6334238097806445';
  let started=false, requested=false, allowed=false, revoking=false, pendingPrivacy=false;
  let privacyTimer=null;
  let privacyStatus=null;
  let slots=[],layout='compact',visibilityObserver=null;
  function eligible(){
    if(!calculator)return true;
    return document.getElementById('tab-nomina')?.classList.contains('active') && !document.querySelector('dialog[open]') && (layout!=='wide'||window.matchMedia('(min-width:1280px)').matches);
  }
  function status(text){
    if(!privacyStatus)return;
    privacyStatus.textContent=text;privacyStatus.hidden=!text;
  }
  const queue=window.adsbygoogle=window.adsbygoogle||[];
  queue.pauseAdRequests=1;
  // Contextual ads only. We never build ad audiences from account data.
  queue.requestNonPersonalizedAds=1;
  function hideAds(){
    window.adsbygoogle.pauseAdRequests=1;allowed=false;
    document.querySelectorAll('[data-ad-placement]').forEach(section=>{section.hidden=true;});
  }
  function suspendAds(){
    window.adsbygoogle.pauseAdRequests=1;
    slots.forEach(slot=>{slot.section.hidden=true;});
  }
  function requestSlot(slot){
    if(slot.queued||slot.unfilled||!slot.near||!allowed||revoking||!eligible()||preview)return;
    slot.queued=true;requested=true;
    visibilityObserver?.unobserve(slot.section);
    // Measure once before Google initializes; no re-requests on resize.
    if(calculator){slot.width=layout==='wide'?160:Math.min(728,Math.floor(slot.section.clientWidth));slot.ad.style.width=slot.width+'px';slot.ad.style.height=(layout==='wide'?600:100)+'px';}
    try{window.adsbygoogle.push({});}catch(_){slot.unfilled=true;slot.section.hidden=true;}
  }
  function configureSlots(){
    slots.forEach(slot=>{
      slot.section.hidden=slot.unfilled;
      if(calculator&&slot.queued&&slot.width>slot.section.clientWidth){slot.section.hidden=true;return;}
      if(!slot.unfilled)requestSlot(slot);
    });
  }
  function renderAds(){
    if(!allowed||revoking)return;
    if(!eligible()){suspendAds();return;}
    if(preview){hideAds();status('Vista previa de privacidad: no se solicitan anuncios.');return;}
    // Google replaces the bootstrap array with its loaded API.
    const activeQueue=window.adsbygoogle;
    activeQueue.requestNonPersonalizedAds=1;
    configureSlots();
    activeQueue.pauseAdRequests=0;
  }
  function consentChanged(tc, success){
    if(!success || tc?.cmpStatus==='error'){clearTimeout(privacyTimer);hideAds();status('No se ha podido comprobar el consentimiento. La publicidad permanece desactivada.');return;}
    if(tc?.eventStatus==='cmpuishown'){if(requested){hideAds();revoking=true;}clearTimeout(privacyTimer);status('');return;}
    if(!['tcloaded','useractioncomplete'].includes(tc?.eventStatus))return;
    if(tc.gdprApplies!==true){clearTimeout(privacyTimer);hideAds();if(revoking)status('La publicidad permanece desactivada en esta visita. No hay un panel publicitario disponible.');return;}
    if(revoking && tc.eventStatus!=='useractioncomplete')return;
    clearTimeout(privacyTimer);
    // Unknown jurisdictions/choices fail closed. Google also validates the full
    // TC string. A refusal never falls back to limited ads or tracking cookies.
    const basic=[2,7,9,10].every(id=>tc.purpose?.consents?.[id]===true || tc.purpose?.legitimateInterests?.[id]===true);
    const next=tc.gdprApplies===true && tc.vendor?.consents?.[755]===true && tc.purpose?.consents?.[1]===true && basic;
    if(requested && tc.eventStatus==='useractioncomplete' && (revoking || next!==allowed)){
      hideAds();location.reload();return;
    }
    revoking=false;
    if(!next){hideAds();if(privacyStatus)status('No se mostrarán anuncios con tus preferencias actuales.');return;}
    status('');
    allowed=true;renderAds();
  }
  function start(){
    if(started || !eligible() || !window.VigilantePrivacy?.hasAnalyticsChoice())return;
    started=true;
    window.googlefc=window.googlefc||{};
    window.googlefc.callbackQueue=window.googlefc.callbackQueue||[];
    window.googlefc.callbackQueue.push({CONSENT_API_READY:function(){
      if(typeof window.__tcfapi==='function')window.__tcfapi('addEventListener',2,consentChanged);
      if(pendingPrivacy){pendingPrivacy=false;showPrivacy();}
    }});
    const script=document.createElement('script');
    script.async=true;script.crossOrigin='anonymous';
    script.src='https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client='+client;
    script.addEventListener('error',()=>{hideAds();status('No se ha podido cargar el gestor de privacidad. La publicidad permanece desactivada.');},{once:true});
    document.head.appendChild(script);
  }
  function showPrivacy(){
    clearTimeout(privacyTimer);
    privacyTimer=setTimeout(()=>{hideAds();status('Google no ha abierto el panel de privacidad. La publicidad permanece desactivada. Puedes volver a intentarlo más tarde.');},8000);
    window.googlefc.callbackQueue.push({CONSENT_API_READY:function(){
      if(typeof window.googlefc.showRevocationMessage==='function')window.googlefc.showRevocationMessage();
    }});
  }
  function openPrivacy(event){
    // Keep the footer link usable in account callbacks or other calculators,
    // without starting advertising services in those views.
    if(event&&calculator&&!started&&!eligible())return;
    event?.preventDefault();hideAds();revoking=true;start();
    status('Abriendo preferencias de publicidad…');
    if(!started){pendingPrivacy=true;window.openCookieSettings?.();return;}
    showPrivacy();
  }
  function init(){
    layout=calculator&&window.matchMedia('(min-width:1280px)').matches?'wide':'compact';
    document.querySelector('.calculator-ad-layout')?.setAttribute('data-ad-layout',layout);
    if(window.IntersectionObserver)visibilityObserver=new IntersectionObserver(entries=>{
      entries.forEach(entry=>{if(entry.isIntersecting){const slot=slots.find(s=>s.section===entry.target);if(slot){slot.near=true;requestSlot(slot);}}});
    },{rootMargin:'300px 0px'});
    slots=Array.from(document.querySelectorAll('[data-ad-placement]')).map(section=>{
      const slot={section,ad:section.querySelector('.adsbygoogle'),queued:false,unfilled:false,near:!calculator||layout==='wide'||!section.classList.contains('calculator-ad--bottom')||!visibilityObserver};
      if(!slot.near)visibilityObserver.observe(section);
      if(slot.ad&&window.MutationObserver){const observer=new MutationObserver(()=>{if(slot.ad.getAttribute('data-ad-status')==='unfilled'){slot.unfilled=true;section.hidden=true;observer.disconnect();}});observer.observe(slot.ad,{attributes:true,attributeFilter:['data-ad-status']});}
      return slot;
    }).filter(slot=>slot.ad);
    if(calculator){
      const sync=()=>{if(!eligible()){suspendAds();return;}start();renderAds();};
      const observer=new MutationObserver(sync);
      document.querySelectorAll('#tab-nomina,dialog').forEach(node=>observer.observe(node,{attributes:true,attributeFilter:['class','open']}));
      window.matchMedia('(min-width:1280px)').addEventListener('change',sync);
      let resizeFrame=0;
      window.addEventListener('resize',()=>{if(!resizeFrame)resizeFrame=requestAnimationFrame(()=>{resizeFrame=0;sync();});},{passive:true});
    }
    const control=document.querySelector('[data-ad-privacy]');
    if(control){privacyStatus=document.createElement('p');privacyStatus.className='ad-privacy-status';privacyStatus.setAttribute('role','status');privacyStatus.hidden=true;control.parentNode.insertBefore(privacyStatus,control.nextSibling);}
    document.querySelectorAll('[data-ad-privacy]').forEach(button=>button.addEventListener('click',openPrivacy));
    window.addEventListener('vigilante:analytics-choice',start);
    start();
    if(location.hash==='#privacidad-publicitaria')openPrivacy();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
