/* EnergyIQ v2.2.3 clean frontend loader. */
(async () => {
  const load = async path => {
    try { await import(`${path}?v=223`); return true; }
    catch (error) { console.error(`EnergyIQ frontend layer failed: ${path}`, error); return false; }
  };
  const setVersion = panel => {
    const sub = panel?.querySelector?.(".sub");
    if (sub) sub.textContent = "Whole-home electrical intelligence · v2.2.3";
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
  // Deliberately omit every legacy monitoring/state layer. Those layers were
  // independently wrapping _render/_save and were the source of duplicate
  // State columns and competing checkbox event handlers.
  await load("./energyiq-diagnostic.js");
  await load("./energyiq-long-cycle.js");
  await load("./energyiq-clean-v223.js");
  const applyVersion = () => setVersion(document.querySelector("energyiq-panel-v209"));
  applyVersion();
  [100, 500, 1500, 3000, 5000].forEach(ms => setTimeout(applyVersion, ms));
})();
