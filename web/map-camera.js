'use strict';
// A bounded world camera: the viewport is always inside the scene, including
// during zoom transitions and after changing the window's aspect ratio.
const VillageCamera=(()=>{
  const clamp=(value,low,high)=>Math.max(low,Math.min(high,value));
  function create(worldWidth=960,worldHeight=640){
    let width=1,height=1,minScale=1,maxScale=2.5,scale=1,targetScale=1;
    let cx=worldWidth/2,cy=worldHeight/2,tx=cx,ty=cy,anchor=null,initialized=false;
    function bound(x,y,s){
      const halfW=(width/2+1)/s,halfH=(height/2+1)/s;
      return {x:clamp(x,halfW,worldWidth-halfW),y:clamp(y,halfH,worldHeight-halfH)};
    }
    function constrain(){
      ({x:cx,y:cy}=bound(cx,cy,scale));
      ({x:tx,y:ty}=bound(tx,ty,targetScale));
    }
    function resize(w,h){
      w=Math.max(1,w);h=Math.max(1,h);
      if(initialized&&w===width&&h===height)return;
      const zoom=initialized?scale/minScale:1,targetZoom=initialized?targetScale/minScale:1;
      width=w;height=h;
      // One pixel of overscan prevents fractional canvas edges exposing a seam.
      minScale=Math.max((width+2)/worldWidth,(height+2)/worldHeight);
      maxScale=minScale*2.5;scale=minScale*zoom;targetScale=minScale*targetZoom;
      anchor=null;initialized=true;constrain();
    }
    function worldAt(x=width/2,y=height/2){return{x:cx+(x-width/2)/scale,y:cy+(y-height/2)/scale};}
    function zoomAt(factor,x=width/2,y=height/2){
      const next=clamp(targetScale*factor,minScale,maxScale);
      if(next===targetScale)return;
      const world=worldAt(x,y);
      anchor={world,x,y};targetScale=next;
      tx=world.x-(x-width/2)/next;ty=world.y-(y-height/2)/next;constrain();
    }
    function panBy(dx,dy){
      anchor=null;targetScale=scale;cx-=dx/scale;cy-=dy/scale;
      ({x:cx,y:cy}=bound(cx,cy,scale));tx=cx;ty=cy;
    }
    function gesture(from,to,factor){
      const world=worldAt(from.x,from.y);
      scale=targetScale=clamp(scale*factor,minScale,maxScale);
      cx=world.x-(to.x-width/2)/scale;cy=world.y-(to.y-height/2)/scale;
      anchor=null;({x:cx,y:cy}=bound(cx,cy,scale));tx=cx;ty=cy;
    }
    function reset(){targetScale=minScale;tx=worldWidth/2;ty=worldHeight/2;anchor=null;constrain();}
    function step(elapsed){
      const blend=1-Math.exp(-Math.min(100,Math.max(0,elapsed))/85);
      scale+=(targetScale-scale)*blend;
      if(Math.abs(targetScale-scale)<.00001)scale=targetScale;
      if(anchor){
        cx=anchor.world.x-(anchor.x-width/2)/scale;
        cy=anchor.world.y-(anchor.y-height/2)/scale;
      }else{cx+=(tx-cx)*blend;cy+=(ty-cy)*blend;
        if(Math.abs(tx-cx)<.002)cx=tx;
        if(Math.abs(ty-cy)<.002)cy=ty;
      }
      constrain();
      if(scale===targetScale)anchor=null;
      return pose();
    }
    function pose(){return{scale,x:width/2-cx*scale,y:height/2-cy*scale,
      zoom:scale/minScale,minScale,canZoomOut:targetScale>minScale+.00001,canZoomIn:targetScale<maxScale-.00001};}
    function moving(){return scale!==targetScale || Math.abs(tx-cx)>.002 || Math.abs(ty-cy)>.002;}
    return {resize,zoomAt,panBy,gesture,reset,step,worldAt,pose,moving};
  }
  return {create};
})();
