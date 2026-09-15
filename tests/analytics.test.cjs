const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
const code=fs.readFileSync(path.join(__dirname,'../cookies.js'),'utf8');
function setup(url='https://calculadoravigilante.com/',consent){
  const dom=new JSDOM('<title>Nómina Vigilante</title><div id="cookie-banner" hidden><button id="cookie-reject"></button></div>',{url,referrer:'https://example.test/page?email=secret@example.test',runScripts:'outside-only'});
  const w=dom.window;
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
