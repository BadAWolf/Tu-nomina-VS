/* Vacation supplements: BOE-A-2026-8569 art. 57.2. Hours are an estimate,
   not a reconstruction of amounts accrued at historical rates. */
(function(root){
  'use strict';
  const round=n=>{const cents=n*100;return Math.round(cents+Number.EPSILON*Math.max(1,cents))/100;};
  const blank=value=>value===''||value===undefined||value===null;
  function number(value,max,label){
    if(blank(value))return 0;
    const n=Number(value);
    if(!Number.isFinite(n)||n<0||n>max)throw new RangeError('Revisa '+label+'. Introduce un número entre 0 y '+max+'.');
    return n;
  }
  function calculate(o){
    const days=number(o.days,31,'los días de vacaciones');
    if(!days)return {average:0,amount:0,provided:false,mode:o.mode};
    let average=0,provided=false;
    if(o.mode==='horas'){
      const night=number(o.night,744,'las horas nocturnas medias');
      const weekend=Number(o.weekendRate)>0?number(o.weekend,744,'las horas medias de fin de semana o festivo'):0;
      const other=number(o.other,10000,'los otros complementos');
      const nightRate=number(o.nightRate,100,'la tarifa nocturna');
      const weekendRate=number(o.weekendRate,100,'la tarifa de fin de semana');
      average=night*nightRate+weekend*weekendRate+other;
      provided=[o.night,weekendRate>0?o.weekend:undefined,o.other].some(value=>!blank(value));
    }else if(o.mode==='nominas'){
      if(!Array.isArray(o.months)||o.months.length<1||o.months.length>12)throw new RangeError('Elige entre 1 y 12 meses de referencia.');
      provided=o.months.some(month=>[month.night,month.weekend,month.other].some(value=>!blank(value)));
      if(provided){
        let total=0;
        o.months.forEach((month,index)=>{
          const values=[month.night,month.weekend,month.other];
          if(values.every(blank))throw new RangeError('Falta el mes '+(index+1)+'. Si no cobraste estos pluses, escribe 0 en una casilla de ese mes.');
          total+=values.reduce((sum,value)=>sum+number(value,10000,'los importes del mes '+(index+1)),0);
        });
        average=total/o.months.length;
      }
    }else if(o.mode==='importe'){
      average=number(o.average,10000,'la media mensual en euros');
      provided=!blank(o.average);
    }else throw new RangeError('Selecciona cómo quieres calcular los pluses de vacaciones.');
    // Keep the full average until prorating: do not round every day or month.
    return {average,amount:round(average*days/31),provided,mode:o.mode,days};
  }
  function mount(context){
    const d=root.document,card=d.getElementById('vac-plus-field');
    const method=d.getElementById('vac-metodo'),months=d.getElementById('vac-meses');
    const money=n=>n.toLocaleString('es-ES',{minimumFractionDigits:2,maximumFractionDigits:2})+' €';
    const rows=d.getElementById('vac-month-rows');
    for(let i=1;i<=12;i++){
      const row=d.createElement('tr');row.dataset.month=String(i);
      const heading=d.createElement('th');heading.scope='row';heading.textContent='Mes '+i;row.append(heading);
      for(const [key,label]of [['night','Noches'],['weekend','Finde y festivos'],['other','Otros pluses']]){
        const cell=d.createElement('td'),input=d.createElement('input');
        input.type='number';input.id='vac-mes-'+i+'-'+key;input.min='0';input.max='10000';input.step='0.01';input.inputMode='decimal';
        input.setAttribute('aria-label',label+' del mes '+i+' en euros');input.placeholder='—';cell.append(input);row.append(cell);
      }
      rows.append(row);
    }
    function sync(){
      const c=context(),weekend=d.getElementById('vac-horas-festivo');
      d.getElementById('vac-intro').textContent=method.value==='horas'?'Dinos las horas que sueles cobrar al mes. Nosotros hacemos las cuentas.':method.value==='nominas'?'Copia los importes de tus nóminas. Nosotros calculamos la media.':'Introduce tu media mensual y calculamos la parte de tus vacaciones.';
      for(const mode of ['horas','nominas','importe']){
        const panel=d.getElementById('vac-mode-'+mode);panel.hidden=method.value!==mode;
        panel.querySelectorAll('input,select').forEach(input=>{input.disabled=panel.hidden;});
      }
      weekend.closest('.field').hidden=!(c.weekendRate>0);
      weekend.disabled=method.value!=='horas'||!(c.weekendRate>0);
      d.getElementById('vac-transport-hint').hidden=c.weekendRate>0||method.value!=='horas';
      rows.querySelectorAll('tr').forEach(row=>{
        row.hidden=Number(row.dataset.month)>Number(months.value);
        row.querySelectorAll('input').forEach(input=>{input.disabled=method.value!=='nominas'||row.hidden;});
      });
    }
    function read(days){
      const c=context();
      const value=id=>{
        const input=d.getElementById(id);
        if(input.validity.badInput)throw new RangeError('Revisa los números de los pluses de vacaciones.');
        return input.value;
      };
      const o={mode:method.value,days:days===undefined?c.days:days};
      if(!o.days)return calculate(o);
      if(o.mode==='horas')Object.assign(o,{night:value('vac-horas-noche'),weekend:c.weekendRate>0?value('vac-horas-festivo'):'',other:value('vac-otros'),nightRate:c.nightRate,weekendRate:c.weekendRate});
      if(o.mode==='importe')o.average=value('n-promedioVac');
      if(o.mode==='nominas'){
        const count=Number(months.value);
        if(!Number.isInteger(count)||count<1||count>12)throw new RangeError('Elige entre 1 y 12 meses de referencia.');
        o.months=Array.from({length:count},(_,i)=>({night:value('vac-mes-'+(i+1)+'-night'),weekend:value('vac-mes-'+(i+1)+'-weekend'),other:value('vac-mes-'+(i+1)+'-other')}));
      }
      return calculate(o);
    }
    function refresh(){
      sync();
      if(card.hidden)return;
      const c=context();
      d.getElementById('vac-rate-hint').textContent='Tarifas de tu categoría en 2026: noche '+money(c.nightRate)+'/h'+(c.weekendRate>0?' · fin de semana o festivo '+money(c.weekendRate)+'/h.':'. El plus de fin de semana y festivos de vigilancia no se aplica a transporte.');
      const preview=d.getElementById('vac-preview');
      try{
        const result=read();
        if(!c.days){preview.textContent='Indica los días de vacaciones para ver este complemento.';return;}
        if(!result.provided){preview.textContent='Opcional: si lo dejas vacío, no se añadirá este complemento de vacaciones.';return;}
        preview.textContent='Media mensual'+(result.mode==='horas'?' estimada':'')+': '+money(result.average)+'. Por '+c.days+' días de vacaciones: +'+money(result.amount)+' brutos.';
      }catch(error){preview.textContent=error.message;}
    }
    card.addEventListener('input',refresh);card.addEventListener('change',refresh);refresh();
    return Object.freeze({read,refresh});
  }
  const api=Object.freeze({calculate,mount});
  if(typeof module==='object'&&module.exports)module.exports=api;else root.VigilanteVacationPluses=api;
})(typeof window==='object'?window:globalThis);
