/* Reglas 2026: BOE-A-2026-8569, arts. 45, 51 y 52; Estatuto, arts. 49, 53 y 56. */
(function(root){
  'use strict';
  const round=n=>Math.round((n+Number.EPSILON)*100)/100;
  const date=value=>new Date(value+'T00:00:00Z');
  const days=(start,end)=>Math.round((date(end)-date(start))/86400000)+1;
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
    if(day<=100 && noPrevious)return 0.8;
    return 0.75;
  }
  function illnessSegments(total,number,noPrevious,hospitalStart){
    const result=[];
    for(let day=1;day<=total;day++){
      const hospital=hospitalStart>0&&day>=hospitalStart&&day<hospitalStart+40;
      const rate=hospital?1:illnessRate(day,number,noPrevious);
      const previous=result[result.length-1];
      if(previous&&previous.rate===rate&&previous.hospital===hospital)previous.end=day;
      else result.push({start:day,end:day,rate,hospital});
    }
    return result;
  }
  const rules=Object.freeze({round,days,months,severance,illnessRate,illnessSegments});
  if(typeof module==='object'&&module.exports)module.exports=rules;else root.VigilanteRules=rules;
})(typeof window==='object'?window:globalThis);
