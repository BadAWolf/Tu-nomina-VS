const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const {calculate}=require('../vacation-pluses.js');
const root=path.join(__dirname,'..');
const hours={mode:'horas',night:64,weekend:32,other:'',nightRate:1.26,weekendRate:1.02,days:15};
function setup(){
  const dom=new JSDOM(fs.readFileSync(path.join(root,'index.html'),'utf8'),{url:'http://localhost:4173/',runScripts:'outside-only'}),w=dom.window,d=w.document;
  w.matchMedia=()=>({matches:false});w.alert=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};
  require('./load-calculator.cjs')(w);w.cargarJsPDF=callback=>callback?.();
  w.VigilanteAuth={require:callback=>callback()};w.actualizarAccesoVacaciones(true);
  const fill=(id,value)=>{d.getElementById(id).value=String(value);d.getElementById(id).dispatchEvent(new w.Event('input',{bubbles:true}));};
  const mode=value=>{d.getElementById('vac-metodo').value=value;d.getElementById('vac-metodo').dispatchEvent(new w.Event('change',{bubbles:true}));};
  d.getElementById('switchVac').click();fill('diasVac',15);fill('hTTotal',80);
  return {w,d,fill,mode,close:()=>w.close()};
}
test('64 night and 32 weekend hours give 113.28 monthly and 54.81 for 15 vacation days',()=>{
  assert.deepEqual(calculate(hours),{mode:'horas',days:15,average:113.28,amount:54.81,provided:true});
  assert.equal(calculate({...hours,days:31}).amount,113.28);
  assert.equal(calculate({...hours,other:62}).amount,84.81);
});
test('Historical amounts include zero months and round only the prorated final amount',()=>{
  const months=Array.from({length:12},()=>({night:0}));months[0]={night:80,weekend:40,other:120};
  assert.equal(calculate({mode:'nominas',months,days:31}).average,20);
  const part={mode:'nominas',months:[{night:0.01},{night:0},{night:0}],days:15};
  assert.equal(calculate(part).amount,0); // Not 0.01 from prematurely rounding the average.
  assert.equal(calculate({mode:'nominas',months:[{night:100},{weekend:50},{other:60}],days:31}).amount,70);
});
test('A partially entered payroll history cannot silently omit months; blanks are distinct from zero',()=>{
  assert.throws(()=>calculate({mode:'nominas',months:[{night:100},{}],days:10}),/Falta el mes 2/);
  assert.equal(calculate({mode:'nominas',months:[{},{}],days:10}).provided,false);
  assert.equal(calculate({mode:'nominas',months:[{night:0},{weekend:0}],days:10}).provided,true);
  assert.throws(()=>calculate({mode:'nominas',months:[],days:1}),/1 y 12/);
  assert.throws(()=>calculate({mode:'nominas',months:Array(13).fill({night:0}),days:1}),/1 y 12/);
});
test('Invalid data fail explicitly; inactive methods and no vacation days contribute nothing',()=>{
  for(const value of [-1,Infinity,'abc',745])assert.throws(()=>calculate({...hours,night:value}),/Revisa/);
  assert.throws(()=>calculate({...hours,days:32}),/días/);
  assert.throws(()=>calculate({...hours,mode:'unknown'}),/Selecciona/);
  assert.equal(calculate({...hours,days:0,night:-1}).amount,0);
  assert.equal(calculate({mode:'importe',average:310,days:1,night:999999}).amount,10);
});
test('Default interface uses hours, follows category rates, and never adds the inactive euro field',()=>{
  const x=setup();try{
    assert.equal(x.d.getElementById('vac-mode-horas').hidden,false);
    assert.equal(x.d.getElementById('n-promedioVac').disabled,true);
    x.fill('n-promedioVac',310);x.fill('vac-horas-noche',64);x.fill('vac-horas-festivo',32);
    x.w.calcNomina();assert.equal(x.d.getElementById('r-vacplus').textContent,'+54,81 €');
    assert.match(x.d.getElementById('vac-preview').textContent,/113,28 €.*54,81 €/);
    assert.match(x.w.ctxPDF.nomina['Pluses de vacaciones'],/Estimación por horas/);
    x.d.getElementById('btn-fondos').click();x.d.getElementById('switchCond').click();
    x.w.calcNomina();assert.equal(x.d.getElementById('r-vacplus').textContent,'+57,91 €');
    assert.match(x.d.getElementById('vac-rate-hint').textContent,/1,36 €/);
    x.mode('importe');x.w.calcNomina();assert.equal(x.d.getElementById('r-vacplus').textContent,'+150,00 €');
    x.mode('horas');x.w.calcNomina();assert.equal(x.d.getElementById('r-vacplus').textContent,'+57,91 €');
  }finally{x.close();}
});
test('Monthly input selects only the declared reference months and missing rows prevent export',()=>{
  const x=setup();try{
    x.mode('nominas');x.fill('vac-meses',2);x.fill('vac-mes-1-night',126);x.fill('vac-mes-1-weekend',102);
    x.w.calcNomina();assert.match(x.d.getElementById('errorBox').textContent,/Falta el mes 2/);assert.equal(x.w.ctxPDF.nomina,null);
    x.fill('vac-mes-2-night',0);x.fill('vac-mes-3-night',10001);
    x.w.calcNomina();assert.equal(x.d.getElementById('r-vacplus').textContent,'+55,16 €');
    assert.equal(x.d.getElementById('vac-mes-3-night').disabled,true);
    assert.match(x.w.ctxPDF.nomina['Pluses de vacaciones'],/Media de 2 nóminas.*114,00 €/);
    x.fill('vac-meses',3);x.w.calcNomina();assert.equal(x.w.ctxPDF.nomina,null,'An invalid amount must be rejected when its month becomes active');
  }finally{x.close();}
});
test('Manual and calendar vacations agree, without double prorating part-time hours',()=>{
  const x=setup();try{
    x.d.getElementById('jorn-parcial').click();x.fill('hPactadas',80);x.fill('hTTotal',0);x.fill('diasVac',1);
    x.fill('vac-horas-noche',64);x.fill('vac-horas-festivo',32);x.w.calcNomina();
    assert.equal(x.d.getElementById('r-vacplus').textContent,'+3,65 €');
    x.w.CUAD['2026-09']={'7':{tramos:[],vac:true}};x.w.calAnio=2026;x.w.calMes=8;
    x.d.getElementById('modo-cuadrante').click();x.w.calcNomina();
    assert.equal(x.d.getElementById('r-vacplus').textContent,'+3,65 €');
    assert.match(x.d.getElementById('vac-preview').textContent,/3,65 €/);
    x.w.actualizarAccesoVacaciones(false);assert.equal(x.d.getElementById('vac-plus-field').hidden,true);assert.equal(x.w.ctxPDF.nomina,null);
  }finally{x.close();}
});
test('Removing vacations ignores stored supplements and invalid hidden fields',()=>{
  const x=setup();try{
    x.fill('vac-horas-noche',64);x.w.calcNomina();assert.match(x.d.getElementById('r-vacplus').textContent,/39,02/);
    x.d.getElementById('switchVac').click();x.fill('vac-horas-noche',-1);x.fill('hTTotal',162);x.w.calcNomina();
    assert.equal(x.d.getElementById('row-vacplus').style.display,'none');
    assert.equal(x.d.getElementById('r-bruto').textContent,'1435,45 €');
    assert.equal(x.w.ctxPDF.nomina['Pluses de vacaciones'],undefined);
  }finally{x.close();}
});
