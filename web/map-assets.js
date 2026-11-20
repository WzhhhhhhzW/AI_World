'use strict';
// Scene posters are consumed as source atlases; the supplied PNG files stay intact.
const VillageTiles = (() => {
  const sheets=new Map(), sprites=new Map(), patterns=new WeakMap();
  let manifest=null, loaded=false;
  const scenery=[];
  function add(key,x,y,scale=1,action=null,name='') { scenery.push({type:'scenery',key,x,y,scale,action,name}); }
  for(let i=0;i<16;i++)add(i%7===3?'tree-gold':'tree-green',-12+i*65,48+(i%3)*9,.95);
  for(const [key,x,y,s] of [
    ['tree-green',35,158,1],['tree-fruit',73,215,.9],['tree-green',24,300,1],['tree-green',48,391,1],
    ['tree-pink',250,204,.9],['tree-pink',914,165,1],['tree-green',944,242,.95],['tree-fruit',921,370,.95],['tree-green',937,493,1],
    ['bush',229,347,1],['bush',598,388,1],['flowers',644,203,.8],['flowers',679,216,.8],['flowers',79,352,.8],
    ['flowers',388,545,.8],['rock',842,467,.8],['ore',870,483,.8],['log-pile',88,446,1],['stump',47,447,.8],
    ['well',604,402,.85],['lamp',594,324,.9],['bench',337,290,1],['barrel',845,260,.8],['crate',796,263,.8],
    ['flowerpot',118,264,.8],['mailbox',224,260,.75],['sack',718,260,.85],['notice-board',354,270,1],
  ])add(key,x,y,s);
  // The board opens an existing feature, not a new external action.
  scenery.find(item=>item.key==='notice-board').action='meeting';
  scenery.find(item=>item.key==='notice-board').name='公告板';
  function get(key){return sprites.get(key);}
  function at(context,key,x,y,scale=1){
    const sprite=get(key),spec=manifest?.assets[key];if(!sprite)return false;
    const anchor=spec.anchor||[sprite.width/2,sprite.height];
    context.imageSmoothingEnabled=false;
    context.drawImage(sprite,Math.round(x-anchor[0]*scale),Math.round(y-anchor[1]*scale),Math.round(sprite.width*scale),Math.round(sprite.height*scale));
    return true;
  }
  function fit(context,key,x,y,width,height){const sprite=get(key);if(!sprite)return false;context.imageSmoothingEnabled=false;context.drawImage(sprite,Math.round(x),Math.round(y),width,height);return true;}
  function within(context,key,rect){const sprite=get(key);if(!sprite)return false;const [x,y,w,h]=rect,scale=Math.min(w/sprite.width,h/sprite.height);context.imageSmoothingEnabled=false;context.drawImage(sprite,x+(w-sprite.width*scale)/2,y+h-sprite.height*scale,sprite.width*scale,sprite.height*scale);return true;}
  function pattern(context,key){
    let cache=patterns.get(context);if(!cache){cache=new Map();patterns.set(context,cache);}
    if(!cache.has(key)&&get(key)){
      let texture=get(key);
      if(key==='grass'){
        const mirrored=document.createElement('canvas');mirrored.width=64;mirrored.height=64;
        const paint=mirrored.getContext('2d');paint.imageSmoothingEnabled=false;
        for(const [flipX,flipY] of [[false,false],[true,false],[false,true],[true,true]]){
          paint.save();paint.translate(flipX?64:0,flipY?64:0);paint.scale(flipX?-1:1,flipY?-1:1);paint.drawImage(texture,0,0,32,32);paint.restore();
        }
        texture=mirrored;
      }
      cache.set(key,context.createPattern(texture,'repeat'));
    }
    return cache.get(key);
  }
  function meadow(context,width,height,camera){
    if(!loaded)return false;
    context.save();context.translate(camera.x,camera.y);context.scale(camera.scale,camera.scale);
    context.fillStyle='#8da950';context.fillRect(-camera.x/camera.scale,-camera.y/camera.scale,width/camera.scale,height/camera.scale);context.globalAlpha=.62;context.fillStyle=pattern(context,'grass');context.fillRect(-camera.x/camera.scale,-camera.y/camera.scale,width/camera.scale,height/camera.scale);context.restore();return true;
  }
  function ground(context){
    if(!loaded)return false;
    context.clearRect(0,0,960,640);context.fillStyle='#8da950';context.fillRect(0,0,960,640);context.save();context.globalAlpha=.62;context.fillStyle=pattern(context,'grass');context.fillRect(0,0,960,640);context.restore();
    for(let row=0;row<20;row++)for(let col=0;col<30;col++){
      const k=(col*47+row*31)%71;
      if(k===4||k===17){context.save();context.globalAlpha=.2;fit(context,k===4?'grass-2':'grass-flowers',col*32,row*32,32,32);context.restore();}
    }
    // Connected road geometry uses the supplied dirt texture. The reference posters
    // do not contain a reliable one-to-one N/E/S/W mask ordering for all 16 tiles.
    const roads=new Set();
    const road=(x,y,w,h)=>{for(let j=y;j<y+h;j++)for(let i=x;i<x+w;i++)roads.add(i+','+j);};
    road(3,9,25,1);road(13,7,3,2);road(14,9,1,9);road(5,8,1,1);road(23,8,1,1);road(8,15,6,1);road(15,15,10,1);
    context.lineWidth=26;context.lineCap='round';context.lineJoin='round';context.strokeStyle='#7a7b3e';
    function trace(){
      context.beginPath();for(const item of roads){const [x,y]=item.split(',').map(Number);const cx=x*32+16,cy=y*32+16;context.moveTo(cx,cy);context.lineTo(cx+.1,cy);
        if(roads.has((x+1)+','+y)){context.moveTo(cx,cy);context.lineTo(cx+32,cy);}if(roads.has(x+','+(y+1))){context.moveTo(cx,cy);context.lineTo(cx,cy+32);}}
      context.stroke();
    }
    trace();context.lineWidth=22;context.strokeStyle=pattern(context,'dirt');trace();
    context.fillStyle=pattern(context,'dirt');context.fillRect(13*32+5,7*32+5,3*32-10,2*32+10);
    // A small pond with textured water and an irregular grassy bank.
    context.save();context.beginPath();context.moveTo(25,520);context.lineTo(155,516);context.lineTo(194,541);context.lineTo(193,624);context.lineTo(162,640);context.lineTo(18,640);context.lineTo(9,594);context.closePath();
    context.lineWidth=8;context.strokeStyle='#908453';context.stroke();context.clip();context.fillStyle=pattern(context,'water');context.fillRect(0,508,208,132);context.restore();
    at(context,'bridge',184,607,.85);
    // Garden fences, built from the supplied fence pieces rather than plain lines.
    for(const [x,y,n] of [[102,269,4],[690,278,4],[259,531,5],[690,525,4]])for(let i=0;i<n;i++)at(context,'fence-h',x+i*27,y,.95);
    return true;
  }
  function farm(context,b,state,time){
    const x=b.x*32,y=b.y*32,w=b.w*32,h=b.h*32;
    fit(context,'soil-dry',x,y,w,h);
    const farmer=state?.residents.find(r=>r.task==='farm'&&!r.meeting);
    const stage=farmer?Math.min(3,Math.floor(farmer.progress/5)):3;
    for(let row=0;row<b.h;row++)for(let col=0;col<b.w;col++){context.save();context.translate(x+col*32+16,y+row*32+30);context.rotate(Math.sin(time/850+col*.7+row)*.045);at(context,(col===b.w-1?'vegetable-':'wheat-')+stage,0,0,1);context.restore();}
  }
  function building(context,b,state,time){
    if(!loaded)return false;
    const x=b.x*32,bottom=(b.y+b.h)*32,w=b.w*32;
    if(!b.built&&!b.constructing){
      context.save();context.globalAlpha=.6;at(context,'construction-0',x+w/2,bottom,Math.max(1,w/96));context.restore();
      context.fillStyle='#fff2c6e8';context.fillRect(x+w/2-24,bottom-35,48,16);context.font='10px Microsoft YaHei';context.textAlign='center';context.fillStyle='#6c623e';context.fillText(b.name,x+w/2,bottom-24);return true;
    }
    if(b.constructing){
      const stage=Math.min(2,Math.floor(b.progress/15));at(context,'construction-'+stage,x+w/2,bottom,Math.max(1,w/96));
      context.fillStyle='#615a37';context.fillRect(x,bottom+4,w,5);context.fillStyle='#e3ce7d';context.fillRect(x+1,bottom+5,Math.max(1,(w-2)*b.progress/45),3);
      VillageUI.effect(context,'dust',time,x+w/2,bottom+4,52,32);return true;
    }
    if(b.kind==='farm'){farm(context,b,state,time);return true;}
    return at(context,b.kind,x+w/2,bottom);
  }
  function drawScenery(context,item,time=0){
    context.save();context.translate(item.x,item.y);
    if(item.key.startsWith('tree-')||item.key==='bush'||item.key==='flowers')context.rotate(Math.sin(time/1100+item.x*.021)*.014);
    at(context,item.key,0,0,item.scale);context.restore();
  }
  function pondPath(context){context.beginPath();context.moveTo(25,520);context.lineTo(155,516);context.lineTo(194,541);context.lineTo(193,624);context.lineTo(162,640);context.lineTo(18,640);context.lineTo(9,594);context.closePath();}
  function groundMotion(context,time){
    if(!loaded)return;
    context.save();pondPath(context);context.clip();context.globalAlpha=.3;context.translate(Math.sin(time/2000)*3,(time/250)%32);context.fillStyle=pattern(context,'water');context.fillRect(-10,470,230,190);context.restore();
    context.save();pondPath(context);context.clip();for(let i=0;i<9;i++){const x=25+(i*29+time/170)%165,y=537+(i*19)%90;context.globalAlpha=.15+.12*Math.sin(time/700+i);context.fillStyle='#d3edce';context.fillRect(x,y,8+i%4*3,1);}context.restore();
    context.save();for(let i=0;i<14;i++){const x=(i*83+time/90)%960,y=(i*57+time/150)%640;context.globalAlpha=.35;context.fillStyle=i%3===0?'#ebd3bb':'#c1d98d';context.fillRect(x+Math.sin(time/1100+i)*5,y,2,1);}context.restore();
  }
  function atmosphere(context,time,state){
    if(!loaded||!state)return;
    for(const b of state.buildings){
      if(!b.built||!['house','workshop','archive'].includes(b.kind))continue;
      const x=(b.x+b.w*.7)*32,y=(b.y+b.h)*32-87;
      for(let i=0;i<5;i++){const p=(time/4500+i/5)%1;context.save();context.globalAlpha=(1-p)*.22;context.fillStyle='#e4e3cf';const size=3+p*7;context.fillRect(x+Math.sin(time/1600+i)*3+p*8-size/2,y-p*33,size,size);context.restore();}
    }
    const hour=state.clock%1440/60;
    if(hour>6&&hour<19){
      context.save();for(let i=0;i<2;i++){const x=635+Math.sin(time/1700+i*3)*21,y=196+Math.cos(time/1300+i*2)*12;const wing=Math.sin(time/70)>0?4:1;context.fillStyle=i?'#b5d5ed':'#efd19c';context.fillRect(x-wing,y,wing,3);context.fillRect(x+1,y,wing,3);context.fillStyle='#6b7852';context.fillRect(x,y,1,4);}context.restore();
    }
  }
  let glow=null;
  function lighting(context,time,state,camera,width,height){
    if(!loaded||!state)return;
    const hour=state.clock%1440/60,daylight=Math.max(0,Math.min(1,(hour-5)/2,(20-hour)/2)),night=1-daylight;
    context.save();context.globalAlpha=night*.36;context.fillStyle='#172b4c';context.fillRect(0,0,width,height);context.restore();
    if(night<.05)return;
    if(!glow){glow=document.createElement('canvas');glow.width=96;glow.height=96;const g=glow.getContext('2d'),light=g.createRadialGradient(48,48,1,48,48,48);light.addColorStop(0,'#ffdc8ba0');light.addColorStop(.3,'#ffd47b55');light.addColorStop(1,'#ffd47b00');g.fillStyle=light;g.fillRect(0,0,96,96);}
    context.save();context.translate(camera.x,camera.y);context.scale(camera.scale,camera.scale);context.globalAlpha=night*(.85+Math.sin(time/900)*.04);
    context.drawImage(glow,594-48,278-48);
    for(const b of state.buildings){if(!b.built||b.kind==='farm')continue;const x=(b.x+b.w/2)*32,y=(b.y+b.h)*32-26;context.drawImage(glow,x-38,y-38,76,76);context.fillStyle='#ffd68e';context.fillRect(x-4,y-9,8,9);}
    for(let i=0;i<12;i++){const x=35+(i*19+Math.sin(time/1400+i)*9)%200,y=500+(i*13+Math.cos(time/1700+i)*12)%115;context.globalAlpha=night*(.3+.3*Math.sin(time/500+i));context.fillStyle='#e5eaa1';context.fillRect(x,y,2,2);}
    context.restore();
  }
  function hit(point){
    for(const item of scenery){
      if(!item.action)continue;const spec=manifest?.assets[item.key];if(!spec)continue;
      const [w,h]=spec.size,[ax,ay]=spec.anchor;
      if(point.x>=item.x-ax*item.scale&&point.x<=item.x+(w-ax)*item.scale&&point.y>=item.y-ay*item.scale&&point.y<=item.y+(h-ay)*item.scale)return{view:item.action,id:null,name:item.name};
    }return null;
  }
  const compact = typeof document !== 'undefined' && document.documentElement.dataset.renderProfile === 'tcg';
  const ready=fetch(compact?'assets/tcg/scenery.json':'assets/scenery.json').then(response=>{if(!response.ok)throw new Error('Scene atlas unavailable');return response.json();}).then(async data=>{
    manifest=data;
    const results=await Promise.allSettled(Object.entries(data.sheets).map(([key,spec])=>new Promise((resolve,reject)=>{
      const image=new Image();image.onload=()=>{if(image.naturalWidth!==spec.size[0]||image.naturalHeight!==spec.size[1])return reject(new Error('Unexpected scene sheet size'));sheets.set(key,image);resolve();};image.onerror=()=>reject(new Error('Scene sheet unavailable'));image.src='assets/'+spec.file;
    })));
    for(const [key,spec] of Object.entries(data.assets)){
      const image=sheets.get(spec.sheet);if(!image)continue;
      const [sx,sy,sw,sh]=spec.rect,[width,height]=spec.size;
      const sprite=document.createElement('canvas');sprite.width=width;sprite.height=height;
      const context=sprite.getContext('2d');context.imageSmoothingEnabled=false;
      if(spec.anchor&&!data.prerendered){const scale=Math.min((width-2)/sw,(spec.anchor[1]-1)/sh);const dw=Math.round(sw*scale),dh=Math.round(sh*scale);context.drawImage(image,sx,sy,sw,sh,Math.round((width-dw)/2),spec.anchor[1]-dh,dw,dh);}
      else context.drawImage(image,sx,sy,sw,sh,0,0,width,height);
      sprites.set(key,sprite);
    }
    loaded=['grass','dirt','water','hall','house','granary'].every(key=>sprites.has(key));
    document.documentElement.dataset.sceneSheets=String(sheets.size);document.documentElement.dataset.sceneSprites=String(sprites.size);
    // Gameplay draws from the cropped sprites once the large source atlases have been decoded.
    sheets.clear();
    if(results.some(result=>result.status==='rejected'))console.warn('Some scene artwork could not be loaded.');
    document.dispatchEvent(new Event('village-map-ready'));
  }).catch(()=>{document.documentElement.dataset.sceneSprites='0';});
  return {ready,ground,meadow,building,drawScenery,groundMotion,atmosphere,lighting,hit,at,within,scenery:()=>loaded?scenery:[]};
})();
