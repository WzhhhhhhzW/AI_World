'use strict';
const VillageProps=(()=>{
  const wheel={x:140.5,y:120.5,radius:27.2,period:18000};let front=null;
  let rooftop;
  const flags=[{x:630,width:35,tile:0,phase:0},{x:821,width:37,tile:40,phase:1.6}];
  function load(file){return new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=()=>reject(Error('场景部件加载失败'));im.src=file==='waterwheel-front-v1.png'&&document.documentElement.dataset.renderProfile==='tcg'?'assets/tcg/waterwheel-front-v1.webp':'assets/props/'+file;});}
  const ready=typeof Image==='undefined'?Promise.resolve():Promise.all([load('waterwheel-front-v1.png'),load('rooftop-motion.png')]).then(([wheelImage,sheet])=>{
    front=wheelImage;rooftop=sheet;document.documentElement.dataset.wheelArt='timber-front-v1';
  });
  function cleanPlate(image){
    const plate=document.createElement('canvas');plate.width=image.naturalWidth;plate.height=image.naturalHeight;
    const c=plate.getContext('2d');c.drawImage(image,0,0);
    for(const f of flags)c.drawImage(rooftop,f.tile,32,f.width,28,f.x,180,f.width,28);
    c.drawImage(rooftop,80,32,40,44,970,371,40,44);
    return plate;
  }
  function flutter(u,time,wind,phase){
    const wave=time/310+phase-u*5;
    return Math.round(u*(2.7+wind*4.7)*(Math.sin(wave)+.22*Math.sin(2*wave)));
  }
  function rooftops(c,time,sky,strip=2){
    if(!rooftop)return;
    c.save();c.scale(1/1.6,1/1.6);
    for(const f of flags)for(let x=0;x<f.width;x+=strip){
      const width=Math.min(strip,f.width-x);
      c.drawImage(rooftop,f.tile+x,0,width,28,f.x+x,180+flutter(x/(f.width-1),time,sky.wind,f.phase),width,28);
    }
    // Oldest first; the small new puff covers the mouth as the preceding curl lifts.
    for(let i=5;i>=0;i--){
      const age=((time%960)/960+i)/6;
      const drift=age*(5+sky.wind*29)+Math.sin(age*8)*age*4;
      const size=6+age*22;
      c.globalAlpha=(1-age*age)*(1-sky.rain*.22);
      c.drawImage(rooftop,80,0,23,21,Math.round(990+drift-size/2),Math.round(414-age*47-size*.85),size,size*.9);
    }
    c.globalAlpha=.76;
    const stem=4+Math.sin(time/310)*.6;
    c.drawImage(rooftop,80,0,23,21,988,414-stem,stem,stem);
    c.restore();
  }
  function frameAt(time){return {angle:Math.max(0,time)%wheel.period/wheel.period*Math.PI*2};}
  function draw(c,time){
    const {angle}=frameAt(time);c.save();c.translate(wheel.x,wheel.y);c.transform(.79,-.11,.1,1,0,0);
    c.fillStyle='#473018';c.beginPath();c.arc(0,0,27,0,Math.PI*2);c.fill();
    if(front){
      c.save();c.rotate(angle);c.drawImage(front,139,139,982,982,-28,-28,56,56);c.restore();
      c.save();c.beginPath();c.arc(0,0,6,0,Math.PI*2);c.clip();c.drawImage(front,529,529,196,196,-6,-6,12,12);c.restore();
    }
    c.restore();c.save();c.fillStyle='#62d8e9';
    c.beginPath();c.moveTo(145,128);c.lineTo(153,130);c.lineTo(158,151);c.lineTo(148,151);c.closePath();c.fill();
    for(let i=0;i<7;i++){const q=(time/(570+i*37)+i*.173)%1;c.globalAlpha=.4+(1-q)*.4;c.fillStyle=i%2?'#d9ffff':'#a7eff2';c.fillRect(146+i%3*2+q*3,130+q*19,1,3+i%3);c.globalAlpha=(1-q)*.55;c.fillRect(150+(i%3-1)*q*8,151+q*4,1.4,1.4);}c.restore();
  }
  return {wheel,ready,frameAt,draw,cleanPlate,flutter,rooftops};
})();
