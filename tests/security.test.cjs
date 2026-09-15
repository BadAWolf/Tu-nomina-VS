const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
const root=path.resolve(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
test('Resource cards render markup as text and discard executable URLs',()=>{
 const w=new JSDOM(read('sindicatos-formacion.html'),{url:'http://localhost:4173/',runScripts:'outside-only'}).window;
 try{w.eval(read('sindicatos-formacion-script-0.js'));
 const name='<img src=x onerror="alert(1)">';const fragment=w.document.createElement('div');
 fragment.innerHTML=w.tarjeta({nombre:name,provincia:'Madrid',web:'javascript:alert(1)'},'sindicato');
 assert.equal(fragment.querySelector('img'),null);assert.equal(fragment.querySelector('a'),null);assert.ok(fragment.textContent.includes(name));
 fragment.innerHTML=w.tarjeta({nombre:'Prueba',provincia:'Madrid',web:'https://example.test/'},'sindicato');
 assert.equal(fragment.querySelector('a').href,'https://example.test/');
 }finally{w.close();}
});
function setup(url='http://localhost:4173/'){
 const dom=new JSDOM(read('index.html'),{url,runScripts:'outside-only'}),w=dom.window;
 w.matchMedia=()=>({matches:false,addEventListener(){}});w.alert=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};
 require('./load-calculator.cjs')(w);return w;
}
test('Calendar rejects injected attributes, prototype keys, impossible days and oversized data',()=>{
 const w=setup();try{
 const attack='08:00" autofocus onfocus="alert(1)';
 const raw='{"__proto__":{"polluted":true},"2026-02":{"29":{"tramos":[]},"1":{"tramos":[{"i":'+JSON.stringify(attack)+',"f":"16:00"},{"i":"08:00","f":"16:00"}],"vac":"false"}}}';
 const result=w.VigilanteSecurity.calendar(raw);
 assert.equal(result.rejected,true);assert.equal(Object.getPrototypeOf(result.data),null);
 assert.equal(result.data.__proto__,undefined);assert.equal(result.data['2026-02']['29'],undefined);
 assert.equal(result.data['2026-02']['1'].tramos.length,1);assert.equal(result.data['2026-02']['1'].vac,false);
 const fragment=w.document.createElement('div');fragment.innerHTML=w.filaTramo(attack,'16:00');
 assert.equal(fragment.querySelector('[onfocus]'),null);assert.equal(fragment.querySelector('.t-ini').value,'');
 for(const value of ['{','[]','null','x'.repeat(2*1024*1024+1)])assert.equal(w.VigilanteSecurity.calendar(value).rejected,true);
 }finally{w.close();}
});
test('Calendar preserves valid leap day and overnight shifts, caps excessively large lists',()=>{
 const w=setup();try{
 const raw=JSON.stringify({'2028-02':{'29':{tramos:Array.from({length:30},()=>({i:'22:00',f:'06:00'})),vac:true,fest:true}}});
 const result=w.VigilanteSecurity.calendar(raw);assert.equal(result.rejected,true);
 assert.equal(result.data['2028-02']['29'].tramos.length,24);assert.equal(result.data['2028-02']['29'].fest,true);
 for(const invalid of ['24:00','12:60','2:00','NaN',null])assert.equal(w.VigilanteSecurity.validTime(invalid),false);
 }finally{w.close();}
});
test('Invalid payroll amounts clear the previous result and prevent stale PDF export',()=>{
 const w=setup(),d=w.document;try{
 d.getElementById('hTTotal').value='162';w.calcNomina();assert.ok(w.ctxPDF.nomina);
 for(const value of ['-1','301','1e308']){
 d.getElementById('hTTotal').value=value;w.calcNomina();assert.equal(w.ctxPDF.nomina,null);
 assert.match(d.getElementById('errorBox').textContent,/Revisa/);
 }
 }finally{w.close();}
});
test('Every public HTML page blocks inline scripts and has no executable inline handlers',()=>{
 const files=fs.readdirSync(root).filter(f=>f.endsWith('.html'));assert.equal(files.length,9);
 for(const file of files){const d=new JSDOM(read(file)).window.document;
 const policy=d.querySelector('meta[http-equiv="Content-Security-Policy"]').content;
 assert.match(policy,/script-src-attr 'none'/);assert.match(policy,/object-src 'none'/);
 const scriptPolicy=policy.split(';').find(p=>p.trim().startsWith('script-src '));
 assert.doesNotMatch(scriptPolicy,/unsafe-inline/);
 if(d.querySelector('script[src^="adsense.js"]')){
  assert.match(scriptPolicy,/'strict-dynamic'/);assert.match(scriptPolicy,/'sha256-/);
  if(file==='index.html')assert.match(policy,/default-src 'self'/);
 }else assert.doesNotMatch(scriptPolicy,/unsafe-eval/);
 for(const el of d.querySelectorAll('*'))for(const attr of el.attributes)assert.equal(/^on/i.test(attr.name),false,file+' '+attr.name);
 for(const script of d.querySelectorAll('script:not([src])'))assert.equal(script.type,'application/ld+json',file);
 d.defaultView.close();}
});
test('Invalid consent records and auth callback URLs never load analytics',()=>{
 const savedAt=Date.now();
 for(const [url,pref]of [
 ['/',{version:1,analytics:'true',savedAt}],['/',{version:1,analytics:true,savedAt:savedAt+86400000}],
 ['/',{version:1,analytics:true,savedAt:savedAt-181*86400000}],
 ['/#access_token=test&refresh_token=test',{version:1,analytics:true,savedAt}],
 ['/?code=test',{version:1,analytics:true,savedAt}]
 ]){const w=setup('http://localhost:4173'+url);try{
 w.localStorage.setItem('vigilante_cookie_preferences_v1',JSON.stringify(pref));w.eval(read('cookies.js'));
 w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
 assert.equal(w.document.querySelectorAll('script[src*="googletagmanager"]').length,0);
 }finally{w.close();}}
});
