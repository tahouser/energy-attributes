/* EnergyIQ v1.7.19 mobile scroll repair: make the panel itself vertically scrollable on iOS while preserving horizontal table panning. */
const TAG = "energy-attribution-panel-v35";
const proto = customElements.get(TAG)?.prototype;
if (proto && !proto.__energyIq1719Fix) {
  const originalRender = proto._render;
  proto._render = function(...args) {
    originalRender.apply(this,args);
    this.style.display="block";
    this.style.height="calc(100dvh - 56px)";
    this.style.maxHeight="calc(100dvh - 56px)";
    this.style.overflowY="auto";
    this.style.overflowX="hidden";
    this.style.webkitOverflowScrolling="touch";
    this.style.touchAction="pan-y";
    const sub=this.querySelector(".sub");
    if(sub) sub.textContent="Whole-home electrical intelligence · v1.7.19";
    const wrap=this.querySelector(".table-wrap");
    if(wrap&&!wrap.__energyIq1719TouchFix){
      wrap.__energyIq1719TouchFix=true;
      wrap.style.touchAction="pan-y";
      let sx=0,sy=0,sl=0,axis=null;
      wrap.addEventListener("touchstart",e=>{if(e.touches.length!==1)return;const t=e.touches[0];sx=t.clientX;sy=t.clientY;sl=wrap.scrollLeft;axis=null},{passive:true});
      wrap.addEventListener("touchmove",e=>{if(e.touches.length!==1)return;const t=e.touches[0],dx=t.clientX-sx,dy=t.clientY-sy;if(!axis&&Math.max(Math.abs(dx),Math.abs(dy))>8)axis=Math.abs(dx)>Math.abs(dy)?"x":"y";if(axis==="x"){e.preventDefault();wrap.scrollLeft=sl-dx;}},{passive:false});
    }
  };
  proto.__energyIq1719Fix=true;
}
