/* EnergyIQ v2.1.9 frontend loader. */
(async () => {
  const load = async (path) => {
    try { await import(`${path}?v=219`); return true; }
    catch (error) { console.error(`EnergyIQ frontend layer failed: ${path}`, error); return false; }
  };
  const setVersion = (panel) => {
    const sub = panel?.querySelector?.(".sub");
    if (sub) sub.textContent = "Whole-home electrical intelligence · v2.1.9";
  };
  const panelLoaded = await load("./energyiq-panel.js");
  if (!panelLoaded) return;
  const proto = customElements.get("energyiq-panel-v209")?.prototype;
  if (proto) {
    proto._ws = function (message) {
      const hass = this._hass;
      if (hass?.callWS) {
        return Promise.race([
          hass.callWS(message),
          new Promise((_, reject) => setTimeout(() => reject(new Error(`EnergyIQ WebSocket timeout: ${message?.type || "unknown command"}`)), 10000)),
        ]);
      }
      if (hass?.connection?.sendMessagePromise) return hass.connection.sendMessagePromise(message);
      throw new Error("EnergyIQ: Home Assistant WebSocket API is not available.");
    };
    if (typeof proto._render === "function" && !proto.__energyiqVersionPatched219) {
      const originalRender = proto._render;
      proto._render = function (...args) {
        const result = originalRender.apply(this, args);
        setVersion(this);
        return result;
      };
      proto.__energyiqVersionPatched219 = true;
    }
  }
  await load("./energyiq-ui-v214.js");
  await load("./energyiq-ui-v216.js");
  await load("./energyiq-ui-v217.js");
  await load("./energyiq-state-v218.js");
  await load("./energyiq-all-views.js");
  await load("./energyiq-diagnostic.js");
  await load("./energyiq-long-cycle.js");
  await load("./energyiq-accounting.js");
  const applyVersion = () => setVersion(document.querySelector("energyiq-panel-v209"));
  const panel = document.querySelector("energyiq-panel-v209");
  applyVersion();
  if (panel && !panel.__energyiqVersionObserver219) {
    const observer = new MutationObserver(applyVersion);
    observer.observe(panel, { childList: true, subtree: true, characterData: true });
    panel.__energyiqVersionObserver219 = observer;
  }
  [100, 500, 1500, 3000, 5000].forEach(ms => setTimeout(applyVersion, ms));
})();
