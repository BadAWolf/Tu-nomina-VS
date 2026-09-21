/* IT dates, monthly estimates and PDF data. Health dates stay in this page only. */
var informeBaja=null;
function bajaEl(id){return document.getElementById(id);}
function bajaNumber(id){return Number(bajaEl(id).value)||0;}
function actualizarCamposBaja(){
  var fechas=bajaEl('b-periodo-modo').value==='fechas',tipo=bajaEl('b-tipo').value;
  var parcial=bajaEl('b-jornada').value==='parcial',laboral=tipo==='laboral'||tipo==='profesional';
  bajaEl('b-fechas-fields').hidden=!fechas;bajaEl('b-dias-field').hidden=fechas;
  bajaEl('b-hospital-fields').hidden=tipo!=='hospitalizacion';
  bajaEl('b-hospital-fecha-field').hidden=!fechas;bajaEl('b-hospital-dia-field').hidden=fechas;
  bajaEl('b-field-nbaja').hidden=laboral;
  bajaEl('b-base-mensual-fields').hidden=parcial;bajaEl('b-base-parcial-fields').hidden=!parcial;
  bajaEl('b-profesional-fields').hidden=!laboral||parcial;
  bajaEl('bbtn-sin_arma').closest('.card').hidden=tipo!=='laboral';
  bajaEl('b-anios').closest('.card').hidden=tipo!=='laboral';
  bajaEl('card-condB').hidden=tipo!=='laboral';
  bajaEl('b-baseManual').required=!parcial;
  bajaEl('b-base-diaria').required=parcial;
  bajaEl('b-br-profesional').required=laboral&&!parcial;
  bajaEl('b-parcial-porcentaje-field').hidden=!parcial||tipo!=='laboral';
  bajaEl('b-cotizacion-field').hidden=parcial;
  var dias=bajaNumber('b-dias');
  if(fechas){
    var inicio=bajaEl('b-inicio').value,fin=bajaEl('b-fin').value;
    bajaEl('b-fin').min=inicio;
    bajaEl('b-hospital-fecha').min='2026-01-01';bajaEl('b-hospital-fecha').max=fin;
    try{dias=VigilanteRules.illnessPeriod(inicio,fin);bajaEl('b-periodo-resumen').textContent=dias+' días de baja · ambas fechas incluidas';}
    catch(_){dias=0;bajaEl('b-periodo-resumen').textContent=inicio&&fin?'Revisa las fechas: el fin debe ser igual o posterior al inicio y el periodo no puede superar 545 días.':'Elige las dos fechas para ver la duración.';}
  }
  var puedeNoTenerProcesos=!laboral&&bajaNumber('b-nbaja')===1;
  bajaEl('b-sin-procesos').disabled=!puedeNoTenerProcesos;
  if(!puedeNoTenerProcesos)bajaEl('b-sin-procesos').checked=false;
  bajaEl('b-sin-procesos-field').hidden=!puedeNoTenerProcesos||dias+bajaNumber('b-dias-previos')<91;
}
function invalidarBaja(){informeBaja=null;ctxPDF.baja=null;bajaEl('resultado-baja').style.display='none';actualizarCamposBaja();}
bajaEl('view-baja').addEventListener('input',invalidarBaja);
bajaEl('view-baja').addEventListener('change',invalidarBaja);
bajaEl('view-baja').querySelectorAll('.cat-btn').forEach(function(btn){btn.addEventListener('click',function(){informeBaja=null;ctxPDF.baja=null;bajaEl('resultado-baja').style.display='none';});});
bajaEl('btnCalcBaja').addEventListener('click',function(){calcBaja();});
var ajustesBaja=bajaEl('b-alcance').closest('.card');
bajaEl('view-baja').prepend(ajustesBaja);
var cotizacionBaja=bajaEl('b-cot-cp').closest('details');
cotizacionBaja.append(bajaEl('b-extra-diaria').closest('.field'),bajaEl('b-fuerza-diaria').closest('.field'));
bajaEl('b-anios').closest('.card').append(bajaEl('b-antig-importe').closest('.field'));
ajustesBaja.querySelector('details.b-adjust').remove();
actualizarCamposBaja();
function calcBaja(){if(window.VigilanteAuth)window.VigilanteAuth.require(calcBajaRegistrado);}
function calcBajaRegistrado(){
  ctxPDF.baja=null;informeBaja=null;actualizarCamposBaja();
  if(!window.VigilanteSecurity.validateInputs('view-baja','b-errorBox','resultado-baja'))return;
  var err=bajaEl('b-errorBox');
  function fail(message){err.textContent=message;err.style.display='block';bajaEl('resultado-baja').style.display='none';}
  var fechas=bajaEl('b-periodo-modo').value==='fechas',inicio=fechas?bajaEl('b-inicio').value:null,fin=fechas?bajaEl('b-fin').value:null;
  var dias;
  try{dias=fechas?VigilanteRules.illnessPeriod(inicio,fin):bajaNumber('b-dias');}catch(e){fail(e.message);return;}
  var prior=bajaNumber('b-dias-previos'),tipo=bajaEl('b-tipo').value,laboral=tipo==='laboral'||tipo==='profesional',parcial=bajaEl('b-jornada').value==='parcial';
  if(bajaEl('b-alcance').value!=='ordinaria'){fail('Este cálculo cubre IT ordinaria con contrato vigente y derecho reconocido. Las IT especiales, el pluriempleo o el contrato extinguido necesitan las reglas y bases específicas de tu resolución.');return;}
  if(fechas&&(inicio.slice(0,4)!=='2026'||fin.slice(0,4)!=='2026')){fail('Este cálculo utiliza tablas y cotizaciones de 2026. Divide el periodo por ejercicios y utiliza las reglas del año correspondiente; no se aplican las de 2026 a otro año.');return;}
  if(prior&&tipo==='hospitalizacion'){fail('Para no reiniciar los 40 días de hospitalización, calcula el proceso continuo desde su inicio e indica la fecha original de ingreso. La hospitalización en una recaída discontinua requiere cálculo individual.');return;}
  var nbaja=bajaNumber('b-nbaja'),ip=bajaNumber('b-irpf'),hospitalStart=0;
  if(tipo==='hospitalizacion'){
    if(fechas){
      var ingreso=bajaEl('b-hospital-fecha').value||inicio;
      if(!VigilanteRules.validDate(ingreso)||ingreso<inicio||ingreso>fin){fail('Incluye el inicio del proceso y la fecha original del ingreso hospitalario dentro del periodo calculado.');return;}
      hospitalStart=VigilanteRules.days(inicio,ingreso);
    }else hospitalStart=bajaNumber('b-hospital-dia');
    if(!Number.isInteger(hospitalStart)||hospitalStart<1||hospitalStart>dias){fail('El día de ingreso debe estar dentro de la duración de la baja.');return;}
  }
  var conductor=bajaEl('switchCondB').checked,cat=catEf(bcatActual,conductor),an=bajaNumber('b-anios'),ant=calcAntig(an,bcatActual,conductor);
  if(bajaEl('b-antig-importe').value!=='')ant=bajaNumber('b-antig-importe');
  var factor=parcial&&tipo==='laboral'?bajaNumber('b-parcial-porcentaje')/100:1;
  if(parcial&&tipo==='laboral'&&!(factor>0&&factor<=1)){fail('Indica el porcentaje de jornada para ajustar el complemento por accidente laboral.');return;}
  var tabla=r2((cat.salBase+cat.pelig+(cat.act||0)+cat.trans+cat.vest+ant)*factor);
  var manual=bajaNumber('b-baseManual'),divisor=bajaNumber('b-base-dias');
  if(!parcial&&(!Number.isInteger(divisor)||divisor<1||divisor>31)){fail('Indica entre 1 y 31 días cotizados para la base.');return;}
  if(!parcial&&!manual){fail('Copia la base de contingencias comunes de tu nómina anterior. Es necesaria para calcular la baja.');return;}
  if(bcatActual==='con_arma'&&tipo==='laboral'){fail('El mínimo de peligrosidad con arma depende de horas y garantías reconocidas. Para baja común usa tu base real; el complemento de accidente laboral con arma requiere revisar esos importes con la empresa.');return;}
  var cc=parcial?bajaNumber('b-base-diaria'):manual/divisor;
  var base=parcial?bajaNumber('b-base-diaria'):(laboral?bajaNumber('b-br-profesional'):cc);
  if(parcial&&!base){fail('Para jornada parcial o fijo discontinuo, introduce la base reguladora diaria reconocida. Se aplica también como base diaria de cotización CC (art. 40).');return;}
  var cp=bajaNumber('b-cot-cp')||cc;
  if(!base){fail('Indica la base reguladora diaria reconocida por la mutua para la contingencia profesional.');return;}
  if(cc>170.04+1e-8||cp>170.04+1e-8||(!parcial&&(cc<47.48-1e-8||cp<47.48-1e-8))){fail('Revisa las bases: en este supuesto ordinario de 2026, la diaria completa está entre 47,48 y 170,04 €. En parcial se aplica la base reguladora reconocida, sin imponer el mínimo mensual completo.');return;}
  var extraDaily=bajaNumber('b-extra-diaria'),forceDaily=bajaNumber('b-fuerza-diaria');
  var report;
  try{report=VigilanteRules.illnessReport({start:inicio,end:fin,total:dias,prior:prior,base:base,cotCC:cc,cotCP:cp,extraDaily:extraDaily,forceDaily:forceDaily,tableDaily:tabla/30,irpf:ip,number:nbaja,noPrevious:bajaEl('b-sin-procesos').checked,hospitalStart:hospitalStart,laboral:laboral,professional:tipo==='profesional',temporary:bajaEl('b-contrato').value==='temporal',monthlyContribution:!parcial&&bajaEl('b-cotizacion').value==='mensual'});}
  catch(e){fail(e.message);return;}
  err.style.display='none';
  for(var i=0;i<=7;i++)bajaEl('brow-t'+i).style.display='none';
  report.segments.forEach(function(s,index){
    bajaEl('brow-t'+index).style.display='flex';
    bajaEl('blbl-t'+index).textContent=s.excluded?'Primer día: salario a cargo de la empresa, aparte':'Días '+s.start+'–'+s.end+' ('+(laboral?(tipo==='profesional'?'75% de la base reguladora':'mayor entre 75% legal y tabla del convenio'):Math.round(s.rate*100)+'%'+(s.hospital?', hospitalización':''))+') · '+(s.end-s.start+1)+' días';
    bajaEl('br-t'+index).textContent=s.excluded?'no incluido':'+'+fmt(s.amount);
  });
  var origen=parcial?'Base diaria aportada':'Base CC aportada: '+fmt(manual)+' ÷ '+divisor;
  bajaEl('b-info-base').textContent='Base reguladora: '+fmt(base)+'/día. '+origen+'.';
  bajaEl('br-total-bruto').textContent=fmt(report.gross);bajaEl('br-ss').textContent='-'+fmt(report.ss);
  bajaEl('brow-irpf').style.display=ip>0?'flex':'none';bajaEl('brow-irpf0').style.display=ip>0?'none':'flex';
  bajaEl('blbl-irpf').textContent='Retención IRPF ('+ip+'%)';bajaEl('br-irpf').textContent='-'+fmt(report.irpf);bajaEl('br-neto').textContent=fmt(report.net);
  var meses=bajaEl('b-meses');meses.replaceChildren();bajaEl('b-meses-section').hidden=!fechas;
  report.monthly.forEach(function(m){
    if(!fechas)return;
    m.label=MESES_ES[Number(m.key.slice(5))-1]+' '+m.key.slice(0,4);
    var card=document.createElement('article');card.className='b-month';
    var h=document.createElement('h3');h.textContent=m.label;card.appendChild(h);
    var period=document.createElement('p');period.className='field-hint';period.textContent=fechaES(m.start)+' – '+fechaES(m.end)+' · '+m.days+' días de baja';card.appendChild(period);
    var dl=document.createElement('dl');
    [['Bruto',m.gross],['Seguridad Social',-m.ss],['IRPF ('+ip+'%)',-m.irpf],['Neto estimado',m.net]].forEach(function(pair){var dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=pair[0];dd.textContent=fmt(pair[1]);dl.append(dt,dd);});card.appendChild(dl);meses.appendChild(card);
  });
  var notas=[
    'Importes por los días de baja del periodo, no la nómina completa del mes. El sueldo trabajado, el día inicial del accidente laboral y las pagas extra abonadas aparte no están sumados.',
    'Supone contrato vigente y derecho a la prestación. La enfermedad común exige, con carácter general, 180 días cotizados en los últimos 5 años; los accidentes no exigen ese periodo. No cubre extinción de contrato, situaciones especiales de IT ni mejoras de empresa.',
    'Bases e IRPF constantes durante el periodo; tipos de cotización de 2026. El neto puede variar por la retención real, topes de cotización y otras incidencias de nómina.'
  ];
  if(extraDaily||forceDaily)notas.push('Incluye la cotización adicional por horas extra: base diaria ordinaria '+fmt(extraDaily)+' al 4,70% y fuerza mayor '+fmt(forceDaily)+' al 2%.');
  if(!parcial&&bajaEl('b-cotizacion').value==='mensual')notas.push('La cotización mensual se ajusta a 30 días, suponiendo empleo ordinario el resto del mes. La prestación se calcula por días naturales.');
  if(!fechas)notas.push('Sin fechas, las deducciones se estiman por los días indicados; no se aplican los ajustes de cotización de cada mes.');
  if(!bajaNumber('b-cot-cp'))notas.push('Se ha supuesto la misma base de cotización para contingencias comunes y profesionales.');
  if(prior)notas.push('Continúa desde el día '+(prior+1)+' del proceso reconocido. Los '+prior+' días anteriores no se incluyen en los importes.');
  if(report.net<0||report.monthly.some(function(m){return m.net<0;}))notas.push('Un neto negativo refleja cotizaciones superiores a la prestación de esos días; no implica por sí solo un cobro bancario, pues se regulariza con el resto de la nómina.');
  notas.push(tipo==='laboral'?'En accidente laboral, el complemento de convenio preserva las pagas extraordinarias.':tipo==='profesional'?'La enfermedad profesional se estima al 75% legal; el complemento del art. 51.a está previsto para accidente laboral.':'La base diaria ya contiene prorrata de extras. Su liquidación posterior depende del devengo y de las mejoras aplicables; no las sumes otra vez a esta estimación.');
  var notesEl=bajaEl('b-notas');notesEl.replaceChildren();notas.forEach(function(t){var p=document.createElement('p');p.textContent=t;notesEl.appendChild(p);});
  var sources=document.createElement('p');[['Convenio, art. 51','https://www.boe.es/buscar/doc.php?id=BOE-A-2026-8569'],['Bases y porcentajes de Seguridad Social','https://www.seg-social.es/wps/portal/wss/internet/Trabajadores/PrestacionesPensionesTrabajadores/10952/28362/28365?changeLanguage=es']].forEach(function(s,index){if(index)sources.append(' · ');var a=document.createElement('a');a.textContent=s[0];a.href=s[1];a.target='_blank';a.rel='noopener';sources.append(a);});notesEl.appendChild(sources);
  ctxPDF.baja={
    'Categoría':nombreCat(bcatActual,conductor),'Tipo de baja':bajaEl('b-tipo').selectedOptions[0].textContent,
    'Periodo':fechas?fechaES(inicio)+' – '+fechaES(fin)+' (ambos incluidos)':dias+' días, sin fechas',
    'Días en este cálculo':String(dias),'Días previos del proceso':String(prior),
    'Jornada':parcial?'Parcial / fijo discontinuo'+(tipo==='laboral'?' · '+factor*100+'%':''):'Completa',
    'Número de baja del año':laboral?'No aplica':String(nbaja),'Antigüedad':an+' años',
    'Origen de la base':origen,'Base reguladora diaria':fmt(base)+'/día',
    'Cotización diaria CC / CP':fmt(cc)+' / '+fmt(cp),
    'Base diaria adicional HE / fuerza mayor':fmt(extraDaily)+' / '+fmt(forceDaily),
    'Retención IRPF':ip+'%','Contrato':bajaEl('b-contrato').selectedOptions[0].textContent
  };
  if(hospitalStart)ctxPDF.baja['Ingreso hospitalario']=fechas?fechaES(bajaEl('b-hospital-fecha').value||inicio):'Día '+hospitalStart+' de este periodo';
  if(!laboral&&dias+prior>90)ctxPDF.baja['Sin otro proceso en los 12 meses anteriores']=bajaEl('b-sin-procesos').checked?'Sí':'No';
  report.notes=notas;informeBaja=report;
  bajaEl('resultado-baja').style.display='block';cargarJsPDF(function(){});
  window.VigilanteInstall?.calculationCompleted();window.VigilanteAnalytics?.track('calculation_complete');
  setTimeout(function(){bajaEl('resultado-baja').scrollIntoView({behavior:'smooth',block:'nearest'});},60);
}
