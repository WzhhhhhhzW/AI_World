import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { TextDecoder } from 'node:util';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';

const args = process.argv.slice(2);
if (args.includes('--help') || args.length > 2) {
  console.log('node browser-smoke.mjs [AI_World repository] [output directory]\n' +
    'Defaults to the current directory and the system temporary directory.\n' +
    'Set HARNESS_BROWSER_PATH or HARNESS_PYTHON_PATH to override executable discovery.');
  process.exit(args.includes('--help') ? 0 : 2);
}
if (typeof WebSocket !== 'function') throw Error('Node.js 22 or later is required.');
const repo = resolve(args[0] || process.cwd());
for (const file of ['server.py','village_harness.py','web/harness-ui.js']) {
  if (!existsSync(join(repo,file))) throw Error('AI_World repository is missing ' + file);
}
const python = process.env.HARNESS_PYTHON_PATH || 'python';
const candidates = [];
for (const root of [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA].filter(Boolean)) {
  candidates.push(join(root, 'Google/Chrome/Application/chrome.exe'), join(root, 'Microsoft/Edge/Application/msedge.exe'));
}
const chromePath = process.env.HARNESS_BROWSER_PATH || candidates.find(existsSync);
if (!chromePath || !existsSync(chromePath)) throw Error('Set HARNESS_BROWSER_PATH to an installed Chromium executable.');
const output = join(resolve(args[1] || join(tmpdir(), 'ai-world-browser-smoke')), new Date().toISOString().replace(/[:.]/g, '-'));
mkdirSync(output, { recursive: true });
const temp = mkdtempSync(join(output, 'fixture-'));
const worldFile = join(temp, 'village.json');
const profile = join(temp, 'chrome-profile');
const downloads = join(output, 'downloads');
mkdirSync(downloads);
mkdirSync(join(profile,'Default'),{recursive:true});
writeFileSync(join(profile,'Default','Preferences'),JSON.stringify({download:{
  default_directory:downloads, directory_upgrade:true, prompt_for_download:false
}}));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const goal = '请从原始库存和建筑快照盘点村务，并标明核对依据。';
const title = '浏览器实测 · 两位独立顾问';
const commit = spawnSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { windowsHide:true, encoding:'utf8' });
const evidence = { result: 'running', checkout_head:commit.status===0 ? commit.stdout.trim() : null, phases: [], posts: [] };
evidence.harness_ui_sha256=sha(readFileSync(join(repo,'web/harness-ui.js')));
evidence.harness_backend_sha256=sha(readFileSync(join(repo,'village_harness.py')));
evidence.download_events=[];
let browser, server, ws, cdp, last;

async function until(label, probe, ms = 15000) {
  const stop = Date.now() + ms;
  let error;
  while (Date.now() < stop) {
    try { const val = await probe(); if (val) return val; } catch (e) { error = e; }
    await sleep(120);
  }
  throw Error('等待超时 ' + label + (error ? ' ' + error.message : ''));
}

function launch(exe, args, options = {}) {
  const child = spawn(exe, args, { windowsHide: true, stdio: ['ignore','pipe','pipe'], ...options });
  child.done = new Promise((res, rej) => { child.once('error', rej); child.once('exit', (code,signal) => res({code,signal})); });
  return child;
}

