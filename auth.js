/* Static-site account UI. Public calculation code is not a server authorization boundary. */
(function () {
  'use strict';
  const config = window.VIGILANTE_AUTH_CONFIG;
  const $ = id => document.getElementById(id);
  const dialog = $('auth-dialog'), form = $('auth-form'), status = $('auth-status');
  const email = $('auth-email'), password = $('auth-password'), confirm = $('auth-confirm');
  const terms = $('auth-terms'), submit = $('auth-submit'), google = $('auth-google');
  const accountSection = $('account-section'), sectorResources = $('sector-resources');
  const legalVersion = '2026-09-15';
  let client = null, user = null, accepted = false, pending = null;
  let mode = 'signup', recovery = false, revision = 0, ready, busy = false;
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
  const titles = {signup:'Crea tu cuenta gratis',signin:'Te damos la bienvenida',reset:'Recupera tu contraseña',recovery:'Elige una contraseña nueva',consent:'Antes de continuar'};
  const buttons = {signup:'Crear cuenta gratis',signin:'Iniciar sesión',reset:'Enviar enlace de recuperación',recovery:'Guardar contraseña',consent:'Aceptar y continuar'};
  function message(text, error) { status.textContent = text; status.dataset.error = String(Boolean(error)); }
  function captchaToken(){
    if(!config.captcha?.enabled)return undefined;
    if(!window.VigilanteCaptcha)throw Object.assign(new Error('captcha_required'),{code:'captcha_required'});
    return window.VigilanteCaptcha.take();
  }
  function render(nextUser) {
    user = nextUser && nextUser.email_confirmed_at && !nextUser.is_anonymous ? nextUser : null;
    const member = Boolean(user && accepted && !recovery);
    $('account-guest').hidden = member;
    $('account-member').hidden = !user;
    accountSection.setAttribute('aria-labelledby', member ? 'account-title' : 'account-heading');
    // Move the shared card in the DOM so visual and keyboard order stay aligned.
    // Keep the original guest order, including immediately after signing out.
    if (user) {
      if (sectorResources.nextElementSibling !== accountSection) accountSection.before(sectorResources);
    } else if (accountSection.nextElementSibling !== sectorResources) accountSection.after(sectorResources);
    $('account-title').textContent = member ? 'Tu cuenta está activa' : 'Has iniciado sesión';
    $('account-benefits').textContent = member ? 'Ya puedes añadir vacaciones, descargar tus PDF y calcular la baja y el finiquito.'
      : recovery ? 'Completa el cambio de contraseña para continuar.' : 'Revisa y acepta las condiciones para activar las herramientas. También puedes cerrar la sesión.';
    $('account-email').textContent = user ? user.email : '';
    window.VigilanteMarketing?.setUser(recovery ? null : user, member);
    window.actualizarAccesoVacaciones?.(member);
    ['Nomina','Finiquito','Baja'].forEach(kind => {
      $('btnPdf'+kind).textContent = member ? 'Compartir / Descargar PDF' : 'Regístrate para descargar el PDF';
    });
    if (!member) $('tab-nomina').click();
  }
  function open(nextMode) {
    if (busy) return;
    mode = recovery ? 'recovery' : nextMode || 'signup';
    $('auth-title').textContent = titles[mode];
    $('auth-intro').textContent = mode === 'reset' ? 'Te enviaremos un enlace para elegir una nueva contraseña.'
      : mode === 'recovery' ? 'Usa al menos 12 caracteres y una contraseña que no utilices en otras webs.'
      : mode === 'consent' ? 'Lee las condiciones y la información sobre tus datos para activar las funciones de tu cuenta.'
      : 'Añade vacaciones y accede a los PDF, la baja y el finiquito. Puedes seguir calculando tu nómina sin vacaciones de forma gratuita y sin cuenta.';
    const showEmail = ['signup','signin','reset'].includes(mode);
    const showPassword = ['signup','signin','recovery'].includes(mode);
    const showConfirm = ['signup','recovery'].includes(mode);
    $('auth-email-field').hidden = !showEmail; email.disabled = !showEmail;
    $('auth-password-field').hidden = !showPassword; password.disabled = !showPassword;
    password.minLength = mode === 'signin' ? 1 : 12;
    password.autocomplete = mode === 'signin' ? 'current-password' : 'new-password';
    $('auth-password-hint').hidden = mode === 'signin';
    $('auth-confirm-field').hidden = !showConfirm; confirm.disabled = !showConfirm;
    $('auth-terms-field').hidden = !['signup','consent'].includes(mode);
    terms.disabled = !['signup','consent'].includes(mode); terms.checked = false;
    if(mode === 'signup') window.VigilanteAnalytics?.track('sign_up_start');
    $('auth-provider-options').hidden = !['signup','signin'].includes(mode);
    $('auth-switches').hidden = !['signup','signin','reset'].includes(mode);
    $('auth-resend').hidden = mode !== 'signin';
    submit.textContent = buttons[mode];
    password.value = ''; confirm.value = ''; confirm.setCustomValidity('');
    message('');
    if (!dialog.open) dialog.showModal();
    window.VigilanteCaptcha?.show(mode);
    (showEmail ? email : showPassword ? password : terms).focus();
  }
  function accountNotice(text) { $('account-notice').textContent = text; }
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
  function finish() {
    const action = pending; pending = null;
    if(dialog.open) dialog.close();
    accountNotice('Tu cuenta está lista. Ya tienes acceso a todas las herramientas.');
    if(action) action();
  }
  async function recordAcceptance() {
    if(!user || !terms.checked) throw new Error('acceptance');
    const previous = await client.from('legal_acceptances').select('version').eq('user_id',user.id).limit(1);
    if(previous.error) throw previous.error;
    const result = await client.from('legal_acceptances').insert({user_id:user.id,version:legalVersion});
    if(result.error && result.error.code!=='23505') throw result.error;
    const newlyActivated = !result.error && !previous.data?.length;
    await verifiedUser(true);
    if(!accepted) throw new Error('acceptance');
    if(newlyActivated) window.VigilanteAnalytics?.track('sign_up', {method: user.app_metadata?.provider === 'google' ? 'Google' : 'Email'});
  }
  window.VigilanteAuth = {require: async function(action){
    await verifiedUser();
    if(user && accepted && !recovery) return action();
    pending = action;
    open(recovery ? 'recovery' : user ? 'consent' : 'signup');
  }};
  document.querySelectorAll('[data-auth-open]').forEach(button=>button.addEventListener('click',()=>open(button.dataset.authOpen)));
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
        await recordAcceptance();
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
        if(accepted) finish(); else open('consent');
        accountNotice('Contraseña actualizada.');return;
      }
      if(currentMode==='signup'){
        const result=await client.auth.signUp({email:email.value.trim(),password:password.value,options:{emailRedirectTo:config.redirectTo,captchaToken:verification}});
        if(result.error) throw result.error;
        password.value='';confirm.value='';
        if(result.data.session){await verifiedUser(true);await recordAcceptance();finish();}
        else message('Revisa tu correo para confirmar el registro. Si ya tenías cuenta, inicia sesión o recupera tu contraseña.');
        return;
      }
      const result=await client.auth.signInWithPassword({email:email.value.trim(),password:password.value,options:{captchaToken:verification}});
      if(result.error) throw result.error;
      password.value=''; await verifiedUser(true);
      if(!user) throw new Error('verification');
      window.VigilanteAnalytics?.track('login',{method:'Email'});
      busy=false;
      if(accepted) finish(); else open('consent');
    } catch(error){
      message(error.code==='captcha_required' ? 'Completa la comprobación de seguridad antes de continuar.'
        : error.code==='captcha_failed' ? 'La comprobación de seguridad no es válida. Reinténtalo.'
        : error.status===429 ? 'Demasiados intentos. Espera un minuto y vuelve a intentarlo.'
        : error.code==='email_not_confirmed' ? 'Confirma primero tu correo. Puedes solicitar otro mensaje de verificación.'
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
    try{
      const result=await client.auth.signInWithOAuth({provider:'google',options:{redirectTo:config.redirectTo}});
      if(result.error)throw result.error;
    }catch(_){message('No se pudo conectar con Google. Inténtalo de nuevo.',true);}
    finally{busy=false;google.disabled=!config.googleEnabled;}
  });
  $('account-signout').addEventListener('click',async()=>{
    if(!client)return;
    try{
      const result=await client.auth.signOut({scope:'local'});
      if(result.error)throw result.error;
      invalidate();accepted=false;recovery=false;pending=null;render(null);accountNotice('Has cerrado la sesión.');
    }catch(_){accountNotice('No se pudo cerrar la sesión. Inténtalo de nuevo.');}
  });
  render(null);
  ready=(async()=>{
    try{
      const sdk=await import('./vendor/supabase.js');
      // Persist across visits and refresh short-lived access tokens. Never sign out on tab close.
      client=sdk.createClient(config.url,config.publishableKey,{global:{fetch:authFetch},auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
      window.VigilanteMarketing?.init(client, verifiedUser);
      client.auth.onAuthStateChange((event,session)=>{
        invalidate();
        if(event==='PASSWORD_RECOVERY'){accepted=false;recovery=true;setTimeout(()=>open('recovery'),0);return;}
        if(event==='SIGNED_OUT'||!session){accepted=false;recovery=false;pending=null;render(null);return;}
        // Return before any async Auth operation, to avoid the SDK's internal lock.
        if(event==='SIGNED_IN') setTimeout(async()=>{
          if(busy)return;
          await verifiedUser();
          if(recovery || !user)return;
          if(!accepted && !dialog.open)open('consent');
        },0);
      });
    }catch(_){client=null;accountNotice('El acceso a cuentas no está disponible. Puedes seguir calculando tu nómina.');}
  })();
  document.addEventListener('visibilitychange',()=>{if(document.hidden)verifiedAt=0;});
  ready.then(async()=>{
    await verifiedUser();
    if(location.hash.includes('error=')){open('signin');message('El enlace ha caducado o no es válido. Solicita uno nuevo.',true);history.replaceState(null,'',location.pathname);}
    else if(user && !accepted && !recovery && !dialog.open) open('consent');
  });
})();
