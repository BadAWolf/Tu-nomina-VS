/* Motor de cálculo sin DOM: nómina, finiquito y baja con las tablas de 2026. */
const {test}=require('node:test'),assert=require('node:assert/strict');
process.env.TZ='Europe/Madrid';
const c=require('../calculator-engine.js');

const nominaBase={categoria:'sin_arma',conductor:false,jornada:'completa',horasContrato:0,contrato:'indefinido',
  responsable:false,plusServicio:0,anios:0,horas:162,horasNoche:0,horasFestivo:0,diasVac:0,mediaPlusVac:0,
  nochesEspeciales:0,pagas:0,irpf:0};
const nomina=o=>c.calcularNomina({...nominaBase,...o});

test('Full month at 162 h: table salary, contributions on the three extra payments, and IRPF',()=>{
  const r=nomina({irpf:10});
  assert.equal(r.bruto,1435.45);
  assert.equal(r.baseCotizacion,1731.79,'The base includes the share of the three extra payments');
  assert.equal(r.ss,112.56);assert.equal(r.irpf,143.55);assert.equal(r.neto,1179.34);
});

test('Overtime above 162 h is paid at the convenio hour and contributes as overtime',()=>{
  const r=nomina({horas:170,horasNoche:60,horasFestivo:40,irpf:10});
  assert.equal(r.valorHora,9.98);assert.equal(r.horasExtra,8);assert.equal(r.extra,79.84);
  assert.equal(r.noche,75.6);assert.equal(r.fest,40.8);
  assert.equal(r.bruto,1631.69);assert.equal(r.ss,125.19);assert.equal(r.neto,1343.33);
  assert.equal(r.cuotas.overtime,3.75);
});

test('Part-time: extra hours become complementary hours, never an error asking for more data',()=>{
  const r=nomina({jornada:'parcial',horasContrato:80,horas:96,horasFestivo:16,irpf:2});
  assert.equal(r.base,573.47);assert.equal(r.horasExtra,16);assert.equal(r.extra,159.68);
  assert.equal(r.cuotas.overtime,0,'Complementary hours contribute as ordinary hours');
  assert.equal(r.bruto,884.86);assert.equal(r.neto,800.13);
});

test('Working fewer hours than the contract pays in proportion (loose days)',()=>{
  const r=nomina({jornada:'parcial',horasContrato:80,horas:24});
  assert.equal(r.factor,24/80);assert.equal(r.base,172.04);assert.equal(r.horasExtra,0);
  const full=nomina({horas:81});
  assert.equal(full.base,580.64);
});

test('Holidays count as worked hours and their usual allowances are spread over 31 days',()=>{
  const r=nomina({horas:110,diasVac:10,mediaPlusVac:310});
  assert.equal(r.hVac,52.26);assert.equal(r.factor,1);assert.equal(r.vacPlus,100);
  const part=nomina({jornada:'parcial',horasContrato:80,horas:0,diasVac:1});
  assert.equal(part.hVac,2.58);
});

test('Team leader: 10% of the base salary, also added to the hourly value of overtime',()=>{
  const r=nomina({horas:200,responsable:true});
  assert.equal(r.responsable,116.13);assert.equal(r.valorHora,10.76);assert.equal(r.extra,408.88);
});

test('Temporary contracts pay 0.05% more unemployment contribution',()=>{
  assert.equal(nomina({contrato:'temporal'}).ss,113.43);
  assert.equal(nomina({}).ss,112.56);
});

test('Category tables: escort allowance, funds driver, prorated July payment and no weekend allowance in transport',()=>{
  assert.equal(nomina({categoria:'escolta'}).escolta,312.99);
  const driver=nomina({categoria:'fondos',conductor:true,anios:5,horasNoche:10});
  assert.equal(driver.noche,13.6);assert.equal(driver.antig,50.23);assert.equal(driver.bruto,1991.84);
  assert.equal(nomina({categoria:'fondos',pagas:1}).prorrata,134.82);
  assert.equal(nomina({categoria:'fondos',horasFestivo:20}).fest,0);
});

