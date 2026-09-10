/* EnergyIQ v2.1.1 frontend loader. Unique loader URL and component name prevent stale v2.0.9 frontend assets from being reused. */
(async () => {
  const load = async (path) => {
    try { await import(`${path}?v=211`); }
    catch (error) { console.error(`EnergyIQ frontend layer failed: ${path}`, error); }
  };

  await load("./energyiq-panel.js");
  await customElements.whenDefined("energyiq-panel-v209");

  const proto = customElements.get("energyiq-panel-v209")?.prototype;
  if (proto) {
    proto._ws = function (message) {
      const hass = this._hass;
      if (!hass?.callWS) {
        throw new Error("EnergyIQ: Home Assistant WebSocket API is not available.");
      }
      return Promise.race([
        hass.callWS(message),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`EnergyIQ WebSocket timeout: ${message?.type || "unknown command"}`)), 10000)),
      ]);
    };
  }

  await load("./energyiq-state.js");
  await load("./energyiq-all-views.js");
  await load("./energyiq-diagnostic.js");
  await load("./energyiq-long-cycle.js");
  await load("./energyiq-accounting.js");

  const setVersion = () => {
    const panel = document.querySelector("energyiq-panel-v211") || document.querySelector("energyiq-panel-v209");
    const sub = panel?.querySelector(".sub");
    if (sub) sub.textContent = "Whole-home electrical intelligence · v2.1.1";
  };
  setVersion();
  new MutationObserver(setVersion).observe(document.documentElement, {childList:true, subtree:true});
})();
