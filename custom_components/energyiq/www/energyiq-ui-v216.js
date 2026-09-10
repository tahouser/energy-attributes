/* EnergyIQ v2.1.6 interaction fixes.
 * Keeps the mobile scrolling fix while leaving checkbox state handling to v2.1.4.
 */
(async () => {
  const tag = "energyiq-panel-v209";
  const panel = customElements.get(tag);
  if (!panel || !panel.prototype) return;
  const proto = panel.prototype;
  if (proto.__energyiqUi216) return;
  proto.__energyiqUi216 = true;

  const originalRender = proto._render;
  proto._render = function (...args) {
    const result = originalRender.apply(this, args);
    const style = this.querySelector("#energyiq-ui-216-style") || document.createElement("style");
    style.id = "energyiq-ui-216-style";
    style.textContent = `
      .table-wrap{touch-action:auto!important;overflow-y:visible!important;-webkit-overflow-scrolling:touch!important;overscroll-behavior-x:auto!important}
    `;
    if (!style.parentNode) this.appendChild(style);
    return result;
  };
})();
