const {test}=require('node:test'),assert=require('node:assert/strict');
const {JSDOM}=require('jsdom'),fs=require('node:fs'),path=require('node:path');
const rules=require('../calculation-rules.js');
process.env.TZ='Europe/Madrid';
function setup(){
 const dom=new JSDOM(fs.readFileSync(path.join(__dirname,'../index.html'),'utf8'),{url:'http://localhost:4173/',runScripts:'outside-only'}),w=dom.window,d=w.document;
 w.matchMedia=()=>({matches:false});w.alert=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};
 require('./load-calculator.cjs')(w);
 return {w,d,set:(id,value)=>{d.getElementById(id).value=value;},close:()=>w.close()};
}
test('2026 illness boundaries: third process, day 90/91, and conditional extension',()=>{
 const expected=[[1,.5],[3,.5],[4,.8],[20,.8],[21,1],[40,1],[41,.9],[60,.9],[61,.8],[90,.8],[91,.75],[100,.75],[101,.75]];
 for(const [day,pct]of expected)assert.equal(rules.illnessRate(day,1,false),pct);
 assert.equal(rules.illnessRate(3,2,false),0);assert.equal(rules.illnessRate(20,3,false),.6);
 assert.equal(rules.illnessRate(21,3,false),1);assert.equal(rules.illnessRate(100,1,true),.8);assert.equal(rules.illnessRate(101,1,true),.75);
});
test('Hospital complement begins at admission, lasts at most 40 days and retains every tranche',()=>{
 const s=rules.illnessSegments(150,1,false,92);
 assert.equal(s.length,8);assert.deepEqual(s.find(x=>x.hospital),{start:92,end:131,rate:1,hospital:true});
 assert.equal(s.reduce((n,x)=>n+x.end-x.start+1,0),150);
 assert.equal(s.at(-1).rate,.75);
 const x=setup();try{x.set('b-periodo-modo','dias');x.set('b-tipo','hospitalizacion');x.set('b-hospital-dia',92);x.set('b-dias',150);x.set('b-baseManual',1800);x.w.calcBajaRegistrado();
  // 60 euros/day * (1.5+13.6+20+18+24+.75+40+14.25) = 7926.
  assert.equal(x.d.getElementById('br-total-bruto').textContent,'7926,00 €');assert.equal(x.d.getElementById('brow-t7').style.display,'flex');
 }finally{x.close();}
});
test('Inclusive service dates and distinct statutory severance rates with caps',()=>{
 assert.equal(rules.days('2026-01-01','2026-01-01'),1);
 assert.equal(rules.months('2026-01-01','2026-01-31'),1);
 assert.equal(rules.months('2026-01-01','2026-02-01'),2);
 assert.equal(rules.severance('2025-01-01','2025-12-31','temporal',36500),1200);
 assert.equal(rules.severance('2025-01-01','2025-12-31','objetivo',36500),2000);
 assert.equal(rules.severance('2025-01-01','2025-12-31','improcedente',36500),3300);
 assert.equal(rules.severance('1980-01-01','2026-12-31','objetivo',36500),36000);
 assert.equal(rules.severance('1980-01-01','2026-12-31','improcedente',36500),126000);
 assert.equal(rules.severance('2020-01-01','2026-12-31','voluntaria',36500),0);
});
test('Calendar includes only hours within the month and handles Spanish clock changes',()=>{
 const x=setup();try{
  x.w.CUAD['2026-01']={'31':{tramos:[{i:'22:00',f:'06:00'}]}};
  x.w.CUAD['2026-02']={'28':{tramos:[{i:'22:00',f:'06:00'}]}};
  const feb=x.w.totalesMes(2026,1);assert.equal(feb.horasTrabajadas,8);assert.equal(feb.noct,8);assert.equal(feb.diasTrab,2);
  const spring=x.w.tramoAFechas(2026,2,28,{i:'22:00',f:'06:00'});assert.equal((spring.fin-spring.ini)/3600000,7);
  const autumn=x.w.tramoAFechas(2026,9,24,{i:'22:00',f:'06:00'});assert.equal((autumn.fin-autumn.ini)/3600000,9);
 }finally{x.close();}
});
test('Part-time calendar holidays and manual holidays use the same contracted hours',()=>{
 const x=setup();try{
  x.d.getElementById('jorn-parcial').click();x.set('hPactadas',80);
  x.w.CUAD['2026-04']={'5':{tramos:[],vac:true}};x.w.calAnio=2026;x.w.calMes=3;x.w.MODO_HORAS='cuadrante';
  x.w.calcNominaRegistrado();assert.equal(x.w.ctxPDF.nomina['Vacaciones disfrutadas'],'1 día = 2,58 h de jornada');
  const calendarGross=x.d.getElementById('r-bruto').textContent;
  x.w.MODO_HORAS='manual';x.d.getElementById('switchVac').checked=true;x.set('diasVac',1);x.set('hTTotal',0);x.w.calcNominaRegistrado();
  assert.equal(x.d.getElementById('r-bruto').textContent,calendarGross);assert.equal(x.w.resumenDia(2026,3,5).horas,80/31);
  x.set('n-promedioVac',310);x.w.calcNominaRegistrado();assert.equal(x.d.getElementById('r-vacplus').textContent,'+10,00 €');
 }finally{x.close();}
});
test('Reduced assigned hours do not reduce a full monthly salary; explicit paid days do',()=>{
 const x=setup();try{x.set('hTTotal',100);x.w.calcNominaRegistrado();assert.equal(x.d.getElementById('r-bruto').textContent,'1435,45 €');
  x.set('n-diasAlta',15);x.set('hTTotal',81);x.w.calcNominaRegistrado();assert.equal(x.d.getElementById('r-base').textContent,'+580,64 €');
  x.set('n-diasAlta',30);x.set('hTTotal',170);x.w.calcNominaRegistrado();assert.equal(x.d.getElementById('r-extra').textContent,'+79,84 €');
 }finally{x.close();}
});
test('Calendar pays a full month in February, leap years, 30 and 31 day months without asking for paid days',()=>{
 const x=setup();try{
  x.d.dispatchEvent(new x.w.Event('DOMContentLoaded'));
  x.set('n-diasAlta',15);x.d.getElementById('modo-cuadrante').click();
  assert.equal(x.d.getElementById('n-diasAlta').disabled,true);
  assert.equal(x.d.getElementById('n-diasAlta').closest('#campos-manual').style.display,'none');
  for(const [year,month]of [[2026,1],[2028,1],[2026,3],[2026,2]]){
   x.w.calAnio=year;x.w.calMes=month;
   x.w.CUAD[year+'-'+String(month+1).padStart(2,'0')]={'10':{tramos:[{i:'08:00',f:'16:00'}],vac:false,fest:false}};
   x.w.pintarCalendario();x.w.calcNominaRegistrado();
   assert.equal(x.d.getElementById('r-base').textContent,'+1161,28 €');
   assert.equal(x.d.getElementById('r-bruto').textContent,'1435,45 €');
   assert.match(x.w.ctxPDF.nomina['Tipo de jornada'],/Mes completo$/);
  }
  assert.equal(x.d.getElementById('n-diasAlta').value,'15','The manual setting is preserved, not silently overwritten');
  x.d.getElementById('modo-manual').click();assert.equal(x.d.getElementById('n-diasAlta').disabled,false);
  x.set('hTTotal',81);x.w.calcNominaRegistrado();assert.equal(x.d.getElementById('r-base').textContent,'+580,64 €');
 }finally{x.close();}
});

