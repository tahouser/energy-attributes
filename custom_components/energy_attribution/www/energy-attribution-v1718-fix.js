const TAG = "energy-attribution-panel-v35";
const proto = customElements.get(TAG)?.prototype;
if (proto && !proto.__energyIq1718Fix) {
  const originalRender = proto._render;
  proto._render = function(...args) {
    originalRender.apply(this,args);
    const sub=this.querySelector(".sub"); if(sub) sub.textContent="Whole-home electrical intelligence · v1.7.18";
    const wrap=this.querySelector(".table-wrap");
    if(wrap&&!wrap.__energyIqTouchFix){wrap.__energyIqTouchFix=true;wrap.style.touchAction="pan-y";let sx=0,sy=0,sl=0,axis=null;
      wrap.addEventListener("touchstart",e=>{if(e.touches.length!==1)return;const t=e.touches[0];sx=t.clientX;sy=t.clientY;sl=wrap.scrollLeft;axis=null},{passive:true});
      wrap.addEventListener("touchmove",e=>{if(e.touches.length!==1)return;const t=e.touches[0],dx=t.clientX-sx,dy=t.clientY-sy;if(!axis&&Math.max(Math.abs(dx),Math.abs(dy))>8)axis=Math.abs(dx)>Math.abs(dy)?"x":"y";if(axis==="x"){e.preventDefault();wrap.scrollLeft=sl-dx;}},{passive:false});
    }
  };
  proto.__energyIq1718Fix=true;
}
