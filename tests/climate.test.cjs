const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const box=vm.createContext({});
for(const f of ['climate.js','living-props.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../web/'+f),'utf8'),box);
const climate=vm.runInContext('VillageClimate',box),props=vm.runInContext('VillageProps',box);

test('village forecast is reproducible, uses all four types and stays in bounds',()=>{
  const seen=new Set();
  for(let t=0;t<1440*14;t+=7){
    const a=climate.sample(t);assert.deepEqual(a,climate.sample(t));seen.add(a.id);
    for(const k of ['rain','cloud','fog','wind'])assert.ok(a[k]>=0&&a[k]<=1);
    assert.ok(a.nextIn>0&&a.nextIn<=240);
  }
  assert.equal(seen.size,4);
  assert.equal(climate.sample(-20).id,climate.sample(0).id);
  assert.equal(climate.sample(200,'unknown').mode,'auto');
});
test('automatic weather intensity is continuous across day and slot boundaries',()=>{
  for(let t=240;t<=1440*8;t+=240){
    const a=climate.sample(t-.00001),b=climate.sample(t);
    for(const k of ['rain','cloud','fog','wind'])assert.ok(Math.abs(a[k]-b[k])<.00001);
  }
});
test('manual selection persists locally and returns to the current automatic forecast',()=>{
  const saved=new Map(),store={getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v)};
  const c=climate.create(store);assert.equal(c.mode,'auto');assert.equal(c.setMode('rain'),true);
  assert.equal(climate.create(store).mode,'rain');assert.equal(c.advance(100,100).id,'rain');
  assert.equal(c.setMode('no-such-weather'),false);assert.equal(c.mode,'rain');
  c.setMode('auto');assert.equal(c.advance(900,200).id,climate.sample(900).id);
  assert.doesNotThrow(()=>climate.create({getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}}).setMode('mist'));
});
test('particle and weather transition clocks freeze during pause and resume together',()=>{
  const c=climate.create();c.setMode('sunny');c.advance(480,0);c.setMode('rain');
  const a=c.advance(480,400);assert.ok(a.rain>0&&a.rain<.82);
  assert.deepEqual(c.advance(480,400),a);
  assert.deepEqual(climate.drop(4,400,a.wind),climate.drop(4,400,a.wind));
  assert.deepEqual(props.frameAt(400),props.frameAt(400));
  const b=c.advance(480,500);assert.ok(b.rain>a.rain);
  assert.notEqual(climate.drop(4,500,b.wind).y,climate.drop(4,400,a.wind).y);
  assert.notEqual(props.frameAt(500).angle,props.frameAt(400).angle);
});
test('rain particles remain in a finite world envelope and wheel completes one cycle',()=>{
  for(let i=0;i<190;i++)for(let t=0;t<20000;t+=317){
    const p=climate.drop(i,t,.95);assert.ok(Number.isFinite(p.x)&&Number.isFinite(p.y));
    assert.ok(p.x>=-70&&p.x<=1060&&p.y>=-55&&p.y<=695);assert.ok(p.alpha>0&&p.alpha<1);
  }
  assert.equal(props.frameAt(18000).angle,props.frameAt(0).angle);
  assert.ok(Math.abs(props.frameAt(9000).angle-Math.PI)<1e-8);
});
