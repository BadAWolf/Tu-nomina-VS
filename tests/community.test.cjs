const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const {JSDOM}=require('jsdom');
const root=path.resolve(__dirname,'..');const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const tick=()=>new Promise(resolve=>setTimeout(resolve,20));
const invite='https://chat.whatsapp.com/SyntheticTestOnly1234';
// state.reply: filas devueltas, número (estado HTTP de error), 'offline' o una promesa que se resuelve después.
function setup(state={}){
  const dom=new JSDOM(read('comunidad.html'),{url:'https://calculadoravigilante.com/comunidad.html',runScripts:'outside-only'});
  const w=dom.window;state.requests=[];state.analytics=[];
  w.fetch=async(url,options)=>{
    state.requests.push({url,options});
    const reply=await state.reply;
    if(reply==='offline')throw new Error('offline');
    if(typeof reply==='number')return {ok:false,status:reply,json:async()=>({})};
    return {ok:true,status:200,json:async()=>reply};
  };
  w.VigilanteAnalytics={track:(...args)=>state.analytics.push(args)};
  w.__navigate=url=>{state.navigation=url;};
  w.eval(read('auth-config.js'));
  w.eval(read('community.js').replace('location.assign(url.href)','window.__navigate(url.href)'));
  const d=w.document;
  return {w,d,state,click:()=>d.getElementById('community-access').click(),close:()=>w.close()};
}
test('The community page shows only the community: no registration block and no account scripts',()=>{
  const x=setup();try{
    const d=x.d;
    assert.equal(d.getElementById('account-section'),null);
    assert.equal(d.querySelector('[data-auth-open]'),null);
    assert.doesNotMatch(d.body.textContent,/Regístrate|Registrarme|Iniciar sesión|Ya tengo cuenta/);
    for(const file of ['auth.js','auth-ui.js','captcha.js','marketing.js'])assert.equal(d.querySelector(`script[src^="${file}"]`),null,file);
    assert.equal(d.querySelector('link[href^="auth.css"]'),null);
    assert.ok(d.getElementById('community-access'));
    // La invitación nunca está en el HTML.
    assert.doesNotMatch(d.documentElement.innerHTML,/chat\.whatsapp\.com\//);
    assert.equal(d.querySelectorAll('a[href*="chat.whatsapp.com"]').length,0);
  }finally{x.close();}
});
test('Anyone opens the community with one anonymous request',async()=>{
  const x=setup({reply:[{invite_url:invite}]});try{
    x.click();await tick();
    assert.equal(x.state.navigation,invite);
    assert.deepEqual(x.state.analytics,[['community_open']]);
    assert.equal(x.state.requests.length,1);
    const {url,options}=x.state.requests[0],config=x.w.VIGILANTE_AUTH_CONFIG;
    assert.equal(url,config.url+'/rest/v1/community_links?select=invite_url&slug=eq.whatsapp&limit=1');
    assert.equal(options.headers.apikey,config.publishableKey);
    assert.equal(options.headers.Authorization,'Bearer '+config.publishableKey);
    assert.equal(x.d.getElementById('community-access').disabled,false);
  }finally{x.close();}
});
test('A second click while the invitation loads does not fetch it twice',async()=>{
  let release;const x=setup({reply:new Promise(resolve=>release=resolve)});try{
    x.click();await tick();
    assert.equal(x.d.getElementById('community-access').disabled,true);
    x.click();release([{invite_url:invite}]);await tick();
    assert.equal(x.state.requests.length,1);
    assert.equal(x.state.navigation,invite);
    assert.equal(x.d.getElementById('community-access').disabled,false);
  }finally{release();x.close();}
});
test('Community rejects invalid destinations and lets the visitor retry',async()=>{
  for(const bad of ['https://evil.example/SyntheticTestOnly1234',invite+'?redirect=evil',invite+'#x','javascript:alert(1)']){
    const x=setup({reply:[{invite_url:bad}]});try{
      x.click();await tick();
      assert.equal(x.state.navigation,undefined,bad);
      assert.match(x.d.getElementById('community-status').textContent,/No se ha podido/);
      assert.equal(x.d.getElementById('community-access').disabled,false);
      assert.deepEqual(x.state.analytics,[]);
    }finally{x.close();}
  }
});
test('Community unavailable or missing invitation can be retried',async()=>{
  for(const reply of ['offline',500,[],null]){
    const x=setup({reply});try{
      x.click();await tick();
      assert.equal(x.state.navigation,undefined);
      assert.equal(x.d.getElementById('community-access').disabled,false);
      assert.notEqual(x.d.getElementById('community-status').textContent,'');
      if(Array.isArray(reply))assert.match(x.d.getElementById('community-status').textContent,/no está disponible/);
    }finally{x.close();}
  }
});
