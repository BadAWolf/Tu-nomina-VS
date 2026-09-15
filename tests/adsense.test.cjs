const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {JSDOM,VirtualConsole}=require('jsdom');
const root=path.resolve(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
const pages=['convenio-2026.html','derechos-vigilante.html','guia-nomina-vigilante.html','preguntas-frecuentes.html'];
function setup(url='https://calculadoravigilante.com/guia-nomina-vigilante.html',choice=true){
 const errors=[];const console=new VirtualConsole();console.on('jsdomError',e=>errors.push(e.message));
 const w=new JSDOM('<section data-ad-placement hidden><ins class="adsbygoogle"></ins></section><button data-ad-privacy>Privacidad publicitaria</button>',{url,runScripts:'outside-only',virtualConsole:console}).window;
 w.errors=errors;w.VigilantePrivacy={hasAnalyticsChoice:()=>choice};
 w.eval(read('adsense.js'));w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
 w.apiReady=()=>{w.__tcfapi=(name,version,fn)=>{assert.equal(name,'addEventListener');assert.equal(version,2);w.consent=fn;};w.googlefc.callbackQueue[0].CONSENT_API_READY();};
 return w;
}
function consent(overrides={}){return {cmpStatus:'loaded',eventStatus:'useractioncomplete',gdprApplies:true,vendor:{consents:{755:true}},purpose:{consents:{1:true},legitimateInterests:{2:true,7:true,9:true,10:true}},...overrides};}
test('Ad script waits for analytics dialog to close, not for analytics permission',()=>{
 const w=setup(undefined,false);try{assert.equal(w.document.querySelector('script'),null);w.VigilantePrivacy.hasAnalyticsChoice=()=>true;w.dispatchEvent(new w.Event('vigilante:analytics-choice'));assert.equal(w.document.querySelectorAll('script').length,1);w.dispatchEvent(new w.Event('vigilante:analytics-choice'));assert.equal(w.document.querySelectorAll('script').length,1);assert.equal(w.adsbygoogle.pauseAdRequests,1);assert.equal(w.adsbygoogle.length,0);}finally{w.close();}
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
test('Ad loading is excluded from calculators, accounts, legal pages, previews and private URL parameters',()=>{
 for(const url of ['https://calculadoravigilante.com/','https://calculadoravigilante.com/index.html','https://calculadoravigilante.com/privacidad.html','https://calculadoravigilante.com/sindicatos-formacion.html','http://localhost:4173/guia-nomina-vigilante.html','https://evil.test/guia-nomina-vigilante.html','https://calculadoravigilante.com/guia-nomina-vigilante.html?code=secret','https://calculadoravigilante.com/guia-nomina-vigilante.html?email=private','https://calculadoravigilante.com/guia-nomina-vigilante.html#access_token=secret']){
  const w=setup(url);try{assert.equal(w.document.querySelector('script'),null);assert.equal(w.adsbygoogle,undefined);}finally{w.close();}
 }
});
test('Advertising code does not read account or payroll storage and has no event/click tracking',()=>{
 const code=read('adsense.js');assert.doesNotMatch(code,/localStorage|sessionStorage|supabase|VigilanteAnalytics|gtag\(|fetch\(|XMLHttpRequest|sendBeacon|ctxPDF|adtest/);
});
test('Static editorial scripts have exact SRI hashes in strict CSP; account pages retain their original restriction',()=>{
 for(const file of fs.readdirSync(root).filter(x=>x.endsWith('.html'))){
  const w=new JSDOM(read(file)).window,d=w.document;try{
   const csp=d.querySelector('meta[http-equiv="Content-Security-Policy"]').content;
   if(pages.includes(file)){
    assert.match(csp,/'strict-dynamic'/);assert.doesNotMatch(csp,/nonce-|script-src 'self'|script-src https:|'unsafe-inline'/);
    for(const script of d.querySelectorAll('script[src]')){const src=script.getAttribute('src').split('?')[0],hash='sha256-'+crypto.createHash('sha256').update(fs.readFileSync(path.join(root,src))).digest('base64');assert.equal(script.integrity||script.getAttribute('integrity'),hash,file+' '+src);assert.ok(csp.includes("'"+hash+"'"));}
    assert.equal(d.querySelectorAll('[data-ad-placement]').length,1);
    assert.equal(d.querySelectorAll('script[src^="auth.js"]').length,0);
   }else{assert.doesNotMatch(csp,/unsafe-eval|unsafe-inline(?=[^;]*; script-src)/);assert.equal(d.querySelector('[data-ad-placement]'),null);assert.equal(d.querySelector('script[src^="adsense.js"]'),null);}
  }finally{w.close();}
 }
});
