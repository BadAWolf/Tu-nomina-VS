const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
const rules=require('../calculation-rules.js');
process.env.TZ='Europe/Madrid';
function setup(){
 const w=new JSDOM(fs.readFileSync(path.join(__dirname,'../index.html'),'utf8'),{url:'http://localhost:4178',runScripts:'outside-only'}).window;
 w.matchMedia=()=>({matches:false});w.alert=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};
 require('./load-calculator.cjs')(w);w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
 w.VigilanteAuth={require:fn=>fn()};w.actualizarAccesoVacaciones(true);
 const d=w.document,set=(id,value)=>{d.getElementById(id).value=value;d.getElementById(id).dispatchEvent(new w.Event('input',{bubbles:true}));d.getElementById(id).dispatchEvent(new w.Event('change',{bubbles:true}));};
 const text=id=>d.getElementById(id).textContent;
 const money=id=>Number(text(id).replace(/[^0-9,\-]/g,'').replace(',','.'));
 const calendar=(data,month=8)=>{w.CUAD={'2026-09':data};w.calAnio=2026;w.calMes=month;d.getElementById('modo-cuadrante').click();};
 const illness=()=>{set('b-inicio','2026-09-01');set('b-fin','2026-09-30');set('b-baseManual',1800);};
 const termination=()=>{set('f-inicio','2025-01-01');set('f-fin','2026-06-30');};
 return {w,d,set,text,money,calendar,illness,termination};
}
const run=(name,fn)=>test(name,()=>{const x=setup();try{fn(x);}finally{x.w.close();}});

