const {test}=require('node:test'),assert=require('node:assert/strict');
process.env.TZ='Europe/Madrid';
const fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom'),{jsPDF}=require('jspdf');
const root=path.resolve(__dirname,'..');
function setup(){
 const dom=new JSDOM(fs.readFileSync(path.join(root,'index.html'),'utf8'),{url:'http://localhost:4173/',runScripts:'outside-only'});
 const w=dom.window;w.matchMedia=()=>({matches:false});w.alert=message=>{throw Error(message);};w.HTMLElement.prototype.scrollIntoView=()=>{};w.jspdf={jsPDF};
 require('./load-calculator.cjs')(w);
 w.eval(fs.readFileSync(path.join(root,'pdf-layout.js'),'utf8'));
 const share=w.guardarOCompartir;w.guardarOCompartir=()=>{};
 return {dom,w,share};
}
const pdfCases={
 nomina:{fields:{hTTotal:170,hNoc:60,hFest:40,irpf:10},run:'calcNominaRegistrado',expected:{'r-bruto':'1631,69 €','r-neto':'1343,33 €'}},
 baja:{fields:{'b-dias':45,'b-irpf':10},run:'calcBajaRegistrado',expected:{'br-total-bruto':'2286,12 €'}},
 finiquito:{fields:{'f-inicio':'2024-03-01','f-fin':'2026-10-05','f-vacas':10,'f-irpf':12,'f-tipodespido':'improcedente'},run:'calcFiniquitoRegistrado',expected:{'fr-indem':'+4286,78 €'}},
 cuadrante:{fields:{},run:'calcNominaRegistrado',expected:{}}
};
for(const type of Object.keys(pdfCases))test('Real PDF export: '+type,()=>{
 const {w}=setup();try{
  const item=pdfCases[type];for(const [id,value]of Object.entries(item.fields))w.document.getElementById(id).value=value;
  if(type==='cuadrante'){
   w.actualizarAccesoVacaciones(true);
   w.CUAD['2026-03']={};for(let day=1;day<=31;day++)w.CUAD['2026-03'][day]={tramos:day%3?[{i:'22:00',f:'06:00'}]:[],vac:day===3,fest:day===19};
   w.CUAD['2026-03']['2'].tramos=[{i:'22:00',f:'00:00'}];
   w.MODO_HORAS='cuadrante';w.calAnio=2026;w.calMes=2;
  }
  w[item.run]();
  if(type==='cuadrante'){
   assert.equal(w.ctxPDF.nomina['Vacaciones'],'1 día (5,23 h)');
   assert.ok(w.ctxPDF.nomina['Horas trabajadas'].startsWith('155 h'));
  }
  const doc=w.construirPDF(type==='cuadrante'?'nomina':type);
  if(type==='cuadrante')assert.equal(doc.getNumberOfPages(),1,'The regular calendar and net should share one sheet');
  assert.ok(doc.getNumberOfPages()>=1&&doc.getNumberOfPages()<=4);
  for(const [id,value]of Object.entries(item.expected))assert.equal(w.document.getElementById(id).textContent,value);
  const bytes=Buffer.from(doc.output('arraybuffer'));assert.equal(bytes.subarray(0,5).toString(),'%PDF-');
 }finally{w.close();}
});

test('Payroll PDF keeps overtime, the team leader allowance and holiday allowances',()=>{
 const {w}=setup();try{
  const d=w.document,calls=[];
  w.jspdf.jsPDF=function(options){const doc=new jsPDF(options),text=doc.text.bind(doc);doc.text=(value,x,y,...rest)=>{calls.push({text:[value].flat().join(' '),y,page:doc.internal.getCurrentPageInfo().pageNumber});return text(value,x,y,...rest);};return doc;};
  w.actualizarAccesoVacaciones(true);
  d.getElementById('switchResponsable').checked=true;d.getElementById('switchVac').checked=true;
  for(const [id,value]of Object.entries({hTTotal:150,hNoc:40,diasVac:10}))d.getElementById(id).value=value;
  w.calcNominaRegistrado();const doc=w.construirPDF('nomina');
  assert.equal(d.getElementById('r-vacplus').textContent,'+25,20 €');
  for(const value of ['+116,13 €','+25,20 €',d.getElementById('r-neto').textContent])assert.ok(calls.some(c=>c.text===value),value+' is exported');
  assert.ok(calls.some(c=>c.text.includes('Responsable de equipo')));
  assert.ok(calls.every(c=>c.y<=289));
 }finally{w.close();}
});

test('Validated 2026 five and six-week calendars put the complete breakdown and net below the schedule',()=>{
 for(const [year,month]of [[2026,1],[2026,2]]){
 const {w}=setup();try{
  const calls=[];w.jspdf.jsPDF=function(options){const doc=new jsPDF(options),text=doc.text.bind(doc);doc.text=(value,x,y,...rest)=>{calls.push({text:[value].flat().join(' '),y,page:doc.internal.getCurrentPageInfo().pageNumber});return text(value,x,y,...rest);};return doc;};
  const key=year+'-'+String(month+1).padStart(2,'0');w.CUAD[key]={};
  for(let d=1;d<=new Date(year,month+1,0).getDate();d++)if(d%3)w.CUAD[key][d]={tramos:[{i:'22:00',f:'06:00'}],vac:false,fest:false};
  w.MODO_HORAS='cuadrante';w.calAnio=year;w.calMes=month;w.document.getElementById('irpf').value='15';
  w.volcarTotales(w.totalesMes(year,month));w.calcNomina();const doc=w.construirPDF('nomina');
  assert.equal(doc.getNumberOfPages(),1);
  const total=calls.find(c=>c.text==='TOTAL'),dev=calls.find(c=>c.text==='DEVENGOS'),net=calls.find(c=>c.text==='NETO ESTIMADO A COBRAR');
  assert.ok(total.y<dev.y&&dev.y<net.y);assert.equal(net.page,1);
  assert.ok(calls.some(c=>c.text===w.document.getElementById('r-neto').textContent&&c.page===1));
  for(const block of w.leerResultado('resultado'))for(const row of block.filas)assert.ok(calls.some(c=>c.text===row.v&&c.page===1));
  assert.ok(calls.every(c=>c.y<=289));
 }finally{w.close();}}
});

