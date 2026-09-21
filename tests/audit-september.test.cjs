// Reproductions from the 22 September audit. Monetary expectations are independent.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom'),{jsPDF}=require('jspdf');
const rules=require('../calculation-rules.js');
process.env.TZ='Europe/Madrid';
function setup(){
 const w=new JSDOM(fs.readFileSync(path.join(__dirname,'../index.html'),'utf8'),{url:'http://localhost:4179',runScripts:'outside-only'}).window;
 w.matchMedia=()=>({matches:false});w.alert=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};w.jspdf={jsPDF};
 require('./load-calculator.cjs')(w);w.eval(fs.readFileSync(path.join(__dirname,'../pdf-layout.js'),'utf8'));w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
 w.guardarOCompartir=()=>{};
 w.VigilanteAuth={require:fn=>fn()};w.actualizarAccesoVacaciones(true);
 const d=w.document,set=(id,value)=>{d.getElementById(id).value=value;for(const event of ['input','change'])d.getElementById(id).dispatchEvent(new w.Event(event,{bubbles:true}));};
 const money=id=>Number(d.getElementById(id).textContent.replace(/[^0-9,\-]/g,'').replace(',','.'));
 const vacation=(days,average)=>{d.getElementById('switchVac').click();set('diasVac',days);set('vac-metodo','importe');set('n-promedioVac',average);};
 return {w,d,set,money,vacation};
}
const run=(name,fn)=>test(name,()=>{const x=setup();try{fn(x);}finally{x.w.close();}});