async function smoke() {
  const fixtureCode = [
    'import sys', 'from pathlib import Path', 'sys.path.insert(0,sys.argv[1])',
    'from village import Village,Provider', 'w=Village(Path(sys.argv[2]),Provider([]))',
    'next(b for b in w.s["buildings"] if b["id"]=="farm")["built"]=True',
    'next(b for b in w.s["buildings"] if b["id"]=="workshop")["built"]=True',
    'w.s["paused"]=True', 'w.save()', 'w.close()',
  ].join('\n');
  const created = spawnSync(python, ['-B','-c',fixtureCode,repo,worldFile], { encoding:'utf8', windowsHide:true });
  assert.equal(created.status, 0, created.stderr);
  writeFileSync(join(temp,'providers.json'),'[]');
  server = launch(python,['-B','-u',join(repo,'server.py'),'--port','0','--data',worldFile,
                            '--providers',join(temp,'providers.json'),'--allow-shutdown','--duration','180']);
  let log = '';
  server.stdout.on('data', d => { log += d; });
  server.stderr.on('data', () => {});
  const origin = await until('fixture startup', () => /VILLAGE_READY (http:\/\/127\.0\.0\.1:\d+)/.exec(log)?.[1]);
  const get = async path => { const res = await fetch(origin + path); assert.equal(res.status,200); return res.json(); };
  const initial = await get('/api/state');
  assert.equal(initial.autonomy,false);
  assert.equal(initial.ledger.length,0);
  assert.equal(initial.providers.length,0);
  const worker = initial.residents[0];
  browser = launch(chromePath,['--headless=new','--no-first-run','--disable-background-networking',
    '--disable-component-update','--disable-sync','--disable-extensions','--disable-default-apps',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1','--window-size=1440,1024',
    '--remote-debugging-address=127.0.0.1','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank']);
  browser.stdout.resume(); browser.stderr.resume();
  const port = await until('Chrome port', () => existsSync(join(profile,'DevToolsActivePort')) && readFileSync(join(profile,'DevToolsActivePort'),'utf8').split(/\r?\n/)[0]);
  const dev = 'http://127.0.0.1:' + port;
  evidence.browser = (await (await fetch(dev+'/json/version')).json()).Browser;
  const tab = (await (await fetch(dev+'/json/list')).json()).find(t=>t.type==='page');
  ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
  let seq=0; const pending=new Map();
  ws.onmessage=e=>{
    const v=JSON.parse(String(e.data));
    if(v.id && pending.has(v.id)){const [r,j]=pending.get(v.id);pending.delete(v.id); v.error?j(Error(v.error.message)):r(v.result);}
    if(v.method==='Page.downloadWillBegin' || v.method==='Page.downloadProgress'){
      const {guid,suggestedFilename,state,totalBytes,receivedBytes}=v.params;
      evidence.download_events.push({event:v.method,guid,suggestedFilename,state,totalBytes,receivedBytes});
    }
    if(v.method==='Network.requestWillBeSent'){
      const req=v.params.request;
      if(req.method==='POST') evidence.posts.push({path:new URL(req.url).pathname, body:JSON.parse(req.postData || '{}')});
    }
  };
  cdp=(method,params={})=>new Promise((r,j)=>{const id=++seq;pending.set(id,[r,j]);ws.send(JSON.stringify({id,method,params}));});
  await cdp('Page.enable'); await cdp('Network.enable');
  const js=async expression=>{
    const val=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
    if(val.exceptionDetails)throw Error(val.exceptionDetails.exception?.description || val.exceptionDetails.text);
    return val.result.value;
  };
  const q=s=>'document.querySelector('+JSON.stringify(s)+')';
  const has=async s=>until(s,()=>js('!!'+q(s)));
  const value=s=>js(q(s)+'.value');
  const point=async ({x,y})=>{
    await cdp('Input.dispatchMouseEvent',{type:'mouseMoved',x,y});
    await cdp('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});
    await cdp('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1});
  };
  const click=async s=>{
    const pos=await until(s,()=>js(`(()=>{const e=${q(s)};if(!e||e.disabled)return null;e.scrollIntoView({block:'center',behavior:'instant'});const b=e.getBoundingClientRect(),x=b.x+b.width/2,y=b.y+b.height/2;if(!b.width||!b.height||!e.contains(document.elementFromPoint(x,y)))return null;return {x,y}})()`));
    await point(pos);
  };
  const type=async(s,text)=>{await click(s);await cdp('Input.insertText',{text});assert.equal(await value(s),text);};
  const phase=name=>{last=name;evidence.phases.push(name);console.log(name);};
  const screen=async name=>{const snap=await cdp('Page.captureScreenshot',{format:'png'});writeFileSync(join(output,name+'.png'),Buffer.from(snap.data,'base64'));};
  await cdp('Page.navigate',{url:origin+'/'});
  await until('initial village ready',()=>js("document.documentElement.dataset.gameReady==='true' && !document.querySelector('#launch-cover')"));
  phase('open-resident-map-menu');
  const residentScreen=await until('hover original primary',async()=>{
    const pos=await js(`(()=>{const e=document.querySelector('#village');if(!e?.dataset.cameraView||document.querySelector('#wood')?.textContent==='—')return null;const c=JSON.parse(e.dataset.cameraView),b=e.getBoundingClientRect();return {x:b.left+c.x+((${worker.x}+.5)*32-14)*c.scale,y:b.top+c.y+((${worker.y}+1)*32-16)*c.scale};})()`);
    if(!pos)return null;
    await cdp('Input.dispatchMouseEvent',{type:'mouseMoved',...pos});
    evidence.hover={...pos,tooltip:await js(q('#map-tooltip')+'.textContent'),target:await js('document.elementFromPoint('+pos.x+','+pos.y+')?.id')};
    return evidence.hover.tooltip.includes(worker.name) && pos;
  });
  await point(residentScreen); await click('[data-action="residentChat"]');
  await type('.chat-compose textarea',goal);
  phase('transfer-unsent-chat');
  await click('.chat-order');await has('[data-sow-form]');
  assert.equal(await value('[name=goal]'),goal);
  assert.equal(await value('[name=worker_id]'),worker.id);
  assert.equal(await value('[name=mode]'),'local');
  assert.deepEqual((await get('/api/residents/chat?id='+worker.id)).turns,[]);
  await type('[data-sow-form] [name=title]',title);
  await click('[data-sow-form] [type=submit]');await click('[data-task-action="run"]');await has('.order-head [data-stage=ready]');
  const id=(await get('/api/state')).harness.tasks.find(t=>t.title===title).id;
  const detail=()=>get('/api/harness/task?id='+id);
  const first=await detail();assert.deepEqual(first.advisor_ids,[]);assert.equal(first.history.length,1);
  phase('independent-advisers');
  const asked=[];
  for(let i=0;i<2;i++){
    if(!await js(q('[data-invite]')+'.open'))await click('[data-invite] summary');
    asked.push(await value('[data-assist-form] [name=reviewer_id]'));
    if(i===0)await type('[data-assist-form] textarea','请独立复核已有材料和建筑状态。');
    await click('[data-assist-form] [type=submit]');
    await until('consultation '+(i+1),async()=>(await detail()).consultations.length===i+1);
    await until('displayed cards '+(i+1),()=>js(`document.querySelectorAll('.adviser-card input[name=hint_ids]').length>0 && document.querySelectorAll('.adviser-card').length===${i+1} && !!document.querySelector('.order-head [data-stage=advised]')`));
  }
  assert.equal(new Set(asked).size,2);
  const advised=await detail();assert.deepEqual(advised.advisor_ids,asked);
  assert.equal(await js("document.querySelectorAll('[name=hint_ids]:checked').length"),0);
  const chosen=advised.consultations[1].hints[0];
  await click('[name=hint_ids][value="'+chosen.id+'"]');
  assert.equal(await js("document.querySelectorAll('[name=hint_ids]:checked').length"),1);
  await screen('adviser-comparison-one-selected');
  phase('resume-harvest');
  await click('[data-feedback-action=resume] [type=submit]');await has('.order-head [data-stage=ready]');
  await click('[data-task-action=harvest]');await has('.order-head [data-stage=harvested]');
  phase('await-new-ready-document');
  const oldOrigin=await js('performance.timeOrigin');
  await cdp('Page.reload',{ignoreCache:true});
  const newOrigin=await until('reloaded village ready',()=>js(`performance.timeOrigin!==${oldOrigin} &&
    performance.getEntriesByType('navigation')[0]?.type==='reload' &&
    document.documentElement.dataset.gameReady==='true' && !document.querySelector('#launch-cover') && performance.timeOrigin`));
  evidence.reload={old_time_origin_ms:oldOrigin,new_time_origin_ms:newOrigin,game_ready:true};
  await click('[data-view=taskBoard]');await click('[data-task-record="'+id+'"]');await has('.order-head [data-stage=harvested]');
  await screen('harvested-after-reload');
  const saved=JSON.parse(readFileSync(worldFile,'utf8')), record=saved.harness.tasks.find(t=>t.id===id);
  assert.deepEqual(await detail(),record);
  assert.deepEqual(record.history.at(-1).input_hints,[chosen.text]);
  assert.deepEqual(record.consultations.map(c=>c.selected_ids),[[],[chosen.id]]);
  assert.equal(record.goal,goal);assert.equal(record.worker_id,worker.id);assert.equal(record.revision,2);
  assert.equal(record.status,'harvested');assert.deepEqual(saved.ledger,[]);
  assert.deepEqual((await get('/api/residents/chat?id='+worker.id)).turns,[]);
  assert.deepEqual(evidence.posts.map(p=>p.path),['/api/harness/tasks',...Array(5).fill('/api/harness/action')]);
  assert.deepEqual(evidence.posts.slice(1).map(p=>p.body.action),['run','assist','assist','resume','harvest']);
  evidence.record=record; evidence.ledger=saved.ledger; evidence.chat_turns=0;
  phase('reload-and-durable-receipt-verified');
  phase('forge-harvested-source');
  await click('[data-forge-work]'); await has('[data-forge-form]');
  const form='[data-forge-form]';
  const origSkill=saved.harness.skills.find(s=>s.id===record.skill_id);
  assert.ok(origSkill);
  const formIdentity={name:await value(form+' [name=name]'),description:await value(form+' [name=description]'),
    instructions:await value(form+' [name=instructions]'),
    tools:await js("Array.from(document.querySelectorAll('[data-forge-form] [name=tools]:checked'),e=>e.value)")};
  assert.deepEqual(formIdentity,{name:record.title,description:record.goal,instructions:record.artifact,tools:origSkill.tools});
  await click(form+' [type=submit]');
  const skill=await until('durable forged skill',async()=>{
    const savedNow=JSON.parse(readFileSync(worldFile,'utf8'));
    return savedNow.harness.skills.find(s=>s.name===record.title && s.id!==origSkill.id);
  });
  assert.deepEqual(skill,{id:skill.id,...formIdentity});
  const card='[data-skill-card="'+skill.id+'"]', preview='[data-skill-preview="'+skill.id+'"]';
  await click(card+' > summary');await click(preview+' > summary');
  const visiblePreview=await js(`(()=>{const e=${q(preview+' > pre')}; return e?.checkVisibility() &&
    e.closest('[data-skill-preview]').open && e.closest('[data-skill-card]').open ? e.textContent : null;})()`);
  assert.equal(typeof visiblePreview,'string');
  const labels={materials:'物资库存',buildings:'建筑进度',farm:'菜田',roster:'居民名册'};
  const expected=['---','name: skill-'+skill.id,'description: '+JSON.stringify(record.goal),'---','',
    '# '+record.title,'',record.artifact,'','## 可查阅的村务材料','',
    ...origSkill.tools.map(tool=>{assert.ok(labels[tool]);return '- '+labels[tool];}),''].join('\n');
  assert.equal(visiblePreview,expected);
  writeFileSync(join(output,'visible-preview.md'),visiblePreview,'utf8');
  await screen('forged-skill-preview');
  phase('download-actual-markdown');
  await click('[data-skill-download="'+skill.id+'"]');
  const md=join(downloads,'SKILL.md');
  const bytes=await until('actual Chrome SKILL.md in disposable download directory',()=>{
    if(!existsSync(md))return false;
    const b=readFileSync(md);
    return b.length?b:false;
  });
  const decoded=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
  assert.equal(decoded,expected);
  assert.deepEqual(bytes,Buffer.from(visiblePreview,'utf8'));
  const finalSaved=JSON.parse(readFileSync(worldFile,'utf8'));
  assert.deepEqual(finalSaved.ledger,[]);
  assert.equal(finalSaved.harness.tasks.find(t=>t.id===record.id).status,'harvested');
  const skillPost=evidence.posts.at(-1);
  assert.equal(skillPost.path,'/api/harness/skills');
  assert.deepEqual(skillPost.body,formIdentity);
  assert.deepEqual(evidence.posts.map(p=>p.path),['/api/harness/tasks',...Array(5).fill('/api/harness/action'),'/api/harness/skills']);
  evidence.forge={source_task_id:record.id,source_revision:record.revision,original_skill_id:origSkill.id,
    source_artifact_sha256:sha(Buffer.from(record.artifact,'utf8')),persisted_skill:skill,
    selection_from_source:formIdentity.tools,download_file:'downloads/SKILL.md',
    bytes:bytes.length,sha256:sha(bytes),preview_sha256:sha(Buffer.from(visiblePreview)),
    expected_sha256:sha(Buffer.from(expected)),policy_override:false,ledger_entries:finalSaved.ledger.length};
  phase('forged-preview-download-verified');
  const stop=await fetch(origin+'/api/shutdown',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:'{}'});
  assert.equal(stop.status,200);
  const exit=await server.done;assert.equal(exit.code,0);evidence.server_exit=exit;
  evidence.result='passed';
}

try { await smoke(); } catch(e) {
  evidence.result='failed'; evidence.error=String(e.stack || e);evidence.last_phase=last;
  console.error(evidence.error);process.exitCode=1;
  if(cdp)try{const s=await cdp('Page.captureScreenshot',{format:'png'});writeFileSync(join(output,'failure.png'),Buffer.from(s.data,'base64'));}catch{}
} finally {
  if(cdp)try{await Promise.race([cdp('Browser.close'),sleep(1000)]);}catch{}
  if(ws)ws.close();
  for(const c of [browser,server].filter(Boolean)){
    if(c.exitCode===null && !c.signalCode){await Promise.race([c.done,sleep(700)]);if(c.exitCode===null && !c.signalCode)c.kill();}
    await c.done;
  }
  writeFileSync(join(output,'evidence.json'),JSON.stringify(evidence,null,2)+'\n');
  if(!resolve(temp).startsWith(resolve(output)+sep+'fixture-'))throw Error('temporary fixture boundary');
  rmSync(temp,{force:true,recursive:true,maxRetries:5,retryDelay:240});
  console.log(output);
}
