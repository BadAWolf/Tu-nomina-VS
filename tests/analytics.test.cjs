const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{JSDOM,VirtualConsole}=require('jsdom');
const code=fs.readFileSync(path.join(__dirname,'../cookies.js'),'utf8');
function setup(url='https://calculadoravigilante.com/',consent,options={}){
  const reloadErrors=[];
  const virtualConsole=new VirtualConsole();
  virtualConsole.on('jsdomError',error=>{
    if(error.message==='Not implemented: navigation (except hash changes)')reloadErrors.push(error);
    else throw error;
  });
  const dom=new JSDOM('<title>Nómina Vigilante</title><div id="cookie-banner" hidden><button id="cookie-reject"></button></div>',{url,referrer:'https://example.test/page?email=secret@example.test',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole});
  const w=dom.window;
  w.reloadErrors=reloadErrors;
  let app=Boolean(options.standalone);const modeListeners=[];
  w.matchMedia=()=>({get matches(){return app;},addEventListener:(_,fn)=>modeListeners.push(fn)});
  Object.defineProperty(w.navigator,'standalone',{value:Boolean(options.ios)});
  if(options.hidden)Object.defineProperty(w.document,'visibilityState',{value:'hidden',configurable:true});
  w.changeAppMode=value=>{app=value;modeListeners.forEach(fn=>fn());};
  if(consent!==undefined)w.localStorage.setItem('vigilante_cookie_preferences_v1',JSON.stringify({version:1,analytics:consent,savedAt:Date.now()}));
  w.eval(code);w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  return w;
}
test('Analytics discards unconsented events and never replays them after consent',()=>{
  const w=setup();try{
    assert.equal(w.VigilanteAnalytics.track('sign_up',{method:'Email'}),false);
    assert.equal(w.document.querySelector('script'),null);
    w.acceptCookies();
    assert.equal(w.dataLayer.some(x=>x[1]==='sign_up'),false);
    assert.equal(w.VigilanteAnalytics.track('sign_up',{method:'Email'}),true);
    assert.equal(w.dataLayer.filter(x=>x[1]==='sign_up').length,1);
  }finally{w.close();}
});

