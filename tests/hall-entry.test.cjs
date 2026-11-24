const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const app = fs.readFileSync(path.join(__dirname, '../web/app.js'), 'utf8');

function fixture(address) {
  const elements = new Map();
  function element(selector) {
    if (!elements.has(selector)) {
      const el = Object.assign(new EventTarget(), {
        dataset: {}, getContext: () => ({}), setAttribute() {}, contains(node) { return node === this; },
      });
      elements.set(selector, el);
    }
    return elements.get(selector);
  }
  const document = Object.assign(new EventTarget(), {
    documentElement: element('html'), querySelector: element, createElement: element,
    querySelectorAll: selector => selector === '[data-view]' ? [element('toolbar-meeting')] : [],
  });
  element('toolbar-meeting').dataset.view = 'meeting';
  const location = {href: address};
  const history = {entries: [], pushState(_, __, url) { this.entries.push(url.href); location.href = url.href; }};
  const window = new EventTarget();
  const context = vm.createContext({
    document, window, location, history, URL, fetch: () => new Promise(() => {}),
    setInterval() {}, requestAnimationFrame() {}, VillageMap: {ground: () => true},
    VillageClimate: {create: () => ({})}, VillageCamera: {create: () => ({reset() {}})},
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../web/resident-actions.js'),'utf8'),context);
  vm.runInContext(app, context);
  document.dispatchEvent(new Event('village-game-ready'));
  return {element, window, location, history, context};
}

test('the toolbar enters the hall, refresh restores the room, and browser back restores the village', () => {
  const start = 'http://127.0.0.1:8766/';
  const f = fixture(start);
  f.element('toolbar-meeting').dispatchEvent(new Event('click'));
  assert.equal(f.element('#village').dataset.scene, 'hall');
  assert.equal(f.element('#hall-tools').hidden, false);
  assert.equal(f.element('#game-window').hidden, true);
  assert.deepEqual(f.history.entries, [start + '?scene=hall']);
  const reload = fixture(f.location.href);
  assert.equal(reload.element('#village').dataset.scene, 'hall');
  assert.equal(reload.history.entries.length, 0);
  f.location.href = start;
  f.window.dispatchEvent(new Event('popstate'));
  assert.equal(f.element('#village').dataset.scene, 'village');
  assert.equal(f.element('#hall-tools').hidden, true);
});

test('an ordinary panel click cannot use the root scene attribute as a map button', () => {
  const f = fixture('http://127.0.0.1:8766/?scene=hall');
  const panel = f.element('#panel');
  panel.closest = selector => selector === '[data-scene]' ? f.element('html') : null;
  f.element('#game-window').hidden = false;
  panel.dispatchEvent(new Event('click'));
  assert.equal(f.element('#game-window').hidden, false);
  assert.equal(f.element('#village').dataset.scene, 'hall');
});

test('editing identity from the role line saves only the role for the intended resident',async()=>{
  const {context,element}=fixture('http://127.0.0.1:8766/');
  const r={id:'r1',name:'星河',role:'匠人',provider:'deepseek'};
  const form=element('#rename-form'), fields={};
  for(const key of ['name','role'])fields[key]={focus(){this.focused=true;},select(){}};
  Object.assign(form,{elements:fields,hidden:true,querySelector:element});
  element('#resident-form').elements={role:{options:[{value:'匠人'},{value:'学者'}]}};
  const calls=[];
  Object.assign(context,{r,save:async(path,data)=>{calls.push({path,data});return {ok:true,role:data.role};}});
  vm.runInContext("state={residents:[r],resident_interactions:true};selected=r.id;request=save;toast=()=>{};VillageInteractions.bindIdentity(r)",context);
  assert.match(vm.runInContext("VillageInteractions.identityEditor(r)",context),/datalist/);
  element('#edit-role').onclick();
  assert.equal(fields.role.focused,true);assert.equal(fields.name.value,'星河');
  fields.role.value=' 钟表师 ';
  await form.onsubmit({preventDefault(){}});
  assert.equal(calls.length,1);
  assert.equal(calls[0].path,'residents/update');
  assert.deepEqual({...calls[0].data},{id:'r1',role:'钟表师',previous_role:'匠人'});
  assert.equal(r.role,'钟表师');assert.equal(r.provider,'deepseek');
});

test('clicking a resident opens three actions and keeps the target ID when entering chat', () => {
  const {context,element,window}=fixture('http://127.0.0.1:8766/');
  const menu=element('#resident-actions'), canvas=element('#village');
  Object.assign(menu,{style:{},offsetWidth:160,offsetHeight:50,querySelector:()=>null});
  Object.assign(window,{innerWidth:960,innerHeight:640});
  canvas.getBoundingClientRect=()=>({left:0,top:0,right:960,bottom:640});
  context.VillageUI={icon:()=>'',paintAll(){}};
  vm.runInContext("state={residents:[{id:'r1',name:'星河'}]};positions.set('r1',{x:4,y:4});",context);
  canvas.dispatchEvent(Object.assign(new Event('click'),{clientX:144,clientY:144}));
  assert.equal(menu.hidden,false);
  for(const label of ['设置','对话','换装'])assert.ok(menu.innerHTML.includes(label));
  vm.runInContext('navigate=(next,id)=>{globalThis.opened={next,id}}',context);
  menu.closest=()=>({dataset:{action:'residentChat'}});
  menu.dispatchEvent(new Event('click'));
  assert.equal(context.opened.id,'r1');
  assert.equal(context.opened.next,'residentChat');
});

test('chat transfers only the unsent draft and still sends to the selected resident', async () => {
  const {context,element}=fixture('http://127.0.0.1:8766/');
  const root=element('.resident-chat'), status=element('status'), thread=element('thread');
  const fields={textarea:element('message'),button:element('send')};
  const form=Object.assign(element('composer'),{querySelector:key=>fields[key]});
  const parts={'.chat-thread':thread,form,'[role=status]':status,'.chat-config':element('configure'),
    '.chat-earlier':element('earlier'),'.chat-newer':element('newer'),'.chat-order':element('order')};
  Object.assign(root,{isConnected:true,querySelector:key=>parts[key]});
  Object.assign(thread,{scrollHeight:100,scrollTop:0,clientHeight:50});
  const resident={id:'r1',name:'星河',appearance:'doubao',connected:true};
  const calls=[],orders=[],turns=[{id:'one',text:'你好',reply:'<星河>',status:'complete'}];
  Object.assign(context,{resident,VillageAvatars:{paintChoices(){}},crypto:{getRandomValues:bytes=>bytes.fill(33)},
    VillageHarness:{openOrderFromChat:(workerId,goal)=>orders.push({workerId,goal})},
    fakeRequest:async(path,body)=>{
      calls.push({path,body});
      if(body){turns.push({id:body.request_id,text:body.text,status:'pending'});return {ok:true};}
      return {turns};
    }});
  vm.runInContext("state={residents:[resident],resident_interactions:true,harness:{}};view='residentChat';selected='r1';request=fakeRequest;VillageInteractions.bindChat(resident)",context);
  await new Promise(resolve=>setImmediate(resolve));
  assert.match(thread.innerHTML,/chat-row mine/);
  assert.match(thread.innerHTML,/chat-row theirs/);
  assert.match(thread.innerHTML,/&lt;星河&gt;/);
  fields.textarea.value='今天在忙什么？';fields.textarea.oninput();
  await root.sync();
  assert.equal(fields.textarea.value,'今天在忙什么？');
  const order=parts['.chat-order'];
  assert.equal(order.hidden,false);
  order.onclick();
  assert.deepEqual(orders,[{workerId:'r1',goal:'今天在忙什么？'}]);
  assert.equal(calls.some(c=>c.body),false);
  const sending=form.onsubmit({preventDefault(){}});
  assert.equal(order.disabled,true);
  order.onclick();
  assert.equal(orders.length,1);
  await sending;
  const send=calls.find(c=>c.body);
  assert.equal(send.path,'residents/chat');
  assert.equal(send.body.id,'r1');
  assert.equal(send.body.request_id,'21'.repeat(16));
  assert.equal(send.body.text,'今天在忙什么？');
  assert.match(thread.innerHTML,/正在回复/);
});

test('background editor keeps the selected resident and the in-progress draft on a state refresh', () => {
  const {context, element} = fixture('http://127.0.0.1:8766/');
  const resident = {id:'r1', name:'阿榆', background:'以前修钟。'};
  const field = Object.assign(new EventTarget(), {setCustomValidity(value){this.error=value;}});
  const form = Object.assign(new EventTarget(), {elements:{background:field},querySelector:element});
  Object.assign(context,{resident,form});
  vm.runInContext("selected='r1';view='residentBackground';state={residents:[resident]}",context);
  assert.match(vm.runInContext('renderResidentBackground()',context), /阿榆的人物背景/);
  vm.runInContext('bindBackgroundForm(form,resident)',context);
  assert.equal(field.value,'以前修钟。');
  element('#background-form').dataset.owner='r1';
  field.value='新草稿🌱';field.dispatchEvent(new Event('input'));
  assert.equal(element('output').textContent,'4 / 1200');
  vm.runInContext('renderPanel()',context);
  assert.equal(field.value,'新草稿🌱');
  field.value='字'.repeat(1201);field.dispatchEvent(new Event('input'));
  assert.ok(field.error);
});

test('resident API editor preserves an existing key only for the saved provider and address', () => {
  const {context} = fixture('http://127.0.0.1:8766/');
  const r = {id:'r1', name:'Test', provider:'custom', connected:true, api_profile:{
    model:'personal', base_url:'https://one.invalid/v1', has_key:true,
  }};
  const form = new EventTarget();
  form.elements = Object.fromEntries(['provider','source','base_url','model','api_key'].map(name=>[name,new EventTarget()]));
  const nodes = new Map();
  form.querySelector = selector => {
    if(!nodes.has(selector))nodes.set(selector,{});
    return nodes.get(selector);
  };
  Object.assign(context, {form, resident:r});
  form.elements.provider.value = 'custom';
  vm.runInContext(`selected=resident.id; state={residents:[resident],providers:[
    {id:'custom',name:'Custom',base_url:'',model:''},
    {id:'second',name:'Second',base_url:'https://two.invalid/v1',model:'shared'}
  ]}`, context);
  assert.match(vm.runInContext('renderResidentApi()',context), /启动游戏\.cmd/);
  vm.runInContext('state.resident_api_settings=true',context);
  assert.match(vm.runInContext('renderResidentApi()',context), /type="password"/);
  vm.runInContext('bindResidentApi(form,resident)',context);
  assert.equal(form.elements.model.value,'personal');
  assert.equal(form.elements.api_key.value,'');
  assert.equal(form.elements.api_key.required,false);
  form.elements.api_key.value='temporary-fixture';
  form.elements.provider.value='second';
  form.elements.provider.dispatchEvent(new Event('change'));
  assert.equal(form.elements.model.value,'shared');
  assert.equal(form.elements.api_key.value,'');
  assert.equal(form.elements.api_key.required,true);
  form.elements.source.value='default';
  form.elements.source.dispatchEvent(new Event('change'));
  assert.equal(form.querySelector('fieldset').disabled,true);
});