test('A hidden manual paid-days value cannot invalidate a calendar or create spurious overtime',()=>{
 const x=setup();try{
  x.d.dispatchEvent(new x.w.Event('DOMContentLoaded'));
  x.w.CUAD['2026-02']={};for(let day=2;day<=21;day++)x.w.CUAD['2026-02'][day]={tramos:[{i:'08:00',f:'16:00'}],vac:false,fest:false};
  x.d.getElementById('modo-cuadrante').click();x.w.calAnio=2026;x.w.calMes=1;
  for(const value of [1,15,45,'']){
   x.set('n-diasAlta',value);x.w.calcNominaRegistrado();
   assert.equal(x.d.getElementById('errorBox').style.display,'none');
   assert.equal(x.d.getElementById('r-base').textContent,'+1161,28 €');
   assert.equal(x.d.getElementById('row-extra').style.display,'none');
  }
  x.set('n-diasAlta',45);x.d.getElementById('modo-manual').click();x.w.calcNominaRegistrado();
  assert.equal(x.d.getElementById('errorBox').style.display,'block');
  assert.equal(x.w.ctxPDF.nomina,null);
 }finally{x.close();}
});

test('Calendar keeps the contracted part-time ratio and ignores incomplete-month settings from manual mode',()=>{
 const x=setup();try{
  x.d.dispatchEvent(new x.w.Event('DOMContentLoaded'));
  x.d.getElementById('jorn-parcial').click();x.set('hPactadas',80);x.set('hTTotal',8);
  x.w.calcNominaRegistrado();const base=x.d.getElementById('r-base').textContent,net=x.d.getElementById('r-neto').textContent;
  x.set('n-diasAlta',15);x.d.getElementById('modo-cuadrante').click();
  x.w.CUAD['2026-02']={'10':{tramos:[{i:'08:00',f:'16:00'}],vac:false,fest:false}};x.w.calAnio=2026;x.w.calMes=1;
  x.w.calcNominaRegistrado();
  assert.equal(x.d.getElementById('r-base').textContent,base);assert.equal(x.d.getElementById('r-neto').textContent,net);
 }finally{x.close();}
});

