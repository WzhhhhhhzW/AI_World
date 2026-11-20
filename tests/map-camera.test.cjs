const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const sandbox=vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../web/map-camera.js'),'utf8'),sandbox);
const {create}=vm.runInContext('VillageCamera',sandbox);

function covered(c,w,h){
  const p=c.pose();
  assert.ok(p.x<=0&&p.y<=0,JSON.stringify(p));
  assert.ok(p.x+960*p.scale>=w&&p.y+640*p.scale>=h,JSON.stringify(p));
  assert.ok(p.zoom>=1-1e-9&&p.zoom<=2.5+1e-9);
}
function settle(c,w,h){for(let i=0;i<50;i++){c.step(50);covered(c,w,h);}}

test('a software-rendered zoom or reset lands on one bounded pose without extra frames',()=>{
  const c=create();c.resize(1024,768);
  const a=c.worldAt(320,270);
  c.zoomAt(1.25,320,270,true);
  const b=c.worldAt(320,270);
  assert.ok(Math.abs(a.x-b.x)<1e-8&&Math.abs(a.y-b.y)<1e-8);
  assert.equal(c.pose().zoom,1.25);
  assert.equal(c.moving(),false);
  c.zoomAt(1e6,0,0,true);covered(c,1024,768);
  assert.equal(c.pose().canZoomIn,false);
  c.reset(true);covered(c,1024,768);
  assert.equal(c.pose().zoom,1);
  assert.equal(c.moving(),false);
});

test('minimum zoom fills landscape, portrait and ultrawide screens without letterboxing',()=>{
  for(const [w,h] of [[1092,871],[1920,1080],[2560,1080],[390,844],[844,390]]){
    const c=create();c.resize(w,h);covered(c,w,h);
    c.zoomAt(.01);settle(c,w,h);assert.equal(c.pose().canZoomOut,false);
    for(const [x,y] of [[1e6,1e6],[-1e6,-1e6]]){c.panBy(x,y);covered(c,w,h);}
  }
});
test('zoom stays anchored to the pointed world location throughout the transition',()=>{
  const c=create();c.resize(1092,871);
  const a=c.worldAt(500,430);c.zoomAt(1.8,500,430);
  for(let i=0;i<40;i++){
    c.step(16);covered(c,1092,871);const b=c.worldAt(500,430);
    assert.ok(Math.abs(a.x-b.x)<1e-8&&Math.abs(a.y-b.y)<1e-8);
  }
});
test('extreme drags and a shrinking camera remain inside world bounds on every frame',()=>{
  const c=create();c.resize(1092,871);c.zoomAt(2.5);settle(c,1092,871);
  for(const [x,y] of [[1e6,1e6],[-1e6,1e6],[-1e6,-1e6],[1e6,-1e6]]){
    c.panBy(x,y);covered(c,1092,871);
    c.zoomAt(.8,1,1);settle(c,1092,871);
  }
  c.reset();settle(c,1092,871);assert.equal(c.pose().zoom,1);
  const p=c.pose();assert.ok(Math.abs(p.x+960*p.scale/2-546)<1e-8);
});
test('resize preserves zoom and covers the screen before the first new frame',()=>{
  const c=create();c.resize(1092,871);c.zoomAt(1.8);settle(c,1092,871);
  for(const [w,h] of [[390,844],[844,390],[2560,1080],[1092,871]]){
    c.resize(w,h);covered(c,w,h);assert.ok(Math.abs(c.pose().zoom-1.8)<1e-8);
    c.reset();c.zoomAt(1.8);settle(c,w,h);
  }
});
test('pinch translates and scales around the two-finger midpoint and obeys limits',()=>{
  const c=create();c.resize(1000,700);c.zoomAt(1.5);settle(c,1000,700);
  const a=c.worldAt(500,350);c.gesture({x:500,y:350},{x:530,y:360},1.2);
  const b=c.worldAt(530,360);assert.ok(Math.abs(a.x-b.x)<1e-8&&Math.abs(a.y-b.y)<1e-8);
  covered(c,1000,700);
  c.gesture({x:0,y:0},{x:5000,y:5000},100);covered(c,1000,700);
  assert.equal(c.pose().canZoomIn,false);
  c.gesture({x:0,y:0},{x:-5000,y:-5000},.001);covered(c,1000,700);
  assert.equal(c.pose().canZoomOut,false);
});
