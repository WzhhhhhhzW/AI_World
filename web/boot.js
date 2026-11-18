'use strict';
(async () => {
  const cover=document.createElement('div');cover.id='launch-cover';document.body.append(cover);
  if(location.protocol==='file:'){
    document.body.className='launch-mode';
    cover.innerHTML='<div class="launch-card"><div class="launch-mark">谷</div><h1>准备进入溪谷村</h1><p>请先双击游戏文件夹里的 <strong>启动游戏.cmd</strong>。<br>启动后会自动打开村庄。</p><a class="primary" href="http://127.0.0.1:8766/">服务已启动，进入村庄</a><p class="fine-print">这个文件入口不再显示未加载完成的地图。</p></div>';
    return;
  }
  const tcg = new URLSearchParams(location.search).get('render') === 'tcg';
  document.documentElement.dataset.renderProfile = tcg ? 'tcg' : 'full';
  cover.innerHTML='<div class="launch-card"><div class="launch-mark">谷</div><h1>村庄正在苏醒</h1><p id="launch-status">正在准备地图与居民…</p></div>';
  document.addEventListener('village-service-stopped',()=>{cover.innerHTML='<div class="launch-card"><div class="launch-mark">谷</div><h1>村庄已保存</h1><p>下次双击「启动游戏.cmd」，即可继续这里的生活。</p></div>';document.body.append(cover);});
  try{
    const stateReady=new Promise(resolve=>document.addEventListener('village-state-ready',resolve,{once:true}));
    for(const file of ['ui-assets.js','ui-skin.js','avatars.js','map-assets.js','river-weather.js','climate.js','living-props.js','farm-ui.js','harness-ui.js','world-scenes.js','map-painted.js','map-camera.js','resident-actions.js','app.js']){
      await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=file;script.onload=resolve;script.onerror=()=>reject(new Error('加载游戏文件失败'));document.head.append(script);});
    }
    await Promise.race([Promise.all([VillageUI.ready,VillageSkin.ready,VillageAvatars.ready,VillageMap.ready,VillageProps.ready,VillageFarm.ready,VillageScenes.ready,stateReady]),new Promise((_,reject)=>setTimeout(()=>reject(new Error('村庄服务或素材加载超时')),tcg ? 120000 : 15000))]);
    if(document.documentElement.dataset.sceneSprites!=='48'||document.documentElement.dataset.avatarCount!=='6'||document.documentElement.dataset.uiSheetsLoaded!=='8'||document.documentElement.dataset.uiSkin!=='village-wood-v2'||document.documentElement.dataset.mapStyle!=='painted-valley-v1')throw new Error('部分素材没有加载完成');
    document.documentElement.dataset.gameReady='true';
    document.dispatchEvent(new Event('village-game-ready'));
    cover.remove();
  }catch(error){
    cover.innerHTML='<div class="launch-card"><h1>村庄还没准备好</h1><p>请确认启动游戏的窗口仍在运行，再重新进入。</p><button class="primary" id="launch-retry">重新载入</button></div>';
    document.querySelector('#launch-retry').addEventListener('click',()=>location.reload());
  }
})();
