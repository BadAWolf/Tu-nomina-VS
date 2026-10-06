/* ══════════════════════════════════════════════════════════
   EXPORTACIÓN A PDF
   ══════════════════════════════════════════════════════════ */
var ctxPDF = {nomina:null, finiquito:null, baja:null, cuadrante:null};
function invalidarCalculo(tipo){
  ctxPDF[tipo]=null;
  if(tipo==='nomina')ctxPDF.cuadrante=null;
  var result=document.getElementById(tipo==='nomina'?'resultado':'resultado-'+tipo);
  if(result)result.style.display='none';
}
['nomina','finiquito','baja'].forEach(function(tipo){
  var view=document.getElementById('view-'+tipo);
  ['input','change'].forEach(function(event){view.addEventListener(event,function(){invalidarCalculo(tipo);});});
  // Botones de categoría, jornada, pagas y modo también alteran las bases.
  view.addEventListener('click',function(e){if(e.target.closest('.cat-btn,.jorn-btn,.paga-btn,#modo-manual,#modo-cuadrante'))invalidarCalculo(tipo);});
});

function validarCuadrante(data,a,m){
  var intervals=[],vac=[],start=new Date(a,m,0),end=new Date(a,m+1,2);
  for(var day=new Date(start);day<end;day=new Date(day.getFullYear(),day.getMonth(),day.getDate()+1)){
    var entry=data[claveMes(day.getFullYear(),day.getMonth())]?.[day.getDate()];
    if(!entry)continue;
    if(entry.vac)vac.push({start:+day,end:+new Date(day.getFullYear(),day.getMonth(),day.getDate()+1)});
    for(var tramo of entry.tramos||[]){
      var ff=tramoAFechas(day.getFullYear(),day.getMonth(),day.getDate(),tramo);
      if(!ff)return 'Hay un turno sin horario válido o con inicio y fin iguales. Revisa el día '+day.getDate()+'.';
      intervals.push({start:+ff.ini,end:+ff.fin});
    }
  }
  intervals.sort(function(x,y){return x.start-y.start;});
  for(var i=0;i<intervals.length;i++){
    var t=intervals[i];
    if(i&&t.start<intervals[i-1].end)return 'Hay turnos que se solapan, incluso entre días consecutivos. Corrige sus horas antes de calcular.';
    if(vac.some(function(v){return t.start<v.end&&t.end>v.start;}))return 'Un día de vacaciones coincide con horas trabajadas, posiblemente de la noche anterior. Revisa ese día.';
  }
  return '';
}

