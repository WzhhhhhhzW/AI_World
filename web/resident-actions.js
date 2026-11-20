'use strict';

const VillageInteractions=(()=>{
  let menuResident=null;
  const drafts=new Map();
  const restartHint='请在「设置」中保存并退出村庄，再双击「启动游戏.cmd」加载新版。';

  function closeMenu(){
    menuResident=null;
    $('#resident-actions').hidden=true;
  }
  function positionMenu(){
    if(!menuResident)return;
    const r=state.residents.find(r=>r.id===menuResident);
    const p=positions.get(menuResident);
    if(!r||!p||(scene!=='hall'&&(r.region||'village')!==scene)){closeMenu();return;}
    const [x,y]=scene==='hall'?VillageScenes.seats[state.residents.indexOf(r)]:[(p.x+.5)*32,(p.y+1)*32];
    const box=canvas.getBoundingClientRect(), menu=$('#resident-actions');
    const cx=box.left+camera.x+x*camera.scale,feet=box.top+camera.y+y*camera.scale;
    if(cx<box.left||cx>box.right||feet<box.top||feet>box.bottom){closeMenu();return;}
    const top=feet-74*camera.scale-menu.offsetHeight;
    menu.style.left=Math.max(6,Math.min(window.innerWidth-menu.offsetWidth-6,cx-menu.offsetWidth/2))+'px';
    menu.style.top=Math.max(6,Math.min(window.innerHeight-menu.offsetHeight-6,top>=6?top:feet+7))+'px';
  }
  function openMenu(rid){
    navigate('village');
    menuResident=rid;
    const menu=$('#resident-actions');
    const items=[['residentChat','discussion','对话'],['wardrobe','invite','换装'],['resident','settings','设置']];
    menu.innerHTML=items.map(([action,icon,label])=>`<button type="button" data-action="${action}">${VillageUI.icon(icon,21)}<span>${label}</span></button>`).join('');
    menu.hidden=false;
    VillageUI.paintAll(menu);positionMenu();
    menu.querySelector('button')?.focus({preventScroll:true});
  }
  function bindMenu(){
    const menu=$('#resident-actions');
    menu.addEventListener('click',e=>{
      const button=e.target.closest('button[data-action]');
      if(button&&menuResident)navigate(button.dataset.action,menuResident);
    });
    document.addEventListener('pointerdown',e=>{if(menuResident&&!menu.contains(e.target))closeMenu();});
  }

  function identityEditor(r){
    return `<div class="resident-name-line"><h3 class="detail-name">${esc(r.name)}</h3><button type="button" class="outline" id="edit-name">改名</button></div>
      <form id="rename-form" data-owner="${esc(r.id)}" hidden><label>名字<input name="name" required autocomplete="off"></label>
        <label>身份<input name="role" list="village-roles" required autocomplete="off" placeholder="选择或填写身份，例如：钟表师"></label>
        <datalist id="village-roles">${[...$('#resident-form').elements.role.options].map(option=>`<option value="${esc(option.value)}"></option>`).join('')}</datalist>
        <div class="detail-actions"><button class="primary" type="submit">保存资料</button><button class="outline" type="button" data-cancel>取消</button></div><p role="alert" hidden></p></form>`;
  }
  function bindIdentity(r){
    const form=$('#rename-form'),fields=form.elements,save=form.querySelector('[type=submit]'),error=form.querySelector('[role=alert]');
    function edit(field){
      if(form.hidden){fields.name.value=r.name;fields.role.value=r.role;form.hidden=false;}
      field.focus();field.select();
    }
    $('#edit-name').onclick=()=>edit(fields.name);
    $('#edit-role').onclick=()=>edit(fields.role);
    form.querySelector('[data-cancel]').onclick=()=>{form.hidden=true;navigate('resident',r.id);};
    form.onsubmit=async e=>{
      e.preventDefault();
      if(save.disabled)return;
      if(!state.resident_interactions){error.textContent=restartHint;error.hidden=false;return;}
      const changes={id:r.id},edited=[];
      for(const [key,label] of [['name','名字'],['role','身份']]){
        const value=fields[key].value.trim();
        if(!value||Array.from(value).length>12){error.textContent=label+'需为 1–12 个字符';error.hidden=false;return;}
        if(value!==r[key]){changes[key]=value;changes['previous_'+key]=r[key];edited.push(key);}
      }
      if(!edited.length){form.hidden=true;navigate('resident',r.id);return;}
      save.disabled=true;error.hidden=true;
      try{
        const result=await request('residents/update',changes);
        if(edited.some(key=>result[key]!==changes[key]))throw Error('请保存并重启村庄服务，以加载人物资料编辑功能');
        const current=state.residents.find(x=>x.id===r.id);
        if(current)for(const key of edited)current[key]=result[key];
        form.hidden=true;
        if(form.isConnected&&selected===r.id)navigate('resident',r.id);
        toast('人物资料已保存');
      }catch(err){error.textContent=err.message;error.hidden=false;}
      finally{save.disabled=false;}
    };
  }
  function wardrobe(r){
    return `<div class="appearance-options wardrobe-options">${state.appearances.map(a=>`<button type="button" class="appearance-choice" data-look="${esc(a.id)}" aria-pressed="${a.id===r.appearance}"><span class="appearance-art"><canvas data-avatar="${esc(a.id)}" width="96" height="112"></canvas></span><span>${esc(a.name)}</span></button>`).join('')}</div>`;
  }
  function bindWardrobe(r){
    const list=$('.wardrobe-options');
    VillageAvatars.paintChoices(list);
    list.onclick=async e=>{
      const choice=e.target.closest('button[data-look]');
      if(!choice||choice.dataset.look===r.appearance)return;
      await mutate('residents/update',{id:r.id,appearance:choice.dataset.look},'已换上新形象');
    };
  }

  function chatView(r){
    return `<section class="resident-chat" data-owner="${esc(r.id)}">
      <div><button type="button" class="outline chat-earlier" hidden>更早的对话</button>
      <button type="button" class="outline chat-newer" hidden>更新的对话</button></div>
      <div class="chat-thread" role="log" aria-live="polite" aria-label="聊天记录"></div>
      <form class="chat-compose"><textarea aria-label="给${esc(r.name)}的消息" rows="2" placeholder="发消息…" required></textarea><button type="submit" class="primary">发送</button></form>
      <div class="chat-status" role="status"></div><button type="button" class="outline chat-config" hidden>配置这位居民的 API</button></section>`;
  }
  function chatRows(turns,r){
    const portrait=`<canvas data-avatar="${esc(r.appearance)}" width="32" height="38" aria-hidden="true"></canvas>`;
    return turns.map(t=>{
      const content=t.status==='complete'?t.reply:t.status==='error'?t.error:'正在回复…';
      return `<div class="chat-row mine"><p>${esc(t.text)}</p><span class="chat-self">我</span></div>
        <div class="chat-row theirs ${t.status==='complete'?'':'notice'}">${portrait}<p>${esc(content)}</p></div>`;
    }).join('');
  }
  function bindChat(r){
    const root=$('.resident-chat'),thread=root.querySelector('.chat-thread'),form=root.querySelector('form');
    const earlier=root.querySelector('.chat-earlier'),newer=root.querySelector('.chat-newer'),pageSize=24;
    const input=form.querySelector('textarea'),send=form.querySelector('button'),status=root.querySelector('[role=status]'),config=root.querySelector('.chat-config');
    if(!state.resident_interactions){
      input.disabled=true;send.disabled=true;status.textContent=restartHint;
      root.sync=()=>{if(state.resident_interactions)bindChat(r);};
      return;
    }
    input.disabled=false;
    let revision=null,loading=false,posting=false,waiting=false,error='',before=null,start=0,end=0,total=0;
    const draft=drafts.get(r.id)||{text:'',requestId:null};
    drafts.set(r.id,draft);input.value=draft.text;
    function controls(current){
      config.hidden=current.connected;
      send.disabled=posting||waiting||!!state.busy||!current.connected||!input.value.trim();
      status.textContent=error||(!current.connected?'这位居民还未配置模型。':state.busy&&!waiting?state.busy:'');
    }
    async function sync(){
      if(!root.isConnected||view!=='residentChat'||selected!==r.id)return;
      const current=state.residents.find(x=>x.id===r.id);
      if(!current)return;
      const next=JSON.stringify([current.chat_revision||'',current.appearance,current.name,before]);
      $('#panel-title').textContent=current.name;
      controls(current);
      if(loading||revision===next)return;
      loading=true;
      earlier.disabled=newer.disabled=true;
      try{
        const page=before;
        const result=await request('residents/chat?id='+encodeURIComponent(r.id)+'&limit='+pageSize+(page===null?'':'&before='+page));
        if(!root.isConnected)return;
        if(before!==page)return;
        start=result.start??0;end=result.end??result.turns.length;total=result.total??end;
        earlier.hidden=start===0;newer.hidden=end===total;
        const atBottom=revision===null||thread.scrollHeight-thread.clientHeight-thread.scrollTop<40;
        waiting=result.waiting??result.turns.some(t=>t.status==='pending');
        if(draft.requestId&&result.turns.some(t=>t.id===draft.requestId)&&input.value===draft.text){
          input.value='';draft.text='';draft.requestId=null;
        }
        thread.innerHTML=chatRows(result.turns,current);
        VillageAvatars.paintChoices(thread);
        if(atBottom)thread.scrollTop=thread.scrollHeight;
        revision=next;
      }catch(problem){error=problem.message;}
      finally{loading=false;earlier.disabled=newer.disabled=false;controls(current);}
    }
    root.sync=sync;
    earlier.onclick=()=>{before=start;return sync();};
    newer.onclick=()=>{before=end+pageSize>=total?null:end+pageSize;return sync();};
    config.onclick=()=>navigate('residentApi',r.id);
    input.oninput=()=>{draft.text=input.value;draft.requestId=null;error='';controls(state.residents.find(x=>x.id===r.id));};
    input.onkeydown=e=>{
      if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&e.keyCode!==229){
        e.preventDefault();if(!send.disabled)form.requestSubmit();
      }
    };
    form.onsubmit=async e=>{
      e.preventDefault();
      if(send.disabled)return;
      const text=input.value.trim();
      if(Array.from(text).length>1200){status.textContent='每条消息最多 1200 字';return;}
      const requestId=draft.requestId||(crypto.randomUUID?.() ||
        Array.from(crypto.getRandomValues(new Uint8Array(16)),byte=>byte.toString(16).padStart(2,'0')).join(''));
      draft.requestId=requestId;posting=true;error='';input.readOnly=true;controls(r);
      try{
        await request('residents/chat',{id:r.id,request_id:requestId,text});
        if(draft.requestId===requestId){draft.text='';draft.requestId=null;input.value='';}
        waiting=true;revision=null;before=null;
        await sync();
        thread.scrollTop=thread.scrollHeight;
      }catch(problem){error=problem.message;}
      finally{posting=false;input.readOnly=false;controls(state.residents.find(x=>x.id===r.id));}
    };
    sync();
  }
  return {openMenu,closeMenu,positionMenu,bindMenu,identityEditor,bindIdentity,wardrobe,bindWardrobe,chatView,bindChat};
})();
