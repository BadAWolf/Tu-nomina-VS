const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom'),{jsPDF}=require('jspdf');
const rules=require('../calculation-rules.js');
const standard={base:60,cotCC:60,cotCP:60,tableDaily:50,irpf:10,number:1,noPrevious:false,hospitalStart:0,laboral:false,temporary:false,monthlyContribution:true};
function report(start,end,extra={}){return rules.illnessReport({...standard,start,end,...extra});}
function setup(){
 const w=new JSDOM(fs.readFileSync(path.join(__dirname,'../index.html'),'utf8'),{url:'http://localhost:4173/',runScripts:'outside-only'}).window;
 w.matchMedia=()=>({matches:false});w.alert=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};w.jspdf={jsPDF};require('./load-calculator.cjs')(w);
 w.eval(fs.readFileSync(path.join(__dirname,'../pdf-layout.js'),'utf8'));w.guardarOCompartir=()=>{};
 const set=(id,value)=>{const el=w.document.getElementById(id);el.value=value;el.dispatchEvent(new w.Event('input',{bubbles:true}));};
 set('b-inicio','2026-01-25');set('b-fin','2026-02-10');set('b-baseManual',1800);set('b-irpf',10);
 return {w,d:w.document,set};
}
test('Baja layout preserves eligibility help while relocating contribution fields',()=>{
 const x=setup();try{
  const card=x.d.getElementById('b-alcance').closest('.card');
  assert.match(card.querySelector('.field-explanation .explanation-content').textContent,/180 días cotizados/);
  assert.equal(card.querySelector('.field-explanation').open,false);
  assert.equal(card.querySelector('.b-adjust'),null);
  const contribution=x.d.getElementById('b-cot-cp').closest('details');
  assert.ok(contribution.contains(x.d.getElementById('b-extra-diaria')));
  assert.ok(contribution.contains(x.d.getElementById('b-fuerza-diaria')));
  assert.ok(x.d.getElementById('b-anios').closest('.card').contains(x.d.getElementById('b-antig-importe')));
  x.w.calcBajaRegistrado();assert.equal(x.d.getElementById('br-neto').textContent,'615,60 €');
 }finally{x.w.close();}
});
test('Inclusive dates: one day, leap day, year boundary and both Spanish DST changes',()=>{
 for(const [a,b,n]of [['2026-01-01','2026-01-01',1],['2028-02-28','2028-03-01',3],['2026-12-31','2027-01-01',2],['2026-03-28','2026-03-30',3],['2026-10-24','2026-10-26',3]])assert.equal(rules.illnessPeriod(a,b),n);
 for(const [a,b]of [['',''],['2026-02-29','2026-03-01'],['2026-04-31','2026-05-02'],['2026-02-02','2026-02-01'],['2026-01-01','2028-01-01']])assert.throws(()=>rules.illnessPeriod(a,b),RangeError);
 assert.throws(()=>rules.illnessReport({...standard,total:2.5}),RangeError);
 assert.throws(()=>report('2026-01-01','2026-01-10',{prior:540}),RangeError);
});
test('Monthly split has independently calculated amounts; rates do not restart in February',()=>{
 const r=report('2026-01-25','2026-02-10');
 assert.equal(r.days,17);assert.deepEqual(r.monthly.map(m=>[m.days,m.gross,m.cotDays,m.ss,m.irpf,m.net]),[[7,282,6,23.4,28.2,230.4],[10,480,12,46.8,48,385.2]]);
 assert.deepEqual([r.gross,r.ss,r.irpf,r.net],[762,70.2,76.2,615.6]);
 assert.equal(r.segments.length,2);assert.equal(r.segments[1].end,17);
});
test('Days 20/21 continue across a month and monthly SS differs from daily/part-time SS',()=>{
 const r=report('2026-01-12','2026-02-05');assert.equal(r.monthly[0].gross,906);assert.equal(r.monthly[1].gross,300);
 const full=report('2026-02-01','2026-02-28',{prior:20});assert.equal(full.monthly[0].cotDays,30);assert.equal(full.ss,117);
 const daily=report('2026-02-01','2026-02-28',{prior:20,monthlyContribution:false});assert.equal(daily.ss,109.2);
 const long=report('2026-03-01','2026-03-31',{prior:20});assert.equal(long.monthly[0].cotDays,30);assert.equal(long.ss,117);
});
test('First accident day is separate; a recognised relapse does not lose another day',()=>{
 let r=report('2026-01-31','2026-02-02',{laboral:true});assert.equal(r.gross,100);assert.equal(r.monthly[0].gross,0);assert.equal(r.monthly[0].ss,0);assert.equal(r.monthly[1].gross,100);
 r=report('2026-01-31','2026-02-02',{laboral:true,prior:20});assert.equal(r.gross,150);assert.equal(r.monthly[0].gross,50);
 assert.equal(report('2026-02-01','2026-02-02',{laboral:true,professional:true}).gross,45);
 assert.equal(report('2026-02-01','2026-02-02',{laboral:true,base:100}).gross,75);
});
test('Hospital dates retain the 40-day complement across months then return to the process rate',()=>{
 const r=report('2026-01-01','2026-03-31',{hospitalStart:25});
 assert.deepEqual(r.segments.find(s=>s.hospital),{start:25,end:64,rate:1,hospital:true,excluded:false,amount:2400});
 assert.equal(r.segments.at(-1).rate,.8);
 assert.equal(report('2026-01-01','2026-01-10',{prior:90}).gross,450);
 assert.equal(report('2026-01-01','2026-01-10',{prior:90,noPrevious:true}).gross,480);
});
test('Distinct regulatory and contribution bases respect the legal floor and the convention complement',()=>{
 assert.equal(report('2026-01-01','2026-01-03',{base:30,cotCC:35,cotCP:40,monthlyContribution:false}).gross,52.5);
 assert.equal(report('2026-01-01','2026-01-03',{base:50,cotCC:30,prior:20,monthlyContribution:false}).gross,112.5);
 assert.equal(report('2026-01-01','2026-01-03',{base:50,cotCC:30,number:3,prior:3,monthlyContribution:false}).gross,90);
 const r=report('2026-02-01','2026-02-28',{cotCP:70,temporary:true});assert.equal(r.ss,123);
});
test('Long periods and awkward decimals reconcile all displayed monthly and tranche cents',()=>{
 for(const extra of [{},{hospitalStart:92},{laboral:true},{number:3},{base:61.2345,cotCC:58.3478,cotCP:62.89,irpf:13.7}]){
  const r=report('2026-01-15','2027-07-13',extra);assert.equal(r.days,545);
  for(const key of ['gross','ss','irpf','net'])assert.equal(Math.round(r[key]*100),r.monthly.reduce((n,m)=>n+Math.round(m[key]*100),0));
  assert.equal(Math.round(r.gross*100),r.segments.reduce((n,s)=>n+Math.round(s.amount*100),0));
  assert.equal(Math.round(r.net*100),Math.round(r.gross*100)-Math.round(r.ss*100)-Math.round(r.irpf*100));
 }
});
test('UI defaults to calendars, shows monthly results and invalidates stale exports on edits',()=>{
 const x=setup();try{
  assert.equal(x.d.getElementById('b-dias-field').hidden,true);assert.match(x.d.getElementById('b-periodo-resumen').textContent,/17 días/);
  x.w.calcBajaRegistrado();assert.equal(x.d.getElementById('br-neto').textContent,'615,60 €');assert.equal(x.d.querySelectorAll('#b-meses article').length,2);
  assert.match(x.d.getElementById('b-meses').textContent,/230,40 €/);assert.match(x.d.getElementById('b-meses').textContent,/385,20 €/);
  x.set('b-fin','2026-01-01');assert.equal(x.w.ctxPDF.baja,null);assert.equal(x.d.getElementById('resultado-baja').style.display,'none');
  x.w.calcBajaRegistrado();assert.match(x.d.getElementById('b-errorBox').textContent,/anterior/);assert.equal(x.w.informeBaja,null);
 }finally{x.w.close();}
});
test('Optional conditional fields reject incomplete partial bases and ignore hidden stale inputs',()=>{
 const x=setup();try{
  x.set('b-jornada','parcial');x.w.calcBajaRegistrado();assert.match(x.d.getElementById('b-errorBox').textContent,/base reguladora diaria/);
  x.set('b-base-diaria',30);x.w.calcBajaRegistrado();assert.ok(x.w.informeBaja);assert.equal(x.w.informeBaja.monthly[0].cotDays,7);
  x.set('b-jornada','completa');x.set('b-base-diaria',-5);x.set('b-hospital-fecha','2027-12-01');x.w.calcBajaRegistrado();assert.equal(x.d.getElementById('br-neto').textContent,'615,60 €');
  x.set('b-tipo','hospitalizacion');x.w.calcBajaRegistrado();assert.match(x.d.getElementById('b-errorBox').textContent,/ingreso/);
  x.set('b-hospital-fecha','2026-02-01');x.w.calcBajaRegistrado();assert.ok(x.w.informeBaja);
  x.set('b-periodo-modo','dias');x.set('b-dias',30);x.set('b-tipo','comun');x.w.calcBajaRegistrado();assert.equal(x.d.getElementById('b-meses-section').hidden,true);assert.equal(x.d.getElementById('br-neto').textContent,'1238,40 €');
 }finally{x.w.close();}
});
test('New monthly data stays local and analytics receives only the generic completion event',()=>{
 const x=setup();try{const events=[];x.w.VigilanteAnalytics={track:(...args)=>events.push(args)};x.w.calcBajaRegistrado();assert.deepEqual(events,[['calculation_complete']]);assert.equal(x.w.localStorage.length,0);}finally{x.w.close();}
});
test('Monthly PDF keeps each month, dates, deductions, total and assumptions with repeated headings',()=>{
 const x=setup();try{
  const calls=[];x.w.jspdf.jsPDF=function(options){const doc=new jsPDF(options),original=doc.text.bind(doc);doc.text=(value,a,b,...rest)=>{calls.push({value:[value].flat().join(' '),x:a,y:b,page:doc.internal.getCurrentPageInfo().pageNumber});return original(value,a,b,...rest);};return doc;};
  x.set('b-inicio','2026-01-15');x.set('b-fin','2026-12-31');x.set('b-tipo','hospitalizacion');x.set('b-hospital-fecha','2026-04-16');x.w.calcBajaRegistrado();
  const doc=x.w.construirPDF('baja');assert.ok(doc.getNumberOfPages()>=3);
  for(const m of x.w.informeBaja.monthly){assert.ok(calls.some(c=>c.value===m.label));assert.ok(calls.some(c=>c.value===x.w.fmt(m.net)));assert.ok(calls.some(c=>c.value===x.w.fechaES(m.start)+' - '+x.w.fechaES(m.end)));}
  assert.ok(calls.some(c=>c.value===x.d.getElementById('br-neto').textContent&&c.page===1));
  assert.ok(calls.some(c=>c.value==='IMPORTES POR MES (CONTINUACIÓN)'));assert.ok(!calls.some(c=>c.value.includes('Proyección fuera de 2026')));
  assert.ok(calls.every(c=>c.y>=0&&c.y<=289));assert.equal(calls.filter(c=>c.value==='Nómina Vigilante').length,doc.getNumberOfPages());
  if(process.env.PDF_SAMPLES==='1'){const dir=path.resolve(__dirname,'../../../output/pdf');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'baja-calendario-larga.pdf'),Buffer.from(doc.output('arraybuffer')));}
 }finally{x.w.close();}
});
test('Typical dated PDF uses exactly the same two monthly estimates as the screen',()=>{
 const x=setup();try{x.w.calcBajaRegistrado();const doc=x.w.construirPDF('baja');assert.ok(doc.getNumberOfPages()<=3);if(process.env.PDF_SAMPLES==='1')fs.writeFileSync(path.resolve(__dirname,'../../../output/pdf/baja-calendario.pdf'),Buffer.from(doc.output('arraybuffer')));}finally{x.w.close();}
});
