const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom'),{jsPDF}=require('jspdf');
function setup(){
 const w=new JSDOM(fs.readFileSync(path.join(__dirname,'../index.html'),'utf8'),{url:'http://localhost:4179',runScripts:'outside-only'}).window;
 w.matchMedia=()=>({matches:false});w.alert=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};w.jspdf={jsPDF};
 require('./load-calculator.cjs')(w);w.eval(fs.readFileSync(path.join(__dirname,'../pdf-layout.js'),'utf8'));w.guardarOCompartir=()=>{};
 const d=w.document,set=(id,value)=>{d.getElementById(id).value=value;d.getElementById(id).dispatchEvent(new w.Event('input',{bubbles:true}));};
 const money=id=>Number(d.getElementById(id).textContent.replace(/[^0-9,\-]/g,'').replace(',','.'));
 return {w,d,set,money};
}
const run=(name,fn)=>test(name,()=>{const x=setup();try{fn(x);}finally{x.w.close();}});
run('Ordinary finiquito needs no paid amounts or optional corrections',x=>{
 assert.equal(x.d.getElementById('f-casos-especiales').open,false);
 for(const id of ['f-pagado-julio','f-pagado-dic','f-pagado-mar','f-variable-anual','b-origen'])assert.equal(x.d.getElementById(id),null);
 x.set('f-inicio','2026-01-01');x.set('f-fin','2026-12-31');x.w.calcFiniquitoRegistrado();
 assert.ok(x.w.ctxPDF.finiquito);assert.equal(x.d.getElementById('f-casos-especiales').open,false);
 assert.equal(x.d.getElementById('frow-navidad').style.display,'none');
 // Extra salary 1161.28 + danger 24.08 = 1185.36. July's next cycle:
 // July–December = 184/365; March 2027: full 2026.
 assert.equal(x.money('fr-julio'),597.55);assert.equal(x.money('fr-marzo'),1185.36);assert.equal(x.money('fr-total-neto'),1782.91);
 x.set('f-tipodespido','sustitucion');x.w.calcFiniquitoRegistrado();
 assert.match(x.w.ctxPDF.finiquito['Motivo de la extinción'],/sustitución o formativo/);
 assert.equal(x.d.getElementById('frow-indem').style.display,'none');
});
run('On-time payments across all three contractual deadlines and new Christmas starters',x=>{
 const start=new Date('2025-01-01');
 const cases=[
  ['2026-03-14','marzo',1+73/365],['2026-03-15','marzo',74/365],['2026-03-16','marzo',75/365],
  ['2026-06-30','julio',1],['2026-07-14','julio',1+14/365],['2026-07-15','julio',15/365],['2026-07-16','julio',16/365],
  ['2026-12-14','navidad',348/365],['2026-12-15','navidad',0],['2026-12-31','navidad',0]
 ];
 for(const [end,pay,expected]of cases)assert.ok(Math.abs(x.w.propPaga(start,new Date(end),pay)-expected)<1e-12,end+' '+pay);
 assert.equal(x.w.propPaga(new Date('2026-12-16'),new Date('2026-12-31'),'navidad'),16/365);
 assert.equal(x.w.propPaga(new Date('2026-12-31'),new Date('2026-12-31'),'navidad'),1/365);
 assert.equal(x.w.propPaga(new Date('2026-12-15'),new Date('2026-12-15'),'navidad'),0);
});
run('Prorated extras stay excluded; exceptional pending balances are never subtracted twice',x=>{
 x.set('f-inicio','2026-01-01');x.set('f-fin','2026-12-31');
 for(const p of ['julio','dic','mar'])x.d.getElementById('fpaga-'+p).click();
 x.w.calcFiniquitoRegistrado();assert.equal(x.money('fr-total-neto'),0);
 x.set('f-extra-dic',100);x.w.calcFiniquitoRegistrado();assert.equal(x.money('fr-navidad'),100);assert.equal(x.money('fr-total-neto'),100);
 assert.match(x.d.getElementById('flbl-navidad').textContent,/pendiente indicada/);
});
run('Exceptional antigüedad remains available and a missing historical amount opens its section',x=>{
 x.set('f-inicio','1990-01-01');x.set('f-fin','2026-09-30');x.w.calcFiniquitoRegistrado();
 assert.equal(x.w.ctxPDF.finiquito,null);assert.equal(x.d.getElementById('f-casos-especiales').open,true);
 x.set('f-antig-importe',400);x.w.calcFiniquitoRegistrado();assert.ok(x.w.ctxPDF.finiquito);
 x.set('f-antig-importe',-1);x.d.getElementById('f-casos-especiales').open=false;x.w.calcFiniquitoRegistrado();
 assert.equal(x.w.ctxPDF.finiquito,null);assert.equal(x.d.getElementById('f-casos-especiales').open,true);
});
run('IT requires a real base, keeps the net unchanged and cannot fall back to category tables',x=>{
 x.set('b-inicio','2026-01-25');x.set('b-fin','2026-02-10');x.set('b-irpf',10);
 x.w.calcBajaRegistrado();assert.equal(x.w.informeBaja,null);
 x.set('b-baseManual',1800);x.w.calcBajaRegistrado();assert.equal(x.money('br-neto'),615.60);
 assert.equal(x.d.getElementById('b-cot-cp').closest('details').open,false);
 x.set('b-baseManual','');x.w.calcBajaRegistrado();assert.equal(x.w.ctxPDF.baja,null);assert.equal(x.w.informeBaja,null);
 x.set('b-jornada','parcial');x.set('b-base-diaria',30);x.w.calcBajaRegistrado();assert.ok(x.w.informeBaja);
});
run('PDF preserves on-time payment assumptions and labels unknown deductions instead of promising a net',x=>{
 x.set('f-inicio','2026-01-01');x.set('f-fin','2026-12-20');x.set('f-vacas',5);x.set('f-irpf',10);x.w.calcFiniquitoRegistrado();
 assert.match(x.d.getElementById('f-total-label').textContent,/PENDIENTE/);
 assert.equal(x.d.getElementById('frow-navidad').style.display,'none');
 const calls=[];x.w.jspdf.jsPDF=function(options){const doc=new jsPDF(options),original=doc.text.bind(doc);doc.text=(text,...args)=>{calls.push([text].flat().join(' '));return original(text,...args);};return doc;};
 const doc=x.w.construirPDF('finiquito');
 assert.ok(calls.some(t=>t.includes('día 15')));assert.ok(calls.some(t=>t.includes('IMPORTE PENDIENTE DE DEDUCCIONES')));
 assert.ok(calls.join(' ').includes('Navidad se considera cobrada'));
 if(process.env.PDF_SAMPLES==='1'){
  const dir=path.resolve(__dirname,'../../../output/pdf');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'finiquito-simplificado.pdf'),Buffer.from(doc.output('arraybuffer')));
 }
});
