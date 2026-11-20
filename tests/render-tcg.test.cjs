const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const app = fs.readFileSync(path.join(__dirname, '../web/app.js'), 'utf8');

function fixture(){
  const elements=new Map(), frames=new Map(), timers=new Map();
  let id=0;
  function element(selector){
    if(!elements.has(selector))elements.set(selector,Object.assign(new EventTarget(),{
      hidden:true,dataset:{},clientWidth:960,clientHeight:640,getContext:()=>({}),setAttribute(){}
    }));
    return elements.get(selector);
  }
  const document=Object.assign(new EventTarget(),{
    documentElement:{dataset:{renderProfile:'tcg'}},querySelector:element,
    createElement:element,querySelectorAll:()=>[]
  });
  const schedule=(jobs,fn)=>{jobs.set(++id,fn);return id;};
  const ctx=vm.createContext({
    document,window:new EventTarget(),fetch:()=>new Promise(()=>{}),setInterval(){},
    requestAnimationFrame:fn=>schedule(frames,fn),clearTimeout:key=>timers.delete(key),
    setTimeout:fn=>schedule(timers,fn),VillageMap:{ground:()=>true},
    VillageClimate:{create:()=>({advance:()=>({})})},
    VillageProps:{frameAt:()=>({angle:0})},VillageInteractions:{bindMenu(){},positionMenu(){}},
    VillageCamera:{create:()=>({resize(){},moving:()=>false,step:()=>({scale:1,x:0,y:0})})},
    painted:0,
  });
  vm.runInContext(app,ctx);
  vm.runInContext("paintFastVillage=()=>{painted++};paintWeather=()=>{};state={paused:false,clock:480};",ctx);
  function step(jobs,time=0){const [key,fn]=jobs.entries().next().value;jobs.delete(key);fn(time);}
  return {ctx,frames,timers,element,step,document};
}

test('TCG stops painting behind a panel and when paused, and coalesces redraw requests',()=>{
  const f=fixture();
  f.step(f.frames,250);
  assert.equal(f.ctx.painted,1);
  assert.equal(f.timers.size,1);
  f.element('#game-window').hidden=false;
  f.step(f.timers);f.step(f.frames,500);
  assert.equal(f.timers.size,0);
  assert.equal(f.ctx.painted,1);
  f.element('#game-window').hidden=true;
  vm.runInContext("state.paused=true; wakeMap(true); wakeMap(true);",f.ctx);
  assert.equal(f.frames.size,1);
  f.step(f.frames,700);
  assert.equal(f.ctx.painted,2);
  assert.equal(f.frames.size+f.timers.size,0);
  f.document.dispatchEvent(new Event('village-scene-ready'));
  f.step(f.frames,900);
  assert.equal(f.ctx.painted,3);
});

test('dirty areas restore both old and new positions without repainting the gap',()=>{
  const f=fixture();
  const result=vm.runInContext('dirtyAreas([[800,220,60,110],[-20,100,42,20]],[[40,350,60,110]])',f.ctx);
  assert.deepEqual(JSON.parse(JSON.stringify(result)),[[800,220,60,110],[0,100,22,20],[40,350,60,110]]);
});
