/* EnergyIQ v1.7.17 frontend repair: correct the stale panel version label and route touch gestures so vertical page scrolling works on iOS while retaining horizontal table scrolling. */
const TAG = "energy-attribution-panel-v35";
const proto = customElements.get(TAG)?.prototype;

if (proto && !proto.__energyIq1717Fix) {
  const originalRender = proto._render;
  proto._render = function(...args) {
    originalRender.apply(this, args);
    const sub = this.querySelector(".sub");
    if (sub) sub.textContent = "Whole-home electrical intelligence · v1.7.17";
    const wrap = this.querySelector(".table-wrap");
    if (wrap && !wrap.__energyIqTouchFix) {
      wrap.__energyIqTouchFix = true;
      wrap.style.touchAction = "pan-y";
      wrap.style.overscrollBehaviorX = "none";
      let startX = 0;
      let startY = 0;
      let startScrollLeft = 0;
      let horizontal = false;
      wrap.addEventListener("touchstart", (e) => {
        if (e.touches.length !== 1) return;
        const t = e.touches[0];
        startX = t.clientX;
        startY = t.clientY;
        startScrollLeft = wrap.scrollLeft;
        horizontal = false;
      }, {passive:true});
      wrap.addEventListener("touchmove", (e) => {
        if (e.touches.length !== 1) return;
        const t = e.touches[0];
        const dx = t.clientX - startX;
        const dy = t.clientY - startY;
        if (!horizontal && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) horizontal = true;
        if (horizontal) {
          e.preventDefault();
          wrap.scrollLeft = startScrollLeft - dx;
        }
      }, {passive:false});
    }
  };
  proto.__energyIq1717Fix = true;
}
