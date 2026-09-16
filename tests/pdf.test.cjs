const {test}=require('node:test'),assert=require('node:assert/strict');
process.env.TZ='Europe/Madrid';
const fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom'),{jsPDF}=require('jspdf');
const root=path.resolve(__dirname,'..');
const fixtures=require('./calculation-fixtures.json');
function setup(){
 const dom=new JSDOM(fs.readFileSync(path.join(root,'index.html'),'utf8'),{url:'http://localhost:4173/',runScripts:'outside-only'});
 const w=dom.window;w.matchMedia=()=>({matches:false});w.alert=message=>{throw Error(message);};w.HTMLElement.prototype.scrollIntoView=()=>{};w.jspdf={jsPDF};
 require('./load-calculator.cjs')(w);
 w.eval(fs.readFileSync(path.join(root,'pdf-layout.js'),'utf8'));
 const share=w.guardarOCompartir;w.guardarOCompartir=()=>{};
 return {dom,w,share};
}
for(const [type,index]of [['nomina',1],['baja',3],['finiquito',4],['cuadrante',1]])test('Real PDF export: '+type,()=>{
 const {dom,w}=setup();try{
  const fixture=fixtures[index];for(const [id,value]of Object.entries(fixture.fields))w.document.getElementById(id).value=value;
  w[fixture.fn+(fixture.fn==='calcNomina'?'':'Registrado')]();
  if(type==='cuadrante'){
   w.CUAD['2026-03']={};for(let day=1;day<=31;day++)w.CUAD['2026-03'][day]={tramos:day%3?[{i:'22:00',f:'06:00'}]:[],vac:day===3,fest:day===19};
   w.CUAD['2026-03']['2'].tramos=[{i:'22:00',f:'00:00'}];
   w.MODO_HORAS='cuadrante';w.calAnio=2026;w.calMes=2;
   w.volcarTotales(w.totalesMes(2026,2));w.calcNominaRegistrado();
   assert.equal(w.ctxPDF.nomina['Vacaciones disfrutadas'],'1 día = 5,23 h de jornada');
   assert.ok(w.ctxPDF.nomina['Horas trabajadas (sin vacaciones)'].startsWith('155 h'));
  }
  const doc=w.construirPDF(type==='cuadrante'?'nomina':type);
  if(type==='cuadrante')assert.equal(doc.getNumberOfPages(),1,'The regular calendar and net should share one sheet');
  assert.ok(doc.getNumberOfPages()>=1&&doc.getNumberOfPages()<=4);
  if(type!=='cuadrante')for(const [id,value]of Object.entries(fixture.expected))assert.equal(w.document.getElementById(id).textContent,value);
  const bytes=Buffer.from(doc.output('arraybuffer'));assert.equal(bytes.subarray(0,5).toString(),'%PDF-');
  if(process.env.PDF_SAMPLES==='1'){
   const out=path.resolve(root,'../../output/pdf');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'vista-previa-'+type+'.pdf'),bytes);
  }
 }finally{w.close();}
});

for(const mode of ['horas','nominas','importe'])test('Vacation supplement PDF keeps the method, average and final amount: '+mode,()=>{
 const {w}=setup();try{
  const d=w.document,calls=[];
  w.jspdf.jsPDF=function(options){const doc=new jsPDF(options),text=doc.text.bind(doc);doc.text=(value,x,y,...rest)=>{calls.push({text:[value].flat().join(' '),y,page:doc.internal.getCurrentPageInfo().pageNumber});return text(value,x,y,...rest);};return doc;};
  d.getElementById('vac-metodo').value=mode;d.getElementById('vac-metodo').dispatchEvent(new w.Event('change',{bubbles:true}));
  d.getElementById('vac-horas-noche').value=64;d.getElementById('vac-horas-festivo').value=32;
  d.getElementById('n-promedioVac').value=113.28;
  d.getElementById('vac-meses').value=2;d.getElementById('vac-meses').dispatchEvent(new w.Event('change',{bubbles:true}));
  d.getElementById('vac-mes-1-night').value=126;d.getElementById('vac-mes-1-weekend').value=100.56;d.getElementById('vac-mes-2-night').value=0;
  w.CUAD['2026-09']={};for(let day=1;day<=30;day++)w.CUAD['2026-09'][day]={tramos:day>15&&day<=25?[{i:'08:00',f:'16:00'}]:[],vac:day<=15,fest:false};
  w.MODO_HORAS='cuadrante';w.calAnio=2026;w.calMes=8;w.actualizarAccesoVacaciones(true);w.calcNominaRegistrado();
  assert.equal(d.getElementById('r-vacplus').textContent,'+54,81 €');
  const doc=w.construirPDF('nomina');
  assert.ok(calls.some(c=>c.text.includes('113,28 €')));
  assert.ok(calls.some(c=>c.text.includes('54,81 €')));
  assert.ok(calls.some(c=>c.text.includes(mode==='horas'?'Estimación por horas':mode==='nominas'?'Media de 2 nóminas':'Media mensual indicada')));
  assert.ok(calls.some(c=>c.text==='NETO ESTIMADO A COBRAR'&&c.page===1));
  assert.ok(calls.every(c=>c.y<=289));
  if(process.env.PDF_SAMPLES==='1'){
   const out=path.resolve(root,'../../output/pdf');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'vacaciones-'+mode+'.pdf'),Buffer.from(doc.output('arraybuffer')));
  }
 }finally{w.close();}
});

test('Four, five and six-week calendars put the complete breakdown and net below the schedule',()=>{
 for(const [year,month]of [[2027,1],[2026,1],[2026,2]]){
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
