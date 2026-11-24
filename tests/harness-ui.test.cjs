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
  const doc = {activeElement:null, hasFocus:()=>true};
  const panel = {replaceChildren(root){this.firstElementChild = root;},contains:node=>node===panel.firstElementChild};
  const slot = {contains:()=>false, focus(){doc.activeElement=this;}};
  const posts = [], visits = [];
  const sowNotes = {};
  const sow = {elements:{mode:{value:'local'},worker_id:{value:''},skill_id:{value:'plain'},goal:{value:''}},
    querySelector(selector){return sowNotes[selector] ||= {};}};
  class FormFields {
    constructor(form) { this.values = form.values; }
    get(key) { return this.values[key] ?? ''; }
    getAll(key) { return this.values[key] || []; }
  }
  let reads = 0;
  function element() {
    return {dataset:{},isConnected:true,listeners:{},focus(){doc.activeElement=this;},addEventListener(type, handler){this.listeners[type]=handler;},
      setAttribute(){}, removeAttribute(){}, contains(){return true;}, querySelectorAll(){return [];},
      querySelector(selector){
        if (selector==='[data-sow-form]' && this.innerHTML?.includes('data-sow-form')) return sow;
        return selector==='[data-record-body]' ? slot : null;
      }};
  }
  doc.createElement=element;
  const context = vm.createContext({state,$:s=>s==='#panel'?panel:{},
    document:doc,esc:s=>String(s??'').replaceAll('<','&lt;').replaceAll('>','&gt;'),
    FormData:FormFields, navigate:(...args)=>visits.push(args),
    mutate:async(path, data)=>{posts.push({path,data});return {};},
    request:async()=>{reads++;return {...record};}});
  const ui = vm.runInContext(script + '\nVillageHarness',context);
  return {ui,record,skill,state,panel,slot,sow,posts,visits,doc,context,reads:()=>reads};
}

const settle = () => new Promise(resolve=>setImmediate(resolve));

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

test('adviser comparison preserves same-revision choices, caps the selection and submits only named IDs', async () => {
  const site = fixture({advisor_ids:['b','c'],reviewer_id:'c',hints:[
    {id:'b1',text:'查原件',reviewer_id:'b'},{id:'b2',text:'看日期',reviewer_id:'b'},
    {id:'c1',text:'列出处',reviewer_id:'c'},{id:'c2',text:'问作者',reviewer_id:'c'}],
    consultations:[{revision:1,reviewer_id:'b',question:'查证据',hints:[]},{revision:1,reviewer_id:'c',question:'补来源',hints:[]}]});
  const {ui,state,slot,panel,posts,record}=site;
  state.residents.push({id:'c',name:'村医',connected:true},{id:'d',name:'木匠',connected:true},{id:'e',name:'商人',connected:false});
  ui.show('taskRecord','t'); await settle();
  assert.match(slot.innerHTML, /<legend>顾问<\/legend>[\s\S]*?查原件[\s\S]*?<legend>村医<\/legend>[\s\S]*?列出处/);
  const options=slot.innerHTML.match(/<select name="reviewer_id"[\s\S]*?<\/select>/)[0];
  assert.match(options,/value="d"/); assert.doesNotMatch(options,/value="[abce]"/);
  assert.equal(posts.length,0);
  const root=panel.firstElementChild;
  const boxes=record.hints.map((h,i)=>({name:'hint_ids',value:h.id,checked:i!==1,disabled:false}));
  const count={};
  const form={dataset:{feedbackAction:'resume'},hasAttribute:()=>false,
    querySelectorAll:()=>boxes,querySelector:()=>count,values:{feedback:'查一遍',hint_ids:['b1','c1','c2']}};
  boxes.forEach(b=>{b.form=form;});
  root.listeners.change({target:boxes[0]});
  assert.equal(boxes[1].disabled,true); assert.equal(count.textContent,'已勾选 3/3 条');
  root.listeners.input({target:{name:'feedback',value:'查一遍'}});
  record.status='advising'; record.stage='advisor'; record.advisor_ids.push('d'); record.reviewer_id='d'; record.version++;
  ui.show('taskRecord','t'); await settle();
  assert.match(slot.innerHTML,/<legend>木匠<\/legend>[\s\S]*?正在独立审阅/);
  assert.match(slot.innerHTML,/value="b1" checked/);
  assert.match(slot.innerHTML,/value="b2" disabled/);
  assert.match(slot.innerHTML,/>查一遍<\/textarea>/);
  await root.listeners.submit({target:form,preventDefault(){}});
  assert.equal(posts.length,0);
  record.status='advised';record.version++;
  ui.show('taskRecord','t'); await settle();
  assert.match(slot.innerHTML,/本稿已邀请三位顾问/);
  assert.doesNotMatch(slot.innerHTML,/data-assist-form/);
  await root.listeners.submit({target:form,preventDefault(){}});
  assert.equal(posts.length,1);
  assert.deepEqual(JSON.parse(JSON.stringify(posts[0].data)),{id:'t',version:5,action:'resume',feedback:'查一遍',hint_ids:['b1','c1','c2']});
  record.status='blocked';record.revision=2;record.version++;record.advisor_ids=[];record.hints=[];
  ui.show('taskRecord','t');await settle();
  assert.doesNotMatch(slot.innerHTML,/>查一遍<\/textarea>|已勾选 3/);
});

