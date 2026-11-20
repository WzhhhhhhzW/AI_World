'use strict';
// Art is a clean background plate; live residents, crops and construction stay separate.
const VillageMap=(()=>{
  let layout=null,plate=null,loaded=false,glow=null,weather=null;
  const compact = document.documentElement.dataset.renderProfile === 'tcg';
  const readLayout = compact ? Promise.resolve(villageTcgAssets.layout) : fetch('assets/maps/valley-layout-v1.json').then(r=>{if(!r.ok)throw Error('Map layout unavailable');return r.json();});
  function loadPlate(url) {
    return new Promise((resolve,reject)=>{
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = url;
    });
  }
  const image = compact ? loadPlate('assets/tcg/valley-painted-v1.webp') : readLayout.then(data=>loadPlate('assets/'+data.background));
  const ready=Promise.all([readLayout,image,VillageProps.ready]).then(([data,art])=>{
    layout=data;
    if(art.naturalWidth!==layout.background_size[0]||art.naturalHeight!==layout.background_size[1])throw Error('Map artwork size mismatch');
    plate=compact ? art : VillageProps.cleanPlate(art);
    if(!compact)weather=VillageWeather.create(plate,layout);
    loaded=true;document.documentElement.dataset.mapStyle=layout.version;
    document.dispatchEvent(new Event('village-map-ready'));
  });
  const spec=b=>layout?.buildings[b.id];
  const anchor=b=>spec(b)?.anchor||[(b.x+b.w/2)*32,(b.y+b.h)*32];
  // These bounds cover the pixels drawn above the plate, including sign captions
  // and the base of a finished building. The map's clickable regions are separate.
  function overlayBounds(b,state){
    const item=spec(b);
    if(!item)return null;
    if(b.kind==='farm')return b.built && state.farm?.plots.some(p=>p.crop) ? item.rect : null;
    if(item.baked)return null;
    const [x,y]=item.anchor;
    if(!b.built&&!b.constructing){
      const half=Math.max(32,(b.name.length+3)*6);
      return [x-half,y-36,half*2,49];
    }
    const scale=item.scale;
    return [x-50*scale,y-114*scale,100*scale,133*scale];
  }
  function ground(c){if(!loaded)return false;c.clearRect(0,0,960,640);c.drawImage(plate,0,0,960,640);return true;}
  function meadow(c,w,h){if(!loaded)return false;c.fillStyle='#243f30';c.fillRect(0,0,w,h);return true;}
  function building(c,b,state,time){
    if(!loaded)return false;
    const item=spec(b);if(!item)return true;
    if(b.kind==='farm'){
      if(!b.built)return true;
      VillageFarm.drawBeds(c,state?.farm,state?.clock,layout.crop_positions);
      return true;
    }
    if(item.baked)return true;
    const [x,y]=item.anchor;
    if(!b.built&&!b.constructing){
      VillageTiles.at(c,'notice-board',x,y-5,.65);
      c.save();c.font='9px Microsoft YaHei';c.textAlign='center';c.fillStyle='#fff1cbd9';c.fillRect(x-29,y-4,58,14);c.fillStyle='#60442b';c.fillText(b.name+'预留地',x,y+6);c.restore();return true;
    }
    c.save();c.translate(x,y);c.scale(item.scale,item.scale);
    VillageTiles.building(c,{...b,x:-1.5,y:-3,w:3,h:3},state,time);c.restore();return true;
  }
  function selection(c,b,time){
    const [x,y]=anchor(b);
    VillageUI.effect(c,'selection',time,x,y+6,b.id==='hall'?92:67,20);
  }
  function hitBuilding(point,b){
    const s=spec(b);if(!s)return false;
    const r=!b.built&&s.lot_rect?s.lot_rect:s.rect;
    return point.x>=r[0]&&point.x<=r[0]+r[2]&&point.y>=r[1]&&point.y<=r[1]+r[3];
  }
  function plotAt(point){
    return layout?.crop_positions.findIndex(([x,y])=>Math.abs(point.x-x)<=30&&Math.abs(point.y-y)<=11)??-1;
  }
  function paintBuildingPortrait(canvas,b){
    const s=spec(b);if(!loaded||!s)return;
    const rect=!b.built&&s.lot_rect?s.lot_rect:s.rect;
    const [x,y,w,h]=rect,scale=Math.min(canvas.width/w,canvas.height/h),dw=w*scale,dh=h*scale;
    const c=canvas.getContext('2d');c.imageSmoothingEnabled=false;c.clearRect(0,0,canvas.width,canvas.height);
    c.drawImage(plate,x*1.6,y*1.6,w*1.6,h*1.6,(canvas.width-dw)/2,(canvas.height-dh)/2,dw,dh);
  }
  function groundMotion(c,time,climate){
    if(weather)weather.ground(c,time,climate);
  }
  function butterflies(time,state,climate){
    const wings=[];
    if(state.clock%1440>360&&state.clock%1440<1140&&(!climate||climate.rain<.25&&climate.fog<.6)){
      const wing=Math.sin(time/80)>0?3:1;
      for(let i=0;i<3;i++)wings.push({x:329+Math.sin(time/1900+i*3)*19+i*86,y:355+Math.cos(time/1500+i)*13+i*30,wing});
    }
    return wings;
  }
  function atmosphere(c,time,state,climate,wings){
    if(!loaded)return;
    if(weather)weather.petals(c,time,climate);
    (wings||butterflies(time,state,climate)).forEach(({x,y,wing},i)=>{
      c.fillStyle=i%2?'#f1d59d':'#e3c8f3';c.fillRect(x-wing,y,wing,2);c.fillRect(x+1,y,wing,2);
    });
  }
  function lighting(c,time,state,camera,w,h){
    if(!loaded)return;
    const hour=state.clock%1440/60,night=1-Math.max(0,Math.min(1,(hour-5)/2,(20-hour)/2));
    c.save();c.globalAlpha=night*.31;c.fillStyle='#132b4d';c.fillRect(0,0,w,h);c.restore();
    if(night<.05)return;
    if(!glow){glow=document.createElement('canvas');glow.width=96;glow.height=96;const g=glow.getContext('2d'),p=g.createRadialGradient(48,48,1,48,48,48);p.addColorStop(0,'#ffe3a3b0');p.addColorStop(.35,'#ffcf7050');p.addColorStop(1,'#ffcf7000');g.fillStyle=p;g.fillRect(0,0,96,96);}
    c.save();c.translate(camera.x,camera.y);c.scale(camera.scale,camera.scale);c.globalAlpha=night*(.8+Math.sin(time/1000)*.03);
    for(const [x,y] of layout.lamps)c.drawImage(glow,x-32,y-32,64,64);
    for(const b of state.buildings){if(!b.built||b.kind==='farm')continue;const [x,y]=anchor(b);c.drawImage(glow,x-30,y-40,60,60);}
    for(let i=0;i<8;i++){const x=230+i*67+Math.sin(time/1600+i)*8,y=520+Math.cos(time/1500+i)*12;c.globalAlpha=night*(.3+.25*Math.sin(time/700+i));c.fillStyle='#f2ef9d';c.fillRect(x,y,2,2);}c.restore();
  }
  return {ready,ground,meadow,building,overlayBounds,selection,anchor,hitBuilding,plotAt,paintBuildingPortrait,groundMotion,butterflies,atmosphere,lighting,scenery:()=>[],drawScenery:()=>{},hit:()=>null,get version(){return layout?.version;}};
})();