test('Only the browser installation event counts; duplicate notifications and old saved flags do not',()=>{
 const w=setup(undefined,true);try{
  w.localStorage.setItem('vigilante_install_v1',JSON.stringify({version:1,shown:true,count:0,installed:true}));
  w.dispatchEvent(new w.Event('beforeinstallprompt'));w.dispatchEvent(new w.Event('pageshow'));
  assert.equal(w.dataLayer.filter(x=>x[1]==='pwa_install').length,0);
  w.dispatchEvent(new w.Event('appinstalled'));w.dispatchEvent(new w.Event('appinstalled'));
  assert.equal(w.dataLayer.filter(x=>x[1]==='pwa_install').length,1);
  assert.equal(w.dataLayer.filter(x=>x[1]==='pwa_open').length,0);
 }finally{w.close();}
});
test('iOS and display-mode launches count use once per page, never a new installation',()=>{
 for(const options of [{ios:true},{standalone:true}]){
  const w=setup(undefined,true,options);try{
   w.dispatchEvent(new w.Event('pageshow'));w.document.dispatchEvent(new w.Event('visibilitychange'));w.changeAppMode(true);
   assert.equal(w.dataLayer.filter(x=>x[1]==='pwa_open').length,1);
   assert.equal(w.dataLayer.filter(x=>x[1]==='pwa_install').length,0);
   assert.deepEqual(Object.keys(w.dataLayer.find(x=>x[1]==='pwa_open')[2]).sort(),['page_location','page_referrer','page_title']);
  }finally{w.close();}
 }
});
test('Switching to an installed window is distinct from installation; background pages wait for visibility',()=>{
 const w=setup(undefined,true,{hidden:true});try{
  w.dispatchEvent(new w.Event('appinstalled'));w.changeAppMode(true);
  assert.equal(w.dataLayer.filter(x=>x[1]==='pwa_open').length,0);
  Object.defineProperty(w.document,'visibilityState',{value:'visible',configurable:true});w.document.dispatchEvent(new w.Event('visibilitychange'));
  assert.equal(w.dataLayer.filter(x=>x[1]==='pwa_install').length,1);assert.equal(w.dataLayer.filter(x=>x[1]==='pwa_open').length,1);
 }finally{w.close();}
});
test('Installations before consent are not replayed; accepting inside the app measures its current use only',()=>{
 for(const consent of [undefined,false]){
  const w=setup(undefined,consent,{ios:true});try{
   w.dispatchEvent(new w.Event('appinstalled'));assert.equal(w.document.querySelector('script'),null);assert.equal(w.dataLayer,undefined);
   w.acceptCookies();w.dispatchEvent(new w.Event('appinstalled'));
   assert.equal(w.dataLayer.filter(x=>x[1]==='pwa_install').length,0);assert.equal(w.dataLayer.filter(x=>x[1]==='pwa_open').length,1);
  }finally{w.close();}
 }
});
test('PWA events remain blocked in previews, auth callbacks and after consent is withdrawn',()=>{
 for(const url of ['http://localhost:4173/','https://calculadoravigilante.com/?code=private','https://calculadoravigilante.com/guia-nomina-vigilante.html?fc=alwaysshow&fctype=gdpr']){
  const w=setup(url,true,{standalone:true});try{w.dispatchEvent(new w.Event('appinstalled'));w.dispatchEvent(new w.Event('pageshow'));assert.equal(w.document.querySelector('script'),null);assert.equal(w.dataLayer,undefined);}finally{w.close();}
 }
 const w=setup(undefined,true);try{w.rejectCookies();assert.equal(w.reloadErrors.length,1);w.dispatchEvent(new w.Event('appinstalled'));w.changeAppMode(true);assert.equal(w.dataLayer.filter(x=>['pwa_install','pwa_open'].includes(x[1])).length,0);}finally{w.close();}
});
test('Only allowed event fields leave the site; URL parameters, referrer paths and PII are stripped',()=>{
  const w=setup('https://calculadoravigilante.com/?email=secret@example.test#name=Carlos',true);try{
    w.VigilanteAnalytics.track('sign_up',{method:'Google',email:'secret@example.test',user_id:'private-id',salary:1234});
    assert.equal(w.VigilanteAnalytics.track('private-event',{email:'secret@example.test'}),false);
    w.VigilanteAnalytics.track('login',{method:'secret@example.test'});
    const payload=JSON.stringify(w.dataLayer);
    for(const text of ['secret@','private-id','salary','?email','#name','/page?'])assert.equal(payload.includes(text),false,text);
    const signup=w.dataLayer.find(x=>x[1]==='sign_up')[2];
    assert.equal(signup.method,'Google');assert.equal(signup.page_referrer,'https://example.test/');
    assert.equal(w.dataLayer.find(x=>x[1]==='login')[2].method,undefined);
  }finally{w.close();}
});
test('Preview and auth callback pages never send analytics; cleaned callback can measure activation with prior consent',()=>{
  for(const url of ['http://localhost:4173/','http://127.0.0.1:4173/','https://calculadoravigilante.com/?code=secret','https://calculadoravigilante.com/#access_token=secret','https://calculadoravigilante.com/?unsubscribe=secret']){
    const w=setup(url,true);try{assert.equal(w.document.querySelector('script'),null);assert.equal(w.VigilanteAnalytics.track('sign_up'),false);}finally{w.close();}
  }
  const w=setup('https://calculadoravigilante.com/?code=secret',true);try{
    w.history.replaceState(null,'','/');assert.equal(w.VigilanteAnalytics.track('sign_up',{method:'Google'}),true);
    assert.equal(JSON.stringify(w.dataLayer).includes('secret'),false);
  }finally{w.close();}
});

test('Marketing events need independent analytics consent and contain no contact data or account state',()=>{
 const events=['marketing_own_opt_in','marketing_partner_opt_in','marketing_own_opt_out','marketing_partner_opt_out'];
 for(const consent of [undefined,false,true]){
  const w=setup(undefined,consent);try{
   for(const name of events)assert.equal(w.VigilanteAnalytics.track(name,{email:'secret@example.test',user_id:'private-id',own_news:true,city:'Burriana',province_code:'12',age_band:'25-34'}),consent===true);
   if(consent!==true){w.acceptCookies();assert.equal(w.dataLayer.filter(e=>events.includes(e[1])).length,0);}
   else {
    assert.equal(w.dataLayer.filter(e=>events.includes(e[1])).length,4);
    for(const e of w.dataLayer.filter(e=>events.includes(e[1])))assert.deepEqual(Object.keys(e[2]).sort(),['page_location','page_referrer','page_title']);
    w.rejectCookies();for(const name of events)assert.equal(w.VigilanteAnalytics.track(name),false);
   }
  }finally{w.close();}
 }
 for(const url of ['http://localhost:4173/','https://calculadoravigilante.com/?code=private']){
  const w=setup(url,true);try{for(const name of events)assert.equal(w.VigilanteAnalytics.track(name),false);}finally{w.close();}
 }
});