test('Long calendar breakdown continues without losing rows and keeps net on the first sheet',()=>{
 const {w}=setup();try{
  const calls=[];w.jspdf.jsPDF=function(options){const doc=new jsPDF(options),text=doc.text.bind(doc);doc.text=(value,x,y,...rest)=>{calls.push({text:[value].flat().join(' '),y,page:doc.internal.getCurrentPageInfo().pageNumber});return text(value,x,y,...rest);};return doc;};
  const doc=w.VigilantePDF.create({title:'Tu nómina mensual',date:'15/09/2026',netLabel:'NETO',net:'1234,56 €',data:{Categoría:'Vigilante de seguridad'},calendar:(doc,y)=>{doc.text('CALENDARIO',18,y);return y+128;},blocks:[{title:'Devengos',rows:Array.from({length:45},(_,i)=>({label:'Concepto '+i+' con una descripción que debe conservarse completa',value:i+',00 €'}))},{title:'Deducciones',rows:[{label:'IRPF',value:'10,00 €',negative:true}]}]});
  assert.ok(doc.getNumberOfPages()>1);
  assert.ok(calls.some(c=>c.text==='NETO ESTIMADO A COBRAR'&&c.page===1));
  assert.ok(calls.some(c=>c.text==='1234,56 €'&&c.page===1));
  for(let i=0;i<45;i++)assert.ok(calls.some(c=>c.text==='Concepto '+i+' con una descripción que debe conservarse completa'));
  assert.ok(calls.every(c=>c.y<=289));
 }finally{w.close();}
});
test('PDF keeps long data and concepts; repeats headers and footers across pages',()=>{
 const {w}=setup();try{
  const textCalls=[];
  w.jspdf.jsPDF=function(options){const doc=new jsPDF(options),original=doc.text.bind(doc);doc.text=function(text,x,y,opts){textCalls.push({text:[text].flat().join(' '),x,y,page:doc.getNumberOfPages()});return original(text,x,y,opts);};return doc;};
  const longValue='Accidente laboral o enfermedad profesional con información adicional que debe conservarse completa hasta FINAL';
  const doc=w.VigilantePDF.create({title:'Prueba de paginación',date:'15/09/2026',netLabel:'NETO',net:'1234,56 €',data:{'Descripción':longValue},blocks:[{title:'Desglose',rows:Array.from({length:48},(_,i)=>({label:'Concepto número '+i+' con descripción extensa que debe continuar en una línea adicional sin cortar ningún dato',value:'123,45 €'}))}]});
  assert.ok(doc.getNumberOfPages()>2);assert.ok(textCalls.some(c=>c.text.includes('hasta FINAL')));
  assert.equal(textCalls.filter(c=>c.text==='Nómina Vigilante').length,doc.getNumberOfPages());
  assert.equal(textCalls.filter(c=>c.text.includes('No sustituye la nómina oficial')).length,doc.getNumberOfPages());
  assert.ok(textCalls.every(c=>c.y>=0&&c.y<=289));
 }finally{w.close();}
});
test('Failed PDF loader restores the download button and allows another attempt',()=>{
 const {w}=setup();try{
  const button=w.document.getElementById('btnPdfNomina'),label=button.textContent;
  w.cargarJsPDF=(success,failure)=>failure();w.alert=()=>{};w.exportarPDFRegistrado('nomina',button);
  assert.equal(button.disabled,false);assert.equal(button.textContent,label);
 }finally{w.close();}
});
test('Mobile sharing respects cancellation and downloads when sharing fails',async()=>{
 const {w,share}=setup();try{
  let downloads=0;w.descargarBlobDirecto=()=>{downloads++;};
  Object.defineProperty(w.navigator,'maxTouchPoints',{value:1});w.matchMedia=()=>({matches:true});w.navigator.canShare=()=>true;
  const doc={output:()=>new w.Blob(['%PDF-'],{type:'application/pdf'})};
  w.navigator.share=()=>Promise.reject(Object.assign(new Error('cancel'),{name:'AbortError'}));
  share(doc,'test.pdf','nomina');await new Promise(resolve=>setTimeout(resolve,0));assert.equal(downloads,0);
  w.navigator.share=()=>Promise.reject(new Error('not allowed'));
  share(doc,'test.pdf','nomina');await new Promise(resolve=>setTimeout(resolve,0));assert.equal(downloads,1);
  w.navigator.share=()=>{throw new Error('unavailable');};share(doc,'test.pdf','nomina');assert.equal(downloads,2);
  w.navigator.canShare=()=>{throw new Error('unsupported');};share(doc,'test.pdf','nomina');assert.equal(downloads,3);
 }finally{w.close();}
});
