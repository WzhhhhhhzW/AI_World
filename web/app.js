'use strict';
const $ = s => document.querySelector(s);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number = n => Number(n || 0).toLocaleString('zh-CN');
const statusName = {draft:'待讨论',gathering:'正在召集',discussing:'独立提案中',synthesizing:'主持人汇总中',complete:'已归档',interrupted:'已中断 · 保留记录'};
let state, view = 'village', selected = null, toastTimer, pending = false, loading = false, previousSignature = '',exiting=false;
let scene='village',roomMeeting=null,speechResident=null;
const canvas = $('#village'), ctx = canvas.getContext('2d', {alpha:false});
const tcg = document.documentElement.dataset.renderProfile === 'tcg';
const positions = new Map(), assets = {};
const worldEffects = [];
let weatherStorage=null;try{weatherStorage=localStorage;}catch{}
const climate=VillageClimate.create(weatherStorage);
let weatherIconId='';
let manifest = {};
fetch('assets/manifest.json').then(r=>r.json()).then(data=>{manifest=data;for(const [key,item] of Object.entries(data)){if(!item.file)continue;const image=new Image();image.onload=()=>assets[key]=image;image.src='assets/'+item.file;}}).catch(()=>{});

function toast(text){$('#toast').textContent=text;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,5500);}
async function request(path, data){
  const response = await fetch('/api/'+path, data ? {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)} : {});
  const body = await response.json();
  if(!response.ok) throw new Error(body.error || '操作未完成');
  return body;
}
async function mutate(path,data,success){
  if(pending)return;
  pending=true;
  try{const result=await request(path,data);if(success)toast(success);await refresh(true);return result;}
  catch(error){toast(error.message);return null;}finally{pending=false;}
}
function providerLabel(id){return state?.providers.find(p=>p.id===id)?.name || id;}
function setScene(next, updateAddress=true){
  VillageInteractions.closeMenu();
  if(next==='eastwood'&&!state?.world?.regions.some(r=>r.id==='eastwood'))return;
  if(view==='residentApi')$('#panel').replaceChildren();
  const address=new URL(location.href);
  if(next==='village')address.searchParams.delete('scene');
  else address.searchParams.set('scene',next);
  if(updateAddress&&address.href!==location.href)history.pushState(null,'',address);
  scene=next;document.documentElement.dataset.scene=next;canvas.dataset.scene=next;
  const name={hall:'圆桌议事厅',eastwood:'东林开拓地',village:'溪谷村'}[next];
  $('.village-name strong').textContent=name;
  document.title=name+' · 谷言';
  canvas.setAttribute('aria-label',next==='hall'?'圆桌议事厅室内地图。点击座位上的居民查看发言。':name+'地图。点击居民或建筑查看详情。');
  $('#map-tooltip').hidden=true;
  view='village';selected=null;$('#game-window').hidden=true;$('#hall-tools').hidden=next!=='hall';$('#scene-back').hidden=next==='village';$('#hall-speech-layer').hidden=next!=='hall';
  $('#world-hint').textContent=next==='hall'?'点击村民查看发言 · 会议记录保留完整讨论':next==='eastwood'?'东林开拓地 · 建筑须经居民表决后施工':'拖动探索村庄 · 点击居民或建筑 · 滚轮缩放';
  worldCamera.reset(tcg);bubbleLayout='';
  wakeMap(true);
}
function navigate(next,id=null){
  VillageInteractions.closeMenu();
  if(view==='residentApi')$('#panel').replaceChildren();
  if(next==='meeting'){
    if(scene!=='hall'||id===null)setScene('hall');
    if(id===null)return;
    if(state?.meetings.some(m=>m.id===id))roomMeeting=id;
  }
  view=next;selected=id;previousSignature='';$('#game-window').hidden=next==='village';if(next!=='village')renderPanel();document.querySelectorAll('.nav').forEach(b=>b.classList.toggle('active',b.dataset.view===next));
  const bubbles=$('#hall-speech-layer');bubbles.hidden=scene!=='hall'||next!=='village';
  // The panel covers the existing map. Village or scene changes separately
  // invalidate its artwork, so revealing it needs only the next normal frame.
  wakeMap();
}
function providerOptions(chosen){return state.providers.map(p=>`<option value="${esc(p.id)}" ${chosen===p.id?'selected':''}>${esc(p.name)}${p.configured?'':' · 待配置'}</option>`).join('');}
function residentIcon(r,large=false){return `<canvas class="${large?'detail-portrait':'portrait'}" width="96" height="112" data-portrait="${esc(r.id)}" aria-label="${esc(r.name)}的头像"></canvas>`;}
function grainbar(r){return `<div class="grain-bar"><i style="width:${Math.max(0,Math.min(100,r.remaining/Math.max(1,r.budget)*100))}%"></i></div>`;}
function residentCard(r){return `<button class="resident-card" data-resident="${esc(r.id)}">${residentIcon(r)}<span class="resident-main"><span class="resident-name">${esc(r.name)}<span class="role">${esc(r.role)}</span></span><span class="resident-job"><span><i class="activity-dot"></i>${esc(r.activity)}</span><span>${number(r.remaining)} 粮</span></span>${grainbar(r)}<span class="provider-tag">${esc(providerLabel(r.provider))} ${r.connected?'· 已连接':'· 待连接'}</span></span><span class="resident-tail">↗</span></button>`;}
function renderVillage(){
  return state.residents.map(residentCard).join('')+`<p class="section-label">一起建些什么</p><div class="sites">${state.buildings.filter(b=>!b.built).map(b=>`<button class="site" data-building="${b.id}">${b.constructing?'▧':'＋'} ${esc(b.name)}${b.constructing?' · '+Math.floor(b.progress/45*100)+'%':''}</button>`).join('') || '<span class="fine-print">所有建筑已落成，去议事厅讨论下一步吧。</span>'}</div><p class="mini-banner">散步、采集与施工不会消耗 Token。<br>让居民思考时，才会动用 TA 的口粮。</p>`;
}
function renderResident(){
  const r=state.residents.find(r=>r.id===selected);if(!r)return renderVillage();
  return `<button class="back" data-go="village">← 回到邻居们</button>${residentIcon(r,true)}${VillageInteractions.identityEditor(r)}<span class="detail-title">${esc(r.role)} · ${esc(providerLabel(r.provider))}<button type="button" class="outline" id="edit-role">修改身份</button></span><p class="detail-desc">${esc(r.nature)}</p><button class="outline full" id="open-resident-api">API 接入设置</button><p class="fine-print">${esc(providerLabel(r.provider))} · ${r.connected?'已配置':'待配置'}${r.api_profile?.model?' · '+esc(r.api_profile.model):''}</p><div class="stat-grid"><div class="stat-box"><small>剩余口粮 / Token</small><strong>${number(r.remaining)}</strong></div><div class="stat-box"><small>实际消耗 / Token</small><strong>${number(r.used)}</strong></div></div><label>当前工作<select id="resident-job"><option value="wood" ${r.task==='wood'?'selected':''}>采集木材</option><option value="stone" ${r.task==='stone'?'selected':''}>采集石料</option><option value="farm" ${r.task==='farm'?'selected':''}>照料菜园</option></select></label><div class="detail-actions"><button class="outline" id="save-resident" ${state.busy?'disabled':''}>保存安排</button><button class="primary" id="think" ${!r.connected||state.busy?'disabled':''}>让 TA 想一想</button></div><p class="fine-print">${r.connected?'单次思考会调用模型，按实际 usage 扣粮。':'打开「API 接入设置」，为这位居民选择服务并填写密钥。'}</p><p class="section-label">最近的想法</p><div class="note"><span class="tag">${r.thought_source==='api'?'真实模型决策':'尚未调用模型'}</span>${esc(r.last_thought)}</div><p class="section-label">TA 记得的事</p>${r.memory.slice(-5).reverse().map(t=>`<div class="note">${esc(t)}</div>`).join('') || '<p class="fine-print">新的记忆，会从第一次讨论开始。</p>'}`;
}
function renderResidentBackground(){
  const r=state.residents.find(resident=>resident.id===selected);
  if(!r)return renderVillage();
  const back=`<button class="back" data-resident="${esc(r.id)}">← ${esc(r.name)}的资料</button>`;
  if(typeof r.background!=='string')return back+'<p class="panel-intro">请保存并重启村庄服务，以加载人物背景编辑器。</p>';
  return back+`<form id="background-form" data-owner="${esc(r.id)}">
    <label for="background-text">${esc(r.name)}的人物背景</label>
    <textarea id="background-text" name="background" rows="8" placeholder="TA 来村庄前经历了什么？现在最想做成哪件事？"></textarea>
    <div class="background-footer"><small>居民在思考和议事时会参考这段经历。</small><output id="background-count"></output></div>
    <p id="background-error" role="alert" hidden></p>
    <button class="primary full" type="submit">保存背景</button>
  </form>`;
}

function bindBackgroundForm(form,r){
  const input=form.elements.background, count=form.querySelector('output');
  const save=form.querySelector('[type=submit]'), error=form.querySelector('[role=alert]');
  const previous=r.background;
  input.value=previous;
  function updateCount(){
    const length=Array.from(input.value).length;
    count.textContent=length+' / 1200';
    input.setCustomValidity(length>1200?'人物背景最多可写 1200 字':'');
  }
  updateCount();
  input.addEventListener('input',updateCount);
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    if(save.disabled||!form.reportValidity())return;
    save.disabled=true;input.readOnly=true;error.hidden=true;
    try{
      const result=await request('residents/background',{id:r.id,previous,background:input.value});
      const current=state.residents.find(resident=>resident.id===r.id);
      if(current)current.background=result.background;
      if(view==='residentBackground'&&selected===r.id&&form.isConnected)navigate('resident',r.id);
      toast(r.name+'的人物背景已保存');
    }catch(problem){error.textContent=problem.message;error.hidden=false;}
    finally{save.disabled=false;input.readOnly=false;}
  });
}

