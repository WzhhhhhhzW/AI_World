'use strict';
// Fictional village weather. The forecast uses saved village minutes, while
// particles and transitions use the same pauseable visual clock as the river.
const VillageClimate=(()=>{
  const types={
    sunny:{label:'晴天',note:'暖阳照着屋顶，村间有轻风。',cloud:.08,rain:0,fog:0,wind:.35},
    cloudy:{label:'多云',note:'云影慢慢掠过石板路，光线柔和下来。',cloud:.72,rain:0,fog:.02,wind:.75},
    rain:{label:'细雨',note:'细雨斜落，溪流与石板路上泛起涟漪。',cloud:.95,rain:.82,fog:.12,wind:.95},
    mist:{label:'薄雾',note:'雾气沿溪谷缓缓流动，远处的树木若隐若现。',cloud:.45,rain:0,fog:.78,wind:.2}
  };
  const modes=['auto',...Object.keys(types)],cycle=['sunny','cloudy','rain','cloudy','sunny','mist'];
  const clamp=n=>Math.max(0,Math.min(1,n)),frac=n=>n-Math.floor(n);
  const random=n=>frac(Math.sin(n*127.1+311.7)*43758.5453);
  const smooth=n=>{n=clamp(n);return n*n*(3-2*n);};
  function slotWeather(slot){
    const day=Math.floor(slot/6),hourSlot=((slot%6)+6)%6;
    return cycle[(hourSlot+Math.floor(random(day+31)*6))%6];
  }
  function sample(clock,mode='auto'){
    clock=Math.max(0,Number(clock)||0);mode=modes.includes(mode)?mode:'auto';
    const slot=Math.floor(clock/240),id=mode==='auto'?slotWeather(slot):mode;
    const previous=mode==='auto'?types[slotWeather(Math.max(0,slot-1))]:types[id];
    const next=types[id],blend=mode==='auto'?smooth(clock%240/20):1;
    const out={id,label:next.label,note:next.note,mode,nextIn:240-clock%240};
    for(const key of ['cloud','rain','fog','wind'])out[key]=previous[key]+(next[key]-previous[key])*blend;
    return out;
  }
  function drop(index,time,wind=1){
    const phase=frac(Math.max(0,time)/(850+random(index+19)*500)+random(index+1));
    return {x:random(index+2)*1060-70+phase*wind*70,y:-55+phase*750,length:5+random(index+3)*6,alpha:.22+random(index+4)*.32};
  }
  function icon(canvas,id){
    if(!canvas)return;const c=canvas.getContext('2d');c.clearRect(0,0,canvas.width,canvas.height);
    c.save();c.scale(canvas.width/24,canvas.height/24);c.imageSmoothingEnabled=false;
    if(id==='sunny'||id==='auto'){
      c.fillStyle='#c28425';c.fillRect(8,6,8,12);c.fillRect(6,8,12,8);
      c.fillStyle='#ffe28b';c.fillRect(8,8,8,8);c.fillStyle='#f3bc48';
      for(const [x,y,w,h] of [[11,1,2,3],[11,20,2,3],[1,11,3,2],[20,11,3,2],[4,4,2,2],[18,4,2,2],[4,18,2,2],[18,18,2,2]])c.fillRect(x,y,w,h);
    }else{
      c.fillStyle='#647d87';c.fillRect(3,10,19,7);c.fillRect(7,6,10,11);
      c.fillStyle=id==='rain'?'#a9c0c8':'#e3e1ca';c.fillRect(3,10,17,5);c.fillRect(7,7,9,8);
      if(id==='rain'){c.fillStyle='#66a8bf';for(let i=0;i<3;i++){c.fillRect(5+i*6,18,2,3);c.fillRect(4+i*6,21,2,2);}}
      if(id==='mist'){c.fillStyle='#ccd6c6';c.fillRect(1,17,15,2);c.fillRect(7,21,16,2);}
    }
    c.restore();
  }
  function create(storage=null){
    let mode='auto',frame=null,lastTime=null,fogTexture=null;
    try{const saved=storage?.getItem('village-weather-v1');if(modes.includes(saved))mode=saved;}catch{}
    function setMode(value){
      if(!modes.includes(value))return false;mode=value;
      try{storage?.setItem('village-weather-v1',mode);}catch{}
      return true;
    }
    function advance(clock,time){
      const target=sample(clock,mode),dt=lastTime===null?0:Math.max(0,time-lastTime);lastTime=time;
      if(!frame)frame={...target};
      const blend=1-Math.exp(-Math.min(100,dt)/380);
      for(const key of ['cloud','rain','fog','wind'])frame[key]+=(target[key]-frame[key])*blend;
      return {...target,cloud:frame.cloud,rain:frame.rain,fog:frame.fog,wind:frame.wind,settled:['cloud','rain','fog','wind'].every(k=>Math.abs(frame[k]-target[k])<.005)};
    }
    function ground(c,time,weather){
      if(weather.rain<.025)return;
      c.save();
      // Fixed walkways, away from roofs and the crop beds.
      for(const [x,y,rx] of [[446,331,15],[526,359,11],[382,352,9],[577,431,14],[479,484,11],[660,413,9]]){
        c.globalAlpha=weather.rain*.15;c.fillStyle='#a2bec2';c.beginPath();c.ellipse(x,y,rx,rx*.29,0,0,Math.PI*2);c.fill();
        const q=frac(time/1900+x*.17);c.globalAlpha=weather.rain*(1-q)*.32;c.strokeStyle='#e0e6cf';c.lineWidth=.7;c.beginPath();c.ellipse(x,y,2+q*rx,1+q*rx*.25,0,0,Math.PI*2);c.stroke();
      }
      c.restore();
    }
    function screen(c,time,weather,camera,w,h,clock){
      const hour=clock%1440/60,day=Math.max(0,Math.min(1,(hour-5)/2,(20-hour)/2));
      c.save();c.fillStyle='#314b60';c.globalAlpha=weather.cloud*.1;c.fillRect(0,0,w,h);
      if(weather.id==='sunny'){c.fillStyle='#ffe6aa';c.globalAlpha=day*.026;c.fillRect(0,0,w,h);}
      c.translate(camera.x,camera.y);c.scale(camera.scale,camera.scale);
      // Cloud shadows stay in world space when the camera moves.
      c.fillStyle='#354854';c.globalAlpha=weather.cloud*.045*day;
      for(let i=0;i<4;i++){
        const x=frac(time/(95000/(weather.wind+.2))+i*.271)*1600-380,y=70+i*142;
        c.beginPath();c.ellipse(x,y,130,42,-.25,0,Math.PI*2);c.ellipse(x+100,y+15,100,32,-.25,0,Math.PI*2);c.fill();
      }
      if(weather.rain>.025){
        c.strokeStyle='#dbebeb';c.lineWidth=.7;
        for(let i=0;i<Math.round(190*weather.rain);i++){
          const p=drop(i,time,weather.wind);c.globalAlpha=p.alpha*weather.rain;
          c.beginPath();c.moveTo(p.x,p.y);c.lineTo(p.x-weather.wind*p.length*.42,p.y-p.length);c.stroke();
        }
      }
      if(weather.fog>.025){
        if(!fogTexture){
          fogTexture=document.createElement('canvas');fogTexture.width=240;fogTexture.height=80;
          const f=fogTexture.getContext('2d'),g=f.createRadialGradient(120,40,1,120,40,120);
          g.addColorStop(0,'#dfe7dbe0');g.addColorStop(.5,'#cbd9d080');g.addColorStop(1,'#cbd9d000');f.fillStyle=g;f.fillRect(0,0,240,80);
        }
        c.globalAlpha=weather.fog*.34;
        for(let i=0;i<6;i++){const x=frac(time/110000+i*.233)*1460-350,y=85+i*105+Math.sin(time/15000+i)*12;c.drawImage(fogTexture,x,y,480,150);}
      }
      c.restore();
    }
    return {setMode,advance,ground,screen,get mode(){return mode;}};
  }
  return {types,modes,sample,drop,icon,create};
})();
