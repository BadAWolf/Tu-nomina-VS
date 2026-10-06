/* Reglas 2026: BOE-A-2026-8569, arts. 45, 51 y 52; Estatuto, arts. 49, 53 y 56. */
(function(root){
  'use strict';
  const round=n=>{const cents=Math.abs(n)*100;return Math.sign(n)*Math.round(cents+Number.EPSILON*Math.max(1,cents))/100;};
  const date=value=>new Date(value+'T00:00:00Z');
  const days=(start,end)=>Math.round((date(end)-date(start))/86400000)+1;
  // Cada cuota se redondea por separado. CC no incluye las horas extra;
  // CP sí, y las horas extra llevan una cotización adicional sin MEI.
  function contributions(cc,cp,extra=0,temporary=false){
    if([cc,cp,extra].some(n=>!Number.isFinite(n)||n<0))throw new RangeError('Revisa las bases de cotización.');
    const parts={common:round(cc*.047),mei:round(cc*.0015),unemployment:round(cp*(temporary?.016:.0155)),training:round(cp*.001),overtime:round(extra*.047)};
    return {...parts,total:round(Object.values(parts).reduce((a,b)=>a+b,0))};
  }
  function seniorityYears(start,end){
    if(!validDate(start)||!validDate(end)||start>end)throw new RangeError('Revisa la fecha de antigüedad reconocida.');
    // Art. 42: el quinquenio se devenga desde el primer día de su mes.
    return Number(end.slice(0,4))-Number(start.slice(0,4))-(end.slice(5,7)<start.slice(5,7)?1:0);
  }
  function nightPremium(workedMinutes,nightMinutes){
    return nightMinutes>=240?Math.min(workedMinutes,480):nightMinutes;
  }
  function months(start,end){
    if(end<start)return 0;
    const a=date(start),b=date(end);b.setUTCDate(b.getUTCDate()+1);
    return (b.getUTCFullYear()-a.getUTCFullYear())*12+b.getUTCMonth()-a.getUTCMonth()+(b.getUTCDate()>a.getUTCDate()?1:0);
  }
  function severance(start,end,type,annualSalary){
    const daily=annualSalary/365;
    if(type==='temporal')return round(daily*12*days(start,end)/365);
    if(type==='objetivo')return round(daily*Math.min(360,20*months(start,end)/12));
    if(type!=='improcedente')return 0;
    const old=start<'2012-02-12'?45*months(start,end<'2012-02-12'?end:'2012-02-11')/12:0;
    const recent=end>='2012-02-12'?33*months(start>'2012-02-12'?start:'2012-02-12',end)/12:0;
    return round(daily*Math.min(old+recent,old>720?Math.min(old,1260):720));
  }
  function illnessRate(day,number,noPrevious){
    if(day<=3)return number===1?0.5:0;
    if(day<=20)return number<=2?0.8:0.6;
    if(day<=40)return 1;
    if(day<=60)return 0.9;
    if(day<=90)return 0.8;
    if(day<=100 && number===1 && noPrevious)return 0.8;
    return 0.75;
  }
  function validDate(value){
    return typeof value==='string'&&/^(?:19|20|21)\d{2}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(+date(value))&&date(value).toISOString().slice(0,10)===value;
  }
  const rules=Object.freeze({round,days,months,severance,illnessRate,validDate,contributions,seniorityYears,nightPremium});
  if(typeof module==='object'&&module.exports)module.exports=rules;else root.VigilanteRules=rules;
})(typeof window==='object'?window:globalThis);
