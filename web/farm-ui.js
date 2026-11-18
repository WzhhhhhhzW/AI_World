'use strict';
const VillageFarm=(()=>{
  let seed='cabbage', item='cabbage', recipient='', quantity=1;
  const images={};
  const ready=Promise.all(['radish','cabbage'].map(key=>new Promise((resolve,reject)=>{
    const im=new Image();im.onload=()=>{images[key]=im;resolve();};im.onerror=()=>reject(Error('蔬菜素材加载失败'));im.src='assets/props/'+key+'.png';
  })));
  const unavailable='<p class="mini-banner">农场需要新版村庄服务。请在设置中保存并退出，再双击「启动游戏.cmd」。</p>';
  function art(key){
    return key==='mixed'?VillageUI.icon('grain',36):`<img class="crop-icon" src="assets/props/${key}.png" alt="">`;
  }
  function phase(plot,clock){
    if(!plot.crop)return 'empty';
    if(plot.ready_at==null)return 'dry';
    return clock>=plot.ready_at?'ripe':'growing';
  }
  function timeLeft(clock,readyAt){
    const s=Math.ceil(Math.max(0,readyAt-clock)/4);
    return Math.floor(s/60)+'分'+String(s%60).padStart(2,'0')+'秒';
  }
  function plotLabel(p,clock){
    return {empty:'空地',dry:'待浇水',growing:timeLeft(clock,p.ready_at),ripe:'可收获'}[phase(p,clock)];
  }
  function garden(){
    const farm=state.farm;if(!farm)return unavailable;
    const index=Number.isInteger(selected)?selected:0,p=farm.plots[index],status=phase(p,state.clock);
    const detail=p.crop?farm.catalog[p.crop]:farm.catalog[seed];
    const tiles=farm.plots.map((plot,i)=>`<button type="button" class="farm-bed ${phase(plot,state.clock)}" data-bed="${i}" aria-pressed="${index===i}"><small>${i===5?'共耕田':(i+1)+' 号田'}</small>${plot.crop?art(plot.crop):'<span class="bed-furrows"></span>'}<b>${plot.crop?farm.catalog[plot.crop].name:'空地'}</b><span>${plotLabel(plot,state.clock)}</span></button>`).join('');
    const seedShelf=status==='empty'?`<div class="seed-pouches">${['cabbage','radish'].map(k=>`<button class="seed-pouch" data-seed="${k}" aria-pressed="${seed===k}">${art(k)}<span><b>${farm.catalog[k].name}种子</b><small>${farm.catalog[k].seconds/60} 分钟 · ${number(farm.catalog[k].tokens)} Token</small></span></button>`).join('')}</div>`:'';
    const caption={empty:'选一种种子，在这里播种。',dry:'种子已入土，浇水后开始生长。',growing:(state.paused?'村庄时间已暂停':'已浇水')+' · 距成熟 '+timeLeft(state.clock,p.ready_at),ripe:'成熟了，收获后可在粮仓查看。'}[status];
    const action={empty:['plant','播种 · '+detail.name],dry:['water','浇水'],ripe:['harvest','收获入仓']}[status];
    return `<div class="garden-toolbar"><span>菜园 · 六畦田</span><button class="outline" data-go="granary">打开粮仓</button></div><div class="farm-beds">${tiles}</div><section class="farm-work"><h3>${index===5?'共耕田':(index+1)+' 号田'}${p.crop?' · '+detail.name:''}</h3><p>${caption}</p>${seedShelf}${action?`<button class="primary full" data-farm-action="${action[0]}" data-index="${index}" data-version="${p.version}">${action[1]}</button>`:''}</section><p class="fine-print">种子免费，每畦收获一颗。园丁会在共耕田种菜，也会为这块田里的种子浇水。</p>`;
  }
  function pantry(){
    const farm=state.farm;if(!farm)return unavailable;
    const keys=['radish','cabbage',...(farm.inventory.mixed?['mixed']:[])];
    if(!keys.includes(item))item='cabbage';
    if(!state.residents.some(r=>r.id===recipient))recipient=state.residents[0]?.id||'';
    const stack=farm.inventory[item],spec=farm.catalog[item];
    const slots=keys.map(k=>`<button class="pantry-slot" data-stack="${k}" aria-pressed="${k===item}">${art(k)}<b>${farm.catalog[k].name}</b><span>×${number(farm.inventory[k])}</span></button>`).join('');
    return `<div class="garden-toolbar"><h3>作物物品栏</h3><button class="outline" data-go="farm">去种菜</button></div><div class="pantry-slots">${slots}</div><form id="food-exchange" data-stock-version="${farm.stock_version}"><p>每颗${spec.name}可换 <strong>${number(spec.tokens)}</strong> 村内 Token</p><div class="exchange-fields"><label>拨给谁<select name="resident">${state.residents.map(r=>`<option value="${esc(r.id)}" ${r.id===recipient?'selected':''}>${esc(r.name)}</option>`).join('')}</select></label><label>数量<input type="number" name="quantity" min="1" max="${stack}" step="1" value="${quantity}" required></label></div><button class="primary full" type="submit" ${stack&&recipient?'':'disabled'}>${stack?'消耗作物并兑换':'该作物暂无库存'}</button></form><p class="fine-print">作物兑换的是村内调用预算。实际用量按服务商回执记账。</p>`;
  }
  function bind(){
    const panel=$('#panel');
    const redraw=()=>{previousSignature='';renderPanel();};
    for(const button of panel.querySelectorAll('[data-bed]'))button.onclick=()=>{selected=Number(button.dataset.bed);redraw();};
    for(const button of panel.querySelectorAll('[data-seed]'))button.onclick=()=>{seed=button.dataset.seed;redraw();};
    const action=panel.querySelector('[data-farm-action]');
    if(action)action.onclick=()=>mutate('farm/plot',{plot:Number(action.dataset.index),version:Number(action.dataset.version),action:action.dataset.farmAction,crop:seed},{plant:'种子已播下',water:'浇好水了',harvest:'作物已收入粮仓'}[action.dataset.farmAction]);
    for(const button of panel.querySelectorAll('[data-stack]'))button.onclick=()=>{item=button.dataset.stack;quantity=1;redraw();};
    const form=panel.querySelector('#food-exchange');
    if(form){
      form.elements.resident.onchange=e=>{recipient=e.target.value;};
      form.elements.quantity.oninput=e=>{quantity=Number(e.target.value);};
      form.onsubmit=async e=>{e.preventDefault();const result=await mutate('granary/exchange',{id:form.elements.resident.value,crop:item,count:Number(form.elements.quantity.value),version:Number(form.dataset.stockVersion)});if(result)toast('已拨入 '+number(result.credited)+' 村内 Token');};
    }
    for(const box of panel.querySelectorAll('[data-auto-food]'))box.onchange=async()=>{
      const ok=await mutate('granary/automatic',{id:box.dataset.autoFood,enabled:box.checked});
      if(!ok)redraw();
    };
  }
  function drawBeds(c,farm,clock,points){
    if(!farm)return;
    farm.plots.forEach((p,i)=>{
      if(!p.crop)return;
      const [x,y]=points[i],stage=phase(p,clock);
      if(stage==='dry'){VillageTiles.at(c,'vegetable-0',x,y,.66);return;}
      c.save();c.fillStyle='#55331555';c.beginPath();c.ellipse(x,y-1,20,5,0,0,Math.PI*2);c.fill();c.restore();
      const progress=1-Math.max(0,p.ready_at-clock)/(4*farm.catalog[p.crop].seconds);
      if(progress<.5){VillageTiles.at(c,progress<.2?'vegetable-0':'vegetable-1',x,y,.74);return;}
      const size=stage==='ripe'?29:17+progress*6;
      if(images[p.crop])c.drawImage(images[p.crop],Math.round(x-size/2),Math.round(y-size*.88),size,size);
    });
  }
  return {ready,garden,pantry,bind,drawBeds,phase};
})();
