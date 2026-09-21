/* Validate device-local data before rendering. This does not replace server authorization. */
(function(){
  'use strict';
  const time=/^(?:[01]\d|2[0-3]):[0-5]\d$/;
  function validTime(value){return typeof value==='string'&&time.test(value);}
  function calendar(raw){
    const result=Object.create(null);let rejected=false;
    if(!raw)return {data:result,rejected};
    if(typeof raw!=='string'||raw.length>2*1024*1024)return {data:result,rejected:true};
    let parsed;try{parsed=JSON.parse(raw);}catch(_){return {data:result,rejected:true};}
    if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return {data:result,rejected:true};
    const months=Object.keys(parsed).sort().reverse();
    if(months.length>600)rejected=true;
    months.slice(0,600).forEach(month=>{
      if(!/^(?:19|20|21)\d{2}-(?:0[1-9]|1[0-2])$/.test(month)){rejected=true;return;}
      const input=parsed[month];if(!input||typeof input!=='object'||Array.isArray(input)){rejected=true;return;}
      const days=Object.create(null),last=new Date(Number(month.slice(0,4)),Number(month.slice(5)),0).getDate();
      Object.keys(input).forEach(day=>{
        if(!/^(?:[1-9]|[12]\d|3[01])$/.test(day)||Number(day)>last){rejected=true;return;}
        const entry=input[day];if(!entry||typeof entry!=='object'||Array.isArray(entry)){rejected=true;return;}
        const tramos=[];
        if(entry.tramos!==undefined&&!Array.isArray(entry.tramos)){rejected=true;return;}
        if((entry.tramos||[]).length>24)rejected=true;
        (entry.tramos||[]).slice(0,24).forEach(t=>{
          if(!t||!validTime(t.i)||!validTime(t.f)){rejected=true;return;}
          tramos.push({i:t.i,f:t.f});
        });
        days[day]={tramos,vac:entry.vac===true,fest:entry.fest===true};
      });
      result[month]=days;
    });
    return {data:result,rejected};
  }
  function validateInputs(view,errorId,resultId){
    const container=document.getElementById(view),error=document.getElementById(errorId);
    for(const input of container.querySelectorAll('input[type=number],input[type=date]')){
      // Hidden conditional fields do not participate in the calculation.
      if(input.disabled)continue;
      let hidden=false;for(let parent=input;parent&&parent!==container;parent=parent.parentElement)if(parent.hidden||parent.style.display==='none'){hidden=true;break;}
      if(hidden)continue;
      if(input.value===''&&!input.validity.badInput&&!input.required)continue;
      const value=input.type==='number'?Number(input.value):Date.parse(input.value);
      let invalid=!Number.isFinite(value)||input.validity.badInput||(input.required&&input.value==='');
      if(input.type==='number'){
        const min=input.min===''?0:Number(input.min),max=input.max===''?1000000:Number(input.max);
        invalid=invalid||value<min||value>max;
      }else invalid=invalid||!/^\d{4}-\d{2}-\d{2}$/.test(input.value)||value<Date.UTC(1900,0,1)||value>Date.UTC(2199,11,31);
      if(invalid){
        const label=document.querySelector('label[for="'+input.id+'"]');
        error.textContent='Revisa '+(label?label.textContent.toLowerCase():'el valor introducido')+'. Debe estar dentro del rango permitido.';
        error.style.display='block';document.getElementById(resultId).style.display='none';
        for(let parent=input.parentElement;parent&&parent!==container;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;
        input.focus();return false;
      }
    }
    return true;
  }
  window.VigilanteSecurity=Object.freeze({validTime,calendar,validateInputs});
})();
