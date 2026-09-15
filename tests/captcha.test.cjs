const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
const root=path.resolve(__dirname,'..');
function setup(enabled=true){
 const w=new JSDOM(fs.readFileSync(path.join(root,'index.html'),'utf8'),{url:'http://localhost:4173/',runScripts:'outside-only'}).window;
 const state={callbacks:[],resets:0,removes:0};
 w.VIGILANTE_AUTH_CONFIG={captcha:{enabled,siteKey:'unit-test-only'}};
 w.turnstile={render:(_host,options)=>{state.callbacks.push(options);return 'test-widget';},reset:()=>state.resets++,remove:()=>state.removes++};
 w.eval(fs.readFileSync(path.join(root,'captcha.js'),'utf8'));return {w,state,api:w.VigilanteCaptcha};
}
test('Captcha tokens are single use, expire and cannot be reused after closing',async()=>{
 const {w,state,api}=setup();try{
 await api.show('signup');assert.throws(()=>api.take(),{code:'captcha_required'});
 state.callbacks.at(-1).callback('verified-token');assert.equal(api.take(),'verified-token');assert.throws(()=>api.take(),{code:'captcha_required'});
 state.callbacks.at(-1).callback('expires');state.callbacks.at(-1)['expired-callback']();assert.throws(()=>api.take(),{code:'captcha_required'});
 api.close();state.callbacks.at(-1).callback('late-token');assert.throws(()=>api.take(),{code:'captcha_required'});
 assert.equal(w.document.getElementById('auth-captcha').hidden,true);
 }finally{w.close();}
});
test('Changing form ignores callbacks from the previous challenge; errors allow retry',async()=>{
 const {w,state,api}=setup();try{
 await api.show('signup');const old=state.callbacks.at(-1);await api.show('reset');old.callback('stale');assert.throws(()=>api.take(),{code:'captcha_required'});
 state.callbacks.at(-1)['error-callback']();assert.match(w.document.getElementById('auth-captcha-status').textContent,/Reinténtalo/);
 w.document.getElementById('auth-captcha-retry').click();assert.equal(state.resets,1);
 state.callbacks.at(-1).callback('new');assert.equal(api.take(),'new');
 await api.show('consent');assert.equal(w.document.getElementById('auth-captcha').hidden,true);
 }finally{w.close();}
});
test('Disabled captcha does not render or load third-party scripts',async()=>{
 const {w,state,api}=setup(false);try{await api.show('signup');assert.equal(api.take(),undefined);assert.equal(state.callbacks.length,0);assert.equal(w.document.querySelector('script[src*="challenges.cloudflare.com"]'),null);}finally{w.close();}
});