var NOMBRES_CAT = {
  sin_arma:"Vigilante de Seguridad sin arma",
  con_arma:"Vigilante de Seguridad con arma",
  escolta:"Escolta Privado",
  explosivos:"Vigilante de Explosivos",
  fondos:"Vigilante de Transporte de Fondos",
  tr_explo:"Vigilante de Transporte de Explosivos"
};
function nombreCat(k,esCond){
  return NOMBRES_CAT[k] + (esCond&&CATS[k].cBase ? " — Conductor" : "");
}
function fechaES(iso){
  if(!iso) return "—";
  var p=iso.split("-");
  return p[2]+"/"+p[1]+"/"+p[0];
}
function hoyLargo(){
  var M=["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
  var d=new Date();
  return d.getDate()+" de "+M[d.getMonth()]+" de "+d.getFullYear();
}
function sufijoArchivo(){
  var d=new Date();
  return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
}

/* Lee el bloque de resultados tal y como se ve en pantalla */
function leerResultado(idContenedor){
  var cont=document.getElementById(idContenedor);
  var top=cont.querySelector(".res-top");
  var bloques=[], actual=null;
  Array.prototype.forEach.call(top.children,function(el){
    if(el.style.display==="none") return;
    if(el.classList.contains("res-section-label")){
      actual={titulo:el.textContent.trim(),
              color:el.classList.contains("red")?"rojo":(el.classList.contains("blue")?"azul":"verde"),
              filas:[]};
      bloques.push(actual);
    } else if(el.classList.contains("res-row")){
      var c=el.querySelector(".res-concept"), v=el.querySelector(".res-val");
      if(!c||!v) return;
      if(!actual){actual={titulo:"",color:"verde",filas:[]};bloques.push(actual);}
      actual.filas.push({c:c.textContent.trim(), v:v.textContent.trim(),
                         neg:v.className.indexOf("down")>=0, exento:v.className.indexOf("exento")>=0});
    } else if(el.classList.contains("bruto-row")){
      var lb=el.querySelector(".bruto-label"), vb=el.querySelector(".bruto-val");
      if(!lb||!vb) return;
      if(!actual){actual={titulo:"",color:"verde",filas:[]};bloques.push(actual);}
      actual.filas.push({c:lb.textContent.trim(), v:vb.textContent.trim(), total:true});
    }
  });
  return bloques;
}

var pdfLoading = null;
function cargarJsPDF(cb, onError){
  if(window.jspdf&&window.jspdf.jsPDF){cb();return;}
  if(!pdfLoading) pdfLoading=new Promise(function(resolve,reject){
    var s=document.createElement('script');s.src='vendor/jspdf.umd.min.js';
    s.onload=function(){resolve();};s.onerror=function(){s.remove();pdfLoading=null;reject(new Error('PDF no disponible'));};
    document.head.appendChild(s);
  });
  pdfLoading.then(cb).catch(function(){if(onError)onError();});
}
function exportarPDF(tipo,btn){
  if(window.VigilanteAuth)window.VigilanteAuth.require(function(){exportarPDFRegistrado(tipo,btn);});
}
function exportarPDFRegistrado(tipo,btn){
  var txt=btn.textContent;btn.disabled=true;btn.textContent='Preparando tu PDF…';
  function restore(){btn.disabled=false;btn.textContent=txt;}
  cargarJsPDF(function(){
    try{construirPDF(tipo);}catch(e){alert('No se ha podido generar el PDF. Inténtalo de nuevo.');}finally{restore();}
  },function(){restore();alert('No se ha podido cargar el generador de PDF. Comprueba tu conexión y vuelve a intentarlo.');});
}
function construirPDF(tipo){
  var cfg={
    nomina:{title:'Tu nómina mensual',cont:'resultado',netoId:'r-neto',netLabel:'NETO A COBRAR',archivo:'nomina'},
    finiquito:{title:'Tu finiquito',cont:'resultado-finiquito',netoId:'fr-total-neto',netLabel:'TOTAL NETO',archivo:'finiquito'},
    baja:{title:'Tu prestación por baja (IT)',cont:'resultado-baja',netoId:'br-neto',netLabel:'NETO DE LA BAJA',archivo:'baja-it'}
  }[tipo];
  if(!cfg||!ctxPDF[tipo]){alert('Primero pulsa el botón de calcular.');return;}
  var doc=window.VigilantePDF.create({title:cfg.title,date:hoyLargo(),data:ctxPDF[tipo],netLabel:cfg.netLabel,
    net:document.getElementById(cfg.netoId).textContent,
    monthly:null,
    notes:tipo==='finiquito'?[document.getElementById('f-notas-calculo').textContent]:tipo==='baja'?[document.getElementById('b-notas').textContent]:null,
    projection:false,
    blocks:leerResultado(cfg.cont).map(function(b){return {title:b.titulo,rows:b.filas.map(function(f){return {label:f.c,value:f.v,total:f.total,negative:f.neg,exempt:f.exento};})};}),
    calendar:tipo==='nomina'&&ctxPDF.cuadrante?function(doc,y,M,A,W,C){return dibujarCuadrantePDF(doc,y,M,A,W,ctxPDF.cuadrante.anio,ctxPDF.cuadrante.mes,C);}:null
  });
  guardarOCompartir(doc,'calculo-'+cfg.archivo+'-'+sufijoArchivo()+'.pdf',tipo);
  return doc;
}

/* Dibuja el cuadrante del mes en la mitad superior de la hoja */
function dibujarCuadrantePDF(doc, y, MG, ancho, W, anio, mes, C){
  var t=totalesMes(anio,mes);
  var cw=ancho/7;

  var primeroTmp=new Date(anio,mes,1);
  var offset=(primeroTmp.getDay()+6)%7;
  var ultimo=new Date(anio,mes+1,0).getDate();
  var filasMes=Math.ceil((offset+ultimo)/7);
  var ch=(filasMes>=6)?14.4:17.2;

  /* Título del mes */
  doc.setTextColor(C.ORO[0],C.ORO[1],C.ORO[2]);
  doc.setFont("helvetica","bold"); doc.setFontSize(10);
  doc.text(MESES_ES[mes].toUpperCase()+" "+anio, W/2, y, {align:"center"});
  y+=4.5;

  /* Cabecera de días */
  var DOW=["LUNES","MARTES","MIERCOLES","JUEVES","VIERNES","SABADO","DOMINGO"];
  for(var i=0;i<7;i++){
    var esFS=(i>=5);
    doc.setFillColor.apply(doc,esFS?C.ORObg:C.SURF);
    doc.setDrawColor(C.LIN[0],C.LIN[1],C.LIN[2]); doc.setLineWidth(0.25);
    doc.rect(MG+cw*i, y, cw, 6, "FD");
    doc.setFont("helvetica","bold"); doc.setFontSize(6.2);
    doc.setTextColor(esFS?C.ORO[0]:C.MUT[0], esFS?C.ORO[1]:C.MUT[1], esFS?C.ORO[2]:C.MUT[2]);
    doc.text(DOW[i], MG+cw*i+cw/2, y+4, {align:"center"});
  }
  y+=6;

  var col=offset, fila=0;
  for(var v=0; v<offset; v++){
    doc.setFillColor(255,255,255);
    doc.setDrawColor(240,238,234); doc.setLineWidth(0.15);
    doc.rect(MG+cw*v, y, cw, ch, "FD");
  }

  for(var d=1; d<=ultimo; d++){
    var x=MG+cw*col, yy=y+ch*fila;
    var fecha=new Date(anio,mes,d);
    var r=resumenDia(anio,mes,d);
    var plus=diaConPlus(fecha);

    if(r&&r.tipo==="trab"){ doc.setFillColor(237,247,239); }
    else if(r&&r.tipo==="vac"){ doc.setFillColor(238,244,252); }
    else if(plus){ doc.setFillColor.apply(doc,C.ORObg); }
    else { doc.setFillColor.apply(doc,C.SURF); }
    doc.setDrawColor(C.LIN[0],C.LIN[1],C.LIN[2]); doc.setLineWidth(0.25);
    doc.rect(x, yy, cw, ch, "FD");

    doc.setFont("helvetica","bold"); doc.setFontSize(7.6);
    doc.setTextColor(plus?C.ORO[0]:C.MUT[0], plus?C.ORO[1]:C.MUT[1], plus?C.ORO[2]:C.MUT[2]);
    doc.text(String(d), x+2, yy+4.6);

    if(r&&r.tipo==="trab"){
      doc.setFont("helvetica","normal"); doc.setFontSize(6.4);
      doc.setTextColor(C.VER[0],C.VER[1],C.VER[2]);
      if(r.lineas.length===2){
        doc.text(r.lineas[0], x+cw/2, yy+8.6, {align:"center"});
        doc.text(r.lineas[1], x+cw/2, yy+12.4, {align:"center"});
      } else {
        doc.text(r.lineas[0], x+cw/2, yy+10.4, {align:"center"});
      }
      doc.setFont("helvetica","bold"); doc.setFontSize(6.4);
      doc.setTextColor(C.TXT2[0],C.TXT2[1],C.TXT2[2]);
      doc.text(String(r.horas).replace(".",",")+" h", x+cw-2, yy+4.6, {align:"right"});
    } else if(r&&r.tipo==="vac"){
      doc.setFont("helvetica","bold"); doc.setFontSize(7.4);
      doc.setTextColor(C.AZU[0],C.AZU[1],C.AZU[2]);
      doc.text("VACAC.", x+cw/2, yy+ch/2+2.4, {align:"center"});
    }

    col++;
    if(col>6){col=0;fila++;}
  }
  if(col>0){
    for(var w=col; w<7; w++){
      doc.setFillColor(255,255,255);
      doc.setDrawColor(240,238,234); doc.setLineWidth(0.15);
      doc.rect(MG+cw*w, y+ch*fila, cw, ch, "FD");
    }
    fila++;
  }
  y += ch*fila + 4.5;
  doc.setFont('helvetica','normal');doc.setFontSize(6);
  doc.setTextColor(C.MUT[0],C.MUT[1],C.MUT[2]);
  doc.text('Horas por día natural. Un tramo desde las 00:00 puede continuar el turno del día anterior.',MG,y-1.5);

  /* Franja resumen del mes */
  var hh=function(n){ return String(Math.round(n*100)/100).replace(".",",")+" h"; };
  doc.setFillColor(C.SURF[0],C.SURF[1],C.SURF[2]);
  doc.setDrawColor(C.LIN[0],C.LIN[1],C.LIN[2]); doc.setLineWidth(0.35);
  doc.roundedRect(MG,y,ancho,19,2.5,2.5,"FD");
  var items=[
    ["Días con horas", String(t.diasTrab)+(t.diasTrab===1?" día":" días"), false],
    ["Libres", String(t.diasLibres)+(t.diasLibres===1?" día":" días"), false],
    ["Vacaciones", String(t.diasVac)+(t.diasVac===1?" día":" días"), false],
    ["Nocturnas", hh(t.noct), false],
    ["Finde / festivo", hh(t.plus), false],
    ["TOTAL", hh(t.horas), true]
  ];
  var celda=ancho/items.length;
  items.forEach(function(it,i){
    if(i>0){
      doc.setDrawColor(C.LIN[0],C.LIN[1],C.LIN[2]); doc.setLineWidth(0.2);
      doc.line(MG+celda*i, y+3, MG+celda*i, y+16);
    }
    doc.setFont("helvetica","normal"); doc.setFontSize(6.4);
    doc.setTextColor(C.MUT[0],C.MUT[1],C.MUT[2]);
    doc.text(it[0], MG+celda*i+celda/2, y+6.4, {align:"center"});
    doc.setFont("helvetica","bold"); doc.setFontSize(it[2]?11.5:9);
    doc.setTextColor(it[2]?C.ORO[0]:C.TXT[0], it[2]?C.ORO[1]:C.TXT[1], it[2]?C.ORO[2]:C.TXT[2]);
    doc.text(it[1], MG+celda*i+celda/2, y+14.2, {align:"center"});
  });
  return y+19+7;
}

/* Comparte el PDF por el panel nativo del móvil (WhatsApp, Mail, Guardar...)
   si el navegador lo permite; si no, lo descarga directamente. */
function guardarOCompartir(doc, filename, tipo){
  var blob;
  try{ blob=doc.output("blob"); }
  catch(e){ doc.save(filename); return; }

  var file=null;
  try{ file=new File([blob],filename,{type:"application/pdf"}); }catch(e){ file=null; }

  /* En móvil/tablet abrimos el panel de compartir; en ordenador descargamos directamente */
  var esTactil=false;
  try{
    esTactil = (navigator.maxTouchPoints||0)>0 &&
               window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
  }catch(e){ esTactil=false; }

  var puedeCompartir=false;
  try{puedeCompartir=esTactil&&file&&typeof navigator.share==='function'&&navigator.canShare&&navigator.canShare({files:[file]});}catch(e){}
  if(puedeCompartir){
    try{Promise.resolve(navigator.share({files:[file], title:filename})).then(function(){
      window.VigilanteAnalytics?.track('pdf_export',{method:'Share'});
    }).catch(function(err){
      if(err && err.name==="AbortError") return; // el usuario ha cancelado, no hacemos nada más
      descargarBlobDirecto(blob,filename,tipo);
    });}catch(e){descargarBlobDirecto(blob,filename,tipo);}
  } else {
    descargarBlobDirecto(blob,filename,tipo);
  }
}

function descargarBlobDirecto(blob, filename, tipo){
  var url=URL.createObjectURL(blob);
  var a=document.createElement("a");
  a.href=url; a.download=filename;
  document.body.appendChild(a); a.click();
  setTimeout(function(){ a.remove(); URL.revokeObjectURL(url); },10000);
  window.VigilanteAnalytics?.track('pdf_export',{method:'Download'});
}

/* ══════════════════════════════════════════════════════════
   CUADRANTE MENSUAL
   Calcula totales y los vuelca a los campos de horas.
   No toca el motor de nómina: solo lo alimenta.
   ══════════════════════════════════════════════════════════ */
var CUAD = {};                 // { "2026-09": { "1": {tramos:[...], vac:bool, fest:bool} } }
var calAnio, calMes;           // mes visible (mes 0-11)
var dlgClave = null;           // "2026-09|1" del día que se está editando
var MODO_HORAS = "manual";

var MESES_ES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

/* ── Festivos nacionales (Viernes Santo calculado con el algoritmo de Pascua) ── */
function domingoPascua(a){
  var A=a%19, B=Math.floor(a/100), C=a%100, D=Math.floor(B/4), E=B%4;
  var F=Math.floor((B+8)/25), G=Math.floor((B-F+1)/3), H=(19*A+B-D-G+15)%30;
  var I=Math.floor(C/4), K=C%4, L=(32+2*E+2*I-H-K)%7;
  var M=Math.floor((A+11*H+22*L)/451);
  var mes=Math.floor((H+L-7*M+114)/31), dia=((H+L-7*M+114)%31)+1;
  return new Date(a,mes-1,dia);
}
function festivosNacionales(a){
  var f={};
  [[0,1],[0,6],[4,1],[7,15],[9,12],[10,1],[11,6],[11,8],[11,25]].forEach(function(p){
    f[p[0]+"-"+p[1]]=true;
  });
  var vs=new Date(domingoPascua(a).getTime()-2*864e5);   // Viernes Santo
  f[vs.getMonth()+"-"+vs.getDate()]=true;
  return f;
}
var CACHE_FEST={};
function esFestivoNacional(d){
  var a=d.getFullYear();
  if(!CACHE_FEST[a]) CACHE_FEST[a]=festivosNacionales(a);
  return !!CACHE_FEST[a][d.getMonth()+"-"+d.getDate()];
}

/* ── Acceso a datos ── */
function claveMes(a,m){ return a+"-"+String(m+1).padStart(2,"0"); }
function datosDia(a,m,d){
  var mm=CUAD[claveMes(a,m)];
  return (mm&&mm[d])?mm[d]:null;
}
function guardarCuad(){
  invalidarCalculo('nomina');
  try{ localStorage.setItem("cuadrante_vigilante",JSON.stringify(CUAD)); }catch(e){}
}
function cargarCuad(){
  try{
    var parsed=window.VigilanteSecurity.calendar(localStorage.getItem("cuadrante_vigilante"));CUAD=parsed.data;
    if(parsed.rejected){
      var notice=document.getElementById('calendar-warning');
      notice.hidden=false;notice.textContent='Se han descartado datos de turnos no válidos. Revisa tu cuadrante antes de calcular.';
    }
  }catch(e){ CUAD=Object.create(null); }
}

/* ── ¿Este día concreto genera plus de fin de semana / festivo? ── */
function diaConPlus(fecha){
  var dow=fecha.getDay();                    // 0 domingo, 6 sábado
  if(dow===0||dow===6) return true;
  if(esFestivoNacional(fecha)) return true;
  var dd=datosDia(fecha.getFullYear(),fecha.getMonth(),fecha.getDate());
  return !!(dd&&dd.fest);
}

/* ── Trocea un tramo en minutos y los reparte por día natural y franja ── */
function trocearTramo(inicio, fin){
  var res={total:0,noct:0,plus:0};
  var cur=new Date(inicio.getTime()), FIN=fin.getTime();
  var guardia=0;
  while(cur.getTime()<FIN && guardia++<400){
    var h=cur.getHours();
    // siguiente frontera relevante: 06:00, 22:00 o medianoche
    var lim=new Date(cur.getFullYear(),cur.getMonth(),cur.getDate(), h<6?6:(h<22?22:24), 0, 0, 0);
    var next=Math.min(FIN, lim.getTime());
    var mins=(next-cur.getTime())/60000;
    if(mins>0){
      res.total+=mins;
      if(h<6||h>=22) res.noct+=mins;
      if(diaConPlus(cur)) res.plus+=mins;
    }
    cur=new Date(next);
  }
  return res;
}

/* ── Convierte {i:"22:00", f:"06:00"} del día d en fechas reales ── */
function tramoAFechas(a,m,d,t){
  if(!t||!window.VigilanteSecurity.validTime(t.i)||!window.VigilanteSecurity.validTime(t.f)) return null;
  if(t.i===t.f)return null;
  var pi=t.i.split(":"), pf=t.f.split(":");
  var ini=new Date(a,m,d,parseInt(pi[0],10),parseInt(pi[1],10),0,0);
  var fin=new Date(a,m,d,parseInt(pf[0],10),parseInt(pf[1],10),0,0);
  if(fin.getTime()<=ini.getTime()) fin=new Date(a,m,d+1,parseInt(pf[0],10),parseInt(pf[1],10),0,0);  // cruza medianoche
  return {ini:ini,fin:fin};
}

/* ── Totales del mes visible ── */
function horasDiaVacaciones(){
  return (jornActual==='parcial'?(parseFloat(document.getElementById('hPactadas').value)||0):162)/31;
}
function totalesMes(a,m){
  var t={horas:0,horasTrabajadas:0,noct:0,plus:0,diasTrab:0,diasVac:0,diasLibres:0};
  var inicio=new Date(a,m,1),fin=new Date(a,m+1,1),ultimo=new Date(a,m+1,0).getDate(),trabajados=new Set();
  // Include the previous evening; clip both sides to the actual calendar month.
  for(var d=0;d<=ultimo;d++){
    var fecha=new Date(a,m,d),dd=datosDia(fecha.getFullYear(),fecha.getMonth(),fecha.getDate());
    var jornada=(dd&&dd.tramos||[]).map(function(tr){return tramoAFechas(fecha.getFullYear(),fecha.getMonth(),fecha.getDate(),tr);}).filter(Boolean);
    var completa=jornada.reduce(function(r,ff){var p=trocearTramo(ff.ini,ff.fin);r.total+=p.total;r.noct+=p.noct;return r;},{total:0,noct:0});
    var noctPagable=VigilanteRules.nightPremium(completa.total,completa.noct);
    jornada.forEach(function(ff){
      var ini=new Date(Math.max(inicio.getTime(),ff.ini.getTime())),lim=new Date(Math.min(fin.getTime(),ff.fin.getTime()));
      if(ini>=lim)return;
      var r=trocearTramo(ini,lim);t.horasTrabajadas+=r.total;t.noct+=completa.noct>=240?noctPagable*r.total/completa.total:r.noct;t.plus+=r.plus;
      var dia=new Date(ini.getFullYear(),ini.getMonth(),ini.getDate());
      while(dia<lim){trabajados.add(dia.getDate());dia=new Date(a,m,dia.getDate()+1);}
    });
  }
  for(var d=1;d<=ultimo;d++){
    var dd=datosDia(a,m,d);
    if(trabajados.has(d))t.diasTrab++;
    else if(dd&&dd.vac)t.diasVac++;
    else t.diasLibres++;
  }
  t.horasTrabajadas=Math.round(t.horasTrabajadas/60*100)/100;
  t.horas=Math.round((t.horasTrabajadas+t.diasVac*horasDiaVacaciones())*100)/100;
  t.noct=Math.round(t.noct/60*100)/100;t.plus=Math.round(t.plus/60*100)/100;
  return t;
}

/* Horas del día natural, incluida la continuación de la noche anterior. */
function tramosDelDia(a,m,d){
  var inicio=new Date(a,m,d),fin=new Date(a,m,d+1),tramos=[];
  [new Date(a,m,d-1),inicio].forEach(function(fecha){
    var dd=datosDia(fecha.getFullYear(),fecha.getMonth(),fecha.getDate());
    (dd&&dd.tramos||[]).forEach(function(tr){
      var ff=tramoAFechas(fecha.getFullYear(),fecha.getMonth(),fecha.getDate(),tr);
      if(!ff||ff.ini>=fin||ff.fin<=inicio)return;
      tramos.push({ini:new Date(Math.max(+inicio,+ff.ini)),fin:new Date(Math.min(+fin,+ff.fin)),continua:ff.ini<inicio});
    });
  });
  return tramos.sort(function(x,y){return x.ini-y.ini;});
}

/* ── Resumen compacto de un día para la celda y el PDF ── */
function resumenDia(a,m,d){
  var dd=datosDia(a,m,d),tramos=tramosDelDia(a,m,d);
  if(tramos.length){
    var mins=tramos.reduce(function(total,tr){return total+(tr.fin-tr.ini)/60000;},0);
    var hora=function(fecha){return +fecha===+new Date(a,m,d+1)?'24:00':String(fecha.getHours()).padStart(2,'0')+':'+String(fecha.getMinutes()).padStart(2,'0');};
    var lineas=tramos.length===1?[hora(tramos[0].ini),hora(tramos[0].fin)]:[tramos.length+' tramos'];
    return {tipo:'trab',lineas:lineas,horas:Math.round(mins/60*100)/100,fest:!!(dd&&dd.fest),continua:tramos.some(function(tr){return tr.continua;})};
  }
  if(!dd)return null;
  if(dd.vac) return {tipo:"vac", lineas:["V"], horas:horasDiaVacaciones(), fest:!!dd.fest};
  if(dd.fest) return {tipo:"libre", lineas:[], horas:0, fest:true};
  return null;
}

/* ── Pintado del calendario ── */
function pintarCalendario(){
  invalidarCalculo('nomina');
  var grid=document.getElementById("cal-grid");
  if(!grid) return;
  document.getElementById("cal-titulo").textContent=MESES_ES[calMes]+" "+calAnio;
  var primero=new Date(calAnio,calMes,1);
  var offset=(primero.getDay()+6)%7;              // lunes = 0
  var ultimo=new Date(calAnio,calMes+1,0).getDate();
  var hoy=new Date();
  var h="";
  for(var i=0;i<offset;i++) h+='<div class="cal-cell vacio"></div>';
  for(var d=1; d<=ultimo; d++){
    var fecha=new Date(calAnio,calMes,d);
    var r=resumenDia(calAnio,calMes,d);
    var cls="cal-cell";
    if(diaConPlus(fecha)) cls+=" finde";
    if(r&&r.tipo==="trab") cls+=" trab";
    else if(r&&r.tipo==="vac") cls+=" vac";
    if((r&&r.fest)||esFestivoNacional(fecha)) cls+=" festivo";
    if(fecha.toDateString()===hoy.toDateString()) cls+=" hoy";
    h+='<div class="'+cls+'" data-dia="'+d+'"'+(r&&r.continua?' title="Incluye la continuación del turno del día anterior"':'')+'>';
    h+='<span class="cal-num">'+d+'</span>';
    if(r&&r.lineas&&r.lineas.length){
      h+='<span class="cal-tag">'+r.lineas.join('<br>')+'</span>';
    }
    if(r&&r.horas>0&&r.tipo==="trab") h+='<span class="cal-hrs">'+String(r.horas).replace(".",",")+'h</span>';
    h+='</div>';
  }
  grid.innerHTML=h;
  Array.prototype.forEach.call(grid.querySelectorAll(".cal-cell[data-dia]"),function(c){
    c.addEventListener("click",function(){ abrirDialogo(parseInt(c.getAttribute("data-dia"),10)); });
  });
  pintarResumen();
}

function pintarResumen(){
  var t=totalesMes(calAnio,calMes);
  var box=document.getElementById("cal-resumen");
  if(!box) return;
  if(t.horas===0&&t.diasTrab===0&&t.diasVac===0){
    box.innerHTML='<div class="cal-vacio-msg">Aún no has introducido ningún turno de este mes.</div>';
  } else {
    function fila(l,v,dest){ return '<div class="cal-res-row'+(dest?' destacada':'')+'"><span class="cal-res-lbl">'+l+'</span><span class="cal-res-val">'+v+'</span></div>'; }
    var hh=function(n){ return String(Math.round(n*100)/100).replace(".",",")+" h"; };
    box.innerHTML =
      fila("Días trabajados", t.diasTrab)+
      fila("Días libres", t.diasLibres)+
      (t.diasVac>0?fila("Días de vacaciones", t.diasVac):"")+
      fila("Horas nocturnas", hh(t.noct))+
      fila("Horas fin de semana / festivo", hh(t.plus))+
      fila("Horas totales del mes", hh(t.horas), true);
  }
  volcarTotales(t);
  actualizarComplementoVacaciones();
}

/* Vuelca los totales a los campos que ya usa el motor de nómina */
function volcarTotales(t){
  if(MODO_HORAS!=="cuadrante") return;
  document.getElementById("hTTotal").value = t.horasTrabajadas>0 ? t.horasTrabajadas : "";
  document.getElementById("hNoc").value    = t.noct>0  ? t.noct  : "";
  document.getElementById("hFest").value   = t.plus>0  ? t.plus  : "";
}

/* ── Diálogo de turnos ── */
function filaTramo(i,f){
  i=window.VigilanteSecurity.validTime(i)?i:'';
  f=window.VigilanteSecurity.validTime(f)?f:'';
  return '<div class="tramo">'+
    '<input type="time" class="t-ini" aria-label="Hora de entrada" value="'+(i||"")+'" step="300">'+
    '<span class="tramo-sep">a</span>'+
    '<input type="time" class="t-fin" aria-label="Hora de salida" value="'+(f||"")+'" step="300">'+
    '<button type="button" class="tramo-del" aria-label="Quitar tramo">×</button></div>';
}
function engancharBorrarTramo(){
  var cont=document.getElementById("dlg-tramos");
  Array.prototype.forEach.call(cont.querySelectorAll(".tramo-del"),function(b){
    b.onclick=function(){
      b.parentNode.parentNode.removeChild(b.parentNode);
      if(!cont.querySelector(".tramo")) cont.innerHTML=filaTramo("","");
      engancharBorrarTramo(); actualizarNotaDlg();
    };
  });
  Array.prototype.forEach.call(cont.querySelectorAll("input[type=time]"),function(inp){
    inp.onchange=actualizarNotaDlg;
  });
}
function actualizarNotaDlg(){
  if(!dlgClave) return;
  var p=dlgClave.split("|"), pm=p[0].split("-");
  var a=parseInt(pm[0],10), m=parseInt(pm[1],10)-1, d=parseInt(p[1],10);
  var tramos=leerTramosDlg();
  if(!tramos.length){ document.getElementById("dlg-nota").innerHTML=""; return; }
  var tot=0,noc=0,plus=0;
  tramos.forEach(function(tr){
    var ff=tramoAFechas(a,m,d,tr);
    if(!ff) return;
    var r=trocearTramo(ff.ini,ff.fin);
    tot+=r.total; noc+=r.noct; plus+=r.plus;
  });
  var hh=function(n){ return String(Math.round(n/60*100)/100).replace(".",","); };
  var txt="Total del día: <b>"+hh(tot)+" h</b>";
  if(noc>0)  txt+=" · "+hh(VigilanteRules.nightPremium(tot,noc))+" h con plus nocturno";
  if(plus>0) txt+=" · "+hh(plus)+" h con plus de fin de semana/festivo";
  document.getElementById("dlg-nota").innerHTML=txt;
}
function leerTramosDlg(){
  var out=[];
  Array.prototype.forEach.call(document.querySelectorAll("#dlg-tramos .tramo"),function(t){
    var i=t.querySelector(".t-ini").value, f=t.querySelector(".t-fin").value;
    if(out.length<24&&window.VigilanteSecurity.validTime(i)&&window.VigilanteSecurity.validTime(f)) out.push({i:i,f:f});
  });
  return out;
}

function abrirDialogo(d){
  dlgClave=claveMes(calAnio,calMes)+"|"+d;
  var fecha=new Date(calAnio,calMes,d);
  var DOW=["domingo","lunes","martes","miércoles","jueves","viernes","sábado"];
  document.getElementById("dlg-titulo").textContent="Turnos del día "+d;
  var sub=DOW[fecha.getDay()]+", "+d+" de "+MESES_ES[calMes].toLowerCase()+" de "+calAnio;
  if(esFestivoNacional(fecha)) sub+="  ·  Festivo nacional";
  else if(fecha.getDay()===0||fecha.getDay()===6) sub+="  ·  Fin de semana";
  document.getElementById("dlg-subtitulo").textContent=sub;
  var continuacion=tramosDelDia(calAnio,calMes,d).filter(function(tr){return tr.continua;});
  var avisoContinuacion=document.getElementById('dlg-continuacion');
  avisoContinuacion.hidden=!continuacion.length;
  if(continuacion.length){
    var anterior=new Date(calAnio,calMes,d-1);
    avisoContinuacion.textContent='Este día incluye la continuación de un turno del '+anterior.getDate()+' de '+MESES_ES[anterior.getMonth()].toLowerCase()+'. Para cambiar esa parte, edita el día en que empezó el turno.';
  }

  var dd=datosDia(calAnio,calMes,d);
  var cont=document.getElementById("dlg-tramos");
  if(dd&&dd.tramos&&dd.tramos.length){
    cont.innerHTML=dd.tramos.map(function(t){return filaTramo(t.i,t.f);}).join("");
  } else {
    cont.innerHTML=filaTramo("","");
  }
  document.getElementById("dlg-vac").checked = !!(dd&&dd.vac);
  document.getElementById("dlg-fest").checked = !!(dd&&dd.fest);
  engancharBorrarTramo(); actualizarNotaDlg();
  document.getElementById("dlg-overlay").classList.add("abierto");
}
function cerrarDialogo(){
  document.getElementById("dlg-overlay").classList.remove("abierto");
  dlgClave=null;
}
function guardarDialogo(){
  if(document.getElementById("dlg-vac").checked){
    var clave=dlgClave;
    solicitarCuentaVacaciones(function(){
      if(clave&&dlgClave===clave) guardarDialogoRegistrado();
    });
    return;
  }
  guardarDialogoRegistrado();
}
function guardarDialogoRegistrado(){
  if(!dlgClave) return;
  var p=dlgClave.split("|"), mk=p[0], d=p[1];
  var tramos=leerTramosDlg();
  var vac=document.getElementById("dlg-vac").checked;
  var fest=document.getElementById("dlg-fest").checked;
  var incompleto=Array.from(document.querySelectorAll('#dlg-tramos .tramo')).some(function(row){return !!row.querySelector('.t-ini').value!==!!row.querySelector('.t-fin').value;});
  if(incompleto){document.getElementById('dlg-nota').textContent='Completa el inicio y el final de cada tramo.';return;}
  var candidato=JSON.parse(JSON.stringify(CUAD));
  if(!candidato[mk])candidato[mk]={};
  candidato[mk][d]={tramos:tramos,vac:vac,fest:fest};
  var conflicto=validarCuadrante(candidato,Number(mk.slice(0,4)),Number(mk.slice(5))-1);
  if(conflicto){document.getElementById('dlg-nota').textContent=conflicto;return;}
  if(!CUAD[mk]) CUAD[mk]={};
  if(!tramos.length&&!vac&&!fest){ delete CUAD[mk][d]; }
  else { CUAD[mk][d]={tramos:tramos, vac:vac, fest:fest}; }
  if(!Object.keys(CUAD[mk]).length) delete CUAD[mk];
  guardarCuad(); cerrarDialogo(); pintarCalendario();
}
function borrarDialogo(){
  if(!dlgClave) return;
  var p=dlgClave.split("|"), mk=p[0], d=p[1];
  if(CUAD[mk]){ delete CUAD[mk][d]; if(!Object.keys(CUAD[mk]).length) delete CUAD[mk]; }
  guardarCuad(); cerrarDialogo(); pintarCalendario();
}

/* ── Arranque del cuadrante ── */
(function initCuadrante(){
  function listo(){
    cargarCuad();
    var hoy=new Date(); calAnio=hoy.getFullYear(); calMes=hoy.getMonth();

    var bm=document.getElementById("modo-manual"), bc=document.getElementById("modo-cuadrante");
    if(!bm||!bc) return;
    bm.addEventListener("click",function(){
      if(MODO_HORAS==='cuadrante'){
        var trasladado=totalesMes(calAnio,calMes);
        document.getElementById('diasVac').value=trasladado.diasVac;
        document.getElementById('switchVac').checked=trasladado.diasVac>0&&cuentaVacacionesActiva;
        document.getElementById('vac-field').style.display=trasladado.diasVac>0&&cuentaVacacionesActiva?'block':'none';
      }
      invalidarCalculo('nomina');
      MODO_HORAS="manual";
      bm.classList.add("active"); bc.classList.remove("active");
      document.getElementById("campos-manual").style.display="block";
      document.getElementById("campos-cuadrante").style.display="none";
      actualizarComplementoVacaciones();
    });
    bc.addEventListener("click",function(){
      MODO_HORAS="cuadrante";
      bc.classList.add("active"); bm.classList.remove("active");
      document.getElementById("campos-manual").style.display="none";
      document.getElementById("campos-cuadrante").style.display="block";
      pintarCalendario();
    });
    document.getElementById("cal-prev").addEventListener("click",function(){
      calMes--; if(calMes<0){calMes=11;calAnio--;} pintarCalendario();
    });
    document.getElementById("cal-next").addEventListener("click",function(){
      calMes++; if(calMes>11){calMes=0;calAnio++;} pintarCalendario();
    });
    document.getElementById("dlg-add").addEventListener("click",function(){
      if(document.querySelectorAll('#dlg-tramos .tramo').length>=24){
        document.getElementById('dlg-nota').textContent='Puedes añadir hasta 24 tramos por día.';
        return;
      }
      document.getElementById("dlg-tramos").insertAdjacentHTML("beforeend",filaTramo("",""));
      engancharBorrarTramo();
    });
    document.getElementById("dlg-guardar").addEventListener("click",guardarDialogo);
    document.getElementById("dlg-borrar").addEventListener("click",borrarDialogo);
    document.getElementById("dlg-cancelar").addEventListener("click",cerrarDialogo);
    document.getElementById("dlg-overlay").addEventListener("click",function(e){
      if(e.target===this) cerrarDialogo();
    });
    document.getElementById("dlg-vac").addEventListener("change",function(){
      if(!this.checked){actualizarNotaDlg();return;}
      this.checked=false;
      var clave=dlgClave, control=this;
      solicitarCuentaVacaciones(function(){
        if(clave&&dlgClave===clave){control.checked=true;actualizarNotaDlg();}
      });
    });
    document.getElementById("dlg-fest").addEventListener("change",actualizarNotaDlg);
  }
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",listo);
  else listo();
})();

/* Tablas y motor de cálculo: calculator-engine.js */
var C=window.VigilanteCalc;
var CATS=C.CATS,QUINQUENIO=C.QUINQUENIO,JORNADA=C.JORNADA,HORAS_ANUALES=C.HORAS_ANUALES,PLUS_FEST=C.PLUS_FEST;
var catEf=C.catEf,tienePlusFestivo=C.tienePlusFestivo,r2=C.r2,calcAntig=C.calcAntig,calcHoraExtra=C.calcHoraExtra;
var calcularNomina=C.calcularNomina,propPaga=C.propPaga,calcularFiniquito=C.calcularFiniquito,calcularBaja=C.calcularBaja;




var catActual="sin_arma", jornActual="completa";
var fcatActual="sin_arma", fjornActual="completa", bcatActual="sin_arma";
var cuentaVacacionesActiva=false;


function fmt(n){return n.toLocaleString("es-ES",{minimumFractionDigits:2,maximumFractionDigits:2})+" €";}
function num(n){return String(Math.round(n*100)/100).replace(".",",");}


function valor(id){return document.getElementById(id).value;}
function numero(id){return Number(valor(id))||0;}
function el(id){return document.getElementById(id);}
function nochesEspeciales(a,m){
  if(m!==11)return 0;
  var count=0;
  [24,31].forEach(function(d){
    var ini=new Date(a,m,d,22),fin=new Date(a,m,d+1,6),found=false;
    [d,d+1].forEach(function(n){var fecha=new Date(a,m,n),entry=datosDia(fecha.getFullYear(),fecha.getMonth(),fecha.getDate());
      (entry&&entry.tramos||[]).forEach(function(t){var f=tramoAFechas(fecha.getFullYear(),fecha.getMonth(),fecha.getDate(),t);if(f&&f.ini<fin&&f.fin>ini)found=true;});});
    if(found)count++;
  });
  return count;
}
function showR(rid,lid,vid,lbl,val,cls){
  var row=el(rid);
  cls=cls||"up";
  if(val>0.005){
    row.style.display="flex";
    if(lid)el(lid).textContent=lbl;
    el(vid).textContent=(cls==="down"?"-":"+")+fmt(val);
    el(vid).className="res-val "+cls;
  } else {row.style.display="none";}
}
function mostrarError(boxId,resultId,tipo,mensaje){
  var box=el(boxId);box.textContent=mensaje;box.style.display='block';
  invalidarCalculo(tipo);
}
function ocultarError(boxId){el(boxId).style.display='none';}
function irAResultado(id){setTimeout(function(){el(id).scrollIntoView({behavior:"smooth",block:"nearest"});},60);}
function tras_calcular(){
  cargarJsPDF(function(){});
  window.VigilanteInstall?.calculationCompleted();
  window.VigilanteAnalytics?.track('calculation_complete');
}

/* ── Pestañas ── */
["nomina","finiquito","baja"].forEach(function(t){
  el("tab-"+t).addEventListener("click",function(){
    if(t!=="nomina"&&window.VigilanteAuth){window.VigilanteAuth.require(function(){mostrarVista(t);});return;}
    mostrarVista(t);
  });
});
function mostrarVista(t){
  ["nomina","finiquito","baja"].forEach(function(x){
    el("tab-"+x).classList.toggle("active",x===t);
    el("tab-"+x).setAttribute("aria-pressed",String(x===t));
    el("view-"+x).style.display=x===t?"block":"none";
  });
}

/* ── Controles compartidos ── */
function grupoCategorias(prefijo,vista,tarjetaCond,switchCond,alCambiar){
  Object.keys(CATS).forEach(function(c){
    el(prefijo+"-"+c).addEventListener("click",function(){
      document.querySelectorAll("#"+vista+" .cat-btn").forEach(function(b){b.classList.remove("active");});
      el(prefijo+"-"+c).classList.add("active");
      var conConductor=!!CATS[c].cBase;
      el(tarjetaCond).style.display=conConductor?"block":"none";
      if(!conConductor)el(switchCond).checked=false;
      alCambiar(c);
    });
  });
}
function grupoJornada(prefijo,campo,alCambiar){
  var botones={completa:el(prefijo+"jorn-completa"),parcial:el(prefijo+"jorn-parcial"),dias:el(prefijo+"jorn-dias")};
  Object.keys(botones).forEach(function(tipo){
    if(!botones[tipo])return;
    botones[tipo].addEventListener("click",function(){
      Object.keys(botones).forEach(function(t){if(botones[t])botones[t].classList.toggle("active",t===tipo);});
      el(campo).style.display=tipo==="parcial"?"block":"none";alCambiar(tipo);
    });
  });
}
function grupoPagas(ids,activa,inactiva){
  ids.forEach(function(id){
    el(id).addEventListener("click",function(){
      this.classList.toggle("active");
      this.setAttribute("aria-pressed",String(this.classList.contains("active")));
      this.querySelector(".paga-sub").textContent=this.classList.contains("active")?activa:inactiva;
    });
  });
}

/* ══════════════════════════════════════════════════════════
   NÓMINA
   ══════════════════════════════════════════════════════════ */
function actualizarPlusesCategoria(){
  var conductor=el('switchCond').checked;
  var a=parseInt(valor('aniosAntiguedad'),10)||0, q=Math.floor(a/5);
  var cat=catEf(catActual,conductor);
  el('badge-noc').textContent='+'+cat.nocH.toFixed(2).replace('.',',')+' €/h';
  el('badge-fest').hidden=!tienePlusFestivo(catActual);
  el("hint-antiguedad").textContent=q<1
    ?"Cada 5 años cobras un quinquenio ("+fmt(calcAntig(5,catActual,conductor))+"/mes)"
    :q+" quinquenio"+(q>1?"s":"")+" = +"+fmt(calcAntig(a,catActual,conductor))+"/mes";
}
grupoCategorias("btn","view-nomina","card-cond","switchCond",function(c){catActual=c;actualizarPlusesCategoria();});
grupoJornada("","parcial-field",function(j){
  jornActual=j;
  el("hint-jornada").textContent={
    completa:"Cobras el sueldo del mes entero. Si pasas de 162 h, el exceso es hora extra.",
    parcial:"Cobras en proporción a tus horas. Si haces más de las de tu contrato, son horas complementarias."
  }[j];
  actualizarHintVac();
  if(MODO_HORAS==='cuadrante')pintarCalendario();
});
el('hPactadas').addEventListener('input',function(){actualizarHintVac();if(MODO_HORAS==='cuadrante')pintarCalendario();});
el('aniosAntiguedad').addEventListener('input',actualizarPlusesCategoria);
el('switchCond').addEventListener('change',actualizarPlusesCategoria);
el("switchPlus").addEventListener("change",function(){
  el("plus-servicio-field").style.display=this.checked?"block":"none";
});
grupoPagas(["paga-julio","paga-dic","paga-mar"],"activa","inactiva");

/* Vacaciones: función de la cuenta gratuita */
function solicitarCuentaVacaciones(action){
  if(window.VigilanteAuth)return window.VigilanteAuth.require(action);
  var notice=el('account-notice');
  if(notice)notice.textContent='El acceso a cuentas no está disponible. Para añadir vacaciones necesitas iniciar sesión.';
}
el("switchVac").addEventListener("change",function(){
  if(this.checked){
    this.checked=false;
    solicitarCuentaVacaciones(function(){
      el("switchVac").checked=true;
      el("vac-field").style.display="block";
      actualizarHintVac();
      el("diasVac").focus();
    });
    return;
  }
  el("vac-field").style.display="none";
  el("diasVac").value="";
  actualizarHintVac();
});
el("diasVac").addEventListener("input",actualizarHintVac);
function actualizarAccesoVacaciones(member){
  cuentaVacacionesActiva=member;
  ['vac-access-note','dlg-vac-access-note'].forEach(function(id){
    var note=el(id);
    if(note)note.textContent=member?'Incluido en tu cuenta':'Disponible con registro gratuito';
  });
  if(member){actualizarComplementoVacaciones();return;}
  el('switchVac').checked=false;
  el('vac-field').style.display='none';
  el('diasVac').value='';
  actualizarHintVac();
  if(ctxPDF.nomina&&ctxPDF.nomina['Vacaciones']&&ctxPDF.nomina['Vacaciones']!=='Ninguna'){
    ctxPDF.nomina=null;
    el('resultado').style.display='none';
  }
}
window.actualizarAccesoVacaciones=actualizarAccesoVacaciones;
function diasVacSolicitados(){
  if(MODO_HORAS==='cuadrante')return totalesMes(calAnio,calMes).diasVac;
  return el('switchVac').checked?numero('diasVac'):0;
}
function diasVacacionesMes(){return cuentaVacacionesActiva?diasVacSolicitados():0;}
function actualizarHintVac(){
  actualizarComplementoVacaciones();
  var d=numero("diasVac");
  el("hint-vac").textContent=d>0
    ?d+" día"+(d!==1?"s":"")+" × "+horasDiaVacaciones().toFixed(2).replace(".",",")+" h = "+num(d*horasDiaVacaciones())+" h que cuentan como trabajadas"
    :"Cada día de vacaciones cuenta como horas de tu jornada.";
}
function actualizarComplementoVacaciones(){
  var conVacaciones=MODO_HORAS==='manual'?el('switchVac').checked:totalesMes(calAnio,calMes).diasVac>0;
  el('vac-plus-field').hidden=!(cuentaVacacionesActiva&&conVacaciones);
}

el("btnCalc").addEventListener("click",function(){calcNomina();});
document.querySelectorAll('[data-pdf]').forEach(function(button){
  button.addEventListener('click',function(){exportarPDF(button.dataset.pdf,button);});
});

/* Motor de la nómina: no lee el DOM, para poder probarlo. */


function calcNomina(){
  if(diasVacSolicitados()>0&&!cuentaVacacionesActiva){
    ctxPDF.nomina=null;el('resultado').style.display='none';
    solicitarCuentaVacaciones(calcNominaRegistrado);
    return;
  }
  calcNominaRegistrado();
}
function calcNominaRegistrado(){
  ctxPDF.nomina=null;
  var fail=function(m){mostrarError('errorBox','resultado','nomina',m);};
  if(MODO_HORAS==='cuadrante'){
    var conflicto=validarCuadrante(CUAD,calAnio,calMes);
    if(conflicto){fail(conflicto);return;}
    volcarTotales(totalesMes(calAnio,calMes));
  }
  if(!window.VigilanteSecurity.validateInputs('view-nomina','errorBox','resultado')){invalidarCalculo('nomina');return;}
  var conductor=el("switchCond").checked;
  var mes=MODO_HORAS==='cuadrante'?totalesMes(calAnio,calMes):null;
  var datos={
    categoria:catActual,conductor:conductor,jornada:jornActual,horasContrato:numero('hPactadas'),
    contrato:'indefinido',responsable:el('switchResponsable').checked,
    plusServicio:el('switchPlus').checked?numero('plusServicio'):0,anios:numero('aniosAntiguedad'),
    horas:mes?mes.horasTrabajadas:numero('hTTotal'),horasNoche:numero('hNoc'),horasFestivo:numero('hFest'),
    diasVac:diasVacacionesMes(),mediaPlusVac:0,diasMes:mes?new Date(calAnio,calMes+1,0).getDate():30,
    nochesEspeciales:mes?nochesEspeciales(calAnio,calMes):0,
    pagas:document.querySelectorAll("#view-nomina .paga-btn.active").length,irpf:numero('irpf')
  };
  if(datos.jornada==='parcial'&&!(datos.horasContrato>0)){fail("Escribe las horas al mes que pone tu contrato.");return;}
  if(datos.jornada==='parcial'&&datos.horasContrato>=JORNADA){fail("A tiempo parcial, las horas de contrato deben ser menos de 162. Si haces 162, elige jornada completa.");return;}
  if(datos.horas<=0&&datos.diasVac<=0){fail(MODO_HORAS==='cuadrante'?"Añade tus turnos en el cuadrante para calcular.":"Escribe las horas que has trabajado este mes.");return;}
  if(datos.horasNoche>datos.horas){fail("Las horas nocturnas no pueden ser más que las horas totales.");return;}
  if(datos.horasFestivo>datos.horas){fail("Las horas de fin de semana o festivo no pueden ser más que las horas totales.");return;}
  ocultarError('errorBox');
  var r=calcularNomina(datos);

  var suf=r.factor<1?" ("+num(r.hJor)+" h de "+num(r.hp)+" h)":(jornActual==='parcial'?" ("+num(r.hp)+" h de 162 h)":"");
  el("lbl-base").textContent="Salario base"+suf;
  el("lbl-pelig").textContent="Plus peligrosidad"+suf;
  el("r-base").textContent="+"+fmt(r.base);
  el("r-pelig").textContent="+"+fmt(r.pelig);
  showR("row-act","lbl-act","r-act","Plus de actividad"+suf,r.act);
  showR("row-escolta","lbl-escolta","r-escolta","Plus escolta"+suf,r.escolta);
  el("lbl-trans").textContent="Plus transporte"+suf;
  el("lbl-vest").textContent="Plus vestuario"+suf;
  el("r-trans").textContent="+"+fmt(r.trans);
  el("r-vest").textContent="+"+fmt(r.vest);
  showR("row-antig","lbl-antig","r-antig","Antigüedad ("+r.quinquenios+" quinquenio"+(r.quinquenios!==1?"s":"")+")",r.antig);
  showR("row-responsable","lbl-responsable","r-responsable","Plus de responsable de equipo (10% del salario base)",r.responsable);
  showR("row-plusserv",null,"r-plusserv","",r.plusServicio);
  if(r.hVac>0){
    el("row-vacinfo").style.display="flex";
    el("lbl-vacinfo").textContent="Vacaciones: "+datos.diasVac+" día"+(datos.diasVac!==1?"s":"");
    el("r-vacinfo").textContent=num(r.hVac)+" h de jornada";
  } else el("row-vacinfo").style.display="none";
  showR("row-vacplus","lbl-vacplus","r-vacplus","Pluses de noches y festivos en vacaciones ("+datos.diasVac+" días)",r.vacPlus);
  showR("row-extra","lbl-extra","r-extra",(jornActual==="parcial"?"Horas complementarias — ":"Horas extra — ")+num(r.horasExtra)+" h × "+fmt(r.valorHora),r.extra);
  showR("row-noc","lbl-noc","r-noc","Plus nocturnidad — "+num(datos.horasNoche)+" h × "+fmt(r.nocheTarifa),r.noche);
  showR("row-fest","lbl-fest","r-fest","Plus fin de semana y festivos — "+num(datos.horasFestivo)+" h × 1,02 €",r.fest);
  showR("row-navidad","lbl-navidad","r-navidad","Nochebuena / Nochevieja — "+datos.nochesEspeciales+" noche"+(datos.nochesEspeciales!==1?"s":""),r.navidad);
  showR("row-prorr","lbl-prorr","r-prorr",datos.pagas+" paga"+(datos.pagas!==1?"s":"")+" extra prorrateada"+(datos.pagas!==1?"s":""),r.prorrata);
  el("r-bruto").textContent=fmt(r.bruto);
  el("lbl-ss").textContent="Seguridad Social";
  el("r-ss").textContent="-"+fmt(r.ss);
  el('r-ss').title='Contingencias comunes '+fmt(r.cuotas.common)+' · MEI '+fmt(r.cuotas.mei)+' · Desempleo '+fmt(r.cuotas.unemployment)+' · Formación '+fmt(r.cuotas.training)+(r.cuotas.overtime?' · Horas extra '+fmt(r.cuotas.overtime):'');
  if(datos.irpf>0){el("row-irpf").style.display="flex";el("row-irpf0").style.display="none";el("lbl-irpf").textContent="Retención IRPF ("+num(datos.irpf)+"%)";el("r-irpf").textContent="-"+fmt(r.irpf);}
  else{el("row-irpf").style.display="none";el("row-irpf0").style.display="flex";}
  el("r-neto").textContent=fmt(r.neto);
  el("resultado").style.display="block";
  tras_calcular();
  ctxPDF.cuadrante=(MODO_HORAS==="cuadrante")?{anio:calAnio,mes:calMes}:null;
  ctxPDF.nomina={
    "Categoría":nombreCat(catActual,conductor),
    "Jornada":jornActual==='completa'?'Completa (mes entero)':'Parcial ('+num(r.hp)+' h/mes)',
    "Horas trabajadas":num(datos.horas)+" h"+(r.horasExtra>0?" ("+num(r.horasExtra)+" h "+(jornActual==='parcial'?'complementarias':'extra')+")":""),
    "Horas nocturnas":datos.horasNoche>0?num(datos.horasNoche)+" h":"Ninguna",
    "Horas fin de semana / festivo":r.festAplicable?(datos.horasFestivo>0?num(datos.horasFestivo)+" h":"Ninguna"):"Sin plus en esta categoría",
    "Vacaciones":datos.diasVac>0?datos.diasVac+" día"+(datos.diasVac!==1?"s":"")+" ("+num(r.hVac)+" h)":"Ninguna",
    "Antigüedad":datos.anios>0?datos.anios+" años ("+r.quinquenios+" quinquenio"+(r.quinquenios!==1?"s":"")+")":"Sin antigüedad",
    "Responsable de equipo":datos.responsable?"Sí":"No",
    "Pagas extra prorrateadas":datos.pagas>0?datos.pagas+" de 3":"Ninguna",
    "Retención IRPF":num(datos.irpf)+" %"
  };
  irAResultado("resultado");
}

/* ══════════════════════════════════════════════════════════
   FINIQUITO
   ══════════════════════════════════════════════════════════ */
grupoCategorias("fbtn","view-finiquito","card-condF","switchCondF",function(c){fcatActual=c;});
grupoJornada("f","f-parcial-field",function(j){fjornActual=j;});
grupoPagas(["fpaga-julio","fpaga-dic","fpaga-mar"],"prorrateada","no prorrateada");
function textoDuracion(si,sf){
  var dias=VigilanteRules.days(si,sf);
  // Meses completos desde el inicio y días restantes, con el último día incluido.
  var a=new Date(si+'T00:00:00Z'),fin=new Date(sf+'T00:00:00Z');fin.setUTCDate(fin.getUTCDate()+1);
  function sumarMeses(n){var y=a.getUTCFullYear(),m=a.getUTCMonth()+n,ultimo=new Date(Date.UTC(y,m+1,0)).getUTCDate();return new Date(Date.UTC(y,m,Math.min(a.getUTCDate(),ultimo)));}
  var meses=0;while(sumarMeses(meses+1)<=fin)meses++;
  var resto=Math.round((fin-sumarMeses(meses))/864e5),anios=Math.floor(meses/12),partes=[];meses%=12;
  if(anios)partes.push(anios+" año"+(anios>1?"s":""));
  if(meses)partes.push(meses+" mes"+(meses>1?"es":""));
  if(resto)partes.push(resto+" día"+(resto>1?"s":""));
  var texto=partes.length>1?partes.slice(0,-1).join(", ")+" y "+partes[partes.length-1]:partes[0];
  return texto+" ("+dias+(dias===1?" día natural)":" días naturales)");
}
function actuFechas(){
  var si=valor("f-inicio"),sf=valor("f-fin");
  if(!VigilanteRules.validDate(si)||!VigilanteRules.validDate(sf)||sf<si)return;
  var q=Math.floor(VigilanteRules.seniorityYears(si,sf)/5);
  el("f-hint-fechas").textContent=textoDuracion(si,sf)+(q>0?" · "+q+" quinquenio"+(q>1?"s":"")+" de antigüedad":"");
}
el("f-inicio").addEventListener("change",actuFechas);
el("f-fin").addEventListener("change",actuFechas);
el("btnCalcFiniquito").addEventListener("click",function(){calcFiniquito();});





function calcFiniquito(){
  if(window.VigilanteAuth){window.VigilanteAuth.require(calcFiniquitoRegistrado);return;}
  calcFiniquitoRegistrado();
}
function calcFiniquitoRegistrado(){
  ctxPDF.finiquito=null;
  var fail=function(m){mostrarError('f-errorBox','resultado-finiquito','finiquito',m);};
  if(!window.VigilanteSecurity.validateInputs('view-finiquito','f-errorBox','resultado-finiquito')){invalidarCalculo('finiquito');return;}
  var si=valor('f-inicio'),sf=valor('f-fin');
  if(!si||!sf){fail('Escribe la fecha de inicio y el último día de trabajo.');return;}
  if(!VigilanteRules.validDate(si)||!VigilanteRules.validDate(sf)||sf<si){fail('El último día de trabajo no puede ser anterior a la fecha de inicio.');return;}
  var conductor=el('switchCondF').checked;
  var datos={
    categoria:fcatActual,conductor:conductor,jornada:fjornActual,horasContrato:numero('fhPactadas'),
    responsable:el('switchResponsableF').checked,inicio:si,fin:sf,diasVac:numero('f-vacas'),
    prorrateadas:{julio:el('fpaga-julio').classList.contains('active'),navidad:el('fpaga-dic').classList.contains('active'),marzo:el('fpaga-mar').classList.contains('active')},
    motivo:valor('f-tipodespido'),irpf:numero('f-irpf')
  };
  if(datos.jornada==='parcial'&&!(datos.horasContrato>0&&datos.horasContrato<JORNADA)){fail('Escribe las horas al mes de tu contrato (menos de 162).');return;}
  ocultarError('f-errorBox');
  var r=calcularFiniquito(datos);
  var sufRatio=datos.jornada==='parcial'?' ('+num(datos.horasContrato)+' h/mes)':'';
  var q=Math.floor(r.aniosAnt/5);
  el('f-info-duracion').innerHTML='';
  el('f-info-duracion').append(Object.assign(document.createElement('strong'),{textContent:'Duración: '}),textoDuracion(si,sf)+(q>0?' · '+q+' quinquenio'+(q>1?'s':''):''));
  showR('frow-vacas','flbl-vacas','fr-vacas','Vacaciones no disfrutadas ('+num(datos.diasVac)+' días × '+fmt(r.valorDiaVac)+')'+sufRatio,r.vacaciones);
  showR('frow-julio','flbl-julio','fr-julio','Paga de julio ('+Math.round(r.pctJulio*100)+'% pendiente)',r.julio);
  showR('frow-navidad','flbl-navidad','fr-navidad','Paga de Navidad ('+Math.round(r.pctNavidad*100)+'% pendiente)',r.navidad);
  showR('frow-marzo','flbl-marzo','fr-marzo','Paga de marzo ('+Math.round(r.pctMarzo*100)+'% pendiente)',r.marzo);
  el('fr-liq-bruta').textContent=fmt(r.liqBruta);
  showR('frow-ss-liq','flbl-ss-liq','fr-ss-liq','Seguridad Social de las vacaciones',r.ssVac,'down');
  showR('frow-irpf-liq','flbl-irpf-liq','fr-irpf-liq','Retención IRPF ('+num(datos.irpf)+'%)',r.irpfLiq,'down');
  el('fr-liq-neto').textContent=fmt(r.liqNeto);
  var etiquetas={temporal:'Fin de contrato temporal (12 días por año)',objetivo:'Despido objetivo (20 días por año, máx. 12 meses)',improcedente:'Despido improcedente (33 días por año, máx. 24 meses)'};
  var hayIndem=r.indem>0;
  el('frow-indem-label').style.display=hayIndem?'block':'none';
  showR('frow-indem','flbl-indem','fr-indem',(etiquetas[datos.motivo]||'Indemnización')+sufRatio,r.indem,'exento');
  showR('frow-irpf-indem','flbl-irpf-indem','fr-irpf-indem','Retención IRPF de la indemnización ('+num(datos.irpf)+'%)',r.irpfIndem,'down');
  var exento=el('f-exento-info');
  exento.style.display=hayIndem?'block':'none';
  exento.textContent=hayIndem?(datos.motivo==='temporal'
    ?'La indemnización por fin de contrato temporal paga IRPF, como el resto del finiquito. Se calcula sobre un salario anual de '+fmt(r.salarioAnual)+'.'
    :'La indemnización por despido no paga IRPF ni Seguridad Social dentro de los límites legales: te llega entera. Se calcula sobre un salario anual de '+fmt(r.salarioAnual)+'.'):'';
  el('fr-total-neto').textContent=fmt(r.total);
  el('f-notas-calculo').textContent='No incluye el sueldo de los días trabajados del último mes, horas extra ni otros pluses variables. Compáralo siempre con el documento de tu empresa.';
  ctxPDF.finiquito={
    'Categoría':nombreCat(fcatActual,conductor),
    'Jornada':datos.jornada==='completa'?'Completa (162 h/mes)':'Parcial ('+num(datos.horasContrato)+' h/mes)',
    'Inicio del contrato':fechaES(si),'Último día de trabajo':fechaES(sf),'Duración':textoDuracion(si,sf),
    'Responsable de equipo':datos.responsable?'Sí':'No',
    'Vacaciones pendientes':num(datos.diasVac)+' días',
    'Motivo':el('f-tipodespido').selectedOptions[0].textContent,
    'Retención IRPF':num(datos.irpf)+' %'
  };
  el('resultado-finiquito').style.display='block';
  tras_calcular();
  irAResultado('resultado-finiquito');
}

/* ══════════════════════════════════════════════════════════
   BAJA (INCAPACIDAD TEMPORAL)
   ══════════════════════════════════════════════════════════ */
grupoCategorias("bbtn","view-baja","card-condB","switchCondB",function(c){bcatActual=c;});
el("b-tipo").addEventListener("change",function(){
  el("b-field-nbaja").style.display=this.value==="laboral"?"none":"block";
});
el("btnCalcBaja").addEventListener("click",function(){calcBaja();});



function calcBaja(){
  if(window.VigilanteAuth){window.VigilanteAuth.require(calcBajaRegistrado);return;}
  calcBajaRegistrado();
}
function calcBajaRegistrado(){
  ctxPDF.baja=null;
  var fail=function(m){mostrarError('b-errorBox','resultado-baja','baja',m);};
  if(!window.VigilanteSecurity.validateInputs('view-baja','b-errorBox','resultado-baja')){invalidarCalculo('baja');return;}
  var conductor=el('switchCondB').checked;
  var datos={categoria:bcatActual,conductor:conductor,baseMensual:numero('b-baseManual'),anios:numero('b-anios'),
    tipo:valor('b-tipo'),nbaja:Number(valor('b-nbaja'))||1,dias:numero('b-dias'),irpf:numero('b-irpf')};
  if(!(datos.dias>=1)||!Number.isInteger(datos.dias)){fail('Escribe cuántos días ha durado (o va a durar) la baja.');return;}
  ocultarError('b-errorBox');
  var r=calcularBaja(datos);
  var top=el('b-res-top'),fin=el('b-tramos-fin');
  top.querySelectorAll('.b-tramo').forEach(function(n){n.remove();});
  r.tramos.forEach(function(t){
    var row=document.createElement('div');row.className='res-row b-tramo';
    var c=document.createElement('span');c.className='res-concept';
    var v=document.createElement('span');
    var dias=t.desde===t.hasta?'Día '+t.desde:'Días '+t.desde+'–'+t.hasta;
    var n=t.hasta-t.desde+1;
    if(t.nota==='nomina'){c.textContent=dias+' · lo paga la empresa en tu nómina';v.className='res-val neu';v.textContent='En nómina';}
    else{
      var pctTexto=datos.tipo!=='laboral'?Math.round(t.pct*100)+'%':(r.baseDiaria*0.75>r.tablaDiaria?'75% de tu base':'100% de tu salario de convenio');
      c.textContent=dias+' · '+pctTexto+' — '+n+' día'+(n>1?'s':'');
      v.className='res-val '+(t.importe>0?'up':'neu');v.textContent=(t.importe>0?'+':'')+fmt(t.importe);
    }
    row.append(c,v);top.insertBefore(row,fin);
  });
  el('b-info-base').innerHTML='';
  el('b-info-base').append(Object.assign(document.createElement('strong'),{textContent:'Base diaria: '}),
    fmt(r.baseDiaria)+' ('+fmt(r.baseMensual)+' ÷ 30)'+(r.estimada?' · estimada con la base mínima del convenio':''));
  el('br-total-bruto').textContent=fmt(r.bruto);
  el('br-ss').textContent='-'+fmt(r.ss);
  if(datos.irpf>0){el('brow-irpf').style.display='flex';el('brow-irpf0').style.display='none';el('blbl-irpf').textContent='Retención IRPF ('+num(datos.irpf)+'%)';el('br-irpf').textContent='-'+fmt(r.irpf);}
  else{el('brow-irpf').style.display='none';el('brow-irpf0').style.display='flex';}
  el('br-neto').textContent=fmt(r.neto);
  el('b-notas').textContent=(datos.tipo==='laboral'
    ?'En accidente laboral, el día del accidente se cobra como trabajado y desde el día siguiente el convenio completa hasta el 100% de tu salario de tablas.'
    :'Si cobras las pagas extra en julio y Navidad, la parte de los días de baja ya va incluida aquí y la empresa la descontará de esas pagas.')+
    ' Durante la baja sigues cotizando a la Seguridad Social sobre tu base del mes anterior.';
  ctxPDF.baja={
    'Categoría':nombreCat(bcatActual,conductor),
    'Tipo de baja':el('b-tipo').selectedOptions[0].textContent,
    'Baja del año':datos.tipo==='laboral'?'No aplica':el('b-nbaja').selectedOptions[0].textContent,
    'Días de baja':datos.dias+' días',
    'Base de cotización':fmt(r.baseMensual)+'/mes'+(r.estimada?' (mínima de convenio)':''),
    'Base diaria':fmt(r.baseDiaria),
    'Retención IRPF':num(datos.irpf)+' %'
  };
  el('resultado-baja').style.display='block';
  tras_calcular();
  irAResultado('resultado-baja');
}

actualizarPlusesCategoria();
