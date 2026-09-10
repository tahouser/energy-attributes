/* EnergyIQ v2.1.6 interaction fixes.
 * Fixes monitor checkbox toggling and restores normal mobile vertical scrolling.
 */
(async () => {
  const tag = "energyiq-panel-v209";
  const panel = customElements.get(tag);
  if (!panel || !panel.prototype) return;
  const proto = panel.prototype;
  if (proto.__energyiqUi216) return;
  proto.__energyiqUi216 = true;

  const patch = (self) => {
    if (self.__energyiqCheckboxFix216) return;
    self.__energyiqCheckboxFix216 = true;

    // The v2.1.4 capture-phase click handler reads box.checked after the
    // browser has already toggled it, then inverts it again. Pre-invert the
    // value during pointer/keyboard activation so that handler lands on the
    // user's requested state.
    self.addEventListener("pointerdown", (ev) => {
      const box = ev.target?.closest?.("input.monitor-box");
      if (!box) return;
      box.checked = !box.checked;
    }, true);

    self.addEventListener("keydown", (ev) => {
      if (ev.key !== " " && ev.key !== "Enter") return;
      const box = ev.target?.closest?.("input.monitor-box");
      if (!box) return;
      box.checked = !box.checked;
    }, true);
  };

  const originalRender = proto._render;
  proto._render = function (...args) {
    const result = originalRender.apply(this, args);
    patch(this);
    const style = this.querySelector("#energyiq-ui-216-style") || document.createElement("style");
    style.id = "energyiq-ui-216-style";
    style.textContent = `
      .table-wrap{touch-action:auto!important;overflow-y:visible!important;-webkit-overflow-scrolling:touch!important;overscroll-behavior-x:auto!important}
    `;
    if (!style.parentNode) this.appendChild(style);
    return result;
  };
})();
