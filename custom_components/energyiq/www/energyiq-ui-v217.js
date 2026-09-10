/* EnergyIQ v2.1.7 interaction fix.
 * Preserves the user's list/page scroll position when the 1-second data refresh
 * rebuilds the EnergyIQ panel DOM.
 */
(async () => {
  const tag = "energyiq-panel-v209";
  const panel = customElements.get(tag);
  if (!panel || !panel.prototype) return;
  const proto = panel.prototype;
  if (proto.__energyiqUi217) return;
  proto.__energyiqUi217 = true;

  const originalRender = proto._render;

  const captureScroll = (self) => {
    const positions = [];
    let node = self;
    while (node) {
      if (typeof node.scrollTop === "number" || typeof node.scrollLeft === "number") {
        positions.push({ node, top: node.scrollTop || 0, left: node.scrollLeft || 0 });
      }
      node = node.parentElement;
    }
    const table = self.querySelector(".table-wrap");
    if (table) positions.push({ node: table, top: table.scrollTop || 0, left: table.scrollLeft || 0 });
    return { positions, windowX: window.scrollX || 0, windowY: window.scrollY || 0 };
  };

  const restoreScroll = (snapshot) => {
    requestAnimationFrame(() => {
      snapshot.positions.forEach(({ node, top, left }) => {
        if (node && node.isConnected) {
          if (top) node.scrollTop = top;
          if (left) node.scrollLeft = left;
        }
      });
      if (snapshot.windowY || snapshot.windowX) window.scrollTo(snapshot.windowX, snapshot.windowY);
    });
  };

  proto._render = function (...args) {
    const snapshot = captureScroll(this);
    const result = originalRender.apply(this, args);
    restoreScroll(snapshot);
    return result;
  };
})();
