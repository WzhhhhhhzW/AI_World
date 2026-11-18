const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
class ImageFixture{set src(value){this.value=value;queueMicrotask(()=>this.onload());}}
const box=vm.createContext({Image:ImageFixture,Promise,Math});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../web/world-scenes.js'),'utf8'),box);
const scenes=vm.runInContext('VillageScenes',box);
test('meeting room exposes twelve distinct seats and loads both real background assets',async()=>{
  await scenes.ready;assert.equal(scenes.seats.length,12);assert.equal(Object.keys(scenes.images).length,2);
  assert.equal(new Set(scenes.seats.map(s=>s.join(','))).size,12);
  for(const [x,y] of scenes.seats){assert.ok(x>100&&x<860&&y>150&&y<550);assert.ok(x<360||x>600);}
  for(const name of ['council-hall-v1','eastwood-v1'])assert.ok(fs.statSync(path.join(__dirname,'../web/assets/maps/'+name+'.png')).size>100000);
});
test('resident selection hits only the appropriate seat and never the central table',()=>{
  const state={residents:scenes.seats.map((_,i)=>({id:String(i)}))};
  scenes.seats.forEach(([x,y],i)=>assert.equal(scenes.hitSeat({x,y:y-20},state).id,String(i)));
  assert.equal(scenes.hitSeat({x:480,y:320},state),null);
});
