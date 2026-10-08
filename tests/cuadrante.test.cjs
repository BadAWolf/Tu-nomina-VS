const {test}=require('node:test'),assert=require('node:assert/strict');
process.env.TZ='Europe/Madrid';
const fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
const root=path.resolve(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
const tick=()=>new Promise(resolve=>setTimeout(resolve,20));
// Octubre de 2026: el 3 es sábado, el 7 miércoles y el 12 festivo nacional (lunes).
async function setup(saved){
  const dom=new JSDOM(read('index.html'),{url:'http://localhost:4173/',runScripts:'outside-only'}),w=dom.window;
  w.matchMedia=()=>({matches:false,addEventListener(){}});w.alert=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};
  if(saved)w.localStorage.setItem('cuadrante_vigilante',JSON.stringify(saved));
  require('./load-calculator.cjs')(w);await tick();
  const d=w.document;
  d.getElementById('modo-cuadrante').click();
  w.calAnio=2026;w.calMes=9;w.pintarCalendario();
  return {w,d,fest:()=>d.getElementById('dlg-fest'),plus:()=>w.totalesMes(2026,9).plus,
    cell:day=>d.querySelector(`.cal-cell[data-dia="${day}"]`),
    shift:(day,i='08:00',f='16:00')=>{w.abrirDialogo(day);d.querySelector('.t-ini').value=i;d.querySelector('.t-fin').value=f;d.getElementById('dlg-guardar').click();}};
}
test('Saturdays, Sundays and national holidays open with the holiday switch on; other days off',async()=>{
  const x=await setup();try{
    for(const [day,label]of [[3,'Fin de semana'],[4,'Fin de semana'],[12,'Festivo nacional']]){
      x.w.abrirDialogo(day);
      assert.equal(x.fest().checked,true,String(day));
      assert.equal(x.d.getElementById('dlg-fest-label').textContent,label);
      assert.match(x.d.getElementById('dlg-fest-note').textContent,/Si lo quitas, este día se calcula como uno normal/);
      x.d.getElementById('dlg-cancelar').click();
    }
    x.w.abrirDialogo(7);
    assert.equal(x.fest().checked,false);assert.equal(x.d.getElementById('dlg-fest-label').textContent,'Día festivo');
    for(const day of [3,4,12])assert.ok(x.cell(day).classList.contains('finde'),String(day));
    assert.equal(x.cell(7).classList.contains('finde'),false);
  }finally{x.w.close();}
});
test('Turning off a Saturday counts it as a normal day, and turning it on again restores the plus',async()=>{
  const x=await setup();try{
    x.shift(3);x.shift(7);
    assert.equal(x.plus(),8);
    x.w.abrirDialogo(3);
    assert.match(x.d.getElementById('dlg-nota').textContent,/8 h con plus de fin de semana\/festivo/);
    x.fest().click();
    assert.doesNotMatch(x.d.getElementById('dlg-nota').textContent,/plus de fin de semana/,'the note follows the switch before saving');
    x.d.getElementById('dlg-guardar').click();
    assert.equal(x.w.CUAD['2026-10']['3'].nofest,true);assert.equal(x.w.CUAD['2026-10']['3'].fest,false);
    assert.equal(x.plus(),0);
    assert.equal(x.cell(3).classList.contains('finde'),false,'no longer grey');
    assert.equal(JSON.parse(x.w.localStorage.getItem('cuadrante_vigilante'))['2026-10']['3'].nofest,true);
    x.w.abrirDialogo(3);assert.equal(x.fest().checked,false);
    x.fest().click();x.d.getElementById('dlg-guardar').click();
    assert.equal(x.w.CUAD['2026-10']['3'].nofest,false);assert.equal(x.plus(),8);
    assert.ok(x.cell(3).classList.contains('finde'));
  }finally{x.w.close();}
});
test('A national holiday without shifts can be turned off and is kept; clearing it brings the default back',async()=>{
  const x=await setup();try{
    x.w.abrirDialogo(12);x.fest().click();x.d.getElementById('dlg-guardar').click();
    assert.deepEqual(JSON.parse(JSON.stringify(x.w.CUAD['2026-10']['12'])),{tramos:[],vac:false,fest:false,nofest:true});
    assert.equal(x.cell(12).classList.contains('finde'),false);
    x.w.abrirDialogo(12);x.d.getElementById('dlg-borrar').click();
    assert.equal(x.w.CUAD['2026-10'],undefined);
    assert.ok(x.cell(12).classList.contains('finde'));
  }finally{x.w.close();}
});
test('A regional holiday marked on a weekday counts and opens with the switch on',async()=>{
  const x=await setup();try{
    x.w.abrirDialogo(7);x.d.querySelector('.t-ini').value='08:00';x.d.querySelector('.t-fin').value='16:00';
    x.fest().click();
    assert.match(x.d.getElementById('dlg-nota').textContent,/8 h con plus de fin de semana\/festivo/);
    x.d.getElementById('dlg-guardar').click();
    assert.equal(x.w.CUAD['2026-10']['7'].fest,true);assert.equal(x.w.CUAD['2026-10']['7'].nofest,false);
    assert.equal(x.plus(),8);assert.ok(x.cell(7).classList.contains('finde'));
    x.w.abrirDialogo(7);assert.equal(x.fest().checked,true);
  }finally{x.w.close();}
});
test('Shifts saved before this change keep their weekend and holiday plus',async()=>{
  // Antes se guardaba fest:false en todos los días sin marcar, también en sábados.
  const x=await setup({'2026-10':{'3':{tramos:[{i:'08:00',f:'16:00'}],vac:false,fest:false},'19':{tramos:[{i:'08:00',f:'16:00'}],vac:false,fest:true},'20':{tramos:[{i:'08:00',f:'16:00'}],vac:false,fest:false}}});
  try{
    assert.equal(x.plus(),16);
    x.w.abrirDialogo(3);assert.equal(x.fest().checked,true);x.d.getElementById('dlg-cancelar').click();
    x.w.abrirDialogo(19);assert.equal(x.fest().checked,true);x.d.getElementById('dlg-cancelar').click();
    x.w.abrirDialogo(20);assert.equal(x.fest().checked,false);
  }finally{x.w.close();}
});
test('A night shift into a Saturday that was turned off pays no weekend plus for those hours',async()=>{
  const x=await setup();try{
    x.shift(2,'22:00','06:00');
    assert.equal(x.plus(),6);
    x.w.abrirDialogo(3);x.fest().click();x.d.getElementById('dlg-guardar').click();
    assert.equal(x.plus(),0);
  }finally{x.w.close();}
});
test('Stored calendars keep only a real true for the new flag',async()=>{
  const x=await setup();try{
    const read=raw=>x.w.VigilanteSecurity.calendar(JSON.stringify(raw)).data['2026-10'];
    assert.equal(read({'2026-10':{'3':{tramos:[],nofest:true}}})['3'].nofest,true);
    assert.equal(read({'2026-10':{'3':{tramos:[],nofest:'true'}}})['3'].nofest,false);
    assert.equal(read({'2026-10':{'3':{tramos:[]}}})['3'].nofest,false);
  }finally{x.w.close();}
});
