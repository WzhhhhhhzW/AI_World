'use strict';
const VillageScenes=(()=>{
  const images={};
  const ready=Promise.all(['council-hall-v1','eastwood-v1'].map(name=>new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>{images[name]=im;resolve();};im.onerror=()=>reject(Error('新地图加载失败'));im.src='assets/maps/'+name+'.png';})));
  const seats=[[286,202],[674,202],[260,257],[700,257],[246,316],[714,316],[245,377],[715,377],[268,445],[692,445],[332,478],[628,478]];
  function drawHall(c,state,time){
    c.drawImage(images['council-hall-v1'],0,0,960,640);
    if(state.residents.length>10){
      c.drawImage(images['council-hall-v1'],352,595,138,170,298,431,68,85);
      c.drawImage(images['council-hall-v1'],1047,595,140,170,594,431,68,85);
    }
    for(let i=0;i<state.residents.length;i++){
      const r=state.residents[i],[x,y]=seats[i];
      c.save();c.beginPath();c.rect(x-40,y-90,80,75);c.clip();VillageAvatars.draw(c,r.appearance,x,y-4+Math.sin(time/1700+x)*.3,67);c.restore();
      c.font='9px Microsoft YaHei';c.textAlign='center';
      const plaque=Math.max(46,Math.ceil(c.measureText(r.name).width)+8);
      c.fillStyle='#fff0d8e8';c.fillRect(x-plaque/2,y+2,plaque,14);c.fillStyle='#72451f';c.fillText(r.name,x,y+12);
    }
    for(const [x,y] of [[398,95],[415,92],[884,355],[906,358]]){const f=.5+Math.sin(time/160+x)*.15;c.fillStyle=`rgba(255,218,126,${f})`;c.fillRect(x,y,2,4);}
  }
  function drawRegion(c,state,time,drawResident){
    c.drawImage(images['eastwood-v1'],0,0,960,640);
    const structures=state.world?.structures||[],entities=structures.map(s=>({y:s.rect[1]+s.rect[3],s}));
    state.residents.filter(r=>r.region==='eastwood').forEach(r=>entities.push({y:(r.y+1)*32,r}));
    entities.sort((a,b)=>a.y-b.y);
    for(const e of entities){if(e.r){drawResident(e.r);continue;}const s=e.s,[x,y,w,h]=s.rect;
      if(!s.built){VillageTiles.within(c,'construction-'+Math.min(2,Math.floor(s.progress/15)),s.rect);VillageUI.effect(c,'dust',time,x+w/2,y+h,42,25);}
      else if(s.kind==='garden'){for(let row=0;row<2;row++)for(let col=0;col<3;col++)VillageTiles.at(c,'vegetable-'+(col%3+1),x+20+col*32,y+38+row*30,.7);}
      else VillageTiles.within(c,s.kind==='watchtower'?'archive':'house',s.rect);
      c.fillStyle='#fff3d9de';c.fillRect(x,y+h+3,w,15);c.font='10px Microsoft YaHei';c.textAlign='center';c.fillStyle='#74502d';c.fillText(s.name+(s.built?'':' · 施工中'),x+w/2,y+h+14);
    }
  }
  function hitSeat(p,state){const i=seats.findIndex(([x,y])=>Math.abs(p.x-x)<33&&p.y>y-76&&p.y<y+18);return i<0?null:state.residents[i];}
  return {ready,images,seats,drawHall,drawRegion,hitSeat};
})();