const finiquitoBase={categoria:'sin_arma',conductor:false,jornada:'completa',horasContrato:0,responsable:false,
  inicio:'2024-03-01',fin:'2026-10-05',diasVac:10,prorrateadas:{julio:false,navidad:false,marzo:false},irpf:12};
const finiquito=o=>c.calcularFiniquito({...finiquitoBase,...o});

test('Settlement: pending holidays and the pending share of each extra payment',()=>{
  const r=finiquito({motivo:'voluntaria'});
  assert.equal(r.vacaciones,478.48);assert.equal(r.julio,315.01);assert.equal(r.navidad,902.82);assert.equal(r.marzo,902.82);
  assert.equal(r.liqBruta,2599.13);
  assert.equal(r.ssVac,31.11,'Only unused holidays contribute again: extra payments already did');
  assert.equal(r.indem,0);assert.equal(r.total,2256.12);
  const prorated=finiquito({motivo:'voluntaria',prorrateadas:{julio:true,navidad:true,marzo:true}});
  assert.equal(prorated.liqBruta,478.48);
});

test('Severance by reason: temporary 12 days (taxed), objective 20 and unfair 33 (exempt)',()=>{
  const temporal=finiquito({motivo:'temporal'});
  assert.equal(temporal.indem,1519.86);assert.equal(temporal.irpfIndem,182.38);assert.equal(temporal.ssVac,31.35);
  assert.equal(finiquito({motivo:'objetivo'}).indem,2598.05);
  const unfair=finiquito({motivo:'improcedente'});assert.equal(unfair.indem,4286.78);assert.equal(unfair.irpfIndem,0);
  assert.equal(finiquito({motivo:'sustitucion'}).indem,0);
  assert.equal(unfair.salarioAnual,17780.4);
});

test('A Christmas payment already received is not counted again',()=>{
  const r=finiquito({inicio:'2026-01-01',fin:'2026-12-31',motivo:'voluntaria'});
  assert.equal(r.navidad,0);
});

const bajaBase={categoria:'sin_arma',conductor:false,baseMensual:0,anios:0,tipo:'comun',nbaja:1,dias:45,irpf:10};
const baja=o=>c.calcularBaja({...bajaBase,...o});

test('Sick leave without a known base uses the convenio minimum and the article 51 tranches',()=>{
  const r=baja({});
  assert.equal(r.estimada,true);assert.equal(r.baseMensual,1731.79);assert.equal(r.baseDiaria,57.73);
  assert.deepEqual(r.tramos.map(t=>[t.desde,t.hasta,t.pct,t.importe]),[[1,3,.5,86.6],[4,20,.8,785.13],[21,40,1,1154.6],[41,45,.9,259.79]]);
  assert.equal(r.bruto,2286.12);
});

test('Third sick leave of the year: no pay the first three days and 60% until day 20',()=>{
  const r=baja({nbaja:3,baseMensual:1600});
  assert.deepEqual(r.tramos.map(t=>[t.desde,t.hasta,t.pct]),[[1,3,0],[4,20,.6],[21,40,1],[41,45,.9]]);
});

test('Work accident: the first day is paid as worked, then 100% of the table salary',()=>{
  const r=baja({tipo:'laboral'});
  assert.equal(r.tramos[0].nota,'nomina');assert.equal(r.tramos[0].importe,0);
  assert.equal(r.tramos[1].desde,2);assert.equal(r.tramos[1].importe,2105.4);
});

test('Hospitalisation pays 100% for 40 days and then follows the ordinary tranches',()=>{
  const r=baja({tipo:'hospitalizacion',dias:65});
  assert.deepEqual(r.tramos.map(t=>[t.desde,t.hasta,t.pct]),[[1,40,1],[41,60,.9],[61,65,.8]]);
});
