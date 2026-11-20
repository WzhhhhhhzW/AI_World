'use strict';
const VillageAvatars = (() => {
  let manifest = null, image = null;
  const sprites = new Map();
  function draw(context, key, x, feetY, height=56) {
    const sprite = sprites.get(key);
    if (!sprite) return false;
    const width = Math.round(height * sprite.width / sprite.height);
    context.imageSmoothingEnabled = false;
    context.drawImage(sprite, Math.round(x-width/2), Math.round(feetY-height), width, height);
    return true;
  }
  function paintChoices(root=document) {
    root.querySelectorAll('canvas[data-avatar]').forEach(element => {
      const context=element.getContext('2d');
      context.clearRect(0,0,element.width,element.height);
      if(draw(context,element.dataset.avatar,element.width/2,element.height-6,element.height-12))element.dataset.artReady='true';
    });
  }
  const compact = typeof document !== 'undefined' && document.documentElement.dataset.renderProfile === 'tcg';
  const ready=fetch(compact?'assets/tcg/avatars.json':'assets/avatars.json').then(response=>{
    if(!response.ok)throw new Error('Avatar manifest unavailable');
    return response.json();
  }).then(data=>new Promise((resolve,reject)=>{
    manifest=data;image=new Image();
    image.onload=()=>{
      if(image.naturalWidth!==data.size[0]||image.naturalHeight!==data.size[1])return reject(new Error('Avatar sheet size mismatch'));
      for(const [key,spec] of Object.entries(data.characters)){
        const [sx,sy,sw,sh]=spec.rect;
        const sprite=document.createElement('canvas');sprite.width=sw;sprite.height=sh;
        const context=sprite.getContext('2d');context.imageSmoothingEnabled=false;
        // The supplied atlas has close adjacent silhouettes. Clip each source region
        // to its own contour so a neighbour's hair or weapon cannot leak into it.
        if(spec.clip?.length){context.beginPath();context.moveTo(...spec.clip[0]);for(const point of spec.clip.slice(1))context.lineTo(...point);context.closePath();context.clip();}
        context.drawImage(image,sx,sy,sw,sh,0,0,sw,sh);sprites.set(key,sprite);
      }
      document.documentElement.dataset.avatarCount=String(sprites.size);
      paintChoices();document.dispatchEvent(new Event('village-avatars-ready'));resolve();
    };
    image.onerror=()=>reject(new Error('Avatar sheet unavailable'));
    image.src='assets/'+data.file;
  })).catch(()=>{document.documentElement.dataset.avatarCount='0';});
  return {draw,paintChoices,ready};
})();
