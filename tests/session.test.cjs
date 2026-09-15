const {test}=require('node:test'),assert=require('node:assert/strict');
const {createClient}=require('@supabase/supabase-js');
const token=exp=>Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:'test-user',aud:'authenticated',exp})).toString('base64url')+'.unit-test-signature';
test('The real SDK restores a saved session, refreshes expired tokens and removes it on local signout',async()=>{
 const saved=new Map(),calls=[],clients=[],key='unit-test-session';
 const storage={getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)};
 const user={id:'test-user',email:'test@example.test',email_confirmed_at:'2026-09-15',aud:'authenticated',role:'authenticated'};
 const fetch=async(url,init)=>{
  calls.push(String(url));
  if(String(url).includes('/logout'))return new Response(null,{status:204});
  if(String(url).includes('/token'))return new Response(JSON.stringify({access_token:token(Math.floor(Date.now()/1000)+3600),refresh_token:'new-unit-test-refresh',token_type:'bearer',expires_in:3600,user}),{status:200,headers:{'content-type':'application/json'}});
  return new Response(JSON.stringify(user),{status:200,headers:{'content-type':'application/json'}});
 };
 const make=()=>{const c=createClient('https://example.supabase.co','unit-test-publishable',{auth:{storage,storageKey:key,persistSession:true,autoRefreshToken:true,detectSessionInUrl:false},global:{fetch}});clients.push(c);return c;};
 try{
  const first=make();const signed=await first.auth.setSession({access_token:token(Math.floor(Date.now()/1000)+3600),refresh_token:'unit-test-refresh'});assert.equal(signed.error,null);await first.auth.stopAutoRefresh();
  assert.ok(saved.has(key));
  const second=make();assert.equal((await second.auth.getSession()).data.session.user.id,user.id);await second.auth.stopAutoRefresh();
  const expired=JSON.parse(saved.get(key));expired.expires_at=Math.floor(Date.now()/1000)-1;expired.access_token=token(expired.expires_at);saved.set(key,JSON.stringify(expired));
  const third=make();const renewed=(await third.auth.getSession()).data.session;assert.ok(renewed.expires_at>Date.now()/1000);assert.ok(calls.some(u=>u.includes('grant_type=refresh_token')));
  assert.equal((await third.auth.signOut({scope:'local'})).error,null);assert.equal(saved.has(key),false);assert.ok(calls.some(u=>u.includes('scope=local')));
  const fourth=make();assert.equal((await fourth.auth.getSession()).data.session,null);
 }finally{for(const c of clients)await c.auth.stopAutoRefresh();}
});
