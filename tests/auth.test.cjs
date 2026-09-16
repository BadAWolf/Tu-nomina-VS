const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const {JSDOM}=require('jsdom');
const root=path.resolve(__dirname,'..');const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const tick=()=>new Promise(resolve=>setTimeout(resolve,20));
const member={id:'test-user',email:'test@example.test',email_confirmed_at:'2026-09-14',is_anonymous:false};
async function setup(state={}){
  const dom=new JSDOM(read('index.html'),{url:state.url||'http://localhost:4173/',runScripts:'outside-only'});
  const w=dom.window,d=w.document;w.alert=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};
  w.matchMedia=()=>({matches:false,addListener(){},addEventListener(){}});
  for (const dialog of d.querySelectorAll('dialog')) {dialog.showModal=function(){this.open=true;};dialog.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};}
  const calls=[];let callback;
  const auth={
    getUser:async()=>{state.verifications=(state.verifications||0)+1;return state.networkError?Promise.reject(new Error('offline')):{data:{user:state.user||null},error:null};},
    onAuthStateChange:cb=>{callback=cb;},
    signUp:async data=>{calls.push(['signup',data]);return {data:{user:null,session:null},error:null};},
    signInWithPassword:async data=>{calls.push(['signin',data]);if(state.loginError)return {error:{code:'email_not_confirmed'}};state.user=member;callback('SIGNED_IN',{user:member});return {data:{user:member,session:{}},error:null};},
    resetPasswordForEmail:async(...args)=>{calls.push(['reset',...args]);return {error:null};},
    updateUser:async data=>{calls.push(['update',data]);return {data:{user:member},error:null};},
    resend:async data=>{calls.push(['resend',data]);return {error:null};},
    signInWithOAuth:async data=>{calls.push(['google',data]);return {error:null};},
    signOut:async()=>{state.user=null;callback('SIGNED_OUT',null);return {error:null};}
  };
  const rpc=async(name,args)=>{
    assert.equal(name,'save_marketing_choices');state.rpcArgs=args;
    const data={own_news:args.p_own_news,partner_offers:args.p_partner_offers,personalize:args.p_personalize,source:args.p_source};
    calls.push(['marketing',data]);if(state.marketingError)return {error:{code:'offline'}};
    const same=state.preferences?.email_at_consent===state.user.email && state.preferences?.own_news===data.own_news && state.preferences?.partner_offers===data.partner_offers && Boolean(state.preferences?.personalize)===data.personalize;
    state.preferences={...data,email_at_consent:state.user.email};
    state.profile=data.personalize?{age_band:args.p_age_band,province_code:args.p_province_code,city:args.p_city,email_at_consent:state.user.email}:null;
    return {error:null,data:same?[]:[data]};
  };
  w.__sdk={createClient:(_url,_key,options)=>{state.clientOptions=options;return {auth,rpc,from:table=>{
    const query={select:()=>query,eq:()=>query,limit:async()=>({data:(state.accepted||state.historicalAcceptance)?[{version:'previous'}]:[],error:null}),maybeSingle:async()=>{
      if(table==='marketing_preferences' && state.preferencesReadGate)await state.preferencesReadGate;
      return {data:table==='marketing_profiles'?(state.profile||null):table==='marketing_preferences'?(state.preferences||null):state.accepted?{version:'2026-09-15'}:null,error:table==='marketing_preferences'&&state.marketingReadError?{code:'offline'}:null};
    },insert:data=>{
      calls.push(['accept',data]);if(state.accepted)return {error:{code:'23505'}};state.accepted=true;return {error:null};}};return query;
  }};}};
  require('./load-calculator.cjs')(w);
  w.eval(read('auth-config.js').replace('googleEnabled: false','googleEnabled: true'));
  w.VIGILANTE_AUTH_CONFIG={...w.VIGILANTE_AUTH_CONFIG,captcha:{enabled:false,siteKey:''}};
  if(state.captcha){
    w.VIGILANTE_AUTH_CONFIG={...w.VIGILANTE_AUTH_CONFIG,captcha:{enabled:true,siteKey:'unit-test-only'}};
    w.VigilanteCaptcha={show(){},close(){},reset(){state.captchaToken=null;},take(){if(!state.captchaToken)throw Object.assign(new Error('captcha'),{code:'captcha_required'});return state.captchaToken;}};
  }
  w.eval(read('marketing.js'));
  state.analytics=[];w.VigilanteAnalytics={track:(...args)=>state.analytics.push(args)};
  w.eval(read('auth.js').replace("import('./vendor/supabase.js')","Promise.resolve(window.__sdk)"));
  await tick();
  return {w,d,state,calls,close:()=>w.close(),emit:event=>callback(event,{user:state.user}),click:id=>d.getElementById(id).click(),fill:(id,value)=>{d.getElementById(id).value=value;},submit:()=>d.getElementById('auth-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}))};
}
test('Guest can calculate repeatedly; PDF, finiquito and baja request registration',async()=>{
 const x=await setup();try{x.fill('hTTotal','162');x.click('btnCalc');assert.notEqual(x.d.getElementById('r-neto').textContent,'—');const first=x.d.getElementById('r-neto').textContent;
 x.fill('hTTotal','190');x.click('btnCalc');assert.notEqual(x.d.getElementById('r-neto').textContent,first);
 for(const id of ['btnPdfNomina','tab-finiquito','tab-baja']){x.click(id);await tick();assert.equal(x.d.getElementById('auth-dialog').open,true);assert.equal(x.d.getElementById('view-nomina').style.display,'block');x.click('auth-close');}
 }finally{x.close();}
});

test('Vacation switch requests registration and cancelling leaves ordinary payroll available',async()=>{
 const x=await setup();try{
  assert.equal(x.d.getElementById('vac-plus-field').hidden,true);
  x.fill('hTTotal','162');x.click('btnCalc');const original=x.d.getElementById('r-neto').textContent;
  x.click('switchVac');await tick();
  assert.equal(x.d.getElementById('auth-dialog').open,true);
  assert.equal(x.d.getElementById('switchVac').checked,false);
  assert.equal(x.d.getElementById('vac-field').style.display,'none');
  assert.match(x.d.querySelector('.account-plan-featured').textContent,/Añadir vacaciones/);
  x.click('auth-close');x.click('btnCalc');assert.equal(x.d.getElementById('r-neto').textContent,original);
 }finally{x.close();}
});

test('Signing in resumes the requested vacation switch; logging out locks it and clears the stale result',async()=>{
 const x=await setup({accepted:true});try{
  x.click('switchVac');await tick();
  x.d.querySelector('[data-auth-open="signin"]').click();x.fill('auth-email','test@example.test');x.fill('auth-password','test-password-123');x.submit();await tick();await tick();
  assert.equal(x.d.getElementById('switchVac').checked,true);
  assert.equal(x.d.getElementById('vac-field').style.display,'block');
  assert.equal(x.d.getElementById('vac-plus-field').hidden,false);
  x.fill('hTTotal','150');x.fill('diasVac','5');x.click('btnCalc');await tick();
  assert.equal(x.w.ctxPDF.nomina['Vacaciones disfrutadas'],'5 días = 26,13 h de jornada');
  x.click('account-signout');await tick();
  assert.equal(x.d.getElementById('switchVac').checked,false);
  assert.equal(x.d.getElementById('vac-field').style.display,'none');
  assert.equal(x.d.getElementById('vac-plus-field').hidden,true);
  assert.equal(x.d.getElementById('resultado').style.display,'none');assert.equal(x.w.ctxPDF.nomina,null);
  x.click('btnCalc');assert.ok(x.w.ctxPDF.nomina);assert.equal(x.w.ctxPDF.nomina['Vacaciones disfrutadas'],'Ninguna');
 }finally{x.close();}
});

test('Unverified accounts, missing terms and failed verification cannot enable holidays',async()=>{
 for(const state of [{user:{...member,email_confirmed_at:null},accepted:true},{user:member,accepted:false},{user:member,accepted:true,networkError:true}]){
  const x=await setup(state);try{
   x.click('switchVac');await tick();assert.equal(x.d.getElementById('switchVac').checked,false);assert.equal(x.d.getElementById('auth-dialog').open,true);
  }finally{x.close();}
 }
});

test('Calendar vacation creation requires an account while ordinary shifts remain free',async()=>{
 const x=await setup({accepted:true});try{
  x.click('modo-cuadrante');x.w.abrirDialogo(4);x.click('dlg-vac');await tick();
  assert.equal(x.d.getElementById('dlg-vac').checked,false);assert.equal(x.d.getElementById('auth-dialog').open,true);
  x.click('auth-close');x.d.querySelector('.t-ini').value='08:00';x.d.querySelector('.t-fin').value='16:00';x.click('dlg-guardar');
  const key=x.w.claveMes(x.w.calAnio,x.w.calMes);assert.equal(x.w.CUAD[key]['4'].vac,false);assert.equal(x.w.CUAD[key]['4'].tramos.length,1);
  x.w.abrirDialogo(5);x.click('dlg-vac');await tick();
  x.d.querySelector('[data-auth-open="signin"]').click();x.fill('auth-email','test@example.test');x.fill('auth-password','test-password-123');x.submit();await tick();await tick();
  assert.equal(x.d.getElementById('dlg-vac').checked,true);x.click('dlg-guardar');await tick();assert.equal(x.w.CUAD[key]['5'].vac,true);
  assert.equal(x.d.getElementById('vac-plus-field').hidden,false);
  x.click('btnCalc');await tick();assert.match(x.w.ctxPDF.nomina['Vacaciones disfrutadas'],/^1 día/);
  const saved=x.w.localStorage.getItem('cuadrante_vigilante');x.click('account-signout');await tick();
  assert.equal(x.w.localStorage.getItem('cuadrante_vigilante'),saved);
  assert.equal(x.d.getElementById('vac-plus-field').hidden,true);
  x.click('btnCalc');await tick();assert.equal(x.d.getElementById('auth-dialog').open,true);assert.equal(x.w.ctxPDF.nomina,null);
 }finally{x.close();}
});

test('Previously stored vacations cannot bypass registration, and are not erased when the request is cancelled',async()=>{
 const x=await setup();try{
  const key=x.w.claveMes(x.w.calAnio,x.w.calMes);x.w.CUAD[key]={'1':{tramos:[],vac:true,fest:false}};x.w.guardarCuad();
  const saved=x.w.localStorage.getItem('cuadrante_vigilante');x.click('modo-cuadrante');x.click('btnCalc');await tick();
  assert.equal(x.d.getElementById('auth-dialog').open,true);assert.equal(x.w.ctxPDF.nomina,null);x.click('auth-close');
  assert.equal(x.w.localStorage.getItem('cuadrante_vigilante'),saved);
  x.w.abrirDialogo(1);x.click('dlg-guardar');await tick();assert.equal(x.d.getElementById('auth-dialog').open,true);
  x.click('auth-close');assert.equal(x.w.localStorage.getItem('cuadrante_vigilante'),saved);
  x.click('dlg-vac');x.click('dlg-guardar');assert.equal(x.d.getElementById('auth-dialog').open,false);assert.equal(x.w.CUAD[key],undefined);
 }finally{x.close();}
});

test('An expired session preserves requested manual vacation days when the person signs back in',async()=>{
 const x=await setup({accepted:true});try{
  x.fill('hTTotal','150');x.d.getElementById('switchVac').checked=true;x.fill('diasVac','7');x.click('btnCalc');await tick();
  assert.equal(x.w.ctxPDF.nomina,null);assert.equal(x.d.getElementById('auth-dialog').open,true);
  x.d.querySelector('[data-auth-open="signin"]').click();x.fill('auth-email','test@example.test');x.fill('auth-password','test-password-123');x.submit();await tick();await tick();
  assert.equal(x.d.getElementById('diasVac').value,'7');assert.equal(x.d.getElementById('switchVac').checked,true);
  assert.match(x.w.ctxPDF.nomina['Vacaciones disfrutadas'],/^7 días/);
 }finally{x.close();}
});

test('Rapid member actions reuse verification, but logout immediately invalidates it',async()=>{
 const x=await setup({user:member,accepted:true});try{
 const initial=x.state.verifications;let completed=0;
 await Promise.all(Array.from({length:10},()=>x.w.VigilanteAuth.require(()=>completed++)));
 assert.equal(completed,10);assert.equal(x.state.verifications,initial);
 x.state.user=null;x.emit('SIGNED_OUT');
 await x.w.VigilanteAuth.require(()=>completed++);
 assert.equal(completed,10);assert.equal(x.d.getElementById('account-member').hidden,true);
 assert.equal(x.d.getElementById('auth-dialog').open,true);
 }finally{x.close();}
});

test('Confirmed user can leave without accepting terms or unlocking tools',async()=>{
 const x=await setup({user:member,accepted:false});try{
 assert.equal(x.d.getElementById('account-member').hidden,false);
 assert.equal(x.d.getElementById('account-title').textContent,'Has iniciado sesión');
 let unlocked=false;await x.w.VigilanteAuth.require(()=>{unlocked=true;});
 assert.equal(unlocked,false);assert.equal(x.d.getElementById('auth-title').textContent,'Antes de continuar');
 x.click('auth-close');x.click('account-signout');await tick();
 assert.equal(x.d.getElementById('account-member').hidden,true);
 assert.equal(x.calls.some(c=>c[0]==='accept'),false);
 }finally{x.close();}
});

test('Double form submission sends only one signup request',async()=>{
 const x=await setup();try{
 x.d.querySelector('[data-auth-open="signup"]').click();x.fill('auth-email','test@example.test');
 x.fill('auth-password','test-password-123');x.fill('auth-confirm','test-password-123');x.d.getElementById('auth-terms').checked=true;
 x.submit();x.submit();await tick();
 assert.equal(x.calls.filter(c=>c[0]==='signup').length,1);
 }finally{x.close();}
});

test('Stalled auth requests abort and caller cancellation is preserved',async()=>{
 const x=await setup();try{
 const original=x.w.setTimeout.bind(x.w);x.w.setTimeout=(fn,delay)=>original(fn,delay===12000?2:delay);
 x.w.fetch=(_input,init)=>new Promise((resolve,reject)=>{
 const abort=()=>reject(new x.w.DOMException('Aborted','AbortError'));
 if(init.signal.aborted)abort();else init.signal.addEventListener('abort',abort,{once:true});
 });
 await assert.rejects(x.state.clientOptions.global.fetch('https://example.invalid'),{name:'AbortError'});
 const controller=new x.w.AbortController();controller.abort();
 await assert.rejects(x.state.clientOptions.global.fetch('https://example.invalid',{signal:controller.signal}),{name:'AbortError'});
 }finally{x.close();}
});
test('Signup requires matching passwords and unchecked-by-default conditions',async()=>{
 const x=await setup();try{x.d.querySelector('[data-auth-open="signup"]').click();x.fill('auth-email','test@example.test');x.fill('auth-password','test-password-123');x.fill('auth-confirm','different-password');x.d.getElementById('auth-terms').checked=true;x.submit();await tick();assert.equal(x.calls.length,0);
 x.fill('auth-confirm','test-password-123');x.d.getElementById('auth-confirm').dispatchEvent(new x.w.Event('input'));x.submit();await tick();assert.equal(x.calls[0][0],'signup');assert.match(x.d.getElementById('auth-status').textContent,/Revisa tu correo/);assert.equal(x.d.getElementById('account-member').hidden,true);
 }finally{x.close();}
});
test('Verified user must accept terms before restricted actions; server acceptance resumes requested tab',async()=>{
 const x=await setup({user:member});try{x.click('tab-baja');await tick();assert.equal(x.d.getElementById('auth-title').textContent,'Antes de continuar');assert.equal(x.d.getElementById('auth-terms').checked,false);
 x.d.getElementById('auth-terms').checked=true;x.submit();await tick();await tick();assert.equal(x.calls[0][0],'accept');assert.equal(x.d.getElementById('view-baja').style.display,'block');assert.equal(x.d.getElementById('account-member').hidden,false);
 }finally{x.close();}
});
test('Confirmed member signs in and signs out; logout locks restricted views',async()=>{
 const x=await setup({accepted:true});try{x.d.querySelector('[data-auth-open="signin"]').click();x.fill('auth-email','test@example.test');x.fill('auth-password','test-password-123');x.submit();await tick();await tick();assert.equal(x.d.getElementById('account-member').hidden,false);assert.equal(x.d.getElementById('auth-dialog').open,false);
 x.click('tab-finiquito');await tick();assert.equal(x.d.getElementById('view-finiquito').style.display,'block');x.click('account-signout');await tick();assert.equal(x.d.getElementById('view-finiquito').style.display,'none');
 }finally{x.close();}
});
test('Anonymous or unconfirmed sessions do not unlock member features',async()=>{
 for(const user of [{...member,email_confirmed_at:null},{...member,is_anonymous:true}]){const x=await setup({user,accepted:true});try{x.click('tab-baja');await tick();assert.equal(x.d.getElementById('account-member').hidden,true);assert.equal(x.d.getElementById('auth-title').textContent,'Crea tu cuenta gratis');}finally{x.close();}}
});
test('Recovery hides signup fields and updates password only after recovery event',async()=>{
 const x=await setup();try{x.d.querySelector('[data-auth-open="reset"]').click();x.fill('auth-email','test@example.test');x.submit();await tick();assert.equal(x.calls[0][0],'reset');assert.equal(x.d.getElementById('auth-password').disabled,true);
 x.state.user=member;x.state.accepted=true;x.emit('PASSWORD_RECOVERY');await tick();assert.equal(x.d.getElementById('auth-title').textContent,'Elige una contraseña nueva');x.fill('auth-password','new-test-password-456');x.fill('auth-confirm','new-test-password-456');x.submit();await tick();assert.equal(x.calls[1][0],'update');assert.equal(x.d.getElementById('auth-dialog').open,false);
 }finally{x.close();}
});
test('Offline verification fails closed while payroll keeps working',async()=>{
 const x=await setup({networkError:true});try{x.fill('hTTotal','162');x.click('btnCalc');assert.notEqual(x.d.getElementById('r-neto').textContent,'—');x.click('tab-baja');await tick();assert.equal(x.d.getElementById('auth-dialog').open,true);assert.equal(x.d.getElementById('account-member').hidden,true);}finally{x.close();}
});
test('Google uses the configured callback and only the google provider',async()=>{
 const x=await setup();try{x.d.querySelector('[data-auth-open="signin"]').click();x.click('auth-google');await tick();assert.equal(x.calls[0][0],'google');assert.equal(x.calls[0][1].provider,'google');assert.equal(x.calls[0][1].options.redirectTo,'http://localhost:4173/');}finally{x.close();}
});

test('Signup blocks missing captcha and passes a fresh token to Supabase',async()=>{
 const x=await setup({captcha:true});try{
 x.d.querySelector('[data-auth-open="signup"]').click();x.fill('auth-email','test@example.test');x.fill('auth-password','test-password-123');x.fill('auth-confirm','test-password-123');x.d.getElementById('auth-terms').checked=true;
 x.submit();await tick();assert.equal(x.calls.length,0);assert.match(x.d.getElementById('auth-status').textContent,/comprobación de seguridad/);
 x.state.captchaToken='verified';x.submit();await tick();assert.equal(x.calls[0][1].options.captchaToken,'verified');assert.equal(x.state.captchaToken,null);
 }finally{x.close();}
});
test('Password login, recovery and resend include the captcha token; Google stays independent',async()=>{
 for(const mode of ['signin','reset','resend','google']){
 const x=await setup({captcha:true,accepted:true});try{
 x.d.querySelector('[data-auth-open="'+(mode==='reset'?'reset':'signin')+'"]').click();x.fill('auth-email','test@example.test');x.fill('auth-password','test-password-123');x.state.captchaToken='verified';
 if(mode==='resend')x.click('auth-resend');else if(mode==='google'){x.state.captchaToken=null;x.click('auth-google');}else x.submit();
 await tick();
 if(mode==='google')assert.equal(x.calls[0][0],'google');
 else if(mode==='reset')assert.equal(x.calls[0][2].captchaToken,'verified');
 else assert.equal(x.calls[0][1].options.captchaToken,'verified');
 }finally{x.close();}}
});
test('Cookies do not load analytics until explicit acceptance; rejection persists',async()=>{
 const x=await setup({url:'https://calculadoravigilante.com/'});try{x.w.eval(read('cookies.js'));assert.equal(x.d.querySelectorAll('script[src*="googletagmanager"]').length,0);x.w.rejectCookies();assert.equal(x.d.querySelectorAll('script[src*="googletagmanager"]').length,0);assert.equal(JSON.parse(x.w.localStorage.getItem('vigilante_cookie_preferences_v1')).analytics,false);
 x.w.openCookieSettings();assert.equal(x.d.getElementById('cookie-banner').hidden,false);x.w.acceptCookies();assert.equal(x.d.querySelectorAll('script[src*="googletagmanager"]').length,1);assert.equal(x.d.querySelectorAll('script[src*="pagead2"]').length,0);
 }finally{x.close();}
});

test('Marketing permissions start empty, are independent and never gate account activation',async()=>{
 for(const [own,partners] of [[false,false],[true,false],[false,true],[true,true]]){
  const x=await setup({user:member});try{
   x.click('tab-baja');await tick();
   assert.equal(x.d.getElementById('marketing-dialog').open,false);
   x.d.getElementById('auth-terms').checked=true;x.submit();await tick();await tick();
   assert.equal(x.d.getElementById('marketing-dialog').open,true);
   assert.equal(x.d.getElementById('view-baja').style.display,'block');
   for(const id of ['auth-marketing-own','auth-marketing-partners']){
    assert.equal(x.d.getElementById(id).checked,false);assert.equal(x.d.getElementById(id).required,false);
   }
   x.d.getElementById('auth-marketing-own').checked=own;x.d.getElementById('auth-marketing-partners').checked=partners;
   x.click('marketing-welcome-save');await tick();await tick();
   const saved=x.calls.find(c=>c[0]==='marketing')[1];
   assert.equal(saved.own_news,own);assert.equal(saved.partner_offers,partners);
   assert.equal(saved.email_at_consent,undefined);assert.equal(saved.recorded_at,undefined);
   assert.equal(x.d.getElementById('marketing-dialog').open,false);
   assert.equal(x.state.analytics.filter(c=>c[0]==='marketing_own_opt_in').length,Number(own));
   assert.equal(x.state.analytics.filter(c=>c[0]==='marketing_partner_opt_in').length,Number(partners));
   assert.equal(x.d.getElementById('view-baja').style.display,'block');
   assert.equal(x.state.analytics.filter(c=>c[0]==='sign_up').length,1);
   await x.w.VigilanteAuth.require(()=>{});assert.equal(x.state.analytics.filter(c=>c[0]==='sign_up').length,1);
  }finally{x.close();}
 }
});
test('Marketing outage does not take away an activated account or report a successful subscription',async()=>{
 const x=await setup({user:member,marketingError:true});try{
  x.click('tab-baja');await tick();x.d.getElementById('auth-terms').checked=true;
  x.submit();await tick();await tick();
  x.d.getElementById('auth-marketing-own').checked=true;x.click('marketing-welcome-save');await tick();await tick();
  assert.equal(x.d.getElementById('account-title').textContent,'Tu cuenta está activa');
  assert.match(x.d.getElementById('marketing-welcome-status').textContent,/No se pudo guardar/);
  assert.equal(x.d.getElementById('marketing-dialog').open,true);
  assert.equal(x.state.analytics.filter(c=>c[0].startsWith('marketing_')).length,0);
  x.click('marketing-close');let used=false;await x.w.VigilanteAuth.require(()=>used=true);assert.equal(used,true);
 }finally{x.close();}
});
test('Existing members are not subscribed retroactively and can withdraw both categories without losing tools',async()=>{
 const x=await setup({user:member,accepted:true,preferences:{email_at_consent:member.email,own_news:true,partner_offers:true}});try{
  assert.equal(x.calls.some(c=>c[0]==='marketing'),false);
  x.d.getElementById('marketing-preferences').open=true;await tick();await tick();
  assert.equal(x.d.getElementById('marketing-own').checked,true);assert.equal(x.d.getElementById('marketing-partners').checked,true);
  x.click('marketing-withdraw');await tick();await tick();
  const saved=x.calls.find(c=>c[0]==='marketing')[1];assert.equal(saved.own_news,false);assert.equal(saved.partner_offers,false);
  assert.match(x.d.getElementById('marketing-status').textContent,/sin publicidad/);
  assert.equal(x.state.analytics.filter(c=>c[0]==='marketing_own_opt_out').length,1);
  assert.equal(x.state.analytics.filter(c=>c[0]==='marketing_partner_opt_out').length,1);
  let allowed=false;await x.w.VigilanteAuth.require(()=>{allowed=true;});assert.equal(allowed,true);
 }finally{x.close();}
});
test('A changed email does not inherit the old address marketing preferences',async()=>{
 const x=await setup({user:member,accepted:true,preferences:{email_at_consent:'old@example.test',own_news:true,partner_offers:true}});try{
  x.d.getElementById('marketing-preferences').open=true;await tick();await tick();
  assert.equal(x.d.getElementById('marketing-own').checked,false);assert.equal(x.d.getElementById('marketing-partners').checked,false);
 }finally{x.close();}
});

test('Accepting updated terms does not count an existing account as a new registration',async()=>{
 const x=await setup({user:member,historicalAcceptance:true});try{
  x.click('tab-baja');await tick();x.d.getElementById('auth-terms').checked=true;x.submit();await tick();await tick();
  assert.equal(x.d.getElementById('account-title').textContent,'Tu cuenta está activa');
  assert.equal(x.state.analytics.filter(c=>c[0]==='sign_up').length,0);
  assert.equal(x.state.clientOptions.auth.persistSession,true);assert.equal(x.state.clientOptions.auth.autoRefreshToken,true);
 }finally{x.close();}
});

test('First entry asks verified members with no choice, including Google; guests and unverified users are never asked',async()=>{
 for(const user of [null,{...member,email_confirmed_at:null},{...member,is_anonymous:true},member,{...member,app_metadata:{provider:'google'}}]){
  const x=await setup({user,accepted:true});try{
   assert.equal(x.d.getElementById('marketing-dialog').open,Boolean(user?.email_confirmed_at&&!user.is_anonymous));
   assert.equal(x.calls.filter(c=>c[0]==='marketing').length,0);
  }finally{x.close();}
 }
});

test('Continue without advertising clears either selection and the stored refusal survives a fresh visit',async()=>{
 const x=await setup({user:member,accepted:true});let preferences;try{
  x.d.getElementById('auth-marketing-own').checked=true;x.d.getElementById('auth-marketing-partners').checked=true;
  x.click('marketing-skip');await tick();await tick();
  preferences=x.state.preferences;
  assert.equal(preferences.own_news,false);assert.equal(preferences.partner_offers,false);
  assert.equal(x.d.getElementById('marketing-dialog').open,false);
  assert.equal(x.state.analytics.filter(c=>c[0].startsWith('marketing_')).length,0);
 }finally{x.close();}
 const fresh=await setup({user:member,accepted:true,preferences});try{
  assert.equal(fresh.d.getElementById('marketing-dialog').open,false);
  await fresh.w.VigilanteAuth.require(()=>{});assert.equal(fresh.calls.length,0);
 }finally{fresh.close();}
});

test('Dismissing the offer records no choice and does not reopen it during the visit',async()=>{
 const x=await setup({user:member,accepted:true});try{
  x.click('marketing-close');await tick();await x.w.VigilanteAuth.require(()=>{});
  assert.equal(x.d.getElementById('marketing-dialog').open,false);
  assert.equal(x.calls.filter(c=>c[0]==='marketing').length,0);
  assert.equal(x.state.analytics.filter(c=>c[0].startsWith('marketing_')).length,0);
 }finally{x.close();}
});

test('Stored consent is not reset on new legal acceptance, nor counted again on reading or saving the same preferences',async()=>{
 const x=await setup({user:member,historicalAcceptance:true,preferences:{email_at_consent:member.email,own_news:true,partner_offers:false}});try{
  x.click('tab-baja');await tick();x.d.getElementById('auth-terms').checked=true;x.submit();await tick();await tick();
  assert.equal(x.d.getElementById('marketing-dialog').open,false);
  assert.equal(x.calls.filter(c=>c[0]==='marketing').length,0);
  x.d.getElementById('marketing-preferences').open=true;await tick();await tick();
  x.click('marketing-save');await tick();await tick();
  assert.equal(x.state.preferences.own_news,true);
  assert.equal(x.state.analytics.filter(c=>c[0].startsWith('marketing_')).length,0);
 }finally{x.close();}
});

test('Unreadable preferences are not treated as a new account or written automatically',async()=>{
 const x=await setup({user:member,accepted:true,marketingReadError:true});try{
  assert.equal(x.d.getElementById('marketing-dialog').open,false);
  assert.equal(x.calls.length,0);
  x.d.getElementById('marketing-preferences').open=true;await tick();await tick();
  assert.equal(x.d.getElementById('marketing-save').disabled,true);
  assert.match(x.d.getElementById('marketing-status').textContent,/No se pudieron cargar/);
 }finally{x.close();}
});

test('Logout during a pending preference read prevents both the offer and a stale write',async()=>{
 let resolve;const gate=new Promise(done=>resolve=done);
 const x=await setup({user:member,accepted:true,preferencesReadGate:gate});try{
  x.click('account-signout');await tick();resolve();await tick();
  assert.equal(x.d.getElementById('marketing-dialog').open,false);assert.equal(x.calls.length,0);
 }finally{x.close();}
 const y=await setup({user:member,accepted:true});try{
  y.state.preferencesReadGate=new Promise(done=>resolve=done);
  y.d.getElementById('auth-marketing-own').checked=true;y.click('marketing-welcome-save');await tick();
  y.click('account-signout');await tick();resolve();await tick();await tick();
  assert.equal(y.calls.filter(c=>c[0]==='marketing').length,0);
  assert.equal(y.state.analytics.filter(c=>c[0].startsWith('marketing_')).length,0);
 }finally{y.close();}
});

test('Profile is optional, separately consented and saved with the selected advertising categories',async()=>{
 const x=await setup({user:member,accepted:true});try{
  assert.equal(x.d.getElementById('auth-marketing-targeting').hidden,false);
  assert.equal(x.d.getElementById('auth-marketing-profile-fields').hidden,false);
  assert.equal(x.d.getElementById('auth-marketing-profile-fields').disabled,true);
  x.click('auth-marketing-partners');assert.equal(x.d.getElementById('auth-marketing-targeting').hidden,false);
  assert.equal(x.d.getElementById('auth-marketing-personalize').checked,false);
  x.click('auth-marketing-personalize');x.fill('auth-marketing-age','25-34');x.fill('auth-marketing-province','12');x.fill('auth-marketing-city','  Burriana  ');
  x.click('marketing-welcome-save');await tick();await tick();
  assert.equal(x.state.rpcArgs.p_user_id,member.id);assert.equal(x.state.preferences.personalize,true);
  assert.equal(x.state.preferences.own_news,false);assert.equal(x.state.preferences.partner_offers,true);
  assert.equal(x.state.profile.city,'Burriana');assert.equal(x.state.profile.age_band,'25-34');assert.equal(x.state.profile.province_code,'12');
  assert.equal(JSON.stringify(x.state.analytics).includes('Burriana'),false);
  assert.equal(JSON.stringify(x.state.analytics).includes('25-34'),false);
 }finally{x.close();}
});

test('Age-only and province-only profiles work without requiring the other optional fields',async()=>{
 for(const field of ['age','province']){
  const x=await setup({user:member,accepted:true});try{
   x.click('auth-marketing-own');x.click('auth-marketing-personalize');x.fill('auth-marketing-'+field,field==='age'?'35-44':'28');
   x.click('marketing-welcome-save');await tick();await tick();assert.equal(x.d.getElementById('marketing-dialog').open,false);
   assert.equal(x.state.profile.city,null);assert.equal(x.state.profile[field==='age'?'province_code':'age_band'],null);
  }finally{x.close();}
 }
});

test('City requires a province, city validation prevents formula/markup input, and declining bypasses incomplete profile',async()=>{
 const x=await setup({user:member,accepted:true});try{
  x.click('auth-marketing-own');x.click('auth-marketing-personalize');x.fill('auth-marketing-city','Burriana');
  x.d.getElementById('marketing-welcome-form').dispatchEvent(new x.w.Event('submit',{bubbles:true,cancelable:true}));await tick();
  assert.equal(x.calls.length,0);assert.equal(x.d.getElementById('auth-marketing-province').validity.valid,false);
  for(const city of ['=IMPORTDATA(1)','<script>alert(1)</script>']){
   x.fill('auth-marketing-province','12');x.d.getElementById('auth-marketing-province').dispatchEvent(new x.w.Event('input'));
   x.fill('auth-marketing-city',city);x.d.getElementById('marketing-welcome-form').dispatchEvent(new x.w.Event('submit',{bubbles:true,cancelable:true}));await tick();
   assert.equal(x.calls.length,0);assert.equal(x.d.getElementById('auth-marketing-city').validity.valid,false);
  }
  x.click('marketing-skip');await tick();await tick();
  assert.equal(x.state.preferences.personalize,false);assert.equal(x.state.profile,null);
  for(const name of ['p_age_band','p_province_code','p_city'])assert.equal(x.state.rpcArgs[name],null);
 }finally{x.close();}
});

test('Personalization can be erased without withdrawing advertising, and saved profiles load only for the matching email',async()=>{
 const profile={email_at_consent:member.email,age_band:'25-34',province_code:'12',city:'Burriana'};
 const x=await setup({user:member,accepted:true,profile,preferences:{email_at_consent:member.email,own_news:true,partner_offers:true,personalize:true}});try{
  x.d.getElementById('marketing-preferences').open=true;await tick();await tick();
  assert.equal(x.d.getElementById('marketing-city').value,'Burriana');assert.equal(x.d.getElementById('marketing-personalize').checked,true);
  x.click('marketing-personalize');x.click('marketing-save');await tick();await tick();
  assert.equal(x.state.profile,null);assert.equal(x.state.preferences.own_news,true);assert.equal(x.state.preferences.partner_offers,true);
  assert.equal(x.state.analytics.filter(e=>e[0].startsWith('marketing_')).length,0);
 }finally{x.close();}
 const y=await setup({user:member,accepted:true,profile:{...profile,email_at_consent:'old@example.test'},preferences:{email_at_consent:member.email,own_news:true,partner_offers:true,personalize:true}});try{
  y.d.getElementById('marketing-preferences').open=true;await tick();await tick();
  assert.equal(y.d.getElementById('marketing-personalize').checked,false);assert.equal(y.d.getElementById('marketing-city').value,'');
 }finally{y.close();}
});

test('Changing only an existing profile is not an extra advertising subscription',async()=>{
 const x=await setup({user:member,accepted:true,profile:{email_at_consent:member.email,age_band:'25-34',province_code:'12',city:'Burriana'},preferences:{email_at_consent:member.email,own_news:true,partner_offers:true,personalize:true}});try{
  x.d.getElementById('marketing-preferences').open=true;await tick();await tick();x.fill('marketing-city','Castelló de la Plana');x.click('marketing-save');await tick();await tick();
  assert.equal(x.state.profile.city,'Castelló de la Plana');assert.equal(x.state.analytics.filter(e=>e[0].startsWith('marketing_')).length,0);
 }finally{x.close();}
});


test('Restored email and Google accounts finish activation before seeing the optional profile',async()=>{
 for(const provider of ['email','google']){
  const x=await setup({user:{...member,app_metadata:{provider}}});try{
   assert.equal(x.d.getElementById('auth-dialog').open,true);
   assert.equal(x.d.getElementById('auth-title').textContent,'Antes de continuar');
   assert.equal(x.d.getElementById('marketing-dialog').open,false);
   x.d.getElementById('auth-terms').checked=true;x.submit();await tick();await tick();
   assert.equal(x.d.getElementById('marketing-dialog').open,true);
   assert.equal(x.d.getElementById('auth-marketing-profile-fields').hidden,false);
   assert.equal(x.d.getElementById('auth-marketing-profile-fields').disabled,true);
   for(const id of ['auth-marketing-own','auth-marketing-partners','auth-marketing-personalize'])assert.equal(x.d.getElementById(id).checked,false);
   x.click('marketing-skip');await tick();await tick();
   assert.equal(x.state.profile,null);assert.equal(x.state.preferences.own_news,false);
   assert.equal(x.d.getElementById('marketing-dialog').open,false);
  }finally{x.close();}
 }
});
