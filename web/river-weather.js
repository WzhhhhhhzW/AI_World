'use strict';
const VillageWeather=(()=>{
  const cherryTrees=[
    {x:286,y:145,rx:43,ry:22,fall:125},{x:608,y:40,rx:49,ry:22,fall:122},
    {x:866,y:48,rx:39,ry:23,fall:119},{x:942,y:203,rx:29,ry:24,fall:130},
    {x:21,y:208,rx:30,ry:27,fall:127},{x:215,y:600,rx:42,ry:22,fall:86}
  ];
  const fraction=x=>x-Math.floor(x);
  const random=n=>fraction(Math.sin(n*127.1+311.7)*43758.5453);
  function petalState(tree,index,time){
    const seed=index+tree.x*.17,period=8500+random(seed+1)*5000;
    const phase=fraction(Math.max(0,time)/period+random(seed+2));
    const fall=Math.min(1,phase/.83),rest=Math.max(0,(phase-.83)/.17);
    return {x:tree.x+(random(seed+3)-.5)*tree.rx*2+fall*(18+random(seed+4)*42)+Math.sin(fall*9+seed)*8,
      y:tree.y+(random(seed+5)-.5)*tree.ry*2+Math.pow(fall,.9)*tree.fall,
      angle:Math.sin(time/930+seed)*1.1+fall*5,
      flutter:.28+Math.abs(Math.sin(time/540+seed))*.72,
      alpha:(.68+random(seed+6)*.26)*(1-rest),size:.7+random(seed+7)*.65,resting:phase>.83};
  }
  function samplePath(points,phase){
    const lengths=points.slice(1).map((p,i)=>Math.hypot(p[0]-points[i][0],p[1]-points[i][1]));
    let remaining=fraction(phase)*lengths.reduce((a,b)=>a+b,0);
    for(let i=0;i<lengths.length;i++){
      if(remaining<=lengths[i]||i===lengths.length-1){const t=remaining/(lengths[i]||1),a=points[i],b=points[i+1];return {x:a[0]+(b[0]-a[0])*t,y:a[1]+(b[1]-a[1])*t,dx:(b[0]-a[0])/(lengths[i]||1),dy:(b[1]-a[1])/(lengths[i]||1)};}
      remaining-=lengths[i];
    }
    return {x:points[0][0],y:points[0][1],dx:0,dy:1};
  }
  function wetPixel(r,g,b,inRiver){return !!inRiver&&g>110&&b>142&&g>r*1.16&&b>r*1.25;}
  function create(plate,layout){
    const w=layout.width,h=layout.height;
    const make=()=>{const el=document.createElement('canvas');el.width=w;el.height=h;return el;};
    const source=make(),s=source.getContext('2d',{willReadFrequently:true});s.drawImage(plate,0,0,w,h);
    const pixels=s.getImageData(0,0,w,h).data;
    const region=make(),r=region.getContext('2d',{willReadFrequently:true});
    r.strokeStyle='#fff';r.lineWidth=68;r.lineCap='round';r.lineJoin='round';r.beginPath();
    layout.water_glints.forEach(([x,y],i)=>i?r.lineTo(x,y):r.moveTo(x,y));r.stroke();
    const territory=r.getImageData(0,0,w,h).data;
    const fullMask=make(),full=fullMask.getContext('2d'),data=full.createImageData(w,h);
    const upperMask=make(),lowerMask=make(),up=upperMask.getContext('2d'),low=lowerMask.getContext('2d');
    const du=up.createImageData(w,h),dl=low.createImageData(w,h);
    let waterPixels=0,movingPixels=0;
    for(let p=0;p<w*h;p++){
      const i=p*4;
      if(wetPixel(pixels[i],pixels[i+1],pixels[i+2],territory[i+3])){data.data[i]=data.data[i+1]=data.data[i+2]=data.data[i+3]=255;waterPixels++;}
    }
    // Keep the sampled current away from banks so shifted texture never drags land into water.
    for(let y=7;y<h-7;y++)for(let x=7;x<w-7;x++){
      const p=y*w+x,i=p*4;
      if(!data.data[i+3]||[-6,6,-6*w,6*w].some(n=>!data.data[(p+n)*4+3]))continue;
      const out=y<490?du.data:dl.data;out[i]=out[i+1]=out[i+2]=out[i+3]=255;movingPixels++;
    }
    full.putImageData(data,0,0);up.putImageData(du,0,0);low.putImageData(dl,0,0);
    const buffer=make(),b=buffer.getContext('2d');b.imageSmoothingEnabled=false;
    function current(c,time,mask,dx,dy,period){
      const q=fraction(time/period);b.clearRect(0,0,w,h);b.globalCompositeOperation='source-over';
      b.globalAlpha=1-q;b.drawImage(plate,Math.round(q*dx),Math.round(q*dy),w,h);
      b.globalAlpha=q;b.drawImage(plate,Math.round((q-1)*dx),Math.round((q-1)*dy),w,h);
      b.globalAlpha=1;b.globalCompositeOperation='destination-in';b.drawImage(mask,0,0);
      b.globalCompositeOperation='source-over';c.save();c.globalAlpha=.79;c.drawImage(buffer,0,0);c.restore();
    }
    function ground(c,time,climate={rain:0}){
      current(c,time,upperMask,1,6,1800);current(c,time,lowerMask,6,1,1600);
      b.clearRect(0,0,w,h);b.globalCompositeOperation='source-over';
      for(let i=0;i<54;i++){
        const q=fraction(time/18000+i/54),p=samplePath(layout.water_glints,q),side=Math.sin(i*7.3)*13;
        const x=p.x-p.dy*side,y=p.y+p.dx*side;
        b.globalAlpha=.25+random(i)*.38;b.strokeStyle=i%7===0?'#ffc6e4':'#e1ffff';b.lineWidth=i%7===0?2:1;
        b.beginPath();b.moveTo(x,y);b.lineTo(x-p.dx*(3+i%4),y-p.dy*(3+i%4));b.stroke();
      }
      if(climate.rain>.025)for(let i=0;i<Math.round(45*climate.rain);i++){
        const p=samplePath(layout.water_glints,random(i+121)),q=fraction(time/1300+random(i+50));
        b.globalAlpha=(1-q)*climate.rain*.6;b.strokeStyle='#e0f9f5';b.lineWidth=.8;b.beginPath();b.ellipse(p.x+Math.sin(i)*14,p.y+Math.cos(i)*10,1+q*5,.5+q*2,0,0,Math.PI*2);b.stroke();
      }
      b.globalAlpha=1;b.globalCompositeOperation='destination-in';b.drawImage(fullMask,0,0);b.globalCompositeOperation='source-over';c.drawImage(buffer,0,0);
      // Faster narrow streaks, spray and expanding foam at the real waterfall landings.
      for(const [x,y] of [[281,53],[249,94],[93,276],[56,325]]){
        c.save();for(let i=0;i<9;i++){const q=fraction(time/(550+i%3*80)+i*.193);c.globalAlpha=(1-q)*.48;c.fillStyle='#edffff';c.fillRect(x+(i%3-1)*2+Math.sin(i)*2,y+q*18,1+i%2,3+i%4);}
        for(let i=0;i<3;i++){const q=fraction(time/1500+i/3);c.globalAlpha=(1-q)*.3;c.strokeStyle='#e8ffff';c.lineWidth=1;c.beginPath();c.ellipse(x,y+20,2+q*8,1+q*3,0,0,Math.PI*2);c.stroke();}c.restore();
      }
    }
    function petals(c,time,climate={wind:.35,rain:0}){
      for(const tree of cherryTrees)for(let i=0;i<12;i++){
        const p=petalState(tree,i,time);if(p.y>h+5||p.x>w+5||p.alpha<.04)continue;
        c.save();c.translate(p.x+Math.sin(time/1700+i)*climate.wind*5,p.y);c.rotate(p.angle+climate.wind*.2);c.scale(p.size*p.flutter,p.size);c.globalAlpha=p.alpha*(1-climate.rain*.3);
        c.fillStyle=i%3===0?'#fff0f5':'#f9b3d7';c.fillRect(-1,-2,2,4);c.fillRect(-2,-1,4,2);c.fillStyle='#d97aab';c.fillRect(0,1,1,1);c.restore();
      }
    }
    document.documentElement.dataset.environmentEffects='river-current waterfall-foam sakura-petals';
    document.documentElement.dataset.waterMaskPixels=String(waterPixels);
    document.documentElement.dataset.waterMovingPixels=String(movingPixels);
    document.documentElement.dataset.sakuraEmitters=String(cherryTrees.length);
    return {ground,petals};
  }
  return {create,petalState,samplePath,wetPixel,cherryTrees};
})();
