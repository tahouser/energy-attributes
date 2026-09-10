/* EnergyIQ v2.2.2 frontend loader. */
(async () => {
  const load = async path => {
    try { await import(`${path}?v=222`); return true; }
    catch (error) { console.error(`EnergyIQ frontend layer failed: ${path}`, error); return false; }
  };
  if (!await load("./energyiq-panel.js")) return;
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
  }
  // Keep the existing All / Monitored / Excluded implementation, but do not
  // load any of the historical state/checkbox layers. v2.2.2 owns those paths.
  await load("./energyiq-all-views.js");
  await load("./energyiq-ui-v222.js");
  await load("./energyiq-diagnostic.js");
  await load("./energyiq-long-cycle.js");
  await load("./energyiq-accounting.js");
  const setVersion = () => {
    const panel = document.querySelector("energyiq-panel-v209");
    const sub = panel?.querySelector?.(".sub");
    if (sub) sub.textContent = "Whole-home electrical intelligence · v2.2.2";
  };
  const panel = document.querySelector("energyiq-panel-v209");
  if (panel && !panel.__energyiqVersionObserver222) {
    const observer = new MutationObserver(setVersion);
    observer.observe(panel, { childList: true, subtree: true, characterData: true });
    panel.__energyiqVersionObserver222 = observer;
  }
  [100, 500, 1500, 3000, 5000].forEach(ms => setTimeout(setVersion, ms));
})();
