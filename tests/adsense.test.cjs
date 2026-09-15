const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {JSDOM,VirtualConsole}=require('jsdom');
const root=path.resolve(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
const pages=['index.html','convenio-2026.html','derechos-vigilante.html','guia-nomina-vigilante.html','preguntas-frecuentes.html'];
function setup(url='https://calculadoravigilante.com/guia-nomina-vigilante.html',choice=true,options={}){
 const errors=[];const console=new VirtualConsole();console.on('jsdomError',e=>errors.push(e.message));
 const calc=['/','/index.html'].includes(new URL(url).pathname);
 const html=calc?'<main class="calculator-ad-layout"><button id="tab-nomina" class="active">Nómina</button><section class="calculator-ad calculator-ad--top" data-ad-placement hidden><ins class="adsbygoogle"></ins></section><button id="calculate">Calcular</button><div id="resultado"></div><section class="calculator-ad calculator-ad--bottom" data-ad-placement hidden><ins class="adsbygoogle"></ins></section></main><dialog></dialog>':'<section data-ad-placement hidden><ins class="adsbygoogle"></ins></section>';
 const w=new JSDOM(html+'<button data-ad-privacy>Privacidad publicitaria</button>',{url,runScripts:'outside-only',virtualConsole:console}).window;
 w.screenSize={matches:Boolean(options.wide),addEventListener(){}};w.matchMedia=()=>w.screenSize;
 Object.defineProperty(w.HTMLElement.prototype,'clientWidth',{get:()=>options.wide?160:360});
 if(options.lazy)w.IntersectionObserver=class{constructor(fn){w.reach=target=>fn([{target,isIntersecting:true}]);}observe(){}unobserve(){}};
 w.errors=errors;w.VigilantePrivacy={hasAnalyticsChoice:()=>choice};
 w.eval(read('adsense.js'));w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
 w.apiReady=()=>{w.__tcfapi=(name,version,fn)=>{assert.equal(name,'addEventListener');assert.equal(version,2);w.consent=fn;};w.googlefc.callbackQueue[0].CONSENT_API_READY();};
 return w;
}
function consent(overrides={}){return {cmpStatus:'loaded',eventStatus:'useractioncomplete',gdprApplies:true,vendor:{consents:{755:true}},purpose:{consents:{1:true},legitimateInterests:{2:true,7:true,9:true,10:true}},...overrides};}
test('Ad script waits for analytics dialog to close, not for analytics permission',()=>{
 const w=setup(undefined,false);try{assert.equal(w.document.querySelector('script'),null);w.VigilantePrivacy.hasAnalyticsChoice=()=>true;w.dispatchEvent(new w.Event('vigilante:analytics-choice'));assert.equal(w.document.querySelectorAll('script').length,1);w.dispatchEvent(new w.Event('vigilante:analytics-choice'));assert.equal(w.document.querySelectorAll('script').length,1);assert.equal(w.adsbygoogle.pauseAdRequests,1);assert.equal(w.adsbygoogle.length,0);assert.equal(w.document.querySelector('section').hidden,true);}finally{w.close();}
});
test('Ads are contextual and paused until a valid separate TCF choice',()=>{
 const w=setup();try{w.apiReady();assert.equal(w.adsbygoogle.requestNonPersonalizedAds,1);w.consent(consent({eventStatus:'cmpuishown'}),true);assert.equal(w.adsbygoogle.pauseAdRequests,1);w.consent(consent(),true);assert.equal(w.adsbygoogle.pauseAdRequests,0);assert.equal(w.adsbygoogle.length,1);assert.equal(w.document.querySelector('section').hidden,false);w.consent(consent(),true);assert.equal(w.adsbygoogle.length,1);}finally{w.close();}
});
test('Refusal, vendor refusal, missing purposes, unknown jurisdiction and CMP failure all keep ads paused',()=>{
 for(const [value,success] of [[consent({purpose:{consents:{1:false}}}),true],[consent({vendor:{consents:{755:false}}}),true],[consent({purpose:{consents:{1:true}}}),true],[consent({gdprApplies:false}),true],[consent({gdprApplies:undefined}),true],[consent({cmpStatus:'error'}),true],[undefined,false]]){
  const w=setup();try{w.apiReady();w.consent(value,success);assert.equal(w.adsbygoogle.pauseAdRequests,1);assert.equal(w.adsbygoogle.length,0);assert.equal(w.document.querySelector('section').hidden,true);}finally{w.close();}
 }
});
test('Privacy control stops serving immediately and uses Google revocation API',()=>{
 const w=setup();try{w.apiReady();w.consent(consent(),true);let opened=0;w.googlefc.showRevocationMessage=()=>opened++;w.document.querySelector('button').click();assert.equal(w.adsbygoogle.pauseAdRequests,1);assert.equal(w.document.querySelector('section').hidden,true);w.googlefc.callbackQueue.at(-1).CONSENT_API_READY();assert.equal(opened,1);w.consent(consent({purpose:{consents:{1:false}}}),true);assert.ok(w.errors.some(e=>e.includes('navigation')));}finally{w.close();}
});
test('Consent uses the loaded AdSense API after Google replaces its bootstrap array',()=>{
 const w=setup();try{
  const bootstrap=w.adsbygoogle;const requests=[];
  w.adsbygoogle={pauseAdRequests:1,push:request=>requests.push(request)};
  w.apiReady();w.consent(consent(),true);
  assert.equal(requests.length,1);assert.equal(bootstrap.length,0);
  assert.equal(w.adsbygoogle.pauseAdRequests,0);assert.equal(w.adsbygoogle.requestNonPersonalizedAds,1);
  w.document.querySelector('button').click();assert.equal(w.adsbygoogle.pauseAdRequests,1);
 }finally{w.close();}
});
test('Google CMP preview can exercise consent without requesting real ads',()=>{
 const w=setup('https://calculadoravigilante.com/guia-nomina-vigilante.html?fc=alwaysshow&fctype=gdpr');try{
  w.apiReady();w.consent(consent(),true);assert.equal(w.adsbygoogle.pauseAdRequests,1);assert.equal(w.document.querySelector('section').hidden,true);assert.match(w.document.querySelector('[role="status"]').textContent,/Vista previa/);
 }finally{w.close();}
});
test('A missing Google consent panel gives feedback and keeps the slot hidden',()=>{
 const w=setup();try{
  let timeout;w.setTimeout=fn=>{timeout=fn;return 1;};w.clearTimeout=()=>{};
  w.document.querySelector('button').click();assert.match(w.document.querySelector('[role="status"]').textContent,/Abriendo/);
  timeout();assert.match(w.document.querySelector('[role="status"]').textContent,/Google no ha abierto/);
  assert.equal(w.adsbygoogle.pauseAdRequests,1);assert.equal(w.adsbygoogle.length,0);assert.equal(w.document.querySelector('section').hidden,true);
 }finally{w.close();}
});
test('Ad loading is excluded from auth callbacks, legal pages, previews and private URL parameters',()=>{
 for(const url of ['https://calculadoravigilante.com/?code=secret','https://calculadoravigilante.com/index.html#access_token=secret','https://calculadoravigilante.com/privacidad.html','https://calculadoravigilante.com/sindicatos-formacion.html','http://localhost:4173/guia-nomina-vigilante.html','https://evil.test/guia-nomina-vigilante.html','https://calculadoravigilante.com/guia-nomina-vigilante.html?code=secret','https://calculadoravigilante.com/guia-nomina-vigilante.html?email=private','https://calculadoravigilante.com/guia-nomina-vigilante.html#access_token=secret']){
  const w=setup(url);try{assert.equal(w.document.querySelector('script'),null);assert.equal(w.adsbygoogle,undefined);}finally{w.close();}
 }
});
test('Advertising code does not read account or payroll storage and has no event/click tracking',()=>{
 const code=read('adsense.js');assert.doesNotMatch(code,/localStorage|sessionStorage|supabase|VigilanteAnalytics|gtag\(|fetch\(|XMLHttpRequest|sendBeacon|ctxPDF|adtest/);
});
test('Privacy navigation stays available when advertising cannot start in the selected calculator',()=>{
 const w=setup('https://calculadoravigilante.com/',false);try{
  w.document.getElementById('tab-nomina').classList.remove('active');
  const event=new w.MouseEvent('click',{bubbles:true,cancelable:true});
  w.document.querySelector('[data-ad-privacy]').dispatchEvent(event);
  assert.equal(event.defaultPrevented,false);assert.equal(w.document.querySelector('script'),null);
  const page=new JSDOM(read('index.html')).window;try{assert.equal(page.document.querySelector('[data-ad-privacy]').getAttribute('href'),'guia-nomina-vigilante.html#privacidad-publicitaria');}finally{page.close();}
 }finally{w.close();}
});
test('Mobile requests at most two banners and waits until the lower placement approaches',()=>{
 const w=setup('https://calculadoravigilante.com/',true,{lazy:true});try{
  w.apiReady();w.consent(consent(),true);
  assert.equal(w.adsbygoogle.length,1);assert.equal(w.document.querySelector('ins').style.height,'100px');
  const lower=w.document.querySelector('.calculator-ad--bottom');w.reach(lower);assert.equal(w.adsbygoogle.length,2);
  for(let i=0;i<10;i++){w.document.getElementById('calculate').click();w.reach(lower);w.consent(consent(),true);}
  assert.equal(w.adsbygoogle.length,2);
 }finally{w.close();}
});
test('Wide screens request exactly two 160 x 600 rails without mobile duplicates',()=>{
 const w=setup('https://calculadoravigilante.com/index.html',true,{wide:true,lazy:true});try{
  w.apiReady();w.consent(consent(),true);assert.equal(w.adsbygoogle.length,2);
  assert.equal(w.document.querySelector('main').dataset.adLayout,'wide');
  for(const ad of w.document.querySelectorAll('ins')){assert.equal(ad.style.width,'160px');assert.equal(ad.style.height,'600px');}
 }finally{w.close();}
});
test('Account dialogs and other calculators pause ads and returning does not refresh them',async()=>{
 const w=setup('https://calculadoravigilante.com/');try{
  w.apiReady();w.consent(consent(),true);assert.equal(w.adsbygoogle.length,2);
  const dialog=w.document.querySelector('dialog');dialog.setAttribute('open','');await Promise.resolve();
  assert.equal(w.adsbygoogle.pauseAdRequests,1);assert.ok([...w.document.querySelectorAll('section')].every(s=>s.hidden));
  dialog.removeAttribute('open');await Promise.resolve();assert.equal(w.adsbygoogle.pauseAdRequests,0);assert.equal(w.adsbygoogle.length,2);
  w.document.getElementById('tab-nomina').classList.remove('active');await Promise.resolve();assert.equal(w.adsbygoogle.pauseAdRequests,1);
  w.document.getElementById('tab-nomina').classList.add('active');await Promise.resolve();assert.equal(w.adsbygoogle.pauseAdRequests,0);assert.equal(w.adsbygoogle.length,2);
 }finally{w.close();}
});
test('An unfilled placement remains hidden after returning from another view',async()=>{
 const w=setup('https://calculadoravigilante.com/');try{
  w.apiReady();w.consent(consent(),true);w.document.querySelector('ins').setAttribute('data-ad-status','unfilled');await Promise.resolve();
  const tab=w.document.getElementById('tab-nomina');tab.classList.remove('active');await Promise.resolve();tab.classList.add('active');await Promise.resolve();
  assert.equal(w.document.querySelector('section').hidden,true);assert.equal(w.adsbygoogle.length,2);
 }finally{w.close();}
});
test('Calculator ad placements stay outside result, PDF, account and medical sections',()=>{
 const w=new JSDOM(read('index.html')).window,d=w.document;try{
  const top=d.querySelector('.calculator-ad--top'),bottom=d.querySelector('.calculator-ad--bottom');
  assert.equal(d.querySelectorAll('[data-ad-placement]').length,2);
  assert.equal(top.closest('#view-nomina')?.id,'view-nomina');assert.equal(bottom.closest('#view-nomina')?.id,'view-nomina');
  assert.equal(d.getElementById('btnCalc').nextElementSibling.id,'resultado');assert.equal(bottom.previousElementSibling.id,'resultado');
  for(const id of ['resultado','view-baja','view-finiquito','account-section','auth-dialog','marketing-dialog'])assert.equal(d.getElementById(id).querySelector('[data-ad-placement]'),null);
  assert.equal(d.querySelector('.ads-placeholder'),null);
  assert.equal(d.querySelector('script[src="vendor/supabase.js"]').type,'module');
  assert.deepEqual([...d.querySelectorAll('[data-ad-slot]')].map(a=>a.dataset.adSlot),['5002757616','1332684927']);
 }finally{w.close();}
});
test('Public ad pages have exact SRI hashes in strict CSP; other pages retain their original restriction',()=>{
 for(const file of fs.readdirSync(root).filter(x=>x.endsWith('.html'))){
  const w=new JSDOM(read(file)).window,d=w.document;try{
   const csp=d.querySelector('meta[http-equiv="Content-Security-Policy"]').content;
   if(pages.includes(file)){
    assert.equal(d.querySelector('meta[name="referrer"]').content,'strict-origin');
    const scriptPolicy=csp.split(';').find(p=>p.trim().startsWith('script-src '));
    assert.match(scriptPolicy,/'strict-dynamic'/);assert.doesNotMatch(scriptPolicy,/nonce-|script-src 'self'|script-src https:|'unsafe-inline'/);
    for(const script of d.querySelectorAll('script[src]')){const src=script.getAttribute('src').split('?')[0],hash='sha256-'+crypto.createHash('sha256').update(fs.readFileSync(path.join(root,src))).digest('base64');assert.equal(script.integrity||script.getAttribute('integrity'),hash,file+' '+src);assert.ok(csp.includes("'"+hash+"'"));}
    assert.equal(d.querySelectorAll('[data-ad-placement]').length,file==='index.html'?2:1);
    assert.equal(d.querySelectorAll('script[src^="auth.js"]').length,file==='index.html'?1:0);
   }else{assert.equal(d.querySelector('meta[name="referrer"]').content,'no-referrer');assert.doesNotMatch(csp,/unsafe-eval|unsafe-inline(?=[^;]*; script-src)/);assert.equal(d.querySelector('[data-ad-placement]'),null);assert.equal(d.querySelector('script[src^="adsense.js"]'),null);}
  }finally{w.close();}
 }
});