test('failed advisers can be retried while earlier replies and harvest remain available; archives retain acceptance', async () => {
  const {ui,record,state,slot,reads}=fixture({stage:'advisor',status:'failed',advisor_ids:['b','c'],reviewer_id:'c',
    consultations:[{revision:1,reviewer_id:'b',question:'哪份凭据？',hints:[{id:'b1',text:'看原件'}], selected_ids:['b1']}],
    hints:[{id:'b1',text:'看原件',reviewer_id:'b'}],error:'连接中断'});
  state.residents.push({id:'c',name:'村医'},{id:'d',name:'木匠',connected:false});
  ui.show('taskRecord','t');await settle();
  assert.match(slot.innerHTML,/重试顾问 · 村医/);assert.match(slot.innerHTML,/data-task-action="harvest"/);
  assert.match(slot.innerHTML,/暂无可邀请的顾问/);
  state.residents.at(-1).connected=true;
  ui.show('taskRecord','t');assert.equal(reads(),1);assert.match(slot.innerHTML,/value="d"/);
  record.status='closed';record.version++;record.consultations.push({revision:0,question:'旧问题',hints:[{id:'old',text:'旧建议'}]});
  ui.show('taskRecord','t');await settle();
  assert.match(slot.innerHTML,/旧记录未记名/);
  assert.match(slot.innerHTML,/<strong>已回传<\/strong> · 看原件/);
  assert.match(slot.innerHTML,/<strong>未回传<\/strong> · 旧建议/);
  assert.doesNotMatch(slot.innerHTML,/data-feedback-action|data-assist-form/);
});

test('chat handoff retains only the supplied unsent text and waits for the garden and explicit submission', () => {
  const {ui,state,panel,sow,visits,posts}=fixture();
  state.buildings.find(b=>b.id==='farm').built=false;
  assert.equal(ui.openOrderFromChat('not-present','private'),false);
  assert.equal(ui.openOrderFromChat('b','<未发送的草稿>'),true);
  assert.deepEqual(visits,[['taskBoard']]);
  ui.show('taskBoard');assert.match(panel.firstElementChild.innerHTML,/菜园建成后可继续/);
  state.buildings.find(b=>b.id==='farm').built=true;
  ui.show('taskBoard');assert.match(panel.firstElementChild.innerHTML,/继续填写聊天草稿/);
  ui.show('sowTask');assert.match(panel.firstElementChild.innerHTML,/来自与顾问的聊天草稿/);
  assert.match(panel.firstElementChild.innerHTML,/&lt;未发送的草稿&gt;/);assert.doesNotMatch(panel.firstElementChild.innerHTML,/<未发送的草稿>/);
  assert.equal(sow.elements.mode.value,'local');
  assert.match(sow.elements.worker_id.innerHTML,/value="b" selected/);
  state.residents[1].connected=true;
  assert.equal(ui.openOrderFromChat('b','另一份草稿'),true);
  assert.deepEqual(visits.at(-1),['sowTask']);
  ui.show('sowTask');
  assert.equal(sow.elements.mode.value,'model');
  assert.match(sow.elements.worker_id.innerHTML,/value="b" selected/);
  assert.equal(posts.length,0);
});

