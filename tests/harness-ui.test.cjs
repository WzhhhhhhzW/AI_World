const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const script = fs.readFileSync(path.join(__dirname, '../web/harness-ui.js'), 'utf8');

function fixture(task = {}) {
  const skill = {id:'plain', name:'<核对>', description:'材料\n"引号" #说明', instructions:'检查来源', tools:[]};
  const state = {residents:[{id:'a',name:'主理人'},{id:'b',name:'顾问'}],
    buildings:[{id:'workshop',built:true},{id:'farm',built:true}],
    harness:{skills:[skill], tasks:[], revision:1}};
  const record = {id:'t',skill_id:'plain',title:'<草稿>',goal:'检查证据',worker_id:'a',reviewer_id:'b',mode:'model',
    status:'advised',revision:1,version:3,history:[{revision:1,status:'ready'}],events:[],
    consultations:[],hints:[{id:'h1',text:'<检查来源>'},{id:'h2',text:'检查日期'}],...task};
  state.harness.tasks.push(record);
  const panel = {replaceChildren(root){this.firstElementChild = root;}};
  const slot = {};
  let reads = 0;
  function element() {
    return {dataset:{},isConnected:true,addEventListener(){},querySelectorAll(){return [];},
      querySelector(selector){return selector==='[data-record-body]' ? slot : null;}};
  }
  const context = vm.createContext({state,$:s=>s==='#panel'?panel:{},
    document:{createElement:element},esc:s=>String(s??'').replaceAll('<','&lt;').replaceAll('>','&gt;'),
    request:async()=>{reads++;return {...record};}});
  const ui = vm.runInContext(script + '\nVillageHarness',context);
  return {ui,record,skill,state,panel,slot,reads:()=>reads};
}

test('an optional consultation leaves the original harvestable and no hints preselected', async () => {
  const {ui,record,panel,slot,reads} = fixture();
  ui.show('taskRecord', 't');
  await new Promise(resolve=>setImmediate(resolve));
  assert.match(slot.innerHTML, /data-task-action="harvest"/);
  assert.equal((slot.innerHTML.match(/name="hint_ids"/g)||[]).length,2);
  assert.doesNotMatch(slot.innerHTML, /name="hint_ids"[^>]*checked|<检查来源>|<草稿>/);
  assert.match(slot.innerHTML,/&lt;检查来源&gt;/);
  const root = panel.firstElementChild;
  ui.show('taskRecord','t');
  assert.equal(panel.firstElementChild,root);
  assert.equal(reads(),1);
  record.status = 'closed';
  record.version++;
  ui.show('taskRecord','t');
  await new Promise(resolve=>setImmediate(resolve));
  assert.match(slot.innerHTML,/下载封存记录/);
  assert.doesNotMatch(slot.innerHTML,/data-task-action="harvest"|锻造成技艺/);
});

test('archive filters active tasks and text-only skills export valid quoted metadata', () => {
  const {ui,skill,state,panel} = fixture({status:'harvested'});
  state.harness.tasks.push({id:'active',title:'仍在思考',status:'working',mode:'model',revision:1,worker_id:'a'});
  ui.show('workArchive');
  assert.match(panel.firstElementChild.innerHTML,/data-task-record="t"/);
  assert.doesNotMatch(panel.firstElementChild.innerHTML,/仍在思考/);
  const lines = ui.skillMarkdown(skill).split('\n');
  assert.equal(lines[1],'name: skill-plain');
  assert.equal(JSON.parse(lines[2].slice('description: '.length)),skill.description);
  assert.match(lines.join('\n'),/无需村务数据/);
});