test('Team-leader hours are paid once, and activity is included in extra payments',()=>{
 const x=setup();try{
  x.set('hTTotal',200);x.d.getElementById('switchJefe').checked=true;x.w.calcNominaRegistrado();
  assert.equal(x.d.getElementById('r-jefe').textContent,'+143,37 €');
  assert.equal(x.d.getElementById('r-extra').textContent,'+379,24 €');
  x.d.getElementById('btn-fondos').click();x.set('hTTotal',162);x.d.getElementById('switchJefe').checked=false;x.d.getElementById('paga-julio').click();x.w.calcNominaRegistrado();
  assert.equal(x.d.getElementById('r-prorr').textContent,'+134,82 €');
 }finally{x.close();}
});
test('A December payment already received is not counted again; one-day contracts are accepted',()=>{
 const x=setup();try{
  x.set('f-inicio','2026-01-01');x.set('f-fin','2026-12-31');x.set('f-pagado-dic',1185.67);x.w.calcFiniquitoRegistrado();
  assert.equal(x.d.getElementById('frow-navidad').style.display,'none');
  x.set('f-pagado-dic',0);x.set('f-inicio','2026-12-31');x.w.calcFiniquitoRegistrado();assert.ok(x.w.ctxPDF.finiquito);assert.match(x.w.ctxPDF.finiquito['Duración'],/1 días/);
 }finally{x.close();}
});

test('Funds-driver supplements match the 2026 table and update the visible category hints',()=>{
 const x=setup();try{
  x.d.getElementById('btn-fondos').click();x.set('aniosAntiguedad',5);x.set('hTTotal',162);x.set('hNoc',10);
  const driver=x.d.getElementById('switchCond');driver.checked=true;driver.dispatchEvent(new x.w.Event('change'));
  x.w.calcNominaRegistrado();
  assert.equal(x.d.getElementById('badge-noc').textContent,'+1,36 €/h');
  assert.match(x.d.getElementById('hint-antiguedad').textContent,/50,23/);
  assert.equal(x.d.getElementById('r-noc').textContent,'+13,60 €');
  assert.equal(x.d.getElementById('r-bruto').textContent,'1991,84 €');
  driver.checked=false;driver.dispatchEvent(new x.w.Event('change'));
  assert.equal(x.d.getElementById('badge-noc').textContent,'+1,27 €/h');
  assert.match(x.d.getElementById('hint-antiguedad').textContent,/46,59/);
 }finally{x.close();}
});

test('Half-cent monetary ties round consistently despite floating-point representation',()=>{
 const x=setup();try{
  assert.equal(x.w.r2(1.005),1.01);assert.equal(x.w.r2(-1.005),-1.01);
  assert.equal(x.w.r2(1435.45*10/100),143.55);
  x.set('hTTotal',162);x.set('irpf',10);x.w.calcNominaRegistrado();
  assert.equal(x.d.getElementById('r-irpf').textContent,'-143,55 €');
  assert.equal(x.d.getElementById('r-neto').textContent,'1179,33 €');
 }finally{x.close();}
});