test('record refresh preserves disclosure focus and leaves browser or page controls alone', async () => {
  const {ui,record,slot,doc}=fixture();
  ui.show('taskRecord','t'); await settle();
  function control(key) {
    return {dataset:{recordFocus:key},focus(){doc.activeElement=this;}};
  }
  let old=control('invite'), replacement=control('invite');
  slot.contains=el=>el===old;
  slot.querySelectorAll=()=>[replacement];
  Object.defineProperty(slot,'innerHTML',{set(){if(doc.activeElement===old) doc.activeElement=null;}});
  old.focus();
  record.version++; ui.show('taskRecord','t'); await settle();
  assert.equal(doc.activeElement,replacement);

  old=replacement; replacement=control('guidance');
  record.version++; ui.show('taskRecord','t'); await settle();
  assert.equal(doc.activeElement,slot);

  const hud=control('hud');
  hud.focus();
  record.version++; ui.show('taskRecord','t'); await settle();
  assert.equal(doc.activeElement,hud);
  old.focus(); doc.hasFocus=()=>false;
  record.version++; ui.show('taskRecord','t'); await settle();
  assert.equal(doc.activeElement,null);
});

test('a focused submission stays in the record through disable and replacement without stealing later focus', async () => {
  const {ui,panel,record,doc,slot,context}=fixture();
  ui.show('taskRecord','t'); await settle();
  const root=panel.firstElementChild;
  const button={isConnected:true,dataset:{recordFocus:'request-advice'},focus(){doc.activeElement=this;}};
  Object.defineProperty(button,'disabled',{set(value){if(value && doc.activeElement===this) doc.activeElement=null;}});
  const form={dataset:{},hasAttribute:k=>k==='data-assist-form',values:{question:'check',reviewer_id:'b'}};
  const event={target:form,preventDefault(){}};
  root.querySelectorAll=()=>[button];
  let done; context.mutate=()=>new Promise(resolve=>{done=resolve;});

  button.focus();
  const failed=root.listeners.submit(event);
  assert.equal(doc.activeElement,slot);
  done(null); await failed;
  assert.equal(doc.activeElement,button);

  const changed=root.listeners.submit(event);
  button.isConnected=false;
  record.version++; ui.show('taskRecord','t'); await settle();
  done({}); await changed;
  assert.equal(doc.activeElement,slot);

  button.isConnected=true; button.focus();
  const leaving=root.listeners.submit(event);
  const outside={}; doc.activeElement=outside;
  done(null); await leaving;
  assert.equal(doc.activeElement,outside);
});

test('routing replaces focus only when the old panel owned it', () => {
  const {ui,panel,doc}=fixture();
  const hud={}; doc.activeElement=hud;
  ui.show('taskBoard'); assert.equal(doc.activeElement,hud);
  const previous=panel.firstElementChild; previous.focus();
  ui.show('sowTask'); const next=panel.firstElementChild;
  assert.notEqual(next,previous); assert.equal(doc.activeElement,next); assert.equal(next.tabIndex,-1);
  doc.activeElement=hud;
  ui.show('sowTask'); assert.equal(doc.activeElement,hud);
});
