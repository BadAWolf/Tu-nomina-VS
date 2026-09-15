var RESOURCE_ICONS=Object.freeze({"scales":"<svg class=\"content-icon\" aria-hidden=\"true\" focusable=\"false\" viewBox=\"0 0 24 24\" width=\"22\" height=\"22\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.65\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M12 3v17m-5 1h10M4 7h16M6 7l-3 7h6L6 7Zm12 0-3 7h6l-3-7ZM3 14c0 3 6 3 6 0m6 0c0 3 6 3 6 0\"/></svg>","academy":"<svg class=\"content-icon\" aria-hidden=\"true\" focusable=\"false\" viewBox=\"0 0 24 24\" width=\"22\" height=\"22\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.65\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"m3 10 9-7 9 7v11H3V10Zm7 11v-7h4v7M7 11h.01M17 11h.01\"/></svg>","calendar":"<svg class=\"content-icon\" aria-hidden=\"true\" focusable=\"false\" viewBox=\"0 0 24 24\" width=\"22\" height=\"22\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.65\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><rect x=\"3\" y=\"5\" width=\"18\" height=\"16\" rx=\"3\"/><path d=\"M7 3v4m10-4v4M3 10h18M7 14h2m6 0h2M7 17h2\"/></svg>"});
/* ══════════════════════════════════════════════════════════════
   ZONA EDITABLE — añade o quita elementos aquí. Nada más.

   Mientras las tres listas estén vacías, la página muestra
   la guía informativa sin filtros ni secciones vacías.
   En cuanto añadas el primer elemento,
   aparecen solas las secciones y el filtro por provincia.

   · provincia: "Castellón", "Madrid"... o "Nacional".
   · destacado: true = tarjeta dorada arriba (de pago)
                false = listado normal
   · hasta:     solo en cursos. Formato AAAA-MM-DD.
                Al pasar la fecha, el curso desaparece solo.

   Ejemplo de curso:
   {titulo:"Curso de operador de dron", centro:"Academia X",
    provincia:"Castellón", hasta:"2026-10-15",
    web:"https://...", info:"20 horas · 450 €", destacado:true}
   ══════════════════════════════════════════════════════════════ */

var SINDICATOS = [];
var ACADEMIAS  = [];
var CURSOS     = [];

/* ══════════════════════════════════════════════════════════════
   A PARTIR DE AQUÍ NO HACE FALTA TOCAR NADA
   ══════════════════════════════════════════════════════════════ */

function hoyISO(){
  var d=new Date();
  return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
}
function cursosVigentes(){
  var h=hoyISO();
  return CURSOS.filter(function(c){return !c.hasta||c.hasta>=h;});
}
function fechaBonita(iso){
  if(!iso)return "";
  var p=iso.split("-"), m=["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
  return parseInt(p[2],10)+" "+m[parseInt(p[1],10)-1]+" "+p[0];
}
function ordenar(a){
  return a.slice().sort(function(x,y){return (y.destacado?1:0)-(x.destacado?1:0);});
}
function coincide(i,p){return !p||i.provincia===p||i.provincia==="Nacional";}
function textoSeguro(value){
  return String(value==null?'':value).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});
}
function enlaceSeguro(value){
  try{var url=new URL(value);return /^https?:$/.test(url.protocol)?url.href:'';}catch(_){return '';}
}

function tarjeta(o,tipo){
  var h='<div class="item'+(o.destacado?' destacado':'')+'">';
  h+='<div class="item-top"><div class="item-nombre">'+textoSeguro(o.nombre||o.titulo)+'</div>';
  h+='<span class="chip zona">'+textoSeguro(o.provincia)+'</span></div>';
  if(tipo==="curso"){
    h+='<div class="item-meta">'+textoSeguro(o.centro)+'</div>';
    if(o.hasta)h+='<div style="margin-bottom:0.5rem"><span class="chip fecha">Plazo hasta el '+textoSeguro(fechaBonita(o.hasta))+'</span></div>';
    if(o.info)h+='<div class="item-desc">'+textoSeguro(o.info)+'</div>';
  } else if(o.desc){
    h+='<div class="item-desc">'+textoSeguro(o.desc)+'</div>';
  }
  var web=enlaceSeguro(o.web);
  if(web)h+='<a href="'+textoSeguro(web)+'" target="_blank" rel="noopener noreferrer nofollow" class="item-link'+(o.destacado?'':' suave')+'">Más información</a>';
  return h+'</div>';
}

function bloque(titulo,icono,sub,items,tipo,vacioTxt){
  if(!items.length&&!SINDICATOS.length&&!ACADEMIAS.length&&!CURSOS.length)return "";
  var h='<h2><span class="h2-icon">'+(Object.hasOwn(RESOURCE_ICONS,icono)?RESOURCE_ICONS[icono]:'')+'</span>'+textoSeguro(titulo)+'</h2>';
  h+='<p class="sec-sub">'+sub+'</p>';
  h+= items.length ? items.map(function(x){return tarjeta(x,tipo);}).join("")
                   : '<div class="vacio">'+vacioTxt+'</div>';
  return h;
}

function pintar(){
  var sel=document.getElementById("filtro-prov");
  var prov=sel?sel.value:"";
  var s=ordenar(SINDICATOS).filter(function(x){return coincide(x,prov);});
  var a=ordenar(ACADEMIAS).filter(function(x){return coincide(x,prov);});
  var c=ordenar(cursosVigentes()).filter(function(x){return coincide(x,prov);});
  document.getElementById("listas").innerHTML =
    bloque("Sindicatos","scales","Si tu empresa incumple el convenio, un sindicato del sector puede asesorarte y representarte.",s,"sindicato","No hay sindicatos listados para esta provincia.")+
    bloque("Academias y Centros de Formación","academy","Centros donde ampliar tu habilitación: especialidades, reciclaje y formación complementaria.",a,"academia","No hay centros listados para esta provincia.")+
    bloque("Cursos y Convocatorias Abiertas","calendar","Formación con plazas abiertas. Las convocatorias desaparecen al pasar su plazo.",c,"curso","No hay convocatorias abiertas para esta provincia.");
}

(function init(){
  var hayAlgo = SINDICATOS.length || ACADEMIAS.length || cursosVigentes().length;
  document.getElementById("resource-empty-note").hidden=Boolean(hayAlgo);
  if(!hayAlgo){ document.getElementById("contenido").hidden=true; return; }

  var provs=Object.create(null);
  SINDICATOS.concat(ACADEMIAS,cursosVigentes()).forEach(function(x){
    if(x.provincia&&x.provincia!=="Nacional")provs[x.provincia]=1;
  });
  var lista=Object.keys(provs).sort(function(a,b){return a.localeCompare(b,"es");});

  var html="";
  if(lista.length>1){
    html+='<div class="filtro-box"><div class="filtro-label">Filtrar por provincia</div>'+
          '<select id="filtro-prov"><option value="">Todas las provincias</option>'+
          lista.map(function(p){return '<option value="'+textoSeguro(p)+'">'+textoSeguro(p)+'</option>';}).join("")+
          '</select></div>';
  }
  html+='<div id="listas"></div>';
  document.getElementById("contenido").innerHTML=html;

  var sel=document.getElementById("filtro-prov");
  if(sel)sel.addEventListener("change",pintar);
  pintar();
})();
