/* ══════════════════════════════════════════════════════════
   EXPORTACIÓN A PDF
   ══════════════════════════════════════════════════════════ */
var ctxPDF = {nomina:null, finiquito:null, baja:null, cuadrante:null};

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
    nomina:{title:'Tu nómina mensual',cont:'resultado',netoId:'r-neto',netLabel:'NETO ESTIMADO',archivo:'nomina'},
    finiquito:{title:'Tu finiquito',cont:'resultado-finiquito',netoId:'fr-total-neto',netLabel:'TOTAL NETO',archivo:'finiquito'},
    baja:{title:'Tu prestación por baja (IT)',cont:'resultado-baja',netoId:'br-neto',netLabel:'NETO DE LA BAJA',archivo:'baja-it'}
  }[tipo];
  if(!cfg||!ctxPDF[tipo]){alert('Primero pulsa el botón de calcular.');return;}
  var doc=window.VigilantePDF.create({title:cfg.title,date:hoyLargo(),data:ctxPDF[tipo],netLabel:cfg.netLabel,
    net:document.getElementById(cfg.netoId).textContent,
    monthly:tipo==='baja'&&informeBaja&&informeBaja.monthly[0].start?informeBaja.monthly.map(function(m){return {label:m.label,period:fechaES(m.start)+' - '+fechaES(m.end),days:String(m.days),gross:fmt(m.gross),ss:fmt(-m.ss),irpf:fmt(-m.irpf),net:fmt(m.net)};}):null,
    notes:tipo==='baja'&&informeBaja?informeBaja.notes:null,
    projection:tipo==='baja'&&informeBaja?informeBaja.projection:false,
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
    if(dd&&dd.tramos)dd.tramos.forEach(function(tr){
      var ff=tramoAFechas(fecha.getFullYear(),fecha.getMonth(),fecha.getDate(),tr);if(!ff)return;
      var ini=new Date(Math.max(inicio.getTime(),ff.ini.getTime())),lim=new Date(Math.min(fin.getTime(),ff.fin.getTime()));
      if(ini>=lim)return;
      var r=trocearTramo(ini,lim);t.horasTrabajadas+=r.total;t.noct+=r.noct;t.plus+=r.plus;
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

/* ── Resumen compacto de un día para la celda ── */
function resumenDia(a,m,d){
  var dd=datosDia(a,m,d);
  if(!dd) return null;
  if(dd.tramos&&dd.tramos.length){
    var mins=0;
    dd.tramos.forEach(function(tr){
      var ff=tramoAFechas(a,m,d,tr);
      if(ff) mins+=trocearTramo(ff.ini,ff.fin).total;
    });
    var lineas = dd.tramos.length===1
      ? [dd.tramos[0].i, dd.tramos[0].f]
      : [dd.tramos.length+" tramos"];
    return {tipo:"trab", lineas:lineas, horas:Math.round(mins/60*100)/100, fest:!!dd.fest};
  }
  if(dd.vac) return {tipo:"vac", lineas:["V"], horas:horasDiaVacaciones(), fest:!!dd.fest};
  if(dd.fest) return {tipo:"libre", lineas:[], horas:0, fest:true};
  return null;
}

/* ── Pintado del calendario ── */
function pintarCalendario(){
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
    h+='<div class="'+cls+'" data-dia="'+d+'">';
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
  document.getElementById("hTTotal").value = t.horas>0 ? t.horas : "";
  document.getElementById("hNoc").value    = t.noct>0  ? t.noct  : "";
  document.getElementById("hFest").value   = t.plus>0  ? t.plus  : "";
}

/* ── Diálogo de turnos ── */
function filaTramo(i,f){
  i=window.VigilanteSecurity.validTime(i)?i:'';
  f=window.VigilanteSecurity.validTime(f)?f:'';
  return '<div class="tramo">'+
    '<input type="time" class="t-ini" value="'+(i||"")+'" step="300">'+
    '<span class="tramo-sep">a</span>'+
    '<input type="time" class="t-fin" value="'+(f||"")+'" step="300">'+
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
  if(noc>0)  txt+=" · "+hh(noc)+" h nocturnas";
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
      MODO_HORAS="manual";
      bm.classList.add("active"); bc.classList.remove("active");
      document.getElementById("campos-manual").style.display="block";
      document.getElementById("campos-cuadrante").style.display="none";
      document.getElementById("n-diasAlta").disabled=false;
      actualizarComplementoVacaciones();
    });
    bc.addEventListener("click",function(){
      MODO_HORAS="cuadrante";
      bc.classList.add("active"); bm.classList.remove("active");
      document.getElementById("campos-manual").style.display="none";
      document.getElementById("campos-cuadrante").style.display="block";
      document.getElementById("n-diasAlta").disabled=true;
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

var CATS = {
  sin_arma:  {salBase:1161.28,pelig:24.08, act:0,     trans:137.81,vest:112.28,nocH:1.26},
  con_arma:  {salBase:1161.28,pelig:179.90,act:0,     trans:137.81,vest:112.28,nocH:1.26},
  escolta:   {salBase:1161.28,pelig:177.15,act:0,     trans:137.81,vest:115.67,nocH:1.26,esc:312.99},
  explosivos:{salBase:1161.28,pelig:210.55,act:40.17, trans:137.81,vest:112.25,nocH:1.26},
  fondos:    {salBase:1227.74,pelig:179.90,act:210.19,trans:137.81,vest:113.27,nocH:1.27,cBase:1285.55,cVest:114.56,cNoc:1.36},
  tr_explo:  {salBase:1227.74,pelig:191.59,act:152.44,trans:137.81,vest:113.27,nocH:1.27,cBase:1285.55,cVest:114.56,cNoc:1.36}
};
var QUINQUENIO = {sin_arma:45.86,con_arma:45.86,escolta:45.86,explosivos:45.86,fondos:46.59,tr_explo:46.59};

// Devuelve la categoría efectiva aplicando la variante conductor si procede
function catEf(k,esCond){
  var c=CATS[k];
  if(esCond&&c.cBase){return {salBase:c.cBase,pelig:c.pelig,act:c.act,trans:c.trans,vest:c.cVest,nocH:c.cNoc};}
  return c;
}
var SS_PCT=0.0650, JORNADA=162, HORAS_ANUALES=1782;
var PLUS_FEST=1.02;
var catActual="sin_arma", jornActual="completa";
var fcatActual="sin_arma", fjornActual="completa", bcatActual="sin_arma";
var cuentaVacacionesActiva=false;
var vacationPlusesUI=window.VigilanteVacationPluses.mount(function(){
  var days=MODO_HORAS==='cuadrante'
    ? (cuentaVacacionesActiva?totalesMes(calAnio,calMes).diasVac:0)
    : (document.getElementById('switchVac').checked?Number(document.getElementById('diasVac').value)||0:0);
  return {days:days,nightRate:catEf(catActual,document.getElementById('switchCond').checked).nocH,weekendRate:PLUS_FEST};
});

function r2(n){var centimos=Math.abs(n)*100;return Math.sign(n)*Math.round(centimos+Number.EPSILON*Math.max(1,centimos))/100;}
function fmt(n){return n.toLocaleString("es-ES",{minimumFractionDigits:2,maximumFractionDigits:2})+" €";}
function calcAntig(a,cat,conductor){return r2(Math.floor(a/5)*(conductor&&CATS[cat].cBase?50.23:QUINQUENIO[cat]));}
function calcHoraExtra(sb,p,act,ant,esc){return r2(((sb+p+act+ant)*15+(esc||0)*12)/HORAS_ANUALES);}

function showR(rid,lid,vid,lbl,val,cls){
  var row=document.getElementById(rid);
  cls=cls||"up";
  if(val>0.005){
    row.style.display="flex";
    if(lid)document.getElementById(lid).textContent=lbl;
    document.getElementById(vid).textContent=(cls==="down"?"-":"+")+fmt(val);
    document.getElementById(vid).className="res-val "+cls;
  } else {row.style.display="none";}
}

["nomina","finiquito","baja"].forEach(function(t){
  document.getElementById("tab-"+t).addEventListener("click",function(){
    if(t!=="nomina"){
      if(window.VigilanteAuth) window.VigilanteAuth.require(function(){mostrarVista(t);});
      return;
    }
    mostrarVista(t);
  });
});
function mostrarVista(t){
    ["nomina","finiquito","baja"].forEach(function(x){
      document.getElementById("tab-"+x).classList.toggle("active",x===t);
      document.getElementById("view-"+x).style.display=x===t?"block":"none";
    });
}

function actualizarPlusesCategoria(){
  var conductor=document.getElementById('switchCond').checked;
  var a=parseInt(document.getElementById('aniosAntiguedad').value)||0, q=Math.floor(a/5);
  var importeQuinquenio=calcAntig(5,catActual,conductor);
  var cat=catEf(catActual,conductor);
  document.getElementById('badge-noc').textContent='+'+cat.nocH.toFixed(2).replace('.',',')+' €/h';
  document.getElementById("hint-antiguedad").textContent=a<5
    ?"Sin antigüedad — el plus aplica cada 5 años ("+fmt(importeQuinquenio)+"/quinquenio)"
    :q+" quinquenio"+(q>1?"s":"")+" = +"+fmt(calcAntig(a,catActual,conductor))+"/mes";
  vacationPlusesUI.refresh();
}
document.getElementById('aniosAntiguedad').addEventListener('input',actualizarPlusesCategoria);
document.getElementById('switchCond').addEventListener('change',actualizarPlusesCategoria);
document.getElementById('switchJefe').addEventListener('change',function(){document.getElementById('jefe-field').hidden=!this.checked;});
document.getElementById("switchPlus").addEventListener("change",function(){
  document.getElementById("plus-servicio-field").style.display=this.checked?"block":"none";
});
document.getElementById("switchVac").addEventListener("change",function(){
  if(this.checked){
    this.checked=false;
    solicitarCuentaVacaciones(function(){
      document.getElementById("switchVac").checked=true;
      document.getElementById("vac-field").style.display="block";
      actualizarHintVac();
      document.getElementById("diasVac").focus();
    });
    return;
  }
  document.getElementById("vac-field").style.display="none";
  document.getElementById("diasVac").value="";
  actualizarHintVac();
});
function solicitarCuentaVacaciones(action){
  if(window.VigilanteAuth) return window.VigilanteAuth.require(action);
  var notice=document.getElementById('account-notice');
  if(notice) notice.textContent='El acceso a cuentas no está disponible. Para añadir vacaciones necesitas iniciar sesión.';
}
function actualizarAccesoVacaciones(member){
  cuentaVacacionesActiva=member;
  ['vac-access-note','dlg-vac-access-note'].forEach(function(id){
    var note=document.getElementById(id);
    if(note) note.textContent=member?'Incluido en tu cuenta':'Disponible con cuenta gratuita';
  });
  if(member){actualizarComplementoVacaciones();return;}
  document.getElementById('switchVac').checked=false;
  document.getElementById('vac-field').style.display='none';
  document.getElementById('diasVac').value='';
  actualizarHintVac();
  // Keep stored calendar days intact. Reusing them in a payroll requires signing in.
  if(ctxPDF.nomina&&ctxPDF.nomina['Vacaciones disfrutadas']!=='Ninguna'){
    ctxPDF.nomina=null;
    document.getElementById('resultado').style.display='none';
  }
}
function actualizarHintVac(){
  actualizarComplementoVacaciones();
  var d=parseFloat(document.getElementById("diasVac").value)||0;
  document.getElementById("hint-vac").textContent = d>0
    ? d+" día"+(d!==1?"s":"")+" × "+horasDiaVacaciones().toFixed(3).replace(".",",")+" h = "+fmt(r2(d*horasDiaVacaciones())).replace(" €"," h")+" de jornada"
    : "31 días naturales al año. Cada día computa tu jornada mensual contratada dividida entre 31.";
}
function actualizarComplementoVacaciones(){
  var vacaciones=MODO_HORAS==='manual'
    ? document.getElementById('switchVac').checked
    : cuentaVacacionesActiva&&totalesMes(calAnio,calMes).diasVac>0;
  document.getElementById('vac-plus-field').hidden=!vacaciones;
  vacationPlusesUI.refresh();
}
document.getElementById("diasVac").addEventListener("input",actualizarHintVac);
["sin_arma","con_arma","escolta","explosivos","fondos","tr_explo"].forEach(function(c){
  document.getElementById("btn-"+c).addEventListener("click",function(){
    document.querySelectorAll("#view-nomina .cat-btn").forEach(function(b){b.classList.remove("active");});
    document.getElementById("btn-"+c).classList.add("active");
    catActual=c;
    var esC=!!CATS[c].cBase;
    document.getElementById("card-cond").style.display=esC?"block":"none";
    if(!esC)document.getElementById("switchCond").checked=false;
    actualizarPlusesCategoria();
  });
});
document.getElementById("jorn-completa").addEventListener("click",function(){
  jornActual="completa";
  document.getElementById("jorn-completa").classList.add("active");
  document.getElementById("jorn-parcial").classList.remove("active");
  document.getElementById("parcial-field").style.display="none";
  document.getElementById("hint-extras").textContent="Si superas 162 h, el exceso se cobra como hora extra";
});
document.getElementById("jorn-parcial").addEventListener("click",function(){
  jornActual="parcial";
  document.getElementById("jorn-parcial").classList.add("active");
  document.getElementById("jorn-completa").classList.remove("active");
  document.getElementById("parcial-field").style.display="block";
  document.getElementById("hint-extras").textContent="El exceso se estima como horas complementarias. Revisa el pacto y los límites de tu contrato.";
});
function actualizarJornada(){actualizarHintVac();if(MODO_HORAS==='cuadrante')pintarCalendario();}
['jorn-completa','jorn-parcial'].forEach(function(id){document.getElementById(id).addEventListener('click',actualizarJornada);});
document.getElementById('hPactadas').addEventListener('input',actualizarJornada);
["paga-julio","paga-dic","paga-mar"].forEach(function(id){
  document.getElementById(id).addEventListener("click",function(){
    this.classList.toggle("active");
    this.querySelector(".paga-sub").textContent=this.classList.contains("active")?"activa":"inactiva";
  });
});
document.getElementById("btnCalc").addEventListener("click",function(){calcNomina();});
document.querySelectorAll('[data-pdf]').forEach(function(button){
  button.addEventListener('click',function(){exportarPDF(button.dataset.pdf,button);});
});

function calcNomina(){
  var conVacaciones=MODO_HORAS==='cuadrante'
    ? totalesMes(calAnio,calMes).diasVac>0
    : document.getElementById('switchVac').checked;
  if(conVacaciones){
    var modoSolicitado=MODO_HORAS;
    var diasSolicitados=document.getElementById('diasVac').value;
    ctxPDF.nomina=null;
    document.getElementById('resultado').style.display='none';
    solicitarCuentaVacaciones(function(){
      if(modoSolicitado==='manual'&&MODO_HORAS==='manual'){
        document.getElementById('switchVac').checked=true;
        document.getElementById('diasVac').value=diasSolicitados;
        document.getElementById('vac-field').style.display='block';
        actualizarHintVac();
      }
      calcNominaRegistrado();
    });
    return;
  }
  calcNominaRegistrado();
}
function calcNominaRegistrado(){
  ctxPDF.nomina=null;
  if(MODO_HORAS==='cuadrante')volcarTotales(totalesMes(calAnio,calMes));
  if(!window.VigilanteSecurity.validateInputs('view-nomina','errorBox','resultado')){ctxPDF.nomina=null;return;}
  var cat=catEf(catActual,document.getElementById("switchCond").checked);
  var hT=parseFloat(document.getElementById("hTTotal").value)||0;
  var hN=parseFloat(document.getElementById("hNoc").value)||0;
  var hF=parseFloat(document.getElementById("hFest").value)||0;
  var ip=parseFloat(document.getElementById("irpf").value)||0;
  var an=parseFloat(document.getElementById("aniosAntiguedad").value)||0;
  var ps=document.getElementById("switchPlus").checked?(parseFloat(document.getElementById("plusServicio").value)||0):0;
  var esJefe=document.getElementById("switchJefe").checked;
  var dVac=(MODO_HORAS==="manual"&&document.getElementById("switchVac").checked)
             ? (parseFloat(document.getElementById("diasVac").value)||0) : 0;
  var hp=jornActual==="completa"?JORNADA:(parseFloat(document.getElementById("hPactadas").value)||0);
  if(MODO_HORAS==='cuadrante'){
    var mesActual=totalesMes(calAnio,calMes);dVac=mesActual.diasVac;hT=mesActual.horasTrabajadas;
  }
  var hVac=r2(dVac*hp/31);
  var err=document.getElementById("errorBox");
  if(hT<=0&&hVac<=0){err.textContent="Introduce las horas totales trabajadas.";err.style.display="block";document.getElementById("resultado").style.display="none";return;}
  if(jornActual==="parcial"&&hp<=0){err.textContent="Introduce las horas pactadas en tu contrato.";err.style.display="block";document.getElementById("resultado").style.display="none";return;}
  if(jornActual==="parcial"&&hp>=JORNADA){err.textContent="Las horas pactadas deben ser menos de 162.";err.style.display="block";document.getElementById("resultado").style.display="none";return;}
  if(hN>hT){err.textContent="Las horas nocturnas no pueden superar el total.";err.style.display="block";document.getElementById("resultado").style.display="none";return;}
  if(hF>hT){err.textContent="Las horas de fin de semana/festivo no pueden superar el total.";err.style.display="block";document.getElementById("resultado").style.display="none";return;}
  err.style.display="none";

  /* Las vacaciones computan como jornada, aunque no se hayan trabajado */
  var hTrab=hT;                 // horas realmente trabajadas
  var hJor=r2(hT+hVac);         // jornada computable del mes
  var ratioFijo=hp/JORNADA;
  // Calendar shifts describe worked hours, not the duration of the contract.
  // A full monthly salary includes rest days, regardless of the month's length.
  var factorH=MODO_HORAS==='cuadrante'?1:(parseFloat(document.getElementById("n-diasAlta").value)||30)/30;
  var labelSufix="";
  if(factorH<1)labelSufix=" ("+Math.round(factorH*30)+" días remunerados)";

  var sb=r2(cat.salBase*ratioFijo*factorH);
  var pe=r2(cat.pelig*ratioFijo*factorH);
  var ac=r2((cat.act||0)*ratioFijo*factorH);
  var tr=r2(cat.trans*ratioFijo*factorH);
  var ve=r2(cat.vest*ratioFijo*factorH);
  var ant=calcAntig(an,catActual,document.getElementById('switchCond').checked);
  var antM=r2(ant*ratioFijo*factorH);
  var hJefe=esJefe?(document.getElementById('n-horasJefe').value===''?hT:Number(document.getElementById('n-horasJefe').value)):0;
  if(hJefe>hT){err.textContent='Las horas como responsable de equipo no pueden superar las trabajadas.';err.style.display='block';document.getElementById('resultado').style.display='none';return;}
  var je=r2(cat.salBase*0.10*hJefe/JORNADA);
  var vacationSupplement;
  try{vacationSupplement=vacationPlusesUI.read(dVac);}catch(error){
    err.textContent=error.message;err.style.display='block';
    document.getElementById('resultado').style.display='none';return;
  }
  var complementoVac=vacationSupplement.amount;
  var q=Math.floor(an/5);
  var sbHE=cat.salBase;
  var hev=calcHoraExtra(sbHE,cat.pelig,cat.act||0,ant,cat.esc);
  var plusEscolta=r2((cat.esc||0)*ratioFijo*factorH);
  var objetivo=hp*factorH;
  var hEx=Math.max(0,r2(hJor-objetivo));
  var pEx=r2(hEx*hev), pN=r2(hN*cat.nocH), pFe=r2(hF*PLUS_FEST);
  var pa=document.querySelectorAll("#view-nomina .paga-btn.active").length;
  var bP=r2((cat.salBase+cat.pelig+(cat.act||0)+ant)*ratioFijo);
  var pP=r2((pa*bP*factorH)/12);
  var bruto=r2(sb+pe+ac+tr+ve+antM+je+ps+plusEscolta+complementoVac+pEx+pN+pFe+pP);
  var pNP=3-pa;
  var ssB=r2(bruto+r2(pNP*bP*factorH/12));
  if(ssB>5101.20){err.textContent='La base supera el máximo de 2026. Este caso requiere calcular topes y cotización de solidaridad con tu nómina real.';err.style.display='block';document.getElementById('resultado').style.display='none';ctxPDF.nomina=null;return;}
  var pctSS=document.getElementById('n-contrato').value==='temporal'?0.0655:SS_PCT;
  // Las horas extra ordinarias cotizan adicionalmente, pero no al MEI.
  var dSS=r2(ssB*pctSS-(jornActual==='completa'?pEx*0.0015:0)), dIP=r2(bruto*ip/100);
  var neto=r2(bruto-dSS-dIP);

  var suf=jornActual==="parcial"&&labelSufix===""?" ("+hp+"h/162h)":labelSufix;
  document.getElementById("lbl-base").textContent="Salario base"+suf;
  document.getElementById("lbl-pelig").textContent="Plus peligrosidad"+suf;
  document.getElementById("r-base").textContent="+"+fmt(sb);
  document.getElementById("r-pelig").textContent="+"+fmt(pe);
  if(hVac>0){
    document.getElementById("row-vacinfo").style.display="flex";
    document.getElementById("lbl-vacinfo").textContent="Vacaciones — "+dVac+" día"+(dVac!==1?"s":"")+" × "+(hp/31).toFixed(3).replace(".",",")+" h";
    document.getElementById("r-vacinfo").textContent=String(hVac).replace(".",",")+" h de jornada";
  } else { document.getElementById("row-vacinfo").style.display="none"; }
  showR("row-act","lbl-act","r-act","Plus de actividad"+suf,ac,"up");
  showR("row-escolta","lbl-escolta","r-escolta","Plus escolta (función todo el mes)",plusEscolta,"up");
  document.getElementById("r-trans").textContent="+"+fmt(tr);
  document.getElementById("r-vest").textContent="+"+fmt(ve);
  if(antM>0){document.getElementById("row-antig").style.display="flex";document.getElementById("lbl-antig").textContent="Antigüedad ("+q+" quinquenio"+(q>1?"s":"")+")";document.getElementById("r-antig").textContent="+"+fmt(antM);}
  else{document.getElementById("row-antig").style.display="none";}
  showR("row-jefe","lbl-jefe","r-jefe","Responsable de equipo — "+hJefe+" h",je,"up");
  showR("row-vacplus","lbl-vacplus","r-vacplus",vacationSupplement.mode==='horas'?"Pluses de vacaciones (estimación por horas)":"Promedio de pluses en vacaciones",complementoVac,"up");
  if(ps>0){document.getElementById("row-plusserv").style.display="flex";document.getElementById("r-plusserv").textContent="+"+fmt(ps);}
  else{document.getElementById("row-plusserv").style.display="none";}
  showR("row-extra","lbl-extra","r-extra",(jornActual==="parcial"?"Horas complementarias estimadas — ":"Horas extra — ")+hEx+"h × "+hev.toFixed(2).replace(".",",")+" €",pEx,"up");
  showR("row-noc","lbl-noc","r-noc","Plus nocturnidad — "+hN+"h × "+cat.nocH.toFixed(2).replace(".",",")+" €",pN,"up");
  showR("row-fest","lbl-fest","r-fest","Plus fin de semana/festivo — "+hF+"h × 1,02 €",pFe,"up");
  showR("row-prorr","lbl-prorr","r-prorr",pa+" paga"+(pa!==1?"s":"")+" extra prorrateada"+(pa!==1?"s":""),pP,"up");
  document.getElementById("r-bruto").textContent=fmt(bruto);
  document.getElementById("r-ss").textContent="-"+fmt(dSS);
  if(ip>0){document.getElementById("row-irpf").style.display="flex";document.getElementById("row-irpf0").style.display="none";document.getElementById("lbl-irpf").textContent="Retención IRPF ("+ip+"%)";document.getElementById("r-irpf").textContent="-"+fmt(dIP);}
  else{document.getElementById("row-irpf").style.display="none";document.getElementById("row-irpf0").style.display="flex";}
  document.getElementById("r-neto").textContent=fmt(neto);
  document.getElementById("resultado").style.display="block";
  cargarJsPDF(function(){});
  window.VigilanteInstall?.calculationCompleted();
  window.VigilanteAnalytics?.track('calculation_complete');
  ctxPDF.cuadrante = (MODO_HORAS==="cuadrante") ? {anio:calAnio, mes:calMes} : null;
  var pdfDiasVac = ctxPDF.cuadrante ? totalesMes(calAnio,calMes).diasVac : dVac;
  var pdfHorasVac = hVac;
  ctxPDF.nomina={
    "Categoría":nombreCat(catActual,document.getElementById("switchCond").checked),
    "Tipo de jornada":(jornActual==="completa"?"Jornada completa (162 h/mes)":"Jornada parcial ("+hp+" h/mes pactadas)")+(MODO_HORAS==='cuadrante'?' · Mes completo':''),
    ["Horas trabajadas (sin vacaciones)"]:String(hTrab).replace(".",",")+" h"+(hEx>0?"  ("+String(hEx).replace(".",",")+" h extraordinarias calculadas)":""),
    "Horas nocturnas":(hN>0?hN+" h  ×  "+cat.nocH.toFixed(2).replace(".",",")+" €":"Ninguna"),
    "Horas fin de semana / festivo":(hF>0?hF+" h  ×  1,02 €":"Ninguna"),
    "Antigüedad":(an>0?an+" años  ("+q+" quinquenio"+(q!==1?"s":"")+")":"Sin antigüedad"),
    "Vacaciones disfrutadas":(pdfDiasVac>0?pdfDiasVac+" día"+(pdfDiasVac!==1?"s":"")+" = "+String(pdfHorasVac).replace(".",",")+" h de jornada":"Ninguna"),
    "Jornada computable del mes":String(hJor).replace(".",",")+" h",
    "Responsable de equipo":(esJefe?"Sí (10% del salario base)":"No"),
    "Pagas extra prorrateadas":(pa>0?pa+" de 3":"Ninguna"),
    "Retención IRPF aplicada":(ip>0?ip+" %":"0 %")
  };
  if(dVac>0&&vacationSupplement.provided){
    ctxPDF.nomina['Pluses de vacaciones']=(vacationSupplement.mode==='horas'?'Estimación por horas con tarifas de 2026':vacationSupplement.mode==='nominas'?'Media de '+document.getElementById('vac-meses').value+' nóminas':'Media mensual indicada')+' · '+fmt(vacationSupplement.average)+' / 31 × '+dVac+' días = '+fmt(complementoVac)+' brutos';
  }
  setTimeout(function(){document.getElementById("resultado").scrollIntoView({behavior:"smooth",block:"nearest"});},60);
}

["sin_arma","con_arma","escolta","explosivos","fondos","tr_explo"].forEach(function(c){
  document.getElementById("fbtn-"+c).addEventListener("click",function(){
    document.querySelectorAll("#view-finiquito .cat-btn").forEach(function(b){b.classList.remove("active");});
    document.getElementById("fbtn-"+c).classList.add("active");
    fcatActual=c;
    var esCF=!!CATS[c].cBase;
    document.getElementById("card-condF").style.display=esCF?"block":"none";
    if(!esCF)document.getElementById("switchCondF").checked=false;
  });
});
document.getElementById("fjorn-completa").addEventListener("click",function(){
  fjornActual="completa";
  document.getElementById("fjorn-completa").classList.add("active");
  document.getElementById("fjorn-parcial").classList.remove("active");
  document.getElementById("f-parcial-field").style.display="none";
});
document.getElementById("fjorn-parcial").addEventListener("click",function(){
  fjornActual="parcial";
  document.getElementById("fjorn-parcial").classList.add("active");
  document.getElementById("fjorn-completa").classList.remove("active");
  document.getElementById("f-parcial-field").style.display="block";
});
function actuFechas(){
  var i=document.getElementById("f-inicio").value, f=document.getElementById("f-fin").value;
  if(!i||!f)return;
  var d1=new Date(i),d2=new Date(f);
  if(d2<d1)return;
  var dias=Math.round((d2-d1)/(864e5));
  var anosN=Math.floor(dias/365), mesesN=Math.floor((dias%365)/30), diasN=(dias%365)%30;
  var q=Math.floor(anosN/5);
  var txt="";
  if(anosN>0)txt+=anosN+" año"+(anosN>1?"s":"")+" ";
  if(mesesN>0)txt+=mesesN+" mes"+(mesesN>1?"es":"")+" ";
  if(diasN>0)txt+=diasN+" día"+(diasN>1?"s":"");
  if(q>0)txt+=" | "+q+" quinquenio"+(q>1?"s":"")+" de antigüedad";
  document.getElementById("f-hint-fechas").textContent=txt.trim()||"Menos de un mes";
}
document.getElementById("f-inicio").addEventListener("change",actuFechas);
document.getElementById("f-fin").addEventListener("change",actuFechas);
["fpaga-julio","fpaga-dic","fpaga-mar"].forEach(function(id){
  document.getElementById(id).addEventListener("click",function(){
    this.classList.toggle("active");
    this.querySelector(".paga-sub").textContent=this.classList.contains("active")?"prorrateada":"no prorrateada";
  });
});
document.getElementById("btnCalcFiniquito").addEventListener("click",function(){calcFiniquito();});

function solapamiento(a1,a2,b1,b2){
  var s=new Date(Math.max(a1.getTime(),b1.getTime()));
  var e=new Date(Math.min(a2.getTime(),b2.getTime()));
  if(e<s)return 0;
  return Math.round((e-s)/864e5)+1;
}
function propPaga(d1,d2,paga){
  var y=d2.getUTCFullYear();
  var ds,de;
  if(paga==='julio'){
    ds=new Date(Date.UTC(d2.getUTCMonth()>=6?y:y-1,6,1));
    de=new Date(Date.UTC(d2.getUTCMonth()>=6?y+1:y,5,30));
  }else{ds=new Date(Date.UTC(y,0,1));de=new Date(Date.UTC(y,11,31));}
  var devDias=Math.round((de-ds)/864e5)+1;
  var sol=solapamiento(d1,d2,ds,de);
  var pendiente=0;
  if((paga==='marzo'&&(d2.getUTCMonth()<2||(d2.getUTCMonth()===2&&d2.getUTCDate()<15)))||
     (paga==='julio'&&d2.getUTCMonth()===6&&d2.getUTCDate()<15)){
    var previoInicio=new Date(Date.UTC(ds.getUTCFullYear()-1,ds.getUTCMonth(),ds.getUTCDate()));
    var previoFin=new Date(ds.getTime()-864e5);
    pendiente=solapamiento(d1,previoFin,previoInicio,previoFin)/(Math.round((previoFin-previoInicio)/864e5)+1);
  }
  return Math.min(1,sol/devDias)+pendiente;
}
function calcFiniquito(){
  if(window.VigilanteAuth) window.VigilanteAuth.require(calcFiniquitoRegistrado);
}
function calcFiniquitoRegistrado(){
  ctxPDF.finiquito=null;
  if(!window.VigilanteSecurity.validateInputs('view-finiquito','f-errorBox','resultado-finiquito')){ctxPDF.finiquito=null;return;}
  var cat=catEf(fcatActual,document.getElementById("switchCondF").checked);
  var dv=parseFloat(document.getElementById("f-vacas").value)||0;
  var ip=parseFloat(document.getElementById("f-irpf").value)||0;
  var tipo=document.getElementById("f-tipodespido").value;
  var si=document.getElementById("f-inicio").value, sf=document.getElementById("f-fin").value;
  var err=document.getElementById("f-errorBox");
  if(!si||!sf){err.textContent="Introduce las fechas de inicio y fin del contrato.";err.style.display="block";document.getElementById("resultado-finiquito").style.display="none";return;}
  var d1=new Date(si),d2=new Date(sf);
  if(d2<d1){err.textContent="La fecha de fin no puede ser anterior a la de inicio.";err.style.display="block";document.getElementById("resultado-finiquito").style.display="none";return;}
  var fhp=fjornActual==="completa"?JORNADA:(parseFloat(document.getElementById("fhPactadas").value)||0);
  if(fjornActual==="parcial"&&fhp<=0){err.textContent="Introduce las horas pactadas en tu contrato.";err.style.display="block";document.getElementById("resultado-finiquito").style.display="none";return;}
  if(fjornActual==="parcial"&&fhp>=JORNADA){err.textContent="Las horas pactadas deben ser menos de 162.";err.style.display="block";document.getElementById("resultado-finiquito").style.display="none";return;}
  err.style.display="none";
  var ratio=fhp/JORNADA;
  var dias=VigilanteRules.days(si,sf);
  var anosC=d2.getUTCFullYear()-d1.getUTCFullYear();
  var aniversario=new Date(Date.UTC(d2.getUTCFullYear(),d1.getUTCMonth(),d1.getUTCDate()));
  if(d2<aniversario)anosC--;
  var q=Math.floor(anosC/5);
  var ant=calcAntig(anosC,fcatActual,document.getElementById('switchCondF').checked);
  var esJefeF=document.getElementById("switchJefeF").checked;
  var sbJE=esJefeF?r2(cat.salBase*1.10):cat.salBase;
  // Salario mensual completo: se usa para valorar las vacaciones pendientes
  var sMens=r2((sbJE+cat.pelig+(cat.act||0)+cat.trans+cat.vest+ant)*ratio);
  var bPaga=r2((cat.salBase+cat.pelig+(cat.act||0)+ant)*ratio);
  // Salario regulador de la indemnización (doctrina TS): conceptos salariales
  // + prorrata de pagas extras, excluyendo transporte y vestuario (extrasalariales)
  var salReg=r2((sbJE+cat.pelig+(cat.act||0)+(cat.esc||0)+ant)*ratio+bPaga*3/12);
  var vDia=r2(sMens/30);
  var totVacas=r2(dv*vDia);
  var pJulio=document.getElementById("fpaga-julio").classList.contains("active");
  var pDic=document.getElementById("fpaga-dic").classList.contains("active");
  var pMar=document.getElementById("fpaga-mar").classList.contains("active");
  var impJulio=0,impNavidad=0,impMarzo=0;
  var pJulTxt="",pNavTxt="",pMarTxt="";
  if(!pJulio){var pr=propPaga(d1,d2,"julio");impJulio=r2(bPaga*pr);pJulTxt="Paga Julio proporcional ("+(pr*100).toFixed(1).replace('.',',')+"% del periodo)";}
  if(!pDic){var pr2=propPaga(d1,d2,"navidad");impNavidad=r2(bPaga*pr2);pNavTxt="Paga Navidad proporcional ("+(pr2*100).toFixed(1).replace('.',',')+"% del periodo)";}
  if(!pMar){var pr3=propPaga(d1,d2,"marzo");impMarzo=r2(bPaga*pr3);pMarTxt="Paga Marzo proporcional ("+(pr3*100).toFixed(1).replace('.',',')+"% del periodo)";}
  var pagos=['julio','dic','mar'].map(function(p){return Number(document.getElementById('f-pagado-'+p).value)||0;});
  if(pagos[0]>impJulio||pagos[1]>impNavidad||pagos[2]>impMarzo){err.textContent='Una paga ya cobrada supera lo devengado en el periodo. Revisa el importe; la regularización de anticipos debe hacerse con las nóminas reales.';err.style.display='block';document.getElementById('resultado-finiquito').style.display='none';return;}
  impJulio=r2(impJulio-pagos[0]);impNavidad=r2(impNavidad-pagos[1]);impMarzo=r2(impMarzo-pagos[2]);
  if(pagos[0])pJulTxt+=' − ya cobrado';if(pagos[1])pNavTxt+=' − ya cobrado';if(pagos[2])pMarTxt+=' − ya cobrado';
  var liqBruta=r2(totVacas+impJulio+impNavidad+impMarzo);
  var pctSS=document.getElementById('f-contrato').value==='temporal'?0.0655:SS_PCT;
  // Las extras ya cotizan mediante la prorrata mensual; no se deducen dos veces.
  var ssLiq=r2(totVacas*pctSS);
  var irpfLiq=r2(liqBruta*ip/100);
  var liqNeto=r2(liqBruta-ssLiq-irpfLiq);
  var indem=VigilanteRules.severance(si,sf,tipo,salReg*12);
  var irpfIndem=tipo==='temporal'?r2(indem*ip/100):0;
  var totalNeto=r2(liqNeto+indem-irpfIndem);
  var anosN=Math.floor(dias/365),mN=Math.floor((dias%365)/30),dN=(dias%365)%30;
  var dur="";
  if(anosN>0)dur+=anosN+" año"+(anosN>1?"s":"")+" ";
  if(mN>0)dur+=mN+" mes"+(mN>1?"es":"")+" ";
  if(dN>0)dur+=dN+" día"+(dN>1?"s":"");
  var sufRatio=fjornActual==="parcial"?" (Ajuste parcial: "+fhp+"h)":"";
  document.getElementById("f-info-duracion").innerHTML="<strong>Duración:</strong> "+dur.trim()+" ("+dias+" días exactos) | <strong>Antigüedad:</strong> "+anosC+" año"+(anosC!==1?"s":"")+(q>0?" | <strong>"+q+" quinquenio"+(q>1?"s":"")+"</strong>":"");
  showR("frow-vacas","flbl-vacas","fr-vacas","Vacaciones ("+dv+" días × "+fmt(vDia)+")"+sufRatio,totVacas,"up");
  showR("frow-julio","flbl-julio","fr-julio",pJulTxt,impJulio,"up");
  showR("frow-navidad","flbl-navidad","fr-navidad",pNavTxt,impNavidad,"up");
  showR("frow-marzo","flbl-marzo","fr-marzo",pMarTxt,impMarzo,"up");
  document.getElementById("fr-liq-bruta").textContent=fmt(liqBruta);
  document.getElementById("fr-ss-liq").textContent="-"+fmt(ssLiq);
  if(ip>0){document.getElementById("frow-irpf-liq").style.display="flex";document.getElementById("flbl-irpf-liq").textContent="Retención IRPF ("+ip+"%)";document.getElementById("fr-irpf-liq").textContent="-"+fmt(irpfLiq);}
  else{document.getElementById("frow-irpf-liq").style.display="none";}
  document.getElementById("fr-liq-neto").textContent=fmt(liqNeto);
  if(indem>0){document.getElementById("frow-indem-label").style.display="block";document.getElementById("frow-indem").style.display="flex";document.getElementById("flbl-indem").textContent=(tipo==="improcedente"?"Despido improcedente (tramos 45/33 días y topes legales)":tipo==="temporal"?"Fin de contrato temporal (12 días/año; IRPF descontado)":"Despido objetivo (20 días/año, máx. 12 meses)")+sufRatio;document.getElementById("fr-indem").textContent="+"+fmt(indem-irpfIndem);document.getElementById("fr-salreg").textContent=fmt(salReg);document.getElementById("f-exento-info").style.display="block";}
  else{document.getElementById("frow-indem-label").style.display="none";document.getElementById("frow-indem").style.display="none";document.getElementById("f-exento-info").style.display="none";}
  document.getElementById("fr-total-neto").textContent=fmt(totalNeto);
  document.getElementById("resultado-finiquito").style.display="block";
  cargarJsPDF(function(){});
  window.VigilanteInstall?.calculationCompleted();
  window.VigilanteAnalytics?.track('calculation_complete');
  ctxPDF.finiquito={
    "Categoría":nombreCat(fcatActual,document.getElementById("switchCondF").checked),
    "Tipo de jornada":(fjornActual==="completa"?"Jornada completa (162 h/mes)":"Jornada parcial ("+fhp+" h/mes pactadas)"),
    "Inicio del contrato":fechaES(si),
    "Fin del contrato":fechaES(sf),
    "Duración":dur.trim()+"  ("+dias+" días)",
    "Antigüedad reconocida":anosC+" año"+(anosC!==1?"s":"")+(q>0?"  ("+q+" quinquenio"+(q!==1?"s":"")+")":""),
    "Responsable de equipo":(esJefeF?"Sí (10% del salario base)":"No"),
    "Días de vacaciones pendientes":dv+" días",
    "Motivo de la extinción":(tipo==="voluntaria"?"Baja voluntaria":tipo==="temporal"?"Fin de contrato temporal (12 días/año)":tipo==="objetivo"?"Despido objetivo (20 días/año)":"Despido improcedente (tramos y topes legales)"),
    "Retención IRPF aplicada":(ip>0?ip+" %":"0 %")
  };
  if(indem>0){ctxPDF.finiquito["Salario regulador"]=fmt(salReg)+"/mes";}
  setTimeout(function(){document.getElementById("resultado-finiquito").scrollIntoView({behavior:"smooth",block:"nearest"});},60);
}

["sin_arma","con_arma","escolta","explosivos","fondos","tr_explo"].forEach(function(c){
  document.getElementById("bbtn-"+c).addEventListener("click",function(){
    document.querySelectorAll("#view-baja .cat-btn").forEach(function(b){b.classList.remove("active");});
    document.getElementById("bbtn-"+c).classList.add("active");
    bcatActual=c;
    document.getElementById("b-baseManual").value="";
    var esCB=!!CATS[c].cBase;
    document.getElementById("card-condB").style.display=esCB?"block":"none";
    if(!esCB)document.getElementById("switchCondB").checked=false;
  });
});
