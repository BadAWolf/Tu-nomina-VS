const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const {JSDOM}=require('jsdom');
const fixtures=require('./calculation-fixtures.json');
for(const item of fixtures)test('2026 payroll reference: '+item.name,()=>{
 const dom=new JSDOM(fs.readFileSync(path.join(__dirname,'../index.html'),'utf8'),{url:'http://localhost:4173/',runScripts:'outside-only'});const w=dom.window,d=w.document;
 try{w.matchMedia=()=>({matches:false,addEventListener(){}});w.alert=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};
 require('./load-calculator.cjs')(w);
 if(item.click)d.getElementById(item.click).click();for(const [id,value]of Object.entries(item.fields)){d.getElementById(id).value=value;d.getElementById(id).dispatchEvent(new w.Event('change'));}
 w[item.fn+(item.fn!=='calcNomina'?'Registrado':'')]();assert.deepEqual(Object.fromEntries(item.outputs.map(id=>[id,d.getElementById(id).textContent])),item.expected);
 }finally{w.close();}
});