function renderResidentApi(){
  const r=state.residents.find(resident=>resident.id===selected);
  if(!state.resident_api_settings){
    return `<button class="back" data-resident="${esc(r.id)}">← ${esc(r.name)}的资料</button>
      <p class="panel-intro">当前村庄服务需要重启。打开「设置 → 保存并退出村庄」，再双击「启动游戏.cmd」即可填写 API 设置。</p>`;
  }
  return `<button class="back" data-resident="${esc(r.id)}">← ${esc(r.name)}的资料</button>
    <form id="resident-api-form">
      <label>模型服务<select name="provider">${state.providers.map(p=>`<option value="${esc(p.id)}" ${p.id===r.provider?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label>
      <label>配置方式<select name="source"><option value="personal">这位居民专用</option><option value="default">使用本机默认设置</option></select></label>
      <fieldset class="api-fields"><label>接口基础地址<input name="base_url" type="url" placeholder="https://…" required maxlength="2048" spellcheck="false"></label>
        <label>模型或接入点 ID<input name="model" required maxlength="200" placeholder="填写服务商控制台中的 ID" spellcheck="false"></label>
        <label>API Key<input name="api_key" type="password" autocomplete="new-password" spellcheck="false" maxlength="4096"></label>
      </fieldset>
      <p class="fine-print" id="api-config-note"></p>
      <p id="api-config-error" role="alert" hidden></p>
      <button class="primary full" type="submit">保存 API 设置</button>
    </form>`;
}

function bindResidentApi(form,r){
  const fields=form.elements, group=form.querySelector('fieldset'), note=form.querySelector('#api-config-note');
  const error=form.querySelector('#api-config-error'), save=form.querySelector('[type=submit]');
  fields.source.value=r.connected&&!r.api_profile?'default':'personal';
  function selectedService(){return state.providers.find(p=>p.id===fields.provider.value);}
  function updateKey(){
    const keep=r.api_profile?.has_key&&fields.provider.value===r.provider&&
      fields.base_url.value.trim().replace(/\/+$/,'')===r.api_profile.base_url;
    fields.api_key.required=!keep;
    fields.api_key.placeholder=keep?'已保存，留空沿用原密钥':'填写该服务的 API Key';
  }
  function updateSource(){
    const shared=fields.source.value==='default';
    group.disabled=shared;group.hidden=shared;
    note.textContent=shared?(selectedService()?.configured?'将使用此服务的本机默认模型和密钥。':'此服务的本机默认配置尚未就绪。'):'密钥保存在本机。保存后可在居民资料中点击「让 TA 想一想」发起调用。';
    if(shared)fields.api_key.value='';
    error.hidden=true;
  }
  function updateService(){
    const profile=fields.provider.value===r.provider?r.api_profile:null;
    const defaults=selectedService();
    fields.base_url.value=profile?.base_url||defaults?.base_url||'';
    fields.model.value=profile?.model||defaults?.model||'';
    fields.api_key.value='';
    updateKey();updateSource();
  }
  fields.provider.addEventListener('change',updateService);
  fields.source.addEventListener('change',updateSource);
  fields.base_url.addEventListener('input',()=>{fields.api_key.value='';updateKey();});
  updateService();
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    if(save.disabled)return;
    save.disabled=true;error.hidden=true;
    const api=fields.source.value==='default'?null:{
      base_url:fields.base_url.value.trim(),model:fields.model.value.trim(),api_key:fields.api_key.value.trim()
    };
    try{
      await request('residents/api',{id:r.id,provider:fields.provider.value,api});
      fields.api_key.value='';
      await refresh();
      if(view==='residentApi'&&selected===r.id)navigate('resident',r.id);
      toast('已保存'+r.name+'的 API 设置');
    }catch(problem){error.textContent=problem.message;error.hidden=false;}
    finally{save.disabled=false;}
  });
}

function renderBuilding(){
  const b=state.buildings.find(b=>b.id===selected);if(!b)return renderVillage();
  const descriptions={hall:'敲响钟声，召集居民讨论问题。不同模型各自提案，再共同形成结论。',granary:'查看每位居民的思考口粮、预留额度与实际消耗，也能在这里分配预算。',home:'欢迎新的邻居。村庄最多可容纳12位居民，外观与模型伙伴可分别选择。',workshop:'居民用木材和石料搭建工坊。落成后，铁匠铺可将工作方法锻成可复用的 Skill。',archive:'保存会议记录与居民记忆，查看村庄里的模型伙伴。',farm:'园丁照料作物，采收后送入粮仓。本地耕作和搬运不会消耗Token。'};
  const action={hall:'进入议事厅',granary:'打开粮仓',home:'邀请新居民',archive:'打开档案',farm:'打理菜田',workshop:'进入铁匠铺'}[b.id];
  const farmer=state.residents.find(r=>r.task==='farm');
  const facts={farm:[['照料居民',farmer?.name||'等待园丁'],['当前活动',farmer?.activity||'暂无居民照料'],['村庄作物',number(state.resources.crops)]],home:[['村庄邻居',state.residents.length+' / 12'],['入住名额',Math.max(0,12-state.residents.length)]],hall:[['待讨论议题',state.meetings.filter(m=>m.status==='draft').length],['已完成会议',state.meetings.filter(m=>m.status==='complete').length]],granary:[['可用口粮',number(state.residents.reduce((n,r)=>n+r.remaining,0))],['待核对调用',state.ledger.filter(e=>e.status==='unknown').length]],archive:[['归档会议',state.meetings.filter(m=>m.status==='complete').length],['居民记忆',state.residents.reduce((n,r)=>n+r.memory.length,0)]],workshop:[['建设进度',b.built?'已落成':b.constructing?Math.floor(b.progress/45*100)+'%':'未开工']]}[b.id]||[];
  return `<canvas class="building-art" width="300" height="200" data-building-art="${esc(b.id)}" aria-label="${esc(b.name)}的场景"></canvas><div class="building-desc"><p class="section-label">${b.built?'已落成':b.constructing?'施工中':'等待建设'}</p><p class="detail-desc">${descriptions[b.id]}</p><div class="building-facts">${facts.map(([k,v])=>`<div><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`).join('')}</div></div><div class="building-body">${!b.built?`<div class="stat-grid"><div class="stat-box"><small>${VillageUI.icon('wood',22)} 所需木材</small><strong>${b.cost.wood}</strong></div><div class="stat-box"><small>${VillageUI.icon('stone',22)} 所需石料</small><strong>${b.cost.stone}</strong></div></div>${b.constructing?`<div class="building-progress"><i style="width:${b.progress/45*100}%"></i></div><p class="fine-print">居民正合力施工 · ${Math.floor(b.progress/45*100)}%</p>`:`<button class="primary full" id="build">开始建设</button>`}`:`<button class="primary full" id="enter-building">${action}</button>`}<p class="fine-print">建设与日常劳动使用村庄材料，模型思考才会消耗口粮。</p></div>`;
}
function renderMeetings(){
  const m=state.meetings.find(m=>m.id===selected);
  if(m){return `<button class="back" data-go="meeting">← 所有议题</button><p class="section-label">${esc(statusName[m.status])}</p><h3 class="detail-name" style="font-size:18px;line-height:1.7">${esc(m.question)}</h3>${m.status==='draft'?`<p class="fine-print">选择参加讨论的居民。首位是主持人：独立提案后，由 TA 汇总。一次会议共 N＋1 次调用。</p><div class="checks">${state.residents.map(r=>`<label><input type="checkbox" name="participant" value="${r.id}" ${r.connected?'checked':'disabled'}>${esc(r.name)}${r.connected?'':'（待连接）'}</label>`).join('')}</div><button class="primary full" id="start-meeting" ${state.busy||!state.residents.some(r=>r.connected)?'disabled':''}>鸣钟 · 召集讨论</button>${!state.residents.some(r=>r.connected)?'<div class="mini-banner">议题已保存。连接模型后，居民们就能来这里讨论。</div>':''}`:''}${m.messages.map(v=>`<div class="message"><strong>${esc(v.name)} <span class="role">${esc(providerLabel(v.provider))} · API</span></strong><p>${esc(v.text)}</p></div>`).join('')}${m.summary?`<div class="message meeting-summary"><strong>共同的结论 · 主持人汇总</strong><p>${esc(m.summary)}</p></div>`:''}${m.status==='interrupted'?'<p class="fine-print warning">本次讨论中断。已有发言和实际用量已保留，结果未知的调用仍占预留额。</p>':''}${['gathering','discussing','synthesizing'].includes(m.status)?'<div class="mini-banner">'+esc(m.status==='gathering'?'居民正沿着村间小路赶来，等大家到齐再开始。':'正在等待模型回答，已完成的发言会陆续出现在这里。')+'</div>':''}`;}
  if(selected==='new')return `<p class="panel-intro">写下一个值得大家一起想的问题。</p><form id="question-form"><label for="question">新的议题</label><textarea id="question" name="question" rows="4" maxlength="1200" placeholder="今天想与居民们讨论什么？" required></textarea><button type="submit" class="primary full" style="margin-top:13px">把议题放上圆桌</button></form><p class="fine-print">议题保存后选择参与者，鸣钟开始。没有模型连接时保留草稿。</p>`;
  return `<p class="panel-intro">每一次提问、每位居民的真实发言与主持人的汇总，都保存在这里。</p>${state.meetings.map(m=>`<button class="meeting-card full" data-meeting="${m.id}" style="text-align:left"><h3>${esc(m.question)}</h3><small>${esc(statusName[m.status])} · ${m.messages.length} 条发言</small></button>`).join('')||'<p class="empty">还没有议题。点击“新的议题”开始。</p>'}`;
}
function renderGranary(){
  const used=state.residents.reduce((a,r)=>a+r.used,0),remaining=state.residents.reduce((a,r)=>a+r.remaining,0);
  return `${VillageFarm.pantry()}<p class="section-label">居民口粮</p><div class="stat-grid"><div class="stat-box"><small>村庄剩余口粮</small><strong>${number(remaining)}</strong></div><div class="stat-box"><small>累计实际消耗</small><strong>${number(used)}</strong></div></div>${state.residents.map(r=>`<div class="budget-row"><div class="budget-row-head"><strong>${esc(r.name)}</strong>${state.farm?`<label class="auto-food"><input type="checkbox" data-auto-food="${esc(r.id)}" ${r.auto_food?'checked':''}>不足时自动兑粮</label>`:''}</div><small>余粮 ${number(r.remaining)} / 分配 ${number(r.budget)}${r.reserved?' · 预留 '+number(r.reserved):''}</small>${grainbar(r)}${r.overdraw?'<small class="warning">实际用量超出预留，请核对账单并补足预算。</small>':''}</div>`).join('')}<p class="fine-print">开启自动兑粮后，调用预留额度不足时从公共库存补齐。作物不足时保留库存，居民等待补粮。</p><p class="section-label">调用账本</p>${state.ledger.map(e=>`<div class="ledger-row"><strong>${esc(e.name)} · ${esc(e.purpose)}</strong><br>${esc(e.model || providerLabel(e.provider))}<br>${e.status==='settled'?`输入 ${number(e.input)} / 输出 ${number(e.output)} / 合计 ${number(e.total)}`:`<span class="pending">${e.status==='reserved'?'调用中':'用量待核对'} · 保留 ${number(e.reserved)} 预留额</span>`}<br>${esc(e.note)}</div>`).join('') || '<p class="fine-print">还没有真实 API 调用，账本从零开始。</p>'}`;
}
function renderArchive(){return `<p class="panel-intro">建筑承载村庄，记忆让它有了自己的故事。</p><p class="section-label">已归档的会议</p>${state.meetings.filter(m=>m.status==='complete').map(m=>`<button class="meeting-card full" data-meeting="${m.id}" style="text-align:left;background:transparent"><h3>${esc(m.question)}</h3><small>${m.messages.length} 位居民的意见与共同结论 ↗</small></button>`).join('') || '<p class="fine-print">会议结束后，共识与分歧都会被保存在这里。</p>'}<p class="section-label">模型服务</p>${state.providers.map(p=>`<div class="provider-config"><strong>${esc(p.name)}</strong> · ${p.configured?'已配置（尚未在此检测连通）':'待配置'}<br>${p.model?esc(p.model):'在本机设置模型名称'}<br><code>${esc(p.key_env)} / ${esc(p.model_env)}</code></div>`).join('')}<p class="fine-print">以上为本机默认服务。点击居民资料中的「API 接入设置」可单独配置。元宝聊天应用与腾讯云开发者 API 分开配置；可按账号实际开通情况选择混元或其他兼容服务。</p>`;}
function renderJournal(){return state.events.map(e=>`<div class="note"><span class="tag">第 ${Math.floor(e.clock/1440)+1} 天 · ${esc(e.title)}</span>${esc(e.text)}</div>`).join('') || '<p class="empty">日记从今天开始。</p>';}
function currentRoomMeeting(){return state?.meetings.find(m=>m.id===roomMeeting)||state?.meetings.find(m=>['gathering','discussing','synthesizing'].includes(m.status))||state?.meetings[0];}
function renderSpeech(){
  const r=state.residents.find(r=>r.id===speechResident),m=currentRoomMeeting();
  return `<p class="panel-intro">${esc(m?.question||'圆桌还在等待新的议题')}</p>${m?.messages.filter(v=>v.resident_id===speechResident).map(v=>`<div class="speech-message"><strong>${esc(v.name)} · ${esc(providerLabel(v.provider))} · 真实发言</strong><p>${esc(v.text)}</p></div>`).join('')||`<p class="empty">${esc(r?.name||'这位居民')}还没有在这个议题发言。</p>`}${m?`<button class="outline full" data-meeting="${m.id}">查看完整会议记录</button>`:''}`;
}
let bubbleLayout='',bubbleMeeting,bubbleRows=[];
function drawRoomBubbles(){
  const layer=$('#hall-speech-layer');
  if(layer.hidden)return;
  const meeting=currentRoomMeeting(),residents=state.residents;
  // A successful inline rename can update the name before the next poll.
  const namesChanged=residents.length!==bubbleRows.length ||
    residents.some((r,i)=>r.id!==bubbleRows[i][0] || r.name!==bubbleRows[i][1]);
  if(meeting!==bubbleMeeting || namesChanged){
    bubbleMeeting=meeting;
    const messages=new Map();
    for(const message of meeting?.messages||[])messages.set(message.resident_id,message);
    const waiting=['discussing','synthesizing'].includes(meeting?.status)?'等候这一轮发言…':'候会 · 点击查看发言';
    const rows=residents.map(({id,name})=>{
      const message=messages.get(id);
      return [id,name,!!message,message?.text.slice(0,85)||waiting];
    });
    if(namesChanged || rows.some((row,i)=>row[2]!==bubbleRows[i][2] || row[3]!==bubbleRows[i][3])){
      bubbleRows=rows;
      bubbleLayout='';
      layer.innerHTML=rows.map(([id,name,hasMessage,text],i)=>
        `<button class="hall-bubble ${i%2?'right':''} ${hasMessage?'':'quiet'}" data-speech="${id}" aria-label="查看${esc(name)}的发言"><strong>${esc(name)}</strong><span>${esc(text)}</span></button>`).join('');
    }
  }
  const pose=[camera.x,camera.y,camera.scale].join('/');
  if(pose!==bubbleLayout){
    bubbleLayout=pose;
    const widths=[...layer.children].map(el=>el.offsetWidth);
    [...layer.children].forEach((el,i)=>{const [x]=VillageScenes.seats[i],right=i%2;el.style.left=(camera.x+x*camera.scale+(right?34:-34)*camera.scale-(right?0:widths[i]))+'px';el.style.top=(camera.y+(159+60*Math.floor(i/2))*camera.scale)+'px';});
  }
}
const proposalStatus={proposed:'待表决',waiting:'等待更多模型连接',voting:'独立投票中',approved:'多数通过',executed:'已执行',rejected:'未通过',interrupted:'已中止',blocked:'校验未通过'};
function worldOptions(){
  const w=state.world,opts=[];if(!w.regions.length)opts.push(['expand:eastwood','开拓东林新地图']);
  for(const b of state.buildings.filter(b=>!b.built&&!b.constructing))opts.push(['build:'+b.id,'建造'+b.name]);
  if(w.regions.length)for(let slot=0;slot<3;slot++){if(w.structures.some(s=>s.rect[0]===[225,680,650][slot]))continue;for(const [kind,name] of Object.entries({cabin:'林间小屋',garden:'林间菜园',watchtower:'瞭望台'}))opts.push([`structure:${kind}:${slot}`,`东林空地${slot+1} · ${name}`]);}
  opts.push(['rule:work_ticks','规则 · 劳动周期（12–40）'],['rule:harvest_amount','规则 · 每次收获（2–8）'],['rule:rest_ticks','规则 · 休息时长（2–12）']);return opts;
}
function renderWorld(){
  const w=state.world;if(!w)return '<p class="empty">世界状态尚未载入。</p>';
  const ready=state.residents.filter(r=>r.connected).length>state.residents.length/2;
  return `<div class="world-maps"><button class="world-map-card" data-scene="village"><img src="${tcg?'assets/tcg/valley-painted-v1.webp':'assets/maps/valley-painted-v1.png'}" alt="溪谷村地图">溪谷村</button><button class="world-map-card" data-scene="eastwood" ${!w.regions.length?'disabled':''}><img src="${tcg?'assets/tcg/eastwood-v1.webp':'assets/maps/eastwood-v1.png'}" alt="东林开拓地地图">东林${w.regions.length?' · 已开拓':' · 等待开拓提案'}</button></div><p class="section-label">世界版本 ${w.revision} · ${w.structures.length} 处新增建筑</p><p class="fine-print">劳动周期 ${w.rules.work_ticks} / 每次收获 ${w.rules.harvest_amount} / 休息时长 ${w.rules.rest_ticks}。AI自主思考开启后可以提出改变，由全体居民独立表决，过半数同意才执行。</p><form id="world-proposal-form"><label>向居民提出世界变化<select name="action">${worldOptions().map(([id,name])=>`<option value="${id}">${name}</option>`).join('')}</select></label><label>规则数值（仅规则提案使用）<input name="value" type="number" value="20" min="2" max="40"></label><label>提案理由<textarea name="reason" rows="2" maxlength="300" required placeholder="为什么值得投入资源？可能有什么风险？"></textarea></label><button class="primary full" type="submit">${ready?'提交并发起表决':'保存待议提案'}</button></form><p class="fine-print">${ready?'表决会实际调用每位已连接居民的模型，按服务商usage扣粮。':'尚未连接足够的模型，提案可保存，不能代替AI投票。'}</p><button class="outline full" id="audit-world">检查建筑重叠与入口通行</button>${w.proposals.map(p=>`<div class="proposal-card"><h3>${esc(p.title)}</h3><span class="proposal-status">${esc(proposalStatus[p.status]||p.status)}${p.applied_revision?' · 世界版本 '+p.applied_revision:''}</span><p>${esc(p.reason)}</p>${p.votes.map(v=>`<div class="proposal-vote"><strong>${esc(v.name)} · ${{yes:'同意',no:'反对',abstain:'弃权'}[v.vote]}</strong><br>${esc(v.reason)}</div>`).join('')}<p class="fine-print">${esc(p.note||'等待居民独立评估')}</p>${['proposed','waiting'].includes(p.status)?`<button class="outline" data-vote="${p.id}" ${!ready||state.busy?'disabled':''}>召集表决</button>`:''}</div>`).join('')}<p class="section-label">世界变更记录</p>${w.audit.map(a=>`<div class="note">v${a.revision} · ${esc(a.title)}<br><small>变更前存档 ${esc(a.backup)}</small></div>`).join('')||'<p class="fine-print">尚无通过表决的世界改动。</p>'}`;
}
function renderWeather(){
  const now=VillageClimate.sample(state.clock,climate.mode);
  return `<p class="panel-intro" id="weather-description">${esc(now.note)}</p><div class="weather-choices" role="group" aria-label="天气选择">${VillageClimate.modes.map(id=>`<button class="weather-choice" data-weather="${id}" aria-pressed="${climate.mode===id}"><canvas width="32" height="32" data-weather-icon="${id}" aria-hidden="true"></canvas><strong>${id==='auto'?'随村庄变化':VillageClimate.types[id].label}</strong><small>${id==='auto'?'跟随村庄时间':{sunny:'暖阳与轻风',cloudy:'移动云影',rain:'斜雨与涟漪',mist:'流动的溪谷雾气'}[id]}</small></button>`).join('')}</div><p class="fine-print">自动天气每4个村庄小时进入下一时段，交替时会渐变。暂停村庄会同时暂停天气与粒子。手动选择记在这个浏览器中，选择“随村庄变化”即可恢复自动天气。</p><p class="fine-print">天气暂时影响场景表现，村民仍照常生活；不会改变口粮账本或调用模型。</p>`;
}
let weatherReportAt=-Infinity;
function paintWeather(weather){
  const label=$('#weather-label'),mode=$('#weather-mode');
  if(label.textContent!==weather.label)label.textContent=weather.label;
  const modeText=weather.mode==='auto'?'自动':'固定';if(mode.textContent!==modeText)mode.textContent=modeText;
  if(weatherIconId!==weather.id){VillageClimate.icon($('#weather-icon'),weather.id);weatherIconId=weather.id;}
  if(visualTime-weatherReportAt>=500 || canvas.dataset.weatherSettled!==String(weather.settled)){
    weatherReportAt=visualTime;
    canvas.dataset.weather=JSON.stringify({id:weather.id,mode:weather.mode,rain:weather.rain,fog:weather.fog,cloud:weather.cloud,wind:weather.wind,time:visualTime});
    canvas.dataset.weatherSettled=String(weather.settled);
  }
}
function renderPanel(){
  if(!state||$('#game-window').hidden)return;
  const resident=state.residents.find(r=>r.id===selected);
  if($('#game-window').dataset.interaction!==view)$('#game-window').dataset.interaction=view;
  if(VillageHarness.handles(view)){
    VillageHarness.show(view,selected);
    return;
  }
  const openChat=$('.resident-chat');
  if(view==='residentChat'&&openChat?.dataset.owner===selected&&openChat.sync){openChat.sync();return;}
  const renameForm=$('#rename-form');
  if(view==='resident'&&previousSignature&&renameForm?.dataset.owner===selected&&!renameForm.hidden)return;
  if(view==='residentApi'&&$('#resident-api-form'))return;
  if(view==='residentBackground'&&$('#background-form')?.dataset.owner===selected)return;
  const history=state.history_revision ?? [state.meetings,state.world,state.ledger];
  const key=JSON.stringify([view,selected,state.residents.map(r=>[r.id,r.name,r.role,r.appearance,r.used,r.reserved,r.remaining,r.provider,r.connected,r.task,r.activity,r.memory.length]),state.buildings,history,state.world.structures,state.busy,state.providers,(view==='farm'||view==='granary')?state.farm:null,view==='farm'?state.clock:null,view==='granary'?state.residents.map(r=>r.auto_food):null,view==='weather'?[climate.mode,VillageClimate.sample(state.clock,climate.mode).id]:null]);
  if(key===previousSignature)return;
  // Preserve in-progress text and focus while background state refreshes.
  const active=document.activeElement, editing=active?.closest('#panel') && ['INPUT','TEXTAREA','SELECT'].includes(active.tagName);
  if(editing && previousSignature)return;
  previousSignature=key;
  const headings={residentApi:['居民手札','API 接入设置'],village:['居民','村庄邻居'],resident:['居民手札','居民资料'],building:['村庄建筑',state.buildings.find(b=>b.id===selected)?.name||'建筑'],meeting:['鸣钟议事',selected==='new'?'新的议题':'会议记录'],granary:['村庄仓储','粮仓'],archive:['村庄档案','模型与记忆'],journal:['溪谷村','村庄日记'],weather:['溪谷天象','小镇天气'],world:['共同开拓','地图与世界建设'],speech:['圆桌发言',state.residents.find(r=>r.id===speechResident)?.name||'村民发言']};
  headings.farm=['村庄菜园','我的菜田'];
  headings.residentBackground=['居民手札','人物背景'];
  if(view==='residentChat')headings.residentChat=['居民私聊',resident.name];
  if(view==='wardrobe')headings.wardrobe=['居民衣橱',resident.name+' · 换装'];
  const head=headings[view]||headings.village;$('#panel-kicker').textContent=head[0];$('#panel-title').textContent=head[1];$('#resident-count').textContent=view==='village'?state.residents.length+' 位':'溪谷村';
  $('#panel').innerHTML=({residentChat:()=>VillageInteractions.chatView(resident),wardrobe:()=>VillageInteractions.wardrobe(resident),residentBackground:renderResidentBackground,residentApi:renderResidentApi,village:renderVillage,resident:renderResident,building:renderBuilding,farm:()=>VillageFarm.garden(),meeting:renderMeetings,granary:renderGranary,archive:renderArchive,journal:renderJournal,weather:renderWeather,world:renderWorld,speech:renderSpeech}[view]||renderVillage)();
  const titleIcon = {resident:'invite',building:'meeting',meeting:'discussion',granary:'grain',archive:'journal',journal:'journal'}[view];
  if(titleIcon)$('#panel-title').insertAdjacentHTML('afterbegin',VillageUI.icon(titleIcon,28,'window-heading-icon'));
  if(view==='resident'){
    VillageInteractions.bindIdentity(resident);
    const roleKey={'匠人':'role-carpenter','园丁':'role-gardener','学者':'role-scholar','规划师':'role-planner','探索者':'role-planner'}[resident?.role]||'invite';
    $('#panel .detail-title')?.insertAdjacentHTML('afterbegin',VillageUI.icon(roleKey,24,'profession-icon'));
    $('#panel .detail-desc')?.insertAdjacentHTML('afterend',`<label>村民形象<select id="resident-appearance">${state.appearances.map(a=>`<option value="${esc(a.id)}" ${resident.appearance===a.id?'selected':''}>${esc(a.name)}</option>`).join('')}</select></label>`);
    $('#panel .detail-desc')?.insertAdjacentHTML('afterend',`<section class="resident-background">
      <h3>人物背景</h3><button type="button" class="outline" id="edit-background">${resident.background?'编辑背景':'编写背景'}</button>
      ${resident.background?`<p>${esc(resident.background)}</p>`:''}</section>`);
    $('#edit-background')?.addEventListener('click',()=>navigate('residentBackground',resident.id));
    if(resident?.remaining===0)$('#panel .detail-desc')?.insertAdjacentHTML('afterend','<p class="resident-food-warning">'+VillageUI.icon('hungry',24)+'当前口粮不足，可到粮仓用作物兑换。</p>');
  }
  const apiForm=$('#resident-api-form');
  if(view==='residentChat')VillageInteractions.bindChat(resident);
  if(view==='wardrobe')VillageInteractions.bindWardrobe(resident);
  if(view==='farm'||view==='granary')VillageFarm.bind();
  if(view==='farm')$('#panel').insertAdjacentHTML('afterbegin','<div class="field-entry"><button class="outline" data-go="taskBoard">打开委托田</button><span>给村民布置工作、收获成果</span></div>');
  if(view==='building'&&selected==='workshop'){
    const shop=state.buildings.find(b=>b.id==='workshop');
    if(!shop.built)$('#panel .building-body').insertAdjacentHTML('afterbegin','<button class="outline full" data-go="forge">翻看铁匠铺技艺册</button>');
  }
  const backgroundForm=$('#background-form');
  if(view==='residentBackground'&&backgroundForm)bindBackgroundForm(backgroundForm,state.residents.find(r=>r.id===selected));
  if(view==='residentApi'&&apiForm)bindResidentApi(apiForm,state.residents.find(r=>r.id===selected));
  $('#open-resident-api')?.addEventListener('click',()=>navigate('residentApi',selected));
  if(view==='speech'&&speechResident)$('#panel').insertAdjacentHTML('afterbegin',`<button class="back" data-resident="${esc(speechResident)}">查看居民资料</button>`);
  VillageUI.paintAll($('#game-window'));
  if(view==='world'&&state.world?.inspections?.length)$('#panel').insertAdjacentHTML('beforeend','<p class="section-label">居民巡查</p>'+state.world.inspections.slice(0,10).map(a=>`<div class="note"><strong>${esc(a.name)} · v${a.revision}</strong><br>${esc(a.reason)}<br>${esc(a.issues.length?a.issues.join('；'):'建筑重叠、入口与资源检查未发现问题')}</div>`).join(''));
  document.querySelectorAll('[data-weather-icon]').forEach(el=>VillageClimate.icon(el,el.dataset.weatherIcon));
  document.querySelectorAll('[data-building-art]').forEach(el=>VillageMap.paintBuildingPortrait(el,state.buildings.find(b=>b.id===el.dataset.buildingArt)));
  if(view==='archive'){
    $('#panel').insertAdjacentHTML('afterbegin','<button class="outline full" data-go="workArchive">查阅已收获与封存的委托</button>');
    $('#panel').insertAdjacentHTML('beforeend','<p class="section-label">本机村庄</p><button class="outline full" id="quit-village">保存并退出村庄</button>');
    $('#quit-village').addEventListener('click',async()=>{try{await request('quit',{});exiting=true;document.dispatchEvent(new Event('village-service-stopped'));}catch(error){toast(error.message);}});
  }
  document.querySelectorAll('[data-portrait]').forEach(el=>{const r=state.residents.find(r=>r.id===el.dataset.portrait);const c=el.getContext('2d');c.imageSmoothingEnabled=false;c.clearRect(0,0,el.width,el.height);if(!VillageAvatars.draw(c,r.appearance,el.width/2,el.height-6,el.height-12)){c.save();c.translate(el.width/2,el.height-7);c.scale(2.4,2.4);person(c,0,0,r,0,0);c.restore();}});
  $('#question-form')?.addEventListener('submit',async event=>{event.preventDefault();const result=await mutate('meetings',{question:$('#question').value},'议题已放上议事桌');if(result)navigate('meeting',result.id);});
  $('#start-meeting')?.addEventListener('click',async()=>{const result=await mutate('meetings/start',{id:selected,participants:[...document.querySelectorAll('[name=participant]:checked')].map(e=>e.value)},'钟声响起，居民正在赶来');if(result)navigate('village');});
  $('#world-proposal-form')?.addEventListener('submit',async event=>{
    event.preventDefault();const data=new FormData(event.target),[kind,key,slot]=data.get('action').split(':'),proposal=kind==='expand'?{kind,region:key}:kind==='build'?{kind,building:key}:kind==='structure'?{kind,structure:key,slot:Number(slot)}:{kind,rule:key,value:Number(data.get('value'))};
    const result=await mutate('world/proposals',{proposal,reason:data.get('reason')},'提案已送上议事桌');if(result&&state.residents.filter(r=>r.connected).length>state.residents.length/2)await mutate('world/vote',{id:result.id},'开始独立表决');
  });
  if($('#world-proposal-form')){const form=$('#world-proposal-form'),choice=form.elements.action,value=form.elements.value,update=()=>{const [kind,key]=choice.value.split(':');value.closest('label').hidden=kind!=='rule';if(kind==='rule'){const limits={work_ticks:[12,40],harvest_amount:[2,8],rest_ticks:[2,12]}[key];value.min=limits[0];value.max=limits[1];value.value=state.world.rules[key];}};choice.addEventListener('change',update);update();}
  $('#audit-world')?.addEventListener('click',async()=>{try{const result=await request('world/audit',{});toast(result.issues.length?result.issues.join('；'):'当前新增建筑无重叠，入口通行检查通过');}catch(error){toast(error.message);}});
  $('#save-resident')?.addEventListener('click',()=>mutate('residents/update',{id:selected,task:$('#resident-job').value,appearance:$('#resident-appearance').value},'新的安排已保存'));
  $('#think')?.addEventListener('click',()=>mutate('plan',{id:selected},'TA 开始认真思考了'));
  $('#build')?.addEventListener('click',()=>mutate('buildings',{id:selected},'建设开始，居民会共同完成它'));
  $('#enter-building')?.addEventListener('click',()=>{const id=selected;if(id==='home')openInvite();else navigate(({hall:'meeting',granary:'granary',archive:'archive',farm:'farm',workshop:'forge'})[id]||'village');});
}
function openInvite(){if(!state)return;$('#create-provider').innerHTML=providerOptions('deepseek');$('#appearance-options').innerHTML=state.appearances.map((a,i)=>`<label class="appearance-choice"><input type="radio" name="appearance" value="${esc(a.id)}" ${i===0?'checked':''} required><span class="appearance-art"><canvas width="96" height="112" data-avatar="${esc(a.id)}" aria-hidden="true"></canvas><span>${esc(a.name)}</span></span></label>`).join('');VillageAvatars.paintChoices($('#resident-dialog'));$('#resident-dialog').showModal();}
function setText(selector,value){
  const el=$(selector);
  if(el.textContent!==value)el.textContent=value;
}
function mergeVillagePoll(previous, next){
  if(next.unchanged_archives){
    const {unchanged_archives,...snapshot}=next;
    for(const key of unchanged_archives)snapshot[key]=previous[key];
    return snapshot;
  }
  if(!next.partial)return next;
  const residents=new Map(previous.residents.map(r=>[r.id,r]));
  const {partial,...changed}=next;
  return {...previous,...changed,
    residents:next.residents.map(r=>({...residents.get(r.id),...r})),
    farm:{...previous.farm,...next.farm},world:{...previous.world,...next.world}};
}
function refresh(force=false){
  if(exiting)return Promise.resolve();
  // A click can commit while a pre-click poll is in flight. Fetch once more before reporting success.
  if(loading)return force ? loading.then(()=>refresh(true)) : loading;
  loading=readState(force).finally(()=>{loading=false;});
  return loading;
}
async function readState(force){
  try{
    const update=await request('state?since='+encodeURIComponent(state?.history_revision || ''));
    const next=mergeVillagePoll(state,update);
    if(next.map_version!=='painted-valley-v1')throw new Error('请重启本机村庄服务以载入新地图');
    const now=performance.now();
    for(const r of next.residents){const old=positions.get(r.id);if(!old||old.region!==(r.region||'village'))positions.set(r.id,{x:r.x,y:r.y,fromX:r.x,fromY:r.y,toX:r.x,toY:r.y,at:now,region:r.region||'village'});else if(old.toX!==r.x||old.toY!==r.y)Object.assign(old,{fromX:old.x,fromY:old.y,toX:r.x,toY:r.y,at:now});}
    if(state){
      for(const building of next.buildings){
        if(building.built&&!state.buildings.find(b=>b.id===building.id)?.built){const [x,y]=VillageMap.anchor(building);worldEffects.push({kind:'spark',x,y:y-20,start:now});}
      }
      if(next.resources.crops>state.resources.crops)worldEffects.push({kind:'spark',x:240,y:440,start:now});
    }
    if(tcg){
      const art=JSON.stringify([next.buildings,next.farm?.plots]);
      const pausedView=next.paused ? (next.history_revision ?? JSON.stringify([next.residents,next.meetings,next.world,next.ledger])) : '';
      if(!state || state.paused!==next.paused || art!==mapArt || pausedView!==pausedMap || force)wakeMap(true);
      mapArt=art;pausedMap=pausedView;
    }
    state=next;
    document.dispatchEvent(new Event('village-state-ready'));
    if(force)previousSignature='';
    setText('#clock',`第 ${Math.floor(state.clock/1440)+1} 天 ${String(Math.floor(state.clock%1440/60)).padStart(2,'0')}:${String(state.clock%60).padStart(2,'0')}`);
    for(const k of ['wood','stone','crops'])setText('#'+k,number(state.resources[k]));
    setText('#total-grain',number(state.residents.reduce((sum,r)=>sum+r.remaining,0)));
    const connected=state.residents.filter(r=>r.connected).length;
    setText('#connection',connected?`${connected} 位居民已配置模型`:'本地生活 · 模型待连接');
    const status=state.busy || (state.paused?'村庄时间已暂停':'本地生活模拟');
    if($('#simulation-status').textContent!==status){
      $('#simulation-status').innerHTML=VillageUI.icon(state.busy?'think':state.paused?'sleep':'happy',16,'status-icon')+esc(status);
      VillageUI.paintAll($('.world-status'));
    }
    setText('#autonomy','自主思考：'+(state.autonomy?'每 120 秒轮流':'关闭'));
    setText('#pause',state.paused?'▶':'Ⅱ');
    const pauseLabel=state.paused?'继续村庄':'暂停村庄';
    if($('#pause').getAttribute('aria-label')!==pauseLabel)$('#pause').setAttribute('aria-label',pauseLabel);
    renderPanel();
  }catch(error){$('#connection').textContent='村庄服务已离线';if(force)toast(error.message);}
}
$('#panel').addEventListener('click',event=>{const r=event.target.closest('[data-resident]'),b=event.target.closest('[data-building]'),m=event.target.closest('[data-meeting]'),g=event.target.closest('[data-go]');if(r)navigate('resident',r.dataset.resident);if(b)navigate('building',b.dataset.building);if(m)navigate('meeting',m.dataset.meeting);if(g)navigate(g.dataset.go);});
document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>navigate(b.dataset.view)));
$('#invite').addEventListener('click',openInvite);$('#close-dialog').addEventListener('click',()=>$('#resident-dialog').close());
VillageInteractions.bindMenu();
$('#close-panel').addEventListener('click',()=>navigate('village'));
$('#weather-badge').addEventListener('click',()=>state&&navigate('weather'));
$('#world-button').addEventListener('click',()=>navigate('world'));
$('#scene-back').addEventListener('click',()=>setScene('village'));
$('#hall-records').addEventListener('click',()=>navigate('meeting','history'));
$('#hall-new-topic').addEventListener('click',()=>navigate('meeting','new'));
$('#hall-world').addEventListener('click',()=>navigate('world'));
$('#hall-speech-layer').addEventListener('click',event=>{const el=event.target.closest('[data-speech]');if(el){speechResident=el.dataset.speech;navigate('speech');}});
$('#panel').addEventListener('click',event=>{
  const button=event.target.closest('button[data-scene],button[data-vote]');
  if(!button||!event.currentTarget.contains(button)||button.disabled)return;
  if(button.dataset.scene)setScene(button.dataset.scene);
  if(button.dataset.vote)mutate('world/vote',{id:button.dataset.vote},'开始独立表决');
});
function restoreScene(){
  const requested=new URL(location.href).searchParams.get('scene');
  const eastwoodOpen=requested==='eastwood'&&state?.world?.regions.some(r=>r.id==='eastwood');
  setScene(requested==='hall'||eastwoodOpen?requested:'village',false);
}
document.addEventListener('village-game-ready',()=>{
  restoreScene();
  window.addEventListener('popstate',restoreScene);
},{once:true});
$('#panel').addEventListener('click',event=>{const choice=event.target.closest('[data-weather]');if(!choice)return;climate.setMode(choice.dataset.weather);canvas.dataset.weatherSettled='false';previousSignature='';renderPanel();});
document.addEventListener('keydown',event=>{if(event.key==='Escape')navigate('village');});
document.addEventListener('village-art-ready',()=>VillageUI.paintAll());
document.addEventListener('village-avatars-ready',()=>{VillageAvatars.paintChoices();previousSignature='';renderPanel();});
$('#resident-form').addEventListener('submit',async event=>{event.preventDefault();const f=new FormData(event.target);const result=await mutate('residents',{name:f.get('name'),role:f.get('role'),provider:f.get('provider'),appearance:f.get('appearance'),nature:f.get('nature'),budget:Number(f.get('budget'))},'新邻居已经搬进来了');if(result){$('#resident-dialog').close();event.target.reset();navigate('resident',result.id);}});
$('#pause').addEventListener('click',()=>state&&mutate('control',{paused:!state.paused}));
$('#autonomy').addEventListener('click',()=>state&&mutate('autonomy',{enabled:!state.autonomy},state.autonomy?'自主思考已关闭':'每120秒轮流安排一位居民思考，服务重启后自动关闭'));

// Pixel renderer. Imported scenery/avatars/UI use their own atlases; code art is a loading fallback.
function rect(c,x,y,w,h,color){c.fillStyle=color;c.fillRect(Math.round(x),Math.round(y),w,h);}
function tree(c,x,y,scale=1){c.save();c.translate(x,y);c.scale(scale,scale);rect(c,-6,-10,14,25,'#7a6e49');rect(c,-4,-10,5,25,'#a18a57');rect(c,-23,-43,46,30,'#65844f');rect(c,-17,-59,35,23,'#65844f');rect(c,-29,-36,60,19,'#65844f');rect(c,-20,-45,39,26,'#7b995c');rect(c,-12,-56,24,21,'#90a969');rect(c,-27,-31,12,10,'#7e9959');rect(c,-9,-41,27,13,'#8ba466');rect(c,17,-28,12,9,'#789352');rect(c,-17,10,38,5,'#839f623f');c.restore();}
function shrub(c,x,y){rect(c,x-12,y-4,26,7,'#799753');rect(c,x-7,y-9,18,6,'#8fa464');rect(c,x-3,y-7,4,4,'#d2ad73');}
function person(c,x,y,r,walk=0,direction=0){
  if(VillageAvatars.draw(c,r.appearance,x,y,56))return;
  const sprite=assets['resident_'+r.id]||assets.resident_default;
  if(sprite){const row=[0,2,3,1][direction]||0;c.drawImage(sprite,(walk?Math.floor(walk)%4:0)*32,row*48,32,48,Math.round(x)-16,Math.round(y)-44,32,48);return;}
  const bob=walk?Math.floor(walk)%2:0;
  rect(c,x-9,y-2,18,4,'#52674230');rect(c,x-5,y-5,4,5,'#554e3b');rect(c,x+2,y-5+bob,4,5-bob,'#554e3b');rect(c,x-7,y-19+bob,15,15,r.color);rect(c,x-9,y-17+bob,3,9,'#e2b88c');rect(c,x+8,y-17+bob,3,9,'#e2b88c');rect(c,x-6,y-32+bob,13,14,'#e6bd90');rect(c,x-8,y-33+bob,17,7,'#5b5242');rect(c,x-8,y-29+bob,4,9,'#5b5242');rect(c,x+6,y-29+bob,3,6,'#5b5242');if(direction!==2){rect(c,x-2,y-25+bob,2,2,'#454334');rect(c,x+4,y-25+bob,2,2,'#454334');}rect(c,x-5,y-18+bob,11,3,'#e3d3a7');if(r.role==='园丁'){rect(c,x-11,y-31+bob,24,3,'#b89957');rect(c,x-6,y-37+bob,14,7,'#c7ad6a');}if(r.role==='学者'){rect(c,x+7,y-12,7,9,'#d9d4b5');rect(c,x+8,y-10,4,1,'#89957d');}
}
function roof(c,x,y,w,kind){const color=kind==='hall'?'#806c53':kind==='granary'?'#a18357':'#9c6f50';for(let k=0;k<7;k++){const left=x+8-k*4,top=y+k*6;rect(c,left,top,w-16+k*8,7,color);rect(c,left,top,w-16+k*8,2,kind==='hall'?'#9b8560':'#b68d61');for(let q=left+9+(k%2)*7;q<left+w-12+k*8;q+=20)rect(c,q,top+2,1,4,'#594e3e44');}rect(c,x-18,y+42,w+36,5,'#665e46');}
function building(c,b,time){
  if(VillageMap.building(c,b,state,time))return;
  const x=b.x*32, bottom=(b.y+b.h)*32, w=b.w*32;
  const sprite=assets[b.kind];
  if(!b.built&&!b.constructing){c.strokeStyle='#8b9c69';c.setLineDash([5,5]);c.strokeRect(x+5,b.y*32+6,w-10,b.h*32-12);c.setLineDash([]);rect(c,x+w/2-2,bottom-44,4,34,'#9e8758');rect(c,x+w/2-22,bottom-48,44,23,'#d8c591');c.fillStyle='#7f7b50';c.font='10px Microsoft YaHei';c.textAlign='center';c.fillText(b.name,x+w/2,bottom-33);return;}
  if(b.kind==='farm'){rect(c,x-4,bottom-94,w+8,92,'#8b7852');for(let j=0;j<3;j++)for(let i=0;i<4;i++){rect(c,x+i*32+3,bottom-88+j*27,26,20,'#ac8e5b');rect(c,x+i*32+9,bottom-83+j*27,13,12,'#7d9850');rect(c,x+i*32+14,bottom-88+j*27,4,18,'#a0b368');}if(b.constructing)VillageUI.effect(c,'dust',performance.now(),x+w/2,bottom+6,52,32);return;}
  if(sprite&&b.built){const spec=manifest[b.kind];c.drawImage(sprite,x+w/2-spec.anchor[0],bottom-spec.anchor[1]);return;}
  c.save();if(b.constructing)c.globalAlpha=.65;
  rect(c,x-6,bottom-4,w+16,13,'#718b4d35');
  const height=b.kind==='hall'?96:75, wall=bottom-height;
  rect(c,x,wall,w,height,'#d9c791');rect(c,x+w-15,wall,15,height,'#b8ac7e');rect(c,x,wall,7,height,'#a48d60');rect(c,x+6,bottom-12,w-13,12,'#b7a575');
  for(let y=wall+11;y<bottom-16;y+=17){rect(c,x+9,y,w-29,1,'#b9ab7b55');}
  const door=x+w/2-12;rect(c,door,bottom-42,25,42,'#796b48');rect(c,door+3,bottom-39,17,39,'#a88a57');rect(c,door+13,bottom-22,3,3,'#dec997');rect(c,door-6,bottom-2,37,6,'#c7b68b');
  for(const wx of [x+16,x+w-42]){rect(c,wx,wall+23,24,25,'#8e7e54');rect(c,wx+3,wall+26,18,18,'#728b82');rect(c,wx+11,wall+25,2,20,'#d4c38c');rect(c,wx+2,wall+34,20,2,'#d4c38c');rect(c,wx-2,wall+48,28,3,'#9c8b5c');}
  roof(c,x-1,wall-40,w+2,b.kind);
  if(b.kind==='hall'){rect(c,x+w/2-3,wall-67,6,28,'#796844');rect(c,x+w/2+3,wall-66,25,16,'#728451');rect(c,x+w/2+20,wall-60,8,10,'#728451');rect(c,x+w/2-18,wall+1,37,18,'#d4bb78');c.font='11px Microsoft YaHei';c.fillStyle='#6a6745';c.textAlign='center';c.fillText('议事厅',x+w/2,wall+14);}
  if(b.kind==='granary'){rect(c,x+13,bottom-24,13,22,'#ad8b51');rect(c,x+9,bottom-18,21,12,'#bc9e62');rect(c,x+w-22,wall-70,10,31,'#857854');rect(c,x+w-25,wall-73,16,6,'#a69465');}
  if(b.kind==='workshop'){rect(c,x+13,bottom+1,29,6,'#997b50');rect(c,x+16,bottom-12,5,13,'#7d6947');rect(c,x+36,bottom-12,5,13,'#7d6947');rect(c,x+11,bottom-15,33,5,'#bc9965');}
  c.restore();
  if(b.constructing){rect(c,x-7,wall-9,4,height+18,'#b8a16c');rect(c,x+w+4,wall-9,4,height+18,'#b8a16c');rect(c,x-7,wall+height/2,w+15,4,'#b8a16c');rect(c,x,bottom+8,w,4,'#849563');rect(c,x,bottom+8,Math.floor(w*b.progress/45),4,'#eee4ac');VillageUI.effect(c,'dust',performance.now(),x+w/2,bottom+6,52,32);}
}
function baseMap(c){
  if(VillageMap.ground(c))return;
  rect(c,0,0,960,640,'#a9bd83');
  for(let y=0;y<20;y++)for(let x=0;x<30;x++){const n=(x*47+y*37)%23;if(n<7){rect(c,x*32+5+n,y*32+12,3,2,'#95af71');rect(c,x*32+8+n,y*32+9,2,3,'#95af71');}if(n===12){rect(c,x*32+14,y*32+20,2,2,'#d6d29b');rect(c,x*32+18,y*32+23,2,2,'#eee2b2');}}
  const road=(x,y,w,h)=>{rect(c,x*32-3,y*32-3,w*32+6,h*32+6,'#b8bd8b');rect(c,x*32,y*32,w*32,h*32,'#d7c69b');for(let k=0;k<w*3;k++){rect(c,x*32+(k*29)%(w*32),y*32+(k*19)%(h*32),6,2,'#bcae8544');}};
  road(3,9,25,1);road(13,7,3,2);road(14,9,1,9);road(5,8,1,1);road(23,8,1,1);road(8,15,6,1);road(15,15,10,1);
  // Pond, banks, reeds, and a small wooden bridge.
  rect(c,16,514,176,118,'#90a974');rect(c,24,525,160,112,'#8dada1');rect(c,36,518,135,115,'#8dada1');rect(c,45,537,115,96,'#9dbbaf');for(let i=0;i<7;i++)rect(c,48+i*17,548+(i%3)*22,24,2,'#c2cfc0');for(let i=0;i<9;i++)rect(c,174,528+i*11,38,8,'#b89b68');rect(c,175,528,3,99,'#897850');rect(c,207,528,3,99,'#897850');
  for(const p of [[20,516],[164,519],[34,614],[164,617]]){rect(c,p[0],p[1]-13,3,22,'#7e915d');rect(c,p[0]+5,p[1]-18,3,26,'#81935b');rect(c,p[0]+4,p[1]-20,5,7,'#ad9e66');}
  // Forester's logs and quarry.
  for(let i=0;i<3;i++){rect(c,62+i*15,437,13,12,'#a78a59');rect(c,62+i*15,437,13,3,'#c5a675');rect(c,66+i*15,440,5,7,'#7d6e48');}
  for(const p of [[842,446,21,12],[868,456,18,15],[827,464,27,15]]){rect(c,p[0],p[1],p[2],p[3],'#9a9f88');rect(c,p[0]+3,p[1]-4,p[2]-7,7,'#c0c1a2');}
  // Fences, lamp, flowers, seating, and village square.
  const fence=(x,y,n)=>{rect(c,x,y+4,n*17,3,'#ab9766');for(let i=0;i<=n;i++){rect(c,x+i*17,y,3,19,'#beaa7b');rect(c,x+i*17,y-2,3,2,'#d9c497');}};
  fence(103,260,6);fence(681,277,9);fence(258,523,8);fence(681,518,7);
  rect(c,593,291,3,39,'#7c7752');rect(c,587,283,15,14,'#807c54');rect(c,590,286,9,9,'#e2ca82');rect(c,585,280,19,4,'#a09665');
  rect(c,326,282,36,9,'#aa8e60');rect(c,330,291,4,11,'#8d7854');rect(c,354,291,4,11,'#8d7854');
  for(let i=0;i<8;i++){const x=613+(i*17)%62,y=190+Math.floor(i/4)*22;rect(c,x,y,3,11,'#789759');rect(c,x-2,y-2,7,5,i%2?'#d9c17e':'#c39276');}
  for(const p of [[233,346],[598,387],[805,343],[385,543],[77,347]])shrub(c,...p);
  for(let i=0;i<17;i++)tree(c,12+i*59,54+(i%3)*9,.9);
  for(const p of [[36,158],[72,203],[25,284],[50,380],[910,164],[938,227],[922,348],[937,489]])tree(c,...p,1);
}
const launchCover=document.querySelector('#launch-cover');
const background=document.createElement('canvas');background.width=960;background.height=640;
if(!tcg || !launchCover?.isConnected || VillageMap.version)baseMap(background.getContext('2d'));
document.addEventListener('village-map-ready',()=>{
  if(!tcg || VillageMap.version){
    baseMap(background.getContext('2d'));
    plateKey='';
  }
});
let lastFrame=0,visualTime=0;
const worldCamera=VillageCamera.create(),camera={scale:1,x:0,y:0};
const mapPointers=new Map();
let mapDrag=null,ignoreMapClick=false;
function cameraViewport(){worldCamera.resize(canvas.clientWidth,canvas.clientHeight);}
function zoomMap(factor,x,y){cameraViewport();worldCamera.zoomAt(factor,x,y,tcg);wakeMap();}
$('#zoom-in').addEventListener('click',()=>zoomMap(1.25));
$('#zoom-out').addEventListener('click',()=>zoomMap(.8));
$('#zoom-reset').addEventListener('click',()=>{cameraViewport();worldCamera.reset(tcg);wakeMap();});
canvas.addEventListener('wheel',event=>{event.preventDefault();const box=canvas.getBoundingClientRect();zoomMap(Math.exp(-Math.max(-120,Math.min(120,event.deltaY))*.0018),event.clientX-box.left,event.clientY-box.top);},{passive:false});
function pointerPoint(event){const box=canvas.getBoundingClientRect();return{x:event.clientX-box.left,y:event.clientY-box.top};}
function pinch(points){const [a,b]=points;return{mid:{x:(a.x+b.x)/2,y:(a.y+b.y)/2},distance:Math.hypot(a.x-b.x,a.y-b.y)};}
canvas.addEventListener('pointerdown',event=>{
  if(event.button!==0)return;
  cameraViewport();canvas.focus({preventScroll:true});
  if(!mapPointers.size)ignoreMapClick=false;
  const p=pointerPoint(event);mapPointers.set(event.pointerId,p);
  mapDrag={start:p,last:p};if(mapPointers.size>1)ignoreMapClick=true;
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove',event=>{
  if(!mapPointers.has(event.pointerId))return;
  const before=[...mapPointers.values()],p=pointerPoint(event);mapPointers.set(event.pointerId,p);
  if(mapPointers.size>1){
    const a=pinch(before),b=pinch([...mapPointers.values()]);
    if(a.distance>0)worldCamera.gesture(a.mid,b.mid,b.distance/a.distance);
    ignoreMapClick=true;
  }else if(mapDrag){
    if(Math.hypot(p.x-mapDrag.start.x,p.y-mapDrag.start.y)>5)ignoreMapClick=true;
    if(ignoreMapClick)worldCamera.panBy(p.x-mapDrag.last.x,p.y-mapDrag.last.y);
    mapDrag.last=p;
  }
  if(ignoreMapClick){canvas.style.cursor='grabbing';$('#map-tooltip').hidden=true;wakeMap();}
});
function releaseMapPointer(event){
  mapPointers.delete(event.pointerId);const next=mapPointers.values().next().value;
  mapDrag=next?{start:next,last:next}:null;
  if(!next)canvas.style.cursor=VillageUI.cursor('default');
}
canvas.addEventListener('pointerup',releaseMapPointer);
canvas.addEventListener('pointercancel',event=>{releaseMapPointer(event);ignoreMapClick=true;});
canvas.addEventListener('lostpointercapture',releaseMapPointer);
canvas.addEventListener('keydown',event=>{
  const moves={ArrowLeft:[70,0],ArrowRight:[-70,0],ArrowUp:[0,70],ArrowDown:[0,-70]};
  if(moves[event.key]){event.preventDefault();worldCamera.panBy(...moves[event.key]);wakeMap();}
  else if(event.key==='Home'){event.preventDefault();worldCamera.reset(tcg);wakeMap();}
});
const namePlaques=new Map();
function plaqueWidth(c,r){
  const last=namePlaques.get(r.id);
  if(last?.name===r.name)return last.width;
  c.font='10px Microsoft YaHei';
  const width=Math.max(38,Math.ceil(c.measureText(r.name).width)+8);
  namePlaques.set(r.id,{name:r.name,width});
  return width;
}
let lastLedger,callingResidents=new Set();
function residentEmote(r){
  if(lastLedger!==state.ledger){
    lastLedger=state.ledger;callingResidents=new Set();
    for(const entry of lastLedger)if(entry.status==='reserved')callingResidents.add(entry.resident_id);
  }
  return r.meeting?'discussion':callingResidents.has(r.id)?'think':r.remaining===0?'hungry':null;
}
function drawVillager(c,e,now){
  const {r,p}=e,x=Math.round((p.x+.5)*32),y=Math.round((p.y+1)*32);
  const walking=Math.abs(p.x-p.toX)+Math.abs(p.y-p.toY)>.05;
  const direction=p.toX>p.fromX?1:p.toX<p.fromX?3:p.toY<p.fromY?2:0;
  if(selected===r.id)VillageUI.effect(c,'selection',now,x,y+5,34,16);
  const phase=visualTime/1000+(parseInt(r.id.slice(0,3),16)||0);
  c.save();c.fillStyle='#34472532';c.beginPath();c.ellipse(x,y+1,10,3,0,0,Math.PI*2);c.fill();
  if(walking){c.globalAlpha=.23;for(let i=0;i<3;i++){const q=(phase*3+i/3)%1;c.fillStyle='#d8c090';c.fillRect(x-5+i*4,y+2+q*5,2,2);}}
  c.restore();
  c.save();c.translate(x,y);c.rotate(walking?Math.sin(phase*11)*.018:Math.sin(phase*2)*.004);
  const bounce=walking?Math.abs(Math.sin(phase*11))*2:Math.sin(phase*2)*.6;
  person(c,0,-bounce,r,walking?now/100:0,direction);c.restore();
  if(r.cargo)VillageUI.renderIcon(c,r.cargo.kind,x+8,y-34,17,17);
  if(!walking&&r.phase==='work'&&r.progress>0&&!r.meeting){c.save();c.globalAlpha=.35;for(let i=0;i<2;i++){const p=(phase*2+i*.5)%1;c.fillStyle=r.task==='stone'?'#c4c2a1':'#dbc493';c.fillRect(x-8+i*13,y-5-p*8,2,2);}c.restore();}
  c.font='10px Microsoft YaHei';c.textAlign='center';
  const plaque=plaqueWidth(c,r);
  c.fillStyle='#fcf9e8dc';c.fillRect(x-plaque/2,y-73,plaque,15);c.fillStyle='#526347';c.fillText(r.name,x,y-62);
  const emote=residentEmote(r);
  if(emote)VillageUI.renderIcon(c,emote,x+8,y-98,24,24);
}
const frameInterval = tcg ? 125 : 50;
let mapArt='', pausedMap='', repaintAll=true, timer=0, frameRequest=0;
let scenePlate=null, projectedPlate=null, plateKey='', lastActorRects=[], lastMapPose='';
let projectionStale=true;
let paintedShowers=false;
let lastDiagnostic=-Infinity,lastExportedPose='';
function backingViewport(width,height,compact){
  const scale=compact ? Math.min(1,960/width,640/height) : 1;
  return {width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale))};
}
function wakeMap(invalidate=false){
  if(!tcg)return;
  if(invalidate)repaintAll=true;
  if(timer){clearTimeout(timer);timer=0;}
  if(!document.hidden&&!mapCovered()&&!frameRequest)frameRequest=requestAnimationFrame(draw);
}
function mapCovered(){
  return !$('#game-window').hidden || $('#resident-dialog').open ||
    (launchCover?.isConnected && document.documentElement.dataset.gameReady!=='true');
}
function nextMapFrame(){
  if(!document.hidden && !mapCovered() && state && (!state.paused || worldCamera.moving())){
    timer=setTimeout(()=>{timer=0;wakeMap();},frameInterval);
  }
}
function actorRect(r,p){
  const x=Math.round((p.x+.5)*32),y=Math.round((p.y+1)*32);
  const emote=residentEmote(r);
  const half=Math.max(25,Math.ceil(plaqueWidth(ctx,r)/2)+2);
  const right=emote?Math.max(half,34):half,top=emote?100:75;
  return [x-half,y-top,half+right,top+10];
}
// Keep the previous positions too so moving or departing residents erase their footprints.
function dirtyAreas(current,previous){
  const areas=[];
  for(const rect of [...current,...previous]){
    let [x,y,w,h]=rect;
    for(let i=areas.length-1;i>=0;i--){
      const [ax,ay,aw,ah]=areas[i];
      if(x+w<ax||ax+aw<x||y+h<ay||ay+ah<y)continue;
      // Distant diagonal marks remain separate instead of copying the empty space between them.
      const left=Math.min(x,ax),top=Math.min(y,ay),right=Math.max(x+w,ax+aw),bottom=Math.max(y+h,ay+ah);
      if((right-left)*(bottom-top)>w*h+aw*ah)continue;
      areas.splice(i,1);x=left;y=top;w=right-left;h=bottom-top;
    }
    const sx=Math.max(0,x),sy=Math.max(0,y),ex=Math.min(960,x+w),ey=Math.min(640,y+h);
    if(ex>sx && ey>sy)areas.push([sx,sy,ex-sx,ey-sy]);
  }
  return areas;
}
const showers=[[185,235,150,90],[420,350,150,90],[677,270,150,90]];
function drawShowers(c,time,weather){
  c.save();c.strokeStyle='#dfeced';c.globalAlpha=.45*weather.rain;c.lineWidth=1;c.beginPath();
  for(const [x,y,w,h] of showers)for(let i=0;i<10;i++){
    const t=(time/(660+i*27)+i*.263)%1;
    const px=x+10+(i*37)%(w-44)+t*20*weather.wind,py=y+9+t*(h-11);
    c.moveTo(px,py);c.lineTo(px-4*weather.wind,py-7);
  }
  c.stroke();c.restore();
}
function paintFastVillage(now,sky,pose,scaleX,scaleY){
  if(!scenePlate){
    scenePlate=document.createElement('canvas');scenePlate.width=960;scenePlate.height=640;
  }
  const key=[Math.floor(state.clock/30),sky.id,Math.round(sky.cloud*6),Math.round(sky.fog*4),Math.round(sky.rain*6)].join('/');
  const full=repaintAll||pose!==lastMapPose||key!==plateKey;
  // A viewport repaint can reuse the world-space plate while its art and lighting match.
  if(key!==plateKey){
    const plate=scenePlate.getContext('2d');
    plate.drawImage(background,0,0);
    climate.ground(plate,visualTime,sky);
    VillageMap.lighting(plate,visualTime,state,{x:0,y:0,scale:1},960,640);
    climate.screen(plate,visualTime,sky,{x:0,y:0,scale:1},960,640,state.clock,false);
    plateKey=key;
  }
  const sx=camera.scale*scaleX,sy=camera.scale*scaleY;
  const tx=camera.x*scaleX,ty=camera.y*scaleY;
  const visible=([x,y,w,h])=>tx+(x+w)*sx>=0 && ty+(y+h)*sy>=0 && tx+x*sx<canvas.width && ty+y*sy<canvas.height;
  const entities=[], current=[];
  for(const r of state.residents){
    if((r.region||'village')!=='village')continue;
    const p=positions.get(r.id),t=Math.max(0,Math.min(1,(now-p.at)/550));
    p.x=p.fromX+(p.toX-p.fromX)*t;p.y=p.fromY+(p.toY-p.fromY)*t;
    const area=actorRect(r,p);
    if(visible(area)){current.push(area);entities.push({r,p,y:(p.y+1)*32});}
  }
  for(const fx of worldEffects)current.push([Math.floor(fx.x)-28,Math.floor(fx.y)-38,56,55]);
  // Restore the insects' old and new wings, including the frame when they disappear.
  const wings=VillageMap.butterflies(visualTime,state,sky);
  for(const {x,y} of wings)current.push([Math.floor(x)-4,Math.floor(y)-1,10,5]);
  const areas=dirtyAreas(current,lastActorRects).concat([[111,87,58,75],[391,106,30,31],[510,106,31,31],[601,208,60,61]]);
  if(sky.rain>.025 || paintedShowers)areas.push(...showers);
  paintedShowers=sky.rain>.025;
  if(state.farm?.plots.some(p=>p.crop))areas.push([126,318,141,102]);
  for(const b of state.buildings)if(b.constructing){
    const [x,y]=VillageMap.anchor(b);areas.push([x-65,y-50,130,67]);
  }
  for(const b of state.buildings){
    const bounds=VillageMap.overlayBounds(b,state);
    const drawBuilding=bounds && visible(bounds) && (full || areas.some(([x,y,w,h])=>
      x<=bounds[0]+bounds[2] && y<=bounds[1]+bounds[3] && x+w>=bounds[0] && y+h>=bounds[1]));
    if(drawBuilding || selected===b.id)entities.push({b,drawBuilding,y:VillageMap.anchor(b)[1]});
  }
  lastActorRects=current;lastMapPose=pose;repaintAll=false;
  // Present a camera change immediately. The first partial redraw projects a
  // backing bitmap so later repairs can copy exact, integral screen pixels.
  if(full)projectionStale=true;
  else if(projectionStale){
    if(!projectedPlate)projectedPlate=document.createElement('canvas');
    if(projectedPlate.width!==canvas.width)projectedPlate.width=canvas.width;
    if(projectedPlate.height!==canvas.height)projectedPlate.height=canvas.height;
    const projected=projectedPlate.getContext('2d');
    projected.imageSmoothingEnabled=false;projected.setTransform(sx,0,0,sy,tx,ty);
    projected.drawImage(scenePlate,0,0);
    projectionStale=false;
  }
  ctx.save();
  ctx.setTransform(1,0,0,1,0,0);
  if(full){
    ctx.save();ctx.setTransform(sx,0,0,sy,tx,ty);ctx.drawImage(scenePlate,0,0);ctx.restore();
  }else{
    ctx.beginPath();
    for(const [x,y,w,h] of areas){
      const left=Math.max(0,Math.floor(tx+x*sx)),top=Math.max(0,Math.floor(ty+y*sy));
      const width=Math.min(canvas.width,Math.ceil(tx+(x+w)*sx))-left;
      const height=Math.min(canvas.height,Math.ceil(ty+(y+h)*sy))-top;
      if(width<=0||height<=0)continue;
      ctx.rect(left,top,width,height);
    }
    ctx.clip();
    // The existing clip also limits the screen-aligned background restoration.
    ctx.drawImage(projectedPlate,0,0);
  }
  ctx.setTransform(sx,0,0,sy,tx,ty);
  if(visible([111,87,58,75]))VillageProps.draw(ctx,visualTime);
  VillageProps.rooftops(ctx,visualTime,sky,8,visible);
  entities.sort((a,b)=>a.y-b.y || Number(!!b.b)-Number(!!a.b));
  for(const entity of entities){
    if(entity.b){if(entity.drawBuilding)building(ctx,entity.b,visualTime);if(selected===entity.b.id)VillageMap.selection(ctx,entity.b,visualTime);}
    else drawVillager(ctx,entity,now);
  }
  for(let i=worldEffects.length-1;i>=0;i--){
    const fx=worldEffects[i];
    if(now-fx.start>700)worldEffects.splice(i,1);
    else VillageUI.effect(ctx,fx.kind,now-fx.start,fx.x,fx.y,44,36);
  }
  VillageMap.atmosphere(ctx,visualTime,state,sky,wings);
  if(sky.rain>.025)drawShowers(ctx,visualTime,sky);
  ctx.restore();
}
function draw(now){
  frameRequest=0;
  if(!tcg)requestAnimationFrame(draw);
  if(document.hidden || (tcg ? !state||mapCovered() : now-lastFrame<frameInterval))return;
  if(tcg)nextMapFrame();
  const elapsed=lastFrame?now-lastFrame:frameInterval;lastFrame=now;if(!state?.paused)visualTime+=Math.min(Math.max(100,frameInterval),elapsed);
  const diagnostics=!tcg||now-lastDiagnostic>=500;
  if(diagnostics){lastDiagnostic=now;canvas.dataset.motionTick=String(Math.floor(visualTime/100));}
  const width=Math.max(1,Math.round(canvas.clientWidth)),height=Math.max(1,Math.round(canvas.clientHeight));
  const backing=backingViewport(width,height,tcg);
  if(canvas.width!==backing.width||canvas.height!==backing.height){
    canvas.width=backing.width;canvas.height=backing.height;
    repaintAll=true;
  }
  const scaleX=backing.width/width,scaleY=backing.height/height;
  worldCamera.resize(width,height);Object.assign(camera,worldCamera.step(elapsed));
  VillageInteractions.positionMenu();
  if($('#zoom-out').disabled===camera.canZoomOut)$('#zoom-out').disabled=!camera.canZoomOut;
  if($('#zoom-in').disabled===camera.canZoomIn)$('#zoom-in').disabled=!camera.canZoomIn;
  const pose=[camera.x,camera.y,camera.scale,width,height].join('/');
  if(pose!==lastExportedPose){
    lastExportedPose=pose;
    canvas.dataset.cameraView=JSON.stringify({x:camera.x,y:camera.y,scale:camera.scale,width,height,worldWidth:960,worldHeight:640,zoom:camera.zoom});
  }
  const sky=climate.advance(state?.clock??480,visualTime);paintWeather(sky);
  ctx.imageSmoothingEnabled=false;
  if(diagnostics && scene==='village')canvas.dataset.waterwheelAngle=String(VillageProps.frameAt(visualTime).angle);
  if(tcg && scene==='village'){paintFastVillage(now,sky,pose,scaleX,scaleY);return;}
  if(tcg)ctx.setTransform(scaleX,0,0,scaleY,0,0);
  rect(ctx,0,0,width,height,'#a9bd83');
  if(state&&scene==='hall'){
    ctx.save();ctx.translate(camera.x,camera.y);ctx.scale(camera.scale,camera.scale);VillageScenes.drawHall(ctx,state,visualTime);ctx.restore();drawRoomBubbles();return;
  }
  if(state&&scene==='eastwood'){
    ctx.save();ctx.translate(camera.x,camera.y);ctx.scale(camera.scale,camera.scale);
    VillageScenes.drawRegion(ctx,state,visualTime,r=>{const p=positions.get(r.id);const t=Math.min(1,(now-p.at)/550);p.x=p.fromX+(p.toX-p.fromX)*t;p.y=p.fromY+(p.toY-p.fromY)*t;drawVillager(ctx,{r,p},now);});ctx.restore();climate.screen(ctx,visualTime,sky,camera,width,height,state.clock);return;
  }
  ctx.save();ctx.translate(camera.x,camera.y);ctx.scale(camera.scale,camera.scale);ctx.drawImage(background,0,0);
  VillageMap.groundMotion(ctx,visualTime,sky);climate.ground(ctx,visualTime,sky);
  VillageProps.draw(ctx,visualTime);VillageProps.rooftops(ctx,visualTime,sky);
  if(!state){ctx.restore();return;}
  const entities=state.buildings.map(b=>({type:'building',y:VillageMap.anchor(b)[1],b}));
  entities.push(...VillageMap.scenery());
  for(const r of state.residents.filter(r=>(r.region||'village')==='village')){const p=positions.get(r.id);const t=Math.min(1,(now-p.at)/550);p.x=p.fromX+(p.toX-p.fromX)*t;p.y=p.fromY+(p.toY-p.fromY)*t;entities.push({type:'person',y:(p.y+1)*32,r,p});}
  entities.sort((a,b)=>a.y-b.y);
  for(const e of entities){
    if(e.type==='building'){
      building(ctx,e.b,visualTime);
      if(selected===e.b.id)VillageMap.selection(ctx,e.b,now);
    }else if(e.type==='scenery')VillageMap.drawScenery(ctx,e,visualTime);
    else drawVillager(ctx,e,now);
  }
  for(let i=worldEffects.length-1;i>=0;i--){const effect=worldEffects[i];if(now-effect.start>700)worldEffects.splice(i,1);else VillageUI.effect(ctx,effect.kind,now-effect.start,effect.x,effect.y,44,36);}
  VillageMap.atmosphere(ctx,visualTime,state,sky);
  ctx.restore();
  VillageMap.lighting(ctx,visualTime,state,camera,width,height);
  climate.screen(ctx,visualTime,sky,camera,width,height,state.clock);
}
function canvasPoint(event){const box=canvas.getBoundingClientRect();return{x:(event.clientX-box.left-camera.x)/camera.scale,y:(event.clientY-box.top-camera.y)/camera.scale};}
function hit(point){if(!state)return null;if(scene==='hall'){const r=VillageScenes.hitSeat(point,state);if(r){speechResident=r.id;return{view:'speech',id:r.id,name:r.name};}return null;}if(scene==='eastwood'){for(const r of state.residents.filter(r=>r.region==='eastwood')){const p=positions.get(r.id);if(Math.abs(point.x-(p.x+.5)*32)<23&&point.y>(p.y+1)*32-60&&point.y<(p.y+1)*32+5)return{view:'resident',id:r.id,name:r.name};}return state.world.structures.some(s=>point.x>=s.rect[0]&&point.x<=s.rect[0]+s.rect[2]&&point.y>=s.rect[1]&&point.y<=s.rect[1]+s.rect[3])?{view:'world',id:null,name:'东林建设'}:null;}for(const r of [...state.residents].filter(r=>(r.region||'village')==='village').reverse()){const p=positions.get(r.id);if(Math.abs(point.x-(p.x+.5)*32)<23&&point.y>(p.y+1)*32-60&&point.y<(p.y+1)*32+5)return{view:'resident',id:r.id,name:r.name};}const plot=state.farm?VillageMap.plotAt(point):-1;if(plot>=0)return{view:'farm',id:plot,name:(plot+1)+' 号田'};for(const b of [...state.buildings].reverse()){if(b.id==='farm'&&b.built&&VillageMap.hitBuilding(point,b))return{view:'farm',id:null,name:b.name};if(VillageMap.hitBuilding(point,b))return{view:'building',id:b.id,name:b.name};}return VillageMap.hit(point);}
canvas.addEventListener('click',event=>{if(ignoreMapClick){ignoreMapClick=false;return;}const target=hit(canvasPoint(event));if(target?.view==='resident'||(scene==='hall'&&target?.view==='speech'))VillageInteractions.openMenu(target.id);else if(target?.view==='building'&&target.id==='hall')setScene('hall');else if(target)navigate(target.view,target.id);else navigate('village');});
canvas.addEventListener('mousemove',event=>{if(mapPointers.size){$('#map-tooltip').hidden=true;return;}const target=hit(canvasPoint(event));$('#map-tooltip').hidden=!target;if(target)$('#map-tooltip').textContent=target.name+' ↗';const plot=target?.view==='building'&&!state.buildings.find(b=>b.id===target.id)?.built;canvas.style.cursor=VillageUI.cursor(plot?'target':target?'hand':'default');});canvas.addEventListener('mouseleave',()=>{$('#map-tooltip').hidden=true;canvas.style.cursor=VillageUI.cursor('default');});
if(tcg){
  for(const event of ['village-map-ready','village-game-ready','village-scene-ready','village-art-ready','village-avatars-ready']){
    document.addEventListener(event,()=>wakeMap(true));
  }
  window.addEventListener('resize',()=>wakeMap(true));
  $('#resident-dialog').addEventListener('close',()=>wakeMap());
}
refresh();setInterval(()=>{if(!document.hidden)refresh();},1000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden){refresh();wakeMap(true);}});
if(tcg)wakeMap(true);else requestAnimationFrame(draw);
