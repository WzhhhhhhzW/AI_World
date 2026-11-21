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
    document,window:new EventTarget(),URL,location:{href:'http://localhost/?render=tcg'},fetch:()=>new Promise(()=>{}),setInterval(){},
    requestAnimationFrame:fn=>schedule(frames,fn),clearTimeout:key=>timers.delete(key),
    setTimeout:fn=>schedule(timers,fn),VillageMap:{ground:()=>true},
    VillageClimate:{create:()=>({advance:()=>({})})},
    VillageProps:{frameAt:()=>({angle:0})},VillageInteractions:{bindMenu(){},positionMenu(){},closeMenu(){}},
    VillageCamera:{create:()=>({resize(){},reset(){},moving:()=>false,step:()=>({scale:1,x:0,y:0})})},
    painted:0,
  });
  vm.runInContext(app,ctx);
  vm.runInContext("const actualVillagePaint=paintFastVillage;paintFastVillage=()=>{painted++};paintWeather=()=>{};state={paused:false,clock:480};",ctx);
  function step(jobs,time=0){const [key,fn]=jobs.entries().next().value;jobs.delete(key);fn(time);}
  return {ctx,frames,timers,element,step,document};
}

test('TCG stops painting behind a panel and when paused, and coalesces redraw requests',()=>{
  const f=fixture();
  f.step(f.frames,250);
  assert.equal(f.ctx.painted,1);
  assert.equal(f.timers.size,1);
  f.element('#game-window').hidden=false;
  f.step(f.timers);
  assert.equal(f.timers.size+f.frames.size,0);
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

test('the covered launch screen waits for the playable village before painting',()=>{
  const f=fixture();
  f.element('#launch-cover').isConnected=true;
  f.step(f.frames,100);
  assert.equal(f.ctx.painted,0);
  assert.equal(f.timers.size,0);
  f.document.documentElement.dataset.gameReady='true';
  f.document.dispatchEvent(new Event('village-game-ready'));
  f.step(f.frames,200);
  assert.equal(f.ctx.painted,1);
});

test('resident damage includes renamed plaques and live emotes, measuring each name once',()=>{
  const f=fixture();
  const actual=vm.runInContext(`(()=>{
    let measurements=0;
    ctx.measureText=name=>{measurements++;return {width:name.length*10};};
    state.ledger=[];
    const actor={id:'a',name:'甲',remaining:4},p={x:2,y:3};
    const plain=actorRect(actor,p);actorRect(actor,p);
    actor.name='村里的长名字居民';
    state.ledger=[{resident_id:'a',status:'reserved'}];
    const calling=actorRect(actor,p);
    return {plain,calling,measurements};
  })()`,f.ctx);
  assert.equal(actual.measurements,2);
  assert.ok(actual.calling[1]<actual.plain[1]);
  assert.ok(actual.calling[2]>actual.plain[2]);
});

test('the TCG raster cap preserves the viewport aspect and leaves small or full-quality canvases alone',()=>{
  const f=fixture();
  for(const [width,height,tcg,expected] of [
    [1280,629,true,{width:960,height:472}],
    [900,800,true,{width:720,height:640}],
    [390,600,true,{width:390,height:600}],
    [1280,629,false,{width:1280,height:629}]
  ]){
    const result=vm.runInContext(`backingViewport(${width},${height},${tcg})`,f.ctx);
    assert.deepEqual(JSON.parse(JSON.stringify(result)),expected);
  }
});

test('complete viewport repairs reuse the plate until art or lighting changes',()=>{
  const f=fixture();
  f.ctx.rebuilds=0;
  vm.runInContext(`
    const noop=()=>{};
    Object.assign(ctx,{save:noop,restore:noop,setTransform:noop,drawImage:noop});
    Object.assign(VillageMap,{version:'painted-valley-v1',lighting:noop,butterflies:()=>[],atmosphere:noop});
    Object.assign(climate,{ground:noop,screen:noop});
    Object.assign(VillageProps,{draw:noop,rooftops:noop});
    Object.assign(state,{residents:[],buildings:[]});
    scenePlate={getContext:()=>({drawImage(){rebuilds++;}})};
    const fixedSky={id:'sunny',cloud:.08,rain:0,fog:0};
    function repairViewport(){repaintAll=true;actualVillagePaint(1000,fixedSky,'viewport',1,1);}
    repairViewport();repairViewport();
  `,f.ctx);
  assert.equal(f.ctx.rebuilds,1);
  f.document.dispatchEvent(new Event('village-map-ready'));
  vm.runInContext('repairViewport()',f.ctx);
  assert.equal(f.ctx.rebuilds,2);
  vm.runInContext('state.clock+=30;repairViewport()',f.ctx);
  assert.equal(f.ctx.rebuilds,3);
});

test('speech bubbles preserve unchanged DOM and respond to an inline rename',()=>{
  const f=fixture();
  const layer=f.element('#hall-speech-layer');
  layer.hidden=false;
  layer.children=[];
  let markup='',writes=0;
  Object.defineProperty(layer,'innerHTML',{set(value){markup=value;writes++;}});
  vm.runInContext(`
    state.residents=[{id:'a',name:'甲'}];
    state.meetings=[{id:'m',status:'complete',messages:[{resident_id:'a',text:'发言'}]}];
    drawRoomBubbles();
    state.meetings=[{...state.meetings[0]}];
    drawRoomBubbles();
  `,f.ctx);
  assert.equal(writes,1);
  assert.match(markup,/甲.*发言/);
  vm.runInContext("state.residents[0].name='乙';drawRoomBubbles()",f.ctx);
  assert.equal(writes,2);
  assert.match(markup,/乙.*发言/);
  vm.runInContext("state.meetings=[{...state.meetings[0],messages:[{resident_id:'a',text:'新发言'}]}];drawRoomBubbles()",f.ctx);
  assert.equal(writes,3);
  assert.match(markup,/乙.*新发言/);
});