for(const mode of ['manual','cuadrante'])run('Escort full vacation never duplicates the functional allowance: '+mode,x=>{
 x.d.getElementById('btn-escolta').click();x.set('hTTotal',0);x.vacation(31,312.99);
 if(mode==='cuadrante'){
  x.w.CUAD={'2026-08':Object.fromEntries(Array.from({length:31},(_,i)=>[i+1,{tramos:[],vac:true}]))};
  x.w.MODO_HORAS='cuadrante';x.w.calAnio=2026;x.w.calMes=7;
 }
 x.w.calcNominaRegistrado();assert.equal(x.money('r-bruto'),1904.90);assert.equal(x.money('r-vacplus'),312.99);
 assert.equal(x.d.getElementById('row-escolta').style.display,'none');assert.equal(x.d.getElementById('n-escolta-field').hidden,true);
 assert.ok(x.w.ctxPDF.nomina);assert.match(x.w.ctxPDF.nomina['Pluses de vacaciones'],/312,99/);
});
for(const partial of [false,true])run('Mixed escort month requires its actual functional amount, separately from vacation: '+partial,x=>{
 x.d.getElementById('btn-escolta').click();
 if(partial){x.d.getElementById('jorn-parcial').click();x.set('hPactadas',81);}
 x.set('hTTotal',partial?40:80);x.vacation(15,partial?156.50:312.99);x.w.calcNominaRegistrado();
 assert.equal(x.w.ctxPDF.nomina,null);assert.equal(x.d.getElementById('n-escolta-field').hidden,false);
 x.set('n-escolta-trabajado',partial?77.20:154.40);x.w.calcNominaRegistrado();
 assert.equal(x.money('r-escolta'),partial?77.20:154.40);assert.equal(x.money('r-vacplus'),partial?75.73:151.45);
 assert.ok(x.w.ctxPDF.nomina);if(!partial)assert.equal(x.money('r-bruto'),1897.76);
 x.set('n-escolta-trabajado',-1);x.w.calcNominaRegistrado();assert.equal(x.w.ctxPDF.nomina,null);
 x.set('n-escolta-trabajado',0);x.w.calcNominaRegistrado();assert.ok(x.w.ctxPDF.nomina);
});
run('Inactive escort override cannot affect a month without vacations or another category',x=>{
 x.d.getElementById('btn-escolta').click();x.set('hTTotal',162);x.set('n-escolta-trabajado',-500);x.w.calcNominaRegistrado();
 assert.equal(x.money('r-escolta'),312.99);assert.ok(x.w.ctxPDF.nomina);
 x.d.getElementById('btn-sin_arma').click();x.vacation(15,0);x.set('hTTotal',80);x.w.calcNominaRegistrado();
 assert.ok(x.w.ctxPDF.nomina);assert.equal(x.d.getElementById('row-escolta').style.display,'none');
});
run('Contribution cap uses days in employment: boundary, one cent over, partial employment and full month',x=>{
 x.set('n-diasAlta',15);x.set('hTTotal',81);x.d.getElementById('switchPlus').click();x.set('n-base-paga',1185.36);
 x.set('plusServicio',1684.70);x.w.calcNominaRegistrado();assert.ok(x.w.ctxPDF.nomina);assert.equal(x.money('r-ss'),-165.79);
 for(const amount of [1684.71,3000]){
  x.set('plusServicio',amount);x.w.calcNominaRegistrado();assert.equal(x.w.ctxPDF.nomina,null);
  assert.match(x.d.getElementById('errorBox').textContent,/2550,60 €.*15 días/);
 }
 x.set('n-diasAlta',30);x.set('hTTotal',162);x.w.calcNominaRegistrado();assert.ok(x.w.ctxPDF.nomina);
 x.d.getElementById('jorn-parcial').click();x.set('hPactadas',81);x.set('hTTotal',40.5);x.set('n-diasAlta',15);x.set('n-base-paga',592.68);
 x.w.calcNominaRegistrado();assert.equal(x.w.ctxPDF.nomina,null);assert.match(x.d.getElementById('errorBox').textContent,/15 días/);
});
run('Later IT processes clear and disable incompatible history; changing back never restores consent-like check',x=>{
 x.set('b-inicio','2026-04-01');x.set('b-fin','2026-07-09');x.set('b-baseManual',1800);
 const history=x.d.getElementById('b-sin-procesos');history.click();assert.equal(history.checked,true);
 x.set('b-nbaja',2);assert.equal(history.checked,false);assert.equal(history.disabled,true);
 x.w.calcBajaRegistrado();assert.equal(x.w.informeBaja.gross,4986);assert.equal(x.w.informeBaja.segments.at(-1).rate,.75);
 assert.equal(x.w.informeBaja.monthly.reduce((sum,m)=>sum+m.gross,0),4986);
 assert.equal(x.w.ctxPDF.baja['Número de baja del año'],'2');
 x.set('b-nbaja',1);assert.equal(history.disabled,false);assert.equal(history.checked,false);
 history.click();x.w.calcBajaRegistrado();assert.equal(x.w.informeBaja.gross,5106);
});
test('84 IT tranche boundary combinations cannot gain the first-process extension through contradictory data',()=>{
 for(const number of [1,2,3])for(const noPrevious of [false,true])for(const total of [1,3,4,20,21,40,41,60,61,90,91,100,101,180]){
  let expected=0;
  for(let day=1;day<=total;day++)expected+=60*(day<=3?(number===1?.5:0):day<=20?(number<=2?.8:.6):day<=40?1:day<=60?.9:day<=90?.8:day<=100&&number===1&&noPrevious?.8:.75);
  const report=rules.illnessReport({total,base:60,cotCC:60,cotCP:60,tableDaily:50,irpf:0,number,noPrevious});
  assert.equal(report.gross,Math.round(expected*100)/100);
 }
 // Legal floor and employer complement have different bases in this case.
 const report=rules.illnessReport({total:10,prior:90,base:40,cotCC:60,cotCP:60,tableDaily:50,irpf:0,number:2,noPrevious:true});
 assert.equal(report.gross,300);assert.equal(rules.illnessSegments(100,2,true,0).at(-1).rate,.75);
});
for(const category of ['fondos','tr_explo'])run('Transport vacation hours omit inapplicable tariff while retaining historical money: '+category,x=>{
 x.set('hTTotal',80);x.vacation(15,0);x.set('vac-metodo','horas');x.set('vac-horas-festivo',40);
 x.d.getElementById('btn-'+category).click();x.w.calcNominaRegistrado();
 assert.equal(x.d.getElementById('row-vacplus').style.display,'none');assert.equal(x.d.getElementById('vac-horas-festivo').disabled,true);
 assert.equal(x.d.getElementById('vac-transport-hint').hidden,false);assert.doesNotMatch(x.d.getElementById('vac-rate-hint').textContent,/1,02/);
 x.set('vac-horas-noche',40);x.w.calcNominaRegistrado();assert.equal(x.money('r-vacplus'),24.58);
 x.d.getElementById('switchCond').click();x.w.calcNominaRegistrado();assert.equal(x.money('r-vacplus'),26.32);
 x.set('vac-metodo','importe');x.set('n-promedioVac',40.80);x.w.calcNominaRegistrado();assert.equal(x.money('r-vacplus'),19.74);
 x.set('vac-metodo','nominas');x.set('vac-meses',1);x.set('vac-mes-1-weekend',40.80);x.w.calcNominaRegistrado();assert.equal(x.money('r-vacplus'),19.74);
 x.set('vac-metodo','horas');x.set('vac-horas-noche',0);x.d.getElementById('btn-sin_arma').click();x.w.calcNominaRegistrado();
 assert.equal(x.d.getElementById('vac-horas-festivo').disabled,false);assert.equal(x.money('r-vacplus'),19.74);
});
run('Daily calendar and PDF include incoming hours without counting them twice or changing saved shifts',x=>{
 x.w.CUAD={'2026-08':{31:{tramos:[{i:'22:00',f:'06:00'}]}}};const original=JSON.stringify(x.w.CUAD);
 x.w.MODO_HORAS='cuadrante';x.w.calAnio=2026;x.w.calMes=8;x.w.pintarCalendario();x.w.calcNominaRegistrado();
 const r=x.w.resumenDia(2026,8,1);assert.equal(r.horas,6);assert.equal(r.lineas.join('–'),'00:00–06:00');assert.equal(r.continua,true);
 assert.match(x.d.querySelector('[data-dia="1"]').textContent,/00:00.*06:00.*6h/);
 assert.equal(x.w.resumenDia(2026,7,31).horas,2);assert.equal(x.w.totalesMes(2026,8).horasTrabajadas,6);
 x.w.abrirDialogo(1);assert.equal(x.d.getElementById('dlg-continuacion').hidden,false);assert.match(x.d.getElementById('dlg-continuacion').textContent,/31 de agosto/);
 const calls=[];x.w.jspdf.jsPDF=function(options){const doc=new jsPDF(options),text=doc.text.bind(doc);doc.text=(value,a,b,...rest)=>{calls.push({text:[value].flat().join(' '),y:b});return text(value,a,b,...rest);};return doc;};
 const pdf=x.w.construirPDF('nomina');assert.equal(pdf.getNumberOfPages(),1);
 for(const value of ['00:00','06:00','6 h',x.d.getElementById('r-neto').textContent])assert.ok(calls.some(c=>c.text===value),value);
 assert.ok(calls.every(c=>c.y<=289));assert.equal(JSON.stringify(x.w.CUAD),original);
 if(process.env.PDF_AUDIT_SAMPLES==='1'){
  const dir=path.resolve(__dirname,'../../../output/pdf');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'auditoria-turno-entre-meses.pdf'),Buffer.from(pdf.output('arraybuffer')));
 }
});
run('30 minute-based shift oracles also reconcile daily calendar totals, including clock, month and year changes',x=>{
 for(const [year,month,day]of [[2026,0,31],[2026,1,28],[2026,2,28],[2026,8,30],[2026,9,24],[2026,11,31]])for(const [i,f]of [['20:00','04:00'],['22:00','06:00'],['02:00','10:00'],['08:00','16:00'],['18:30','23:30']]){
  x.w.CUAD={[year+'-'+String(month+1).padStart(2,'0')]:{[day]:{tramos:[{i,f}]}}};
  const [ih,im]=i.split(':').map(Number),[fh,fm]=f.split(':').map(Number),start=new Date(year,month,day,ih,im),end=new Date(year,month,day+(f<=i?1:0),fh,fm);
  const minutes=[];for(let stamp=+start;stamp<+end;stamp+=60000)minutes.push(new Date(stamp));
  const night=minutes.filter(d=>d.getHours()>=22||d.getHours()<6).length,within=minutes.filter(d=>d.getMonth()===month);
  const payable=night>=240?Math.min(minutes.length,480)*within.length/minutes.length:within.filter(d=>d.getHours()>=22||d.getHours()<6).length;
  const totals=x.w.totalesMes(year,month);assert.equal(totals.horasTrabajadas,Math.round(within.length/60*100)/100);assert.equal(totals.noct,Math.round(payable/60*100)/100);
  const next=new Date(year,month,day+1),first=x.w.resumenDia(year,month,day),second=x.w.resumenDia(next.getFullYear(),next.getMonth(),next.getDate());
  assert.equal(Math.round(((first?.horas||0)+(second?.horas||0))*100),Math.round(minutes.length/60*100));
 }
 x.w.CUAD={'2026-08':{31:{tramos:[{i:'22:00',f:'06:00'}]}},'2026-09':{1:{tramos:[{i:'14:00',f:'18:00'}]}}};
 assert.equal(x.w.resumenDia(2026,8,1).horas,10);assert.equal(x.w.resumenDia(2026,8,1).lineas[0],'2 tramos');
});
run('Automatic severance uses the exact annual salary, matching a direct annual input',x=>{
 x.d.getElementById('fbtn-fondos').click();x.set('f-inicio','2000-01-01');x.set('f-fin','2026-09-30');x.set('f-antig-importe',0);x.set('f-tipodespido','objetivo');x.set('f-fiscalidad','exenta');
 x.w.calcFiniquitoRegistrado();assert.equal(x.money('fr-indem'),23935.02);
 x.set('f-salario-anual',24267.45);x.w.calcFiniquitoRegistrado();assert.equal(x.money('fr-indem'),23935.02);
});
