/* Static-site account UI. Public calculation code is not a server authorization boundary. */
(function () {
  'use strict';
  const config = window.VIGILANTE_AUTH_CONFIG;
  const $ = id => document.getElementById(id);
  const dialog = $('auth-dialog'), form = $('auth-form'), status = $('auth-status');
  if (!config || !dialog || !form) return;
  const email = $('auth-email'), password = $('auth-password'), confirm = $('auth-confirm');
  const terms = $('auth-terms'), submit = $('auth-submit'), google = $('auth-google');
  const accountSection = $('account-section'), sectorResources = $('sector-resources');
  const legalVersion = '2026-09-15';
  const pendingKey = 'nv_pending_signup';
  let client = null, user = null, accepted = false, pending = null;
  let mode = 'signup', recovery = false, revision = 0, ready, busy = false, activating = false;
  let verificationTask=null, verifiedAt=0;
  function invalidate(){revision++;verifiedAt=0;verificationTask=null;}
  // Bounds stalled network requests; database RLS remains the authorization boundary.
  async function authFetch(input,init={}){
    const controller=new AbortController();
    const abort=()=>controller.abort();
    if(init.signal?.aborted)abort();else init.signal?.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(abort,12000);
    try{return await fetch(input,{...init,signal:controller.signal});}
    finally{clearTimeout(timer);init.signal?.removeEventListener('abort',abort);}
  }
  const titles = {signup:'Crea tu cuenta gratis',signin:'Te damos la bienvenida',reset:'Recupera tu contraseña',recovery:'Elige una contraseña nueva',consent:'Último paso'};
  const buttons = {signup:'Crear cuenta gratis',signin:'Iniciar sesión',reset:'Enviar enlace de recuperación',recovery:'Guardar contraseña',consent:'Activar mi cuenta'};
  const intros = {
    signup:'Calcula la baja y el finiquito, añade vacaciones, descarga tus PDF y accede a las guías del sector.',
    signin:'Entra con tu cuenta para usar todas las herramientas.',
    reset:'Te enviaremos un enlace para elegir una nueva contraseña.',
    recovery:'Usa al menos 12 caracteres y una contraseña que no utilices en otras webs.',
    consent:'Acepta las condiciones para activar tu cuenta. Si quieres, elige también qué correos recibir.'
  };
  function message(text, error) { status.textContent = text; status.dataset.error = String(Boolean(error)); }
  function notice(text) {
    const box = $('account-notice');
    if (box) box.textContent = text;
    window.VigilanteAuthUI?.toast(text);
  }
  function captchaToken(){
    if(!config.captcha?.enabled)return undefined;
    if(!window.VigilanteCaptcha)throw Object.assign(new Error('captcha_required'),{code:'captcha_required'});
    return window.VigilanteCaptcha.take();
  }
  function readPending(){try{return JSON.parse(sessionStorage.getItem(pendingKey)||'null');}catch(_){return null;}}
  function writePending(value){try{if(value)sessionStorage.setItem(pendingKey,JSON.stringify(value));else sessionStorage.removeItem(pendingKey);}catch(_){}}
  function render(nextUser) {
    user = nextUser && nextUser.email_confirmed_at && !nextUser.is_anonymous ? nextUser : null;
    const member = Boolean(user && accepted && !recovery);
    if ($('account-guest')) $('account-guest').hidden = member;
    if ($('account-member')) $('account-member').hidden = !user;
    if (accountSection) {
      accountSection.setAttribute('aria-labelledby', member ? 'account-title' : 'account-heading');
      // Move the shared card in the DOM so visual and keyboard order stay aligned.
      if (sectorResources) {
        if (user) { if (sectorResources.nextElementSibling !== accountSection) accountSection.before(sectorResources); }
        else if (accountSection.nextElementSibling !== sectorResources) accountSection.after(sectorResources);
      }
    }
    if ($('account-title')) $('account-title').textContent = member ? 'Tu cuenta está activa' : 'Has iniciado sesión';
    if ($('account-benefits')) $('account-benefits').textContent = member ? 'Ya puedes calcular la baja y el finiquito, añadir vacaciones, descargar tus PDF y leer las guías del sector.'
      : recovery ? 'Completa el cambio de contraseña para continuar.' : 'Acepta las condiciones para activar tu cuenta. También puedes cerrar la sesión.';
    if ($('account-email')) $('account-email').textContent = user ? user.email : '';
    window.VigilanteMarketing?.setUser(recovery ? null : user, member);
    window.VigilanteCommunity?.setUser(recovery ? null : user, member);
    window.actualizarAccesoVacaciones?.(member);
    ['Nomina','Finiquito','Baja'].forEach(kind => {
      if ($('btnPdf'+kind)) $('btnPdf'+kind).textContent = member ? 'Compartir / Descargar PDF' : 'Regístrate gratis para descargar el PDF';
    });
    if (!member) $('tab-nomina')?.click();
    document.documentElement.classList.toggle('nv-member', member);
    document.dispatchEvent(new CustomEvent('vigilante:account', {detail: {member, signedIn: Boolean(user)}}));
  }
  function open(nextMode) {
    if (busy) return;
    mode = recovery ? 'recovery' : nextMode || 'signup';
    $('auth-title').textContent = titles[mode];
    $('auth-intro').textContent = intros[mode];
    const showEmail = ['signup','signin','reset'].includes(mode);
    const showPassword = ['signup','signin','recovery'].includes(mode);
    const showConfirm = ['signup','recovery'].includes(mode);
    const showMarketing = ['signup','consent'].includes(mode);
    $('auth-email-field').hidden = !showEmail; email.disabled = !showEmail;
    $('auth-password-field').hidden = !showPassword; password.disabled = !showPassword;
    password.minLength = mode === 'signin' ? 1 : 12;
    password.autocomplete = mode === 'signin' ? 'current-password' : 'new-password';
    $('auth-password-hint').hidden = mode === 'signin';
    $('auth-confirm-field').hidden = !showConfirm; confirm.disabled = !showConfirm;
    $('auth-marketing-step').hidden = !showMarketing;
    $('signup-fields').disabled = !showMarketing;
    if (showMarketing) window.VigilanteAuthUI?.fill('signup', mode === 'consent' ? readPending() : null);
    $('auth-terms-field').hidden = !showMarketing;
    terms.disabled = !showMarketing; terms.checked = false;
    if(mode === 'signup') window.VigilanteAnalytics?.track('sign_up_start');
    $('auth-provider-options').hidden = !['signup','signin'].includes(mode);
    $('auth-switches').hidden = !['signup','signin','reset'].includes(mode);
    $('auth-switches').querySelectorAll('[data-auth-open]').forEach(link => { link.hidden = link.dataset.authOpen === mode; });
    $('auth-resend').hidden = mode !== 'signin';
    submit.textContent = buttons[mode];
    password.value = ''; confirm.value = ''; confirm.setCustomValidity('');
    message('');
    if (!dialog.open) dialog.showModal();
    window.VigilanteCaptcha?.show(mode);
    (showEmail ? email : showPassword ? password : terms).focus();
  }
  async function verifiedUser(force=false) {
    await ready;
    if (!client) return null;
    if(!force&&verifiedAt&&Date.now()-verifiedAt<15000)return user;
    if(verificationTask)return verificationTask;
    const request = ++revision;
    verificationTask=(async()=>{
    try {
      const {data,error} = await client.auth.getUser();
      if (request !== revision) return user;
      if (error || !data.user) { accepted=false; render(null);if(!error)verifiedAt=Date.now(); return null; }
      const result = await client.from('legal_acceptances').select('version').eq('user_id',data.user.id).eq('version',legalVersion).maybeSingle();
      if (request !== revision) return user;
      accepted = !result.error && Boolean(result.data);
      render(data.user);
      if(!result.error)verifiedAt=Date.now();
    } catch (_) { if(request===revision){accepted=false;render(null);} }
    finally {if(request===revision)verificationTask=null;}
    return user;
    })();
    return verificationTask;
  }
  function finish(text) {
    const action = pending; pending = null;
    if(dialog.open) dialog.close();
    notice(text || 'Tu cuenta está lista. Ya tienes acceso a todas las herramientas.');
    if(action) action();
  }
  // termsAccepted: the person ticked the conditions box, now or when registering by email.
  async function recordAcceptance(termsAccepted) {
    if(!user || !termsAccepted) throw new Error('acceptance');
    const previous = await client.from('legal_acceptances').select('version').eq('user_id',user.id).limit(1);
    if(previous.error) throw previous.error;
    const result = await client.from('legal_acceptances').insert({user_id:user.id,version:legalVersion});
    if(result.error && result.error.code!=='23505') throw result.error;
    const newlyActivated = !result.error && !previous.data?.length;
    await verifiedUser(true);
    if(!accepted) throw new Error('acceptance');
    if(newlyActivated) window.VigilanteAnalytics?.track('sign_up', {method: user.app_metadata?.provider === 'google' ? 'Google' : 'Email'});
  }
  async function saveMarketing(choice) {
    if (!window.VigilanteMarketing || !choice) return;
    try { await window.VigilanteMarketing.applyChoice(choice); }
    catch (_) { window.VigilanteMarketing.releaseChoice(); }
  }
  // Email sign-up: the choices travel with the account until the address is confirmed.
  async function completeEmailSignup() {
    const saved = user?.user_metadata?.nv_signup;
    if (activating || accepted || !saved || saved.terms !== legalVersion) return false;
    activating = true;
    window.VigilanteMarketing?.expectChoice();
    try {
      await recordAcceptance(true);
      await saveMarketing(saved);
      client.auth.updateUser({data:{nv_signup:null}}).catch(()=>{});
      finish('Correo confirmado. Tu cuenta está lista.');
      return true;
    } catch (_) { window.VigilanteMarketing?.releaseChoice(); return false; }
    finally { activating = false; }
  }
  async function afterSignIn() {
    if (recovery || !user || accepted) return;
    if (await completeEmailSignup()) return;
    if (!accepted && !dialog.open) open('consent');
  }
  window.VigilanteAuth = {
    require: async function(action){
      await verifiedUser();
      if(user && accepted && !recovery) return action();
      pending = action;
      open(recovery ? 'recovery' : user ? 'consent' : 'signup');
    },
    open: mode => open(mode),
    get member(){ return Boolean(user && accepted && !recovery); }
  };
  document.addEventListener('click', event => {
    const trigger = event.target.closest('[data-auth-open]');
    if (!trigger) return;
    event.preventDefault();
    open(trigger.dataset.authOpen);
  });
  $('auth-close').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('close',()=>{pending=null;password.value='';confirm.value='';window.VigilanteCaptcha?.close();});
  confirm.addEventListener('input',()=>confirm.setCustomValidity(''));
  password.addEventListener('input',()=>confirm.setCustomValidity(''));
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    if(busy)return;
    if(!confirm.disabled) confirm.setCustomValidity(password.value===confirm.value?'':'Las contraseñas no coinciden.');
    if(!form.reportValidity()) return;
    await ready;
    if(busy)return;
    if(!client){message('No se puede conectar al registro. Puedes seguir calculando tu nómina.',true);return;}
    busy=true;submit.disabled=true; google.disabled=true; message('Un momento…');
    const currentMode=mode;
    try {
      const verification=['signup','signin','reset'].includes(currentMode)?captchaToken():undefined;
      if(currentMode==='consent'){
        const choice=window.VigilanteAuthUI?.read('signup');
        window.VigilanteMarketing?.expectChoice();
        await recordAcceptance(terms.checked);
        await saveMarketing(choice);
        writePending(null);
        finish();
        return;
      }
      if(currentMode==='reset'){
        const result=await client.auth.resetPasswordForEmail(email.value.trim(),{redirectTo:config.redirectTo,captchaToken:verification});
        if(result.error) throw result.error;
        message('Si existe una cuenta con ese correo, recibirás un enlace de recuperación. Revisa también el spam.'); return;
      }
      if(currentMode==='recovery'){
        const result=await client.auth.updateUser({password:password.value});
        if(result.error) throw result.error;
        recovery=false; password.value='';confirm.value='';
        await verifiedUser(true); busy=false;
        if(accepted) finish('Contraseña actualizada.'); else open('consent');
        return;
      }
      if(currentMode==='signup'){
        const choice=window.VigilanteAuthUI?.read('signup')||{};
        const data={nv_signup:{terms:legalVersion,own:Boolean(choice.own),partners:Boolean(choice.partners),personalize:Boolean(choice.personalize),province:choice.province||null}};
        const result=await client.auth.signUp({email:email.value.trim(),password:password.value,options:{emailRedirectTo:config.redirectTo,captchaToken:verification,data}});
        if(result.error) throw result.error;
        password.value='';confirm.value='';
        if(result.data.session){
          await verifiedUser(true);
          window.VigilanteMarketing?.expectChoice();
          await recordAcceptance(true);await saveMarketing(choice);finish();
        }
        else message('¡Casi está! Te hemos enviado un correo: pulsa el enlace para confirmar tu cuenta. Revisa también el spam.');
        return;
      }
      const result=await client.auth.signInWithPassword({email:email.value.trim(),password:password.value,options:{captchaToken:verification}});
      if(result.error) throw result.error;
      password.value=''; await verifiedUser(true);
      if(!user) throw new Error('verification');
      window.VigilanteAnalytics?.track('login',{method:'Email'});
      busy=false;
      if(accepted) finish('Has iniciado sesión.');
      else if(!(await completeEmailSignup())) open('consent');
    } catch(error){
      window.VigilanteMarketing?.releaseChoice();
      message(error.code==='captcha_required' ? 'Completa la comprobación de seguridad antes de continuar.'
        : error.code==='captcha_failed' ? 'La comprobación de seguridad no es válida. Reinténtalo.'
        : error.status===429 ? 'Demasiados intentos. Espera un minuto y vuelve a intentarlo.'
        : error.code==='email_not_confirmed' ? 'Confirma primero tu correo. Puedes solicitar otro mensaje de verificación.'
        : error.message==='acceptance' ? 'Marca la casilla de las condiciones para continuar.'
        : currentMode==='signin' ? 'No se pudo iniciar sesión. Comprueba el correo y la contraseña.'
        : 'No se pudo completar la operación. Inténtalo más tarde.',true);
    } finally {busy=false;submit.disabled=false;google.disabled=!config.googleEnabled;window.VigilanteCaptcha?.reset();}
  });
  $('auth-resend').addEventListener('click',async()=>{
    if(!email.reportValidity()||busy)return;
    await ready;if(!client||busy)return;
    busy=true;$('auth-resend').disabled=true;
    try{
      const result=await client.auth.resend({type:'signup',email:email.value.trim(),options:{emailRedirectTo:config.redirectTo,captchaToken:captchaToken()}});
      if(result.error)throw result.error;
      message('Si hay una verificación pendiente, recibirás un nuevo correo.');
    }catch(error){message(error.code==='captcha_required'?'Completa la comprobación de seguridad antes de reenviar el correo.':'No se pudo reenviar el correo. Espera un minuto e inténtalo de nuevo.',true);}
    finally{busy=false;$('auth-resend').disabled=false;window.VigilanteCaptcha?.reset();}
  });
  google.disabled=!config.googleEnabled;
  $('auth-google-note').hidden=Boolean(config.googleEnabled);
  google.addEventListener('click',async()=>{
    await ready;if(!client || !config.googleEnabled || busy)return;
    busy=true;google.disabled=true;
    // Keep any choice already ticked, to show it again in the last step after Google.
    if(mode==='signup')writePending(window.VigilanteAuthUI?.read('signup'));
    try{
      const result=await client.auth.signInWithOAuth({provider:'google',options:{redirectTo:config.redirectTo}});
      if(result.error)throw result.error;
    }catch(_){message('No se pudo conectar con Google. Inténtalo de nuevo.',true);}
    finally{busy=false;google.disabled=!config.googleEnabled;}
  });
  $('account-signout')?.addEventListener('click',async()=>{
    if(!client)return;
    try{
      const result=await client.auth.signOut({scope:'local'});
      if(result.error)throw result.error;
      invalidate();accepted=false;recovery=false;pending=null;render(null);notice('Has cerrado la sesión.');
    }catch(_){notice('No se pudo cerrar la sesión. Inténtalo de nuevo.');}
  });
  render(null);
  ready=(async()=>{
    try{
      const sdk=await import('./vendor/supabase.js');
      // Persist across visits and refresh short-lived access tokens. Never sign out on tab close.
      client=sdk.createClient(config.url,config.publishableKey,{global:{fetch:authFetch},auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
      window.VigilanteMarketing?.init(client, verifiedUser);
      window.VigilanteCommunity?.init(client, verifiedUser);
      client.auth.onAuthStateChange((event,session)=>{
        invalidate();
        if(event==='PASSWORD_RECOVERY'){accepted=false;recovery=true;setTimeout(()=>open('recovery'),0);return;}
        if(event==='SIGNED_OUT'||!session){accepted=false;recovery=false;pending=null;render(null);return;}
        // Return before any async Auth operation, to avoid the SDK's internal lock.
        if(event==='SIGNED_IN') setTimeout(async()=>{
          if(busy)return;
          await verifiedUser();
          await afterSignIn();
        },0);
      });
    }catch(_){client=null;notice('El acceso a cuentas no está disponible ahora mismo. Puedes seguir calculando tu nómina.');}
  })();
  document.addEventListener('visibilitychange',()=>{if(document.hidden)verifiedAt=0;});
  ready.then(async()=>{
    await verifiedUser();
    if(location.hash.includes('error=')){open('signin');message('El enlace ha caducado o no es válido. Solicita uno nuevo.',true);history.replaceState(null,'',location.pathname);}
    else if(location.hash==='#registro' && !user){history.replaceState(null,'',location.pathname);open('signup');}
    else await afterSignIn();
  });
})();
