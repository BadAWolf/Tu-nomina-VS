/* Reglas 2026: BOE-A-2026-8569, arts. 45, 51 y 52; Estatuto, arts. 49, 53 y 56. */
(function(root){
  'use strict';
  const round=n=>{const cents=Math.abs(n)*100;return Math.sign(n)*Math.round(cents+Number.EPSILON*Math.max(1,cents))/100;};
  const date=value=>new Date(value+'T00:00:00Z');
  const days=(start,end)=>Math.round((date(end)-date(start))/86400000)+1;
  // Cada cuota se redondea por separado. CC no incluye las horas extra;
  // CP sí, y las horas extra llevan una cotización adicional sin MEI.
  function contributions(cc,cp,extra=0,temporary=false,force=0){
    if([cc,cp,extra,force].some(n=>!Number.isFinite(n)||n<0))throw new RangeError('Revisa las bases de cotización.');
    const parts={common:round(cc*.047),mei:round(cc*.0015),unemployment:round(cp*(temporary?.016:.0155)),training:round(cp*.001),overtime:round(extra*.047),force:round(force*.02)};
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
  function validDate(value){
    return typeof value==='string'&&/^(?:19|20|21)\d{2}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(+date(value))&&date(value).toISOString().slice(0,10)===value;
  }
  function illnessPeriod(start,end){
    if(!validDate(start)||!validDate(end)||end<start)throw new RangeError('Selecciona fechas válidas: el fin no puede ser anterior al inicio.');
    const total=days(start,end);
    if(total>545)throw new RangeError('Esta calculadora admite hasta 545 días de IT. Las prolongaciones posteriores requieren otro cálculo.');
    return total;
  }
  // All dates are UTC calendar days; payroll tranches never reset at a month boundary.
  // Cotización mensual: art. 6 Orden PJC/297/2026. The remaining days of each
  // calendar month are assumed to be ordinary employment, with no other incidents.
  function illnessReport(o){
    const total=o.start?illnessPeriod(o.start,o.end):o.total;
    const prior=o.prior||0;
    if(!Number.isInteger(total)||total<1||!Number.isInteger(prior)||prior<0||total+prior>545)throw new RangeError('Revisa los días: el proceso acumulado debe estar entre 1 y 545 días.');
    for(const value of [o.base,o.cotCC,o.cotCP,o.tableDaily])if(!Number.isFinite(value)||value<0)throw new RangeError('Revisa las bases de cálculo.');
    if(o.base<=0||!Number.isFinite(o.irpf)||o.irpf<0||o.irpf>47)throw new RangeError('Revisa la base reguladora y el IRPF.');
    const segments=[],monthly=[];
    for(let i=1;i<=total;i++){
      const day=i+prior,dt=o.start?new Date(+date(o.start)+(i-1)*86400000):null;
      const iso=dt?dt.toISOString().slice(0,10):null,key=iso?iso.slice(0,7):'total';
      let month=monthly.at(-1);
      if(!month||month.key!==key){month={key,start:iso,end:iso,days:0,paidDays:0,pieces:new Map(),gross:0};monthly.push(month);}
      month.days++;month.end=iso;
      const excluded=o.laboral&&day===1;
      const hospital=!o.laboral&&o.hospitalStart>0&&i>=o.hospitalStart&&i<o.hospitalStart+40;
      const rate=o.laboral?1:hospital?1:illnessRate(day,o.number,o.noPrevious);
      const legalRate=day<=3?0:day<=20?.6:.75;
      const hasComplement=hospital||(day<=3?o.number===1:day<=20?o.number<=2:day<=90||day<=100&&o.number===1&&o.noPrevious);
      const daily=excluded?0:o.laboral?Math.max(o.base*.75,o.professional?0:o.tableDaily):Math.max(o.base*legalRate,hasComplement?o.cotCC*rate:0);
      let segment=segments.at(-1);
      if(!segment||segment.rate!==rate||segment.hospital!==hospital||segment.excluded!==excluded){segment={start:day,end:day,rate,hospital,excluded,amount:0};segments.push(segment);}
      segment.end=day;
      const idx=segments.length-1;
      month.pieces.set(idx,(month.pieces.get(idx)||0)+daily);
      month.gross+=daily;if(!excluded)month.paidDays++;
    }
    monthly.forEach(month=>{
      month.gross=round(month.gross);
      // Allocate rounded monthly cents to tranches, so both views reconcile exactly.
      const parts=Array.from(month.pieces,([idx,amount])=>({idx,cents:Math.floor(amount*100+1e-8),fraction:amount*100-Math.floor(amount*100+1e-8)}));
      let remaining=Math.round(month.gross*100)-parts.reduce((n,p)=>n+p.cents,0);
      parts.sort((a,b)=>b.fraction-a.fraction||a.idx-b.idx);
      for(let i=0;i<remaining;i++)parts[i%parts.length].cents++;
      parts.forEach(p=>{segments[p.idx].amount=round(segments[p.idx].amount+p.cents/100);});
      let cotDays=month.paidDays;
      if(o.monthlyContribution&&o.start&&cotDays){
        const last=new Date(Date.UTC(Number(month.key.slice(0,4)),Number(month.key.slice(5,7)),0)).getUTCDate();
        cotDays=Math.max(0,30-(last-cotDays));
      }
      month.cotDays=cotDays;
      const cc=round(o.cotCC*cotDays),cp=round(o.cotCP*cotDays);
      month.ss=contributions(cc,cp,round((o.extraDaily||0)*cotDays),o.temporary,round((o.forceDaily||0)*cotDays)).total;
      month.irpf=round(month.gross*o.irpf/100);
      month.net=round(month.gross-month.ss-month.irpf);
      delete month.pieces;
    });
    const sum=key=>round(monthly.reduce((n,m)=>n+m[key],0));
    return {days:total,prior,segments,monthly,gross:sum('gross'),ss:sum('ss'),irpf:sum('irpf'),net:sum('net')};
  }
  const rules=Object.freeze({round,days,months,severance,illnessRate,illnessSegments,validDate,illnessPeriod,illnessReport,contributions,seniorityYears,nightPremium});
  if(typeof module==='object'&&module.exports)module.exports=rules;else root.VigilanteRules=rules;
})(typeof window==='object'?window:globalThis);
