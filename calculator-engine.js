/* Motor de cálculo 2026, sin acceso al DOM: nómina, finiquito y baja.
   Tablas: Convenio estatal de empresas de seguridad (BOE-A-2026-8569). */
(function(root){
'use strict';
var VigilanteRules=root.VigilanteRules||(typeof require==='function'?require('./calculation-rules.js'):null);
var CATS = {
  sin_arma:  {salBase:1161.28,pelig:24.08, act:0,     trans:137.81,vest:112.28,nocH:1.26},
  con_arma:  {salBase:1161.28,pelig:179.90,act:0,     trans:137.81,vest:112.28,nocH:1.26},
  escolta:   {salBase:1161.28,pelig:177.15,act:0,     trans:137.81,vest:115.67,nocH:1.26,esc:312.99},
  explosivos:{salBase:1161.28,pelig:210.55,act:40.17, trans:137.81,vest:112.25,nocH:1.26},
  fondos:    {salBase:1227.74,pelig:179.90,act:210.19,trans:137.81,vest:113.27,nocH:1.27,cBase:1285.55,cVest:114.56,cNoc:1.36},
  tr_explo:  {salBase:1227.74,pelig:191.59,act:152.44,trans:137.81,vest:113.27,nocH:1.27,cBase:1285.55,cVest:114.56,cNoc:1.36}
};
var QUINQUENIO = {sin_arma:45.86,con_arma:45.86,escolta:45.86,explosivos:45.86,fondos:46.59,tr_explo:46.59};
var JORNADA=162, HORAS_ANUALES=1782, PLUS_FEST=1.02, PLUS_NOCHE_ESPECIAL=83.48;
var BASE_MAXIMA=5101.20, BASE_MINIMA_HORA_PARCIAL=8.58;

// Categoría efectiva, con la variante de conductor cuando existe.
function catEf(k,esCond){
  var c=CATS[k];
  if(esCond&&c.cBase)return {salBase:c.cBase,pelig:c.pelig,act:c.act,trans:c.trans,vest:c.cVest,nocH:c.cNoc,esc:0};
  return {salBase:c.salBase,pelig:c.pelig,act:c.act||0,trans:c.trans,vest:c.vest,nocH:c.nocH,esc:c.esc||0};
}
function tienePlusFestivo(categoria){return !['fondos','tr_explo'].includes(categoria);}
function r2(n){var centimos=Math.abs(n)*100;return Math.sign(n)*Math.round(centimos+Number.EPSILON*Math.max(1,centimos))/100;}
function calcAntig(a,cat,conductor){return r2(Math.floor(a/5)*(conductor&&CATS[cat].cBase?50.23:QUINQUENIO[cat]));}
// Art. 53: valor de la hora ordinaria/extra = (12 mensualidades + 3 pagas) ÷ 1.782 h.
function calcHoraExtra(sb,p,act,ant,esc){
  return r2(((sb+p+act+ant)*15+(esc||0)*12)/HORAS_ANUALES);
}
function calcularNomina(o){
  var cat=catEf(o.categoria,o.conductor);
  var hp=o.jornada==='parcial'?o.horasContrato:JORNADA;
  var ratio=hp/JORNADA;
  var hVac=r2(o.diasVac*hp/31);
  var hJor=r2(o.horas+hVac);                       // jornada computable del mes
  // Jornada completa: mes entero. Parcial y días sueltos: en proporción a las horas.
  var factor=o.jornada!=='completa'&&hJor<hp?hJor/hp:1;
  var f=ratio*factor;
  var ant=calcAntig(o.anios,o.categoria,o.conductor);
  var r={hp:hp,ratio:ratio,factor:factor,hVac:hVac,hJor:hJor,quinquenios:Math.floor(o.anios/5)};
  r.base=r2(cat.salBase*f); r.pelig=r2(cat.pelig*f); r.act=r2(cat.act*f);
  r.escolta=r2(cat.esc*f); r.trans=r2(cat.trans*f); r.vest=r2(cat.vest*f);
  r.antig=r2(ant*f);
  r.responsable=o.responsable?r2(cat.salBase*0.10*f):0;
  r.plusServicio=r2(o.plusServicio||0);
  // Hora extra (jornada completa) u hora complementaria (parcial): mismo valor de hora.
  r.valorHora=r2(calcHoraExtra(cat.salBase,cat.pelig,cat.act,ant,cat.esc)+(o.responsable?cat.salBase*0.10*12/HORAS_ANUALES:0));
  r.horasExtra=Math.max(0,r2(hJor-hp));
  r.extra=r2(r.horasExtra*r.valorHora);
  r.nocheTarifa=cat.nocH;
  r.noche=r2(o.horasNoche*cat.nocH);
  r.festAplicable=tienePlusFestivo(o.categoria);
  r.fest=r.festAplicable?r2(o.horasFestivo*PLUS_FEST):0;
  r.navidad=r2((o.nochesEspeciales||0)*PLUS_NOCHE_ESPECIAL);
  // Pluses de vacaciones: si no se indica la media, se estiman con los turnos del mes
  // (lo cobrado en noches y festivos por cada día no de vacaciones, aplicado a los días de vacaciones).
  var diasMes=o.diasMes||30;
  r.vacPlus=0;
  if(o.diasVac>0){
    if(o.mediaPlusVac>0)r.vacPlus=r2(o.mediaPlusVac/31*o.diasVac);
    else if(diasMes>o.diasVac)r.vacPlus=r2((r.noche+r.fest)*o.diasVac/(diasMes-o.diasVac));
  }
  r.basePaga=r2((cat.salBase+cat.act+ant+cat.pelig)*ratio);
  r.pagasProrrateadas=o.pagas;
  r.prorrata=r2(o.pagas*r.basePaga*factor/12);
  r.bruto=r2(r.base+r.pelig+r.act+r.escolta+r.trans+r.vest+r.antig+r.responsable+r.plusServicio+
    r.vacPlus+r.extra+r.noche+r.fest+r.navidad+r.prorrata);
  // La base de cotización incluye siempre la parte de las 3 pagas, prorrateadas o no.
  var baseCot=r2(r.bruto+r2((3-o.pagas)*r.basePaga*factor/12));
  if(o.jornada==='parcial')baseCot=Math.max(baseCot,r2(o.horas*BASE_MINIMA_HORA_PARCIAL));
  baseCot=Math.min(baseCot,BASE_MAXIMA);
  var cotExtra=o.jornada==='completa'?Math.min(r.extra,baseCot):0;
  r.baseCotizacion=baseCot;
  r.cuotas=VigilanteRules.contributions(r2(baseCot-cotExtra),baseCot,cotExtra,o.contrato==='temporal');
  r.ss=r.cuotas.total;
  r.irpf=r2(r.bruto*(o.irpf||0)/100);
  r.neto=r2(r.bruto-r.ss-r.irpf);
  return r;
}
function solapamiento(a1,a2,b1,b2){
  var s=new Date(Math.max(a1.getTime(),b1.getTime()));
  var e=new Date(Math.min(a2.getTime(),b2.getTime()));
  if(e<s)return 0;
  return Math.round((e-s)/864e5)+1;
}
// Parte pendiente de cada paga (art. 45). Las pagas vencidas se dan por cobradas el día 15.
function propPaga(d1,d2,paga){
  var y=d2.getUTCFullYear();
  var pagoNavidad=new Date(Date.UTC(y,11,15));
  if(paga==='navidad'&&d2>=pagoNavidad&&d1<=pagoNavidad)return 0;
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
function calcularFiniquito(o){
  var cat=catEf(o.categoria,o.conductor);
  var hp=o.jornada==='completa'?JORNADA:o.horasContrato,ratio=hp/JORNADA;
  var r={dias:VigilanteRules.days(o.inicio,o.fin),aniosAnt:VigilanteRules.seniorityYears(o.inicio,o.fin)};
  var ant=calcAntig(r.aniosAnt,o.categoria,o.conductor);
  var responsableMes=o.responsable?cat.salBase*0.10*ratio:0;
  // Salario de un mes completo (para valorar las vacaciones) y base de una paga extra.
  var mes=(cat.salBase+cat.pelig+cat.act+cat.esc+cat.trans+cat.vest+ant)*ratio+responsableMes;
  r.basePaga=r2((cat.salBase+cat.pelig+cat.act+ant)*ratio);
  r.valorDiaVac=r2(mes/30);
  r.vacaciones=r2(o.diasVac*mes/30);
  var d1=new Date(o.inicio+'T00:00:00Z'),d2=new Date(o.fin+'T00:00:00Z');
  r.pctJulio=o.prorrateadas.julio?0:propPaga(d1,d2,'julio');
  r.pctNavidad=o.prorrateadas.navidad?0:propPaga(d1,d2,'navidad');
  r.pctMarzo=o.prorrateadas.marzo?0:propPaga(d1,d2,'marzo');
  r.julio=r2(r.basePaga*r.pctJulio);r.navidad=r2(r.basePaga*r.pctNavidad);r.marzo=r2(r.basePaga*r.pctMarzo);
  r.liqBruta=r2(r.vacaciones+r.julio+r.navidad+r.marzo);
  var temporal=o.motivo==='temporal'||o.motivo==='sustitucion';
  // Las pagas ya cotizaron mes a mes con su prorrata; las vacaciones no disfrutadas cotizan ahora.
  r.ssVac=VigilanteRules.contributions(r.vacaciones,r.vacaciones,0,temporal).total;
  r.irpfLiq=r2(r.liqBruta*o.irpf/100);
  r.liqNeto=r2(r.liqBruta-r.ssVac-r.irpfLiq);
  r.salarioAnual=r2((cat.salBase+cat.pelig+cat.act+cat.esc+ant)*ratio*12+responsableMes*12+r.basePaga*3);
  r.indem=VigilanteRules.severance(o.inicio,o.fin,o.motivo,r.salarioAnual);
  // Hacienda considera que la indemnización por fin de contrato temporal tributa.
  r.irpfIndem=o.motivo==='temporal'?r2(r.indem*o.irpf/100):0;
  r.total=r2(r.liqNeto+r.indem-r.irpfIndem);
  return r;
}
// Porcentaje de cada día (art. 51 del convenio). day = día de la baja, empezando en 1.
function porcentajeBaja(day,tipo,nbaja){
  if(tipo==='hospitalizacion'&&day<=40)return 1;
  return VigilanteRules.illnessRate(day,nbaja,nbaja===1);
}
function calcularBaja(o){
  var cat=catEf(o.categoria,o.conductor);
  var ant=calcAntig(o.anios,o.categoria,o.conductor);
  var tabla=r2(cat.salBase+cat.pelig+cat.act+cat.esc+cat.trans+cat.vest+ant);
  var prorrata=r2((cat.salBase+cat.pelig+cat.act+ant)*3/12);
  var r={estimada:!(o.baseMensual>0)};
  r.baseMensual=o.baseMensual>0?r2(o.baseMensual):r2(tabla+prorrata);
  r.baseDiaria=r2(r.baseMensual/30);
  r.tablaDiaria=r2(tabla/30);
  r.tramos=[];
  var bruto=0;
  for(var day=1;day<=o.dias;day++){
    var pct,importe,nota='';
    if(o.tipo==='laboral'){
      if(day===1){pct=null;importe=0;nota='nomina';}
      else{pct=1;importe=Math.max(r.baseDiaria*0.75,r.tablaDiaria);}
    }else{pct=porcentajeBaja(day,o.tipo,o.nbaja);importe=r.baseDiaria*pct;}
    var ultimo=r.tramos[r.tramos.length-1];
    if(ultimo&&ultimo.pct===pct&&ultimo.nota===nota){ultimo.hasta=day;ultimo.importe+=importe;}
    else r.tramos.push({desde:day,hasta:day,pct:pct,nota:nota,importe:importe});
    bruto+=importe;
  }
  r.tramos.forEach(function(t){t.importe=r2(t.importe);});
  r.bruto=r2(r.tramos.reduce(function(s,t){return s+t.importe;},0));
  var baseCot=r2(r.baseDiaria*o.dias);
  r.ss=VigilanteRules.contributions(baseCot,baseCot,0,false).total;
  r.irpf=r2(r.bruto*o.irpf/100);
  r.neto=r2(r.bruto-r.ss-r.irpf);
  return r;
}

var api={CATS:CATS,QUINQUENIO:QUINQUENIO,JORNADA:JORNADA,HORAS_ANUALES:HORAS_ANUALES,PLUS_FEST:PLUS_FEST,
  PLUS_NOCHE_ESPECIAL:PLUS_NOCHE_ESPECIAL,BASE_MAXIMA:BASE_MAXIMA,BASE_MINIMA_HORA_PARCIAL:BASE_MINIMA_HORA_PARCIAL,
  catEf:catEf,tienePlusFestivo:tienePlusFestivo,r2:r2,calcAntig:calcAntig,calcHoraExtra:calcHoraExtra,
  calcularNomina:calcularNomina,propPaga:propPaga,calcularFiniquito:calcularFiniquito,porcentajeBaja:porcentajeBaja,calcularBaja:calcularBaja};
if(typeof module==='object'&&module.exports)module.exports=api;else root.VigilanteCalc=Object.freeze(api);
})(typeof window==='object'?window:globalThis);