test('BOE quotas: independent rounding of CC, MEI, unemployment, training and ordinary/force overtime',()=>{
 assert.deepEqual(rules.contributions(1731.79,1731.79),{common:81.39,mei:2.60,unemployment:26.84,training:1.73,overtime:0,force:0,total:112.56});
 assert.equal(rules.contributions(1800,2100,300).total,136.05);
 assert.equal(rules.contributions(1800,2100,0,false,300).total,127.95);
});
run('C01: night premium expands 4+ clock hours to the jornada, capped at eight; split shifts and month crossing',x=>{
 for(const [i,f,expected]of [['20:00','04:00',8],['02:00','10:00',8],['23:00','07:00',8],['20:00','00:00',2],['18:00','06:00',8]]){
  x.w.CUAD={'2026-09':{1:{tramos:[{i,f}]}}};assert.equal(x.w.totalesMes(2026,8).noct,expected,i+'–'+f);
 }
 x.w.CUAD={'2026-09':{1:{tramos:[{i:'00:00',f:'03:00'},{i:'04:00',f:'09:00'}]}}};assert.equal(x.w.totalesMes(2026,8).noct,8);
 x.w.CUAD={'2026-08':{31:{tramos:[{i:'20:00',f:'04:00'}]}}};
 assert.equal(x.w.totalesMes(2026,7).noct,4);assert.equal(x.w.totalesMes(2026,8).noct,4);
 x.w.CUAD={'2026-10':{24:{tramos:[{i:'22:00',f:'06:00'}]}}};
 assert.equal(x.w.totalesMes(2026,9).horasTrabajadas,9);assert.equal(x.w.totalesMes(2026,9).noct,8);
});
run('C02/C06/C07: saved overlaps, equal endpoints, overnight collisions and vacation conflicts cannot produce payroll',x=>{
 const entries=[
  {1:{tramos:[{i:'08:00',f:'16:00'},{i:'12:00',f:'20:00'}]}},
  {1:{tramos:[{i:'08:00',f:'08:00'}]}},
  {1:{tramos:[{i:'22:00',f:'06:00'}]},2:{tramos:[{i:'04:00',f:'12:00'}]}},
  {1:{tramos:[{i:'22:00',f:'06:00'}]},2:{tramos:[],vac:true}}
 ];
 for(const data of entries){x.calendar(data);const original=JSON.stringify(x.w.CUAD);x.w.calcNominaRegistrado();assert.equal(x.w.ctxPDF.nomina,null);assert.equal(x.d.getElementById('errorBox').style.display,'block');assert.equal(JSON.stringify(x.w.CUAD),original);}
 x.w.CUAD={'2026-08':{31:{tramos:[{i:'22:00',f:'06:00'}]}},'2026-09':{1:{tramos:[{i:'05:00',f:'10:00'}]}}};assert.ok(x.w.validarCuadrante(x.w.CUAD,2026,8));
});
run('Shift editor refuses to save an overlap or a half-filled interval',x=>{
 x.calendar({1:{tramos:[{i:'08:00',f:'16:00'}]}});x.w.abrirDialogo(1);
 x.d.getElementById('dlg-add').click();const rows=x.d.querySelectorAll('#dlg-tramos .tramo');rows[1].querySelector('.t-ini').value='12:00';rows[1].querySelector('.t-fin').value='20:00';
 x.w.guardarDialogoRegistrado();assert.equal(x.w.CUAD['2026-09'][1].tramos.length,1);assert.match(x.text('dlg-nota'),/solapan/);
 rows[1].querySelector('.t-fin').value='';x.w.guardarDialogoRegistrado();assert.match(x.text('dlg-nota'),/Completa/);
});
run('C08: calendar/manual/calendar round trip preserves actual work, holiday credit and gross without duplicate overtime',x=>{
 const data={};for(let d=1;d<=15;d++)data[d]={tramos:[],vac:true};for(let d=16;d<=25;d++)data[d]={tramos:[{i:'08:00',f:'16:00'}]};
 x.d.getElementById('switchVac').checked=true;x.set('diasVac',15);x.calendar(data);x.w.calcNominaRegistrado();const gross=x.money('r-bruto');
 assert.equal(x.d.getElementById('hTTotal').value,'80');x.d.getElementById('modo-manual').click();x.w.calcNominaRegistrado();
 assert.equal(x.money('r-bruto'),gross);assert.equal(x.d.getElementById('row-extra').style.display,'none');
 x.d.getElementById('modo-cuadrante').click();x.w.calcNominaRegistrado();assert.equal(x.money('r-bruto'),gross);
});
run('C03: payroll, calendar, mode, category and termination input edits invalidate old results and export data',x=>{
 x.set('hTTotal',162);x.w.calcNominaRegistrado();assert.ok(x.w.ctxPDF.nomina);x.set('hTTotal',170);assert.equal(x.w.ctxPDF.nomina,null);
 x.w.calcNominaRegistrado();x.d.getElementById('paga-julio').click();assert.equal(x.w.ctxPDF.nomina,null);
 x.calendar({1:{tramos:[{i:'08:00',f:'16:00'}]}});x.w.calcNominaRegistrado();x.w.abrirDialogo(1);x.d.querySelector('#dlg-tramos .t-fin').value='20:00';x.w.guardarDialogoRegistrado();assert.equal(x.w.ctxPDF.nomina,null);assert.equal(x.w.ctxPDF.cuadrante,null);
 x.termination();x.w.calcFiniquitoRegistrado();assert.ok(x.w.ctxPDF.finiquito);x.set('f-vacas',15);assert.equal(x.w.ctxPDF.finiquito,null);
});
run('C04: later calendars remain editable but cannot silently pay 2026 rates; ending dates are constrained too',x=>{
 x.w.CUAD={'2027-01':{1:{tramos:[{i:'08:00',f:'16:00'}]}}};x.w.calAnio=2027;x.w.calMes=0;x.w.MODO_HORAS='cuadrante';x.w.calcNominaRegistrado();assert.equal(x.w.ctxPDF.nomina,null);assert.match(x.text('errorBox'),/2026/);
 x.termination();x.set('f-fin','2027-01-01');x.w.calcFiniquitoRegistrado();assert.equal(x.w.ctxPDF.finiquito,null);
 x.illness();x.set('b-fin','2027-01-01');x.w.calcBajaRegistrado();assert.equal(x.w.informeBaja,null);
});
run('Standard monthly hours still determine overtime after removing the contract adjustment panel',x=>{
 x.set('hTTotal',170);x.w.calcNominaRegistrado();assert.equal(x.money('r-extra'),79.84);
 x.set('hTTotal',162);x.w.calcNominaRegistrado();assert.equal(x.d.getElementById('row-extra').style.display,'none');assert.equal(x.money('r-bruto'),1435.45);
 x.d.getElementById('jorn-parcial').click();x.set('hPactadas',81);x.set('hTTotal',80);x.w.calcNominaRegistrado();assert.ok(x.w.ctxPDF.nomina);assert.equal(x.d.getElementById('n-complementarias-field').hidden,true);
});
run('Calendar vacation credit and full monthly pay work without removed controls; manual partial months remain available',x=>{
 x.calendar({1:{tramos:[],vac:true}});assert.equal(x.w.totalesMes(2026,8).horas,5.23);x.w.calcNominaRegistrado();assert.equal(x.money('r-base'),1161.28);
 x.d.getElementById('modo-manual').click();x.d.getElementById('switchVac').checked=false;x.set('diasVac',0);x.set('hTTotal',81);x.set('n-diasAlta',15);x.w.calcNominaRegistrado();assert.equal(x.money('r-base'),580.64);
 for(const id of ['n-reparto','n-asignadas','n-mes','n-incidencia','n-dias-cuadrante','n-festivos-derecho','n-noches-especiales','n-compensacion-noche','n-antig-fecha'])assert.equal(x.d.getElementById(id),null);
});
run('N01: armed hours, minimum, known guarantees and extra-payment share are explicit',x=>{
 x.d.getElementById('btn-con_arma').click();x.set('hTTotal',100);x.w.calcNominaRegistrado();assert.equal(x.w.ctxPDF.nomina,null);
 x.set('n-arma-horas',100);x.set('n-arma-paga',111);x.w.calcNominaRegistrado();assert.equal(x.money('r-pelig'),111);
 x.set('n-arma-horas',0);x.w.calcNominaRegistrado();assert.equal(x.money('r-pelig'),24.08);
 x.set('n-arma-horas',101);x.w.calcNominaRegistrado();assert.equal(x.w.ctxPDF.nomina,null);
 x.set('n-arma-modo','importe');x.set('n-arma-importe',179.90);x.w.calcNominaRegistrado();assert.equal(x.money('r-pelig'),179.90);
});
run('Armed overtime includes the declared extra-payment danger without paying variable armed hours twice',x=>{
 x.d.getElementById('btn-con_arma').click();x.set('hTTotal',170);x.set('n-arma-horas',170);x.set('n-arma-paga',24.08);
 x.w.calcNominaRegistrado();assert.equal(x.money('r-extra'),79.84);assert.equal(x.money('r-pelig'),188.70);
 // Art. 53: (1161.28 + 24.08) * 12 + (1161.28 + 179.90) * 3 = 18247.86 annually.
 // 18247.86 / 1782 = 10.24/hour (rounded); the 170 armed hours remain 188.70 separately.
 x.set('n-arma-paga',179.90);x.w.calcNominaRegistrado();
 assert.equal(x.money('r-extra'),81.92);assert.equal(x.money('r-pelig'),188.70);assert.equal(x.money('r-bruto'),1681.99);
 for(const id of ['paga-julio','paga-dic','paga-mar'])x.d.getElementById(id).click();
 x.w.calcNominaRegistrado();assert.equal(x.money('r-extra'),81.92);assert.equal(x.money('r-prorr'),335.30);assert.equal(x.money('r-bruto'),2017.29);
 x.set('aniosAntiguedad',5);x.w.calcNominaRegistrado();assert.equal(x.money('r-extra'),85.04);assert.equal(x.money('r-antig'),45.86);
});
run('Armed overtime rate survives an incomplete payroll month and does not replace part-time complementary rates',x=>{
 x.d.getElementById('btn-con_arma').click();x.set('n-arma-paga',179.90);x.set('n-diasAlta',15);x.set('hTTotal',90);x.set('n-arma-horas',90);
 x.w.calcNominaRegistrado();assert.equal(x.money('r-extra'),92.16);assert.equal(x.money('r-pelig'),99.90);
 x.set('n-diasAlta',30);x.d.getElementById('jorn-parcial').click();x.set('hPactadas',81);x.set('n-arma-paga',89.95);
 x.w.calcNominaRegistrado();assert.equal(x.w.ctxPDF.nomina,null);
 x.set('n-hora-ordinaria',12);x.w.calcNominaRegistrado();assert.equal(x.money('r-extra'),108);assert.equal(x.money('r-pelig'),99.90);
});
run('Armed calendar and manual payroll share the corrected overtime amount',x=>{
 x.d.getElementById('btn-con_arma').click();x.set('hTTotal',170);x.set('hFest',40);x.set('n-arma-horas',170);x.set('n-arma-paga',179.90);
 x.w.calcNominaRegistrado();const gross=x.money('r-bruto'),net=x.money('r-neto');
 const days={};for(let day=1;day<=17;day++)days[day]={tramos:[{i:'08:00',f:'18:00'}]};
 x.calendar(days);x.w.calcNominaRegistrado();
 assert.equal(x.money('r-extra'),81.92);assert.equal(x.money('r-pelig'),188.70);assert.equal(x.money('r-bruto'),gross);assert.equal(x.money('r-neto'),net);
});
run('Armed guarantees still require and use their recognised overtime value',x=>{
 x.d.getElementById('btn-con_arma').click();x.set('hTTotal',170);x.set('n-arma-modo','importe');x.set('n-arma-importe',179.90);x.set('n-arma-paga',179.90);
 x.w.calcNominaRegistrado();assert.equal(x.w.ctxPDF.nomina,null);assert.match(x.text('errorBox'),/precio reconocido/);
 x.set('n-valor-extra',12);x.w.calcNominaRegistrado();assert.equal(x.money('r-extra'),96);assert.equal(x.money('r-pelig'),179.90);
});
run('Responsible allowance keeps its hours validation and real severance salary after renaming the controls',x=>{
 x.d.getElementById('switchResponsable').click();assert.equal(x.d.getElementById('responsable-field').hidden,false);
 x.set('hTTotal',170);x.set('n-horasResponsable',171);x.w.calcNominaRegistrado();
 assert.equal(x.w.ctxPDF.nomina,null);assert.match(x.text('errorBox'),/responsable de equipo/);
 x.set('n-horasResponsable',80);x.w.calcNominaRegistrado();assert.equal(x.money('r-responsable'),57.35);
 x.d.getElementById('switchResponsable').click();assert.equal(x.d.getElementById('responsable-field').hidden,true);
 x.w.calcNominaRegistrado();assert.equal(x.d.getElementById('row-responsable').style.display,'none');
 x.termination();x.set('f-tipodespido','objetivo');x.d.getElementById('switchResponsableF').click();x.w.calcFiniquitoRegistrado();
 assert.equal(x.w.ctxPDF.finiquito,null);
 x.set('f-salario-anual',24000);x.set('f-vac-media',0);x.w.calcFiniquitoRegistrado();
 assert.ok(x.w.ctxPDF.finiquito);assert.equal(x.money('fr-salreg'),2000);
 assert.equal(x.w.ctxPDF.finiquito['Responsable de equipo'],'Incluido en los importes reales indicados');
});
run('BOE 2026 night and clothing tariffs remain distinct for explosives guards and transport drivers',x=>{
 // BOE-A-2026-8569, annex I (2026) and annex II, section 10.
 for(const [category,driver,night,clothing]of [['fondos',false,12.70,113.27],['fondos',true,13.60,114.56],['tr_explo',false,12.70,113.27],['tr_explo',true,13.60,114.56],['explosivos',false,12.60,112.25]]){
  x.d.getElementById('btn-'+category).click();x.d.getElementById('switchCond').checked=driver;
  x.d.getElementById('switchCond').dispatchEvent(new x.w.Event('change'));
  x.set('hTTotal',162);x.set('hNoc',10);x.w.calcNominaRegistrado();
  assert.equal(x.money('r-noc'),night,category+' night');assert.equal(x.money('r-vest'),clothing,category+' clothing');
 }
});
run('Festive category scope and automatic Christmas monetary estimates remain available',x=>{
 x.set('hTTotal',162);x.set('hFest',8);x.w.calcNominaRegistrado();assert.equal(x.money('r-fest'),8.16);
 x.d.getElementById('btn-fondos').click();x.w.calcNominaRegistrado();assert.equal(x.d.getElementById('row-fest').style.display,'none');
 x.w.CUAD={'2026-12':{24:{tramos:[{i:'22:00',f:'06:00'}]},31:{tramos:[{i:'22:00',f:'06:00'}]}}};x.w.calAnio=2026;x.w.calMes=11;x.w.MODO_HORAS='cuadrante';x.w.calcNominaRegistrado();assert.equal(x.money('r-navidad'),166.96);
 assert.match(x.w.ctxPDF.nomina['Nochebuena / Nochevieja'],/compensación económica estimada/);
});
run('Partial complementary hours need their ordinary agreed value instead of borrowing an overtime price',x=>{
 x.d.getElementById('jorn-parcial').click();x.set('hPactadas',80);x.set('hTTotal',90);x.w.calcNominaRegistrado();assert.equal(x.w.ctxPDF.nomina,null);
 assert.equal(x.d.getElementById('n-complementarias-field').hidden,false);assert.ok(x.d.getElementById('parcial-field').contains(x.d.getElementById('n-hora-ordinaria')));
 x.set('n-hora-ordinaria',11);x.w.calcNominaRegistrado();assert.equal(x.money('r-extra'),110);
 x.set('hTTotal',80);x.w.calcNominaRegistrado();assert.equal(x.d.getElementById('n-complementarias-field').hidden,true);assert.equal(x.d.getElementById('row-extra').style.display,'none');
});
run('Special service complements use their recognised extra-payment and overtime amounts',x=>{
 x.set('hTTotal',170);x.d.getElementById('switchPlus').checked=true;x.set('plusServicio',100);x.w.calcNominaRegistrado();assert.equal(x.w.ctxPDF.nomina,null);
 x.set('n-base-paga',1300);x.set('n-valor-extra',12);x.w.calcNominaRegistrado();assert.equal(x.money('r-extra'),96);assert.equal(x.money('r-bruto'),1631.45);
});
run('Legacy seniority requires its recognised amount instead of replacing consolidated trienios',x=>{
 x.set('hTTotal',162);x.set('aniosAntiguedad',35);x.w.calcNominaRegistrado();assert.equal(x.w.ctxPDF.nomina,null);
 x.set('n-antig-importe',400);x.w.calcNominaRegistrado();assert.equal(x.money('r-antig'),400);assert.equal(x.text('lbl-antig'),'Antigüedad reconocida');
 assert.equal(x.d.getElementById('n-antig-importe-field').hidden,false);
 x.set('aniosAntiguedad',5);x.w.calcNominaRegistrado();assert.equal(x.money('r-antig'),45.86);assert.equal(x.d.getElementById('n-antig-importe-field').hidden,true);
 x.termination();x.set('f-antig-fecha','1990-01-01');x.w.calcFiniquitoRegistrado();assert.equal(x.w.ctxPDF.finiquito,null);x.set('f-antig-importe',400);x.w.calcFiniquitoRegistrado();assert.ok(x.w.ctxPDF.finiquito);
});
run('B01/B02: real bases reject implausible full-time amounts and include additional overtime quotas',x=>{
 x.illness();for(const base of [1,20000]){x.set('b-baseManual',base);x.w.calcBajaRegistrado();assert.equal(x.w.informeBaja,null);}
 x.set('b-baseManual',1800);x.set('b-cot-cp',70);x.set('b-extra-diaria',10);x.w.calcBajaRegistrado();assert.equal(x.w.informeBaja.ss,136.05);
 x.set('b-baseManual','');x.w.calcBajaRegistrado();assert.equal(x.w.informeBaja,null);
});
run('B03/B04: escort uses the real contribution base and functional pay does not enter the accident table minimum',x=>{
 x.illness();x.d.getElementById('bbtn-escolta').click();x.set('b-baseManual',2239.51);x.w.calcBajaRegistrado();assert.match(x.w.ctxPDF.baja['Base reguladora diaria'],/74,65/);
 x.set('b-tipo','laboral');x.set('b-br-profesional',2239.51/30);x.set('b-fin','2026-09-02');x.w.calcBajaRegistrado();assert.equal(x.w.informeBaja.gross,55.99);
});
run('Partial IT derives CC from the recognised daily BR without requiring a duplicate field',x=>{
 x.illness();x.set('b-jornada','parcial');x.set('b-base-diaria',30);x.w.calcBajaRegistrado();assert.ok(x.w.informeBaja);assert.match(x.w.ctxPDF.baja['Cotización diaria CC / CP'],/^30,00 € \/ 30,00 €/);assert.equal(x.d.getElementById('b-cot-cc'),null);
 x.set('b-alcance','especial');x.w.calcBajaRegistrado();assert.equal(x.w.informeBaja,null);
});
run('Professional IT requires the recognised BR; a hospital relapse cannot restart its 40-day complement',x=>{
 x.illness();x.set('b-tipo','laboral');x.w.calcBajaRegistrado();assert.equal(x.w.informeBaja,null);
 x.set('b-br-profesional',60);x.w.calcBajaRegistrado();assert.ok(x.w.informeBaja);
 x.set('b-tipo','hospitalizacion');x.set('b-dias-previos',40);x.w.calcBajaRegistrado();assert.equal(x.w.informeBaja,null);assert.match(x.text('b-errorBox'),/reiniciar/);
});
run('F01/F02: daily money stays unrounded until total; quinquenio starts the first day of the anniversary month',x=>{
 x.termination();x.set('f-vacas',15);x.w.calcFiniquitoRegistrado();assert.equal(x.money('fr-vacas'),717.73);assert.match(x.text('f-total-label'),/PENDIENTE/);assert.equal(x.text('fr-ss-liq'),'Pendiente');
 x.set('f-inicio','2021-09-20');x.set('f-fin','2026-09-16');x.w.calcFiniquitoRegistrado();assert.match(x.w.ctxPDF.finiquito['Antigüedad reconocida'],/45,86/);
 x.set('hTTotal',162);x.set('aniosAntiguedad',5);x.w.calcNominaRegistrado();assert.equal(x.money('r-antig'),45.86);
});
run('F03: actual annual salary includes customary variables; vacation average and known L13 quota are accounted once',x=>{
 x.termination();x.set('f-tipodespido','objetivo');x.set('f-salario-anual',36500);x.set('f-fiscalidad','exenta');x.w.calcFiniquitoRegistrado();assert.equal(x.money('fr-indem'),3000);
 x.set('f-salario-anual',37700);x.w.calcFiniquitoRegistrado();assert.equal(x.money('fr-indem'),3098.63);
 x.set('f-vacas',15);x.set('f-vac-media',310);x.set('f-ss-vac',60);x.w.calcFiniquitoRegistrado();assert.equal(x.money('fr-vacas'),867.73);assert.equal(x.money('fr-ss-liq'),-60);assert.equal(x.text('f-total-label'),'NETO ESTIMADO');
 x.set('f-vacas',45);x.w.calcFiniquitoRegistrado();assert.ok(x.w.ctxPDF.finiquito);
});
run('F04: exemption is never assumed; temporal contracts are taxable and substitution/training have no statutory indemnity',x=>{
 x.termination();x.set('f-tipodespido','objetivo');x.set('f-salario-anual',36500);x.set('f-irpf',10);x.w.calcFiniquitoRegistrado();assert.match(x.text('f-total-label'),/PENDIENTE/);
 const pending=x.money('fr-total-neto');x.set('f-fiscalidad','sujeta');x.w.calcFiniquitoRegistrado();assert.equal(x.money('fr-total-neto'),pending-300);assert.equal(x.money('fr-irpf-indem'),-300);
 x.set('f-tipodespido','temporal');x.w.calcFiniquitoRegistrado();assert.ok(x.money('fr-irpf-indem')<0);
 x.set('f-tipodespido','sustitucion');x.w.calcFiniquitoRegistrado();assert.equal(x.d.getElementById('frow-indem').style.display,'none');
});
run('Termination incident history, subrogation, salary arrears and advances are explicit',x=>{
 x.termination();x.set('f-historial','cambios');x.w.calcFiniquitoRegistrado();assert.equal(x.w.ctxPDF.finiquito,null);
 for(const p of ['julio','dic','mar'])x.set('f-extra-'+p,0);
 x.set('f-pendiente',1000);x.set('f-ss-pendiente',65);x.set('f-ajuste-neto',100);x.set('f-irpf',10);x.w.calcFiniquitoRegistrado();assert.equal(x.money('fr-total-neto'),735);
 x.set('f-antig-fecha','2026-01-01');x.w.calcFiniquitoRegistrado();assert.equal(x.w.ctxPDF.finiquito,null);
 x.set('f-antig-fecha','2024-01-01');x.set('f-tipodespido','objetivo');x.set('f-salario-anual',36500);x.w.calcFiniquitoRegistrado();assert.equal(x.money('fr-indem'),5000);
});
