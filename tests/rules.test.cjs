const {test}=require('node:test'),assert=require('node:assert/strict');
const rules=require('../calculation-rules.js');
process.env.TZ='Europe/Madrid';
test('2026 illness boundaries: third process, day 90/91, and conditional extension',()=>{
 const expected=[[1,.5],[3,.5],[4,.8],[20,.8],[21,1],[40,1],[41,.9],[60,.9],[61,.8],[90,.8],[91,.75],[100,.75],[101,.75]];
 for(const [day,pct]of expected)assert.equal(rules.illnessRate(day,1,false),pct);
 assert.equal(rules.illnessRate(3,2,false),0);assert.equal(rules.illnessRate(20,3,false),.6);
 assert.equal(rules.illnessRate(21,3,false),1);assert.equal(rules.illnessRate(100,1,true),.8);assert.equal(rules.illnessRate(101,1,true),.75);
});
test('Inclusive service dates and distinct statutory severance rates with caps',()=>{
 assert.equal(rules.days('2026-01-01','2026-01-01'),1);
 assert.equal(rules.months('2026-01-01','2026-01-31'),1);
 assert.equal(rules.months('2026-01-01','2026-02-01'),2);
 assert.equal(rules.severance('2025-01-01','2025-12-31','temporal',36500),1200);
 assert.equal(rules.severance('2025-01-01','2025-12-31','objetivo',36500),2000);
 assert.equal(rules.severance('2025-01-01','2025-12-31','improcedente',36500),3300);
 assert.equal(rules.severance('1980-01-01','2026-12-31','objetivo',36500),36000);
 assert.equal(rules.severance('1980-01-01','2026-12-31','improcedente',36500),126000);
 assert.equal(rules.severance('2020-01-01','2026-12-31','voluntaria',36500),0);
});
