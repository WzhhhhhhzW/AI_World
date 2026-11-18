const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const web = path.join(__dirname, '../web');
const run = (file, ctx) => vm.runInContext(fs.readFileSync(path.join(web, file), 'utf8'), ctx);
const layout = JSON.parse(fs.readFileSync(path.join(web, 'assets/maps/valley-layout-v1.json')));

test('each painted bed stays paired with one garden action and the warehouse uses crop prices', async () => {
  const catalog = {cabbage:{name:'白菜',seconds:120,tokens:500},radish:{name:'萝卜',seconds:300,tokens:1000}};
  const farm = {plots:layout.crop_positions.map(()=>({crop:null,ready_at:null,version:0})), catalog, inventory:{radish:1,cabbage:0,mixed:0},stock_version:1};
  const state = {clock:480,farm,residents:[{id:'r',name:'小满'}]};
  const ctx = vm.createContext({state,selected:0,Image:class {set src(url){this.onload();}},esc:String,number:String});
  run('farm-ui.js',ctx);
  const ui=vm.runInContext('VillageFarm',ctx);
  await ui.ready;
  assert.equal((ui.garden().match(/class="farm-bed /g)||[]).length,6);
  assert.match(ui.garden(),/data-farm-action="plant"/);
  Object.assign(farm.plots[0],{crop:'radish',ready_at:null,version:1});
  assert.match(ui.garden(),/data-farm-action="water"/);
  farm.plots[0].ready_at=1680;
  assert.match(ui.garden(),/5分00秒/);
  assert.doesNotMatch(ui.garden(),/data-farm-action="harvest"/);
  state.clock=1680;
  assert.match(ui.garden(),/data-farm-action="harvest"/);
  assert.match(ui.pantry(),/作物物品栏/);
  assert.match(ui.pantry(),/500/);
  for (const name of ['radish','cabbage']) assert.ok(fs.statSync(path.join(web,'assets/props',name+'.png')).size>100);
});

test('flags move from their fixed hoists and smoke shares the same paused clock and camera transform', async () => {
  const ctx=vm.createContext({Image:class{set src(url){this.file=url;this.onload();}},document:{documentElement:{dataset:{}}}});
  run('living-props.js',ctx);
  const props=vm.runInContext('VillageProps',ctx);
  await props.ready;
  const frame=(time,wind)=>{
    const draws=[];
    const c={save(){},restore(){},scale(x,y){assert.equal(x,.625);assert.equal(y,.625);},drawImage(img,...rect){draws.push(rect);}};
    props.rooftops(c,time,{wind,rain:.1});
    return draws;
  };
  const still=frame(800,.35), later=frame(1140,.35);
  assert.deepEqual(still,frame(800,.35));
  assert.notDeepEqual(still,later);
  for(const x of [630,821]){
    assert.equal(still.find(r=>r[4]===x)[5],180);
    assert.equal(later.find(r=>r[4]===x)[5],180);
  }
  assert.notDeepEqual(still.slice(-4),later.slice(-4));
  assert.notDeepEqual(still.slice(-4),frame(800,.95).slice(-4));
});
