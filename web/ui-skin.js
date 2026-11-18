'use strict';
const VillageSkin=(()=>{
  const ready=fetch('assets/ui-skin-v2.json').then(r=>{if(!r.ok)throw Error('UI skin unavailable');return r.json();}).then(async atlas=>{
    const image=await new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=reject;im.src='assets/'+atlas.file;});
    if(image.naturalWidth!==atlas.size[0]||image.naturalHeight!==atlas.size[1])throw Error('UI skin dimensions mismatch');
    for(const [key,spec] of Object.entries(atlas.sprites)){
      const [x,y,w,h]=spec.rect;
      if(x<0||y<0||x+w>image.naturalWidth||y+h>image.naturalHeight)throw Error('UI region out of bounds');
      const tile=document.createElement('canvas');tile.width=w;tile.height=h;
      const c=tile.getContext('2d');c.imageSmoothingEnabled=false;c.drawImage(image,x,y,w,h,0,0,w,h);
      document.documentElement.style.setProperty('--skin-'+key,`url("${tile.toDataURL('image/png')}")`);
    }
    document.documentElement.dataset.uiSkin=atlas.version;
    document.documentElement.dataset.uiSkinRegions=String(Object.keys(atlas.sprites).length);
  });
  return {ready};
})();
