const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const sandbox=vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../web/river-weather.js'),'utf8'),sandbox);
const weather=vm.runInContext('VillageWeather',sandbox);

test('water classification excludes dry regions, stone and vegetation',()=>{
 assert.equal(weather.wetPixel(20,180,210,true),true);
 assert.equal(weather.wetPixel(20,180,210,false),false);
 assert.equal(weather.wetPixel(84,83,98,true),false);
 assert.equal(weather.wetPixel(73,167,67,true),false);
 assert.equal(weather.wetPixel(240,180,55,true),false);
});
test('petals are deterministic under a frozen visual clock and drift locally',()=>{
 for(const tree of weather.cherryTrees)for(let i=0;i<12;i++){
  assert.deepEqual(weather.petalState(tree,i,5000),weather.petalState(tree,i,5000));
  for(let t=0;t<60000;t+=700){const p=weather.petalState(tree,i,t);assert.ok(Number.isFinite(p.x)&&Number.isFinite(p.y));assert.ok(p.alpha>=0&&p.alpha<=1);assert.ok(Math.abs(p.x-tree.x)<tree.rx+75);assert.ok(p.y>=tree.y-tree.ry&&p.y<=tree.y+tree.ry+tree.fall);}
 }
 const a=weather.petalState(weather.cherryTrees[0],0,1000),b=weather.petalState(weather.cherryTrees[0],0,1200);assert.notEqual(a.y,b.y);
});
test('river particles follow the channel and wrap without invalid coordinates',()=>{
 const p=[[0,0],[0,10],[10,10]];
 assert.deepEqual(JSON.parse(JSON.stringify(weather.samplePath(p,.25))),{x:0,y:5,dx:0,dy:1});
 assert.deepEqual(JSON.parse(JSON.stringify(weather.samplePath(p,.75))),{x:5,y:10,dx:1,dy:0});
 assert.equal(weather.samplePath(p,1).x,0);
});
test('new UI regions and four-state rows remain within their source atlas',()=>{
 const a=JSON.parse(fs.readFileSync(path.join(__dirname,'../web/assets/ui-skin-v2.json'),'utf8'));
 assert.equal(Object.keys(a.sprites).length,31);
 for(const s of Object.values(a.sprites)){const [x,y,w,h]=s.rect;assert.ok(x>=0&&y>=0&&x+w<=a.size[0]&&y+h<=a.size[1]);const [top,right,bottom,left]=s.slice;assert.ok(top+bottom<h&&left+right<w);}
 for(const group of ['green','gold','paper','icon','close']){const n=a.sprites[group+'-normal'].rect.slice(2);for(const state of ['hover','pressed','disabled'])assert.deepEqual(a.sprites[group+'-'+state].rect.slice(2),n);}
});
