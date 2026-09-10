/* EnergyIQ v2.2.5 clean loader. */
(async () => {
  const VERSION = "2.2.5";
  const load = async (path) => {
    const url = `${path}?v=225`;
    try {
      await import(url);
      return true;
    } catch (error) {
      console.error(`EnergyIQ frontend layer failed: ${path}`, error);
      const panel = document.querySelector("energyiq-panel-v209");
      if (panel) {
        panel.innerHTML = `<ha-card style="display:block;padding:24px"><h2>EnergyIQ</h2><p style="color:var(--error-color)">EnergyIQ frontend failed to load: ${String(error?.message || error).replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]))}</p></ha-card>`;
      }
      return false;
    }
  };

  if (!await load("./energyiq-panel.js")) return;

  const proto = customElements.get("energyiq-panel-v209")?.prototype;
  if (!proto) return;

  // Use the current Home Assistant WebSocket API with a timeout, while keeping
  // the older connection fallback for compatibility.
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

  // Only the diagnostic, Long Cycle, and single clean monitoring/state layers
  // are loaded. The old v2.1/v2.2 monitoring layers remain excluded.
  await load("./energyiq-diagnostic.js");
  await load("./energyiq-long-cycle.js");
  await load("./energyiq-clean-v223.js");

  const setVersion = () => {
    const panel = document.querySelector("energyiq-panel-v209");
    const sub = panel?.querySelector?.(".sub");
    if (sub) sub.textContent = `Whole-home electrical intelligence · v${VERSION}`;
  };
  [0, 100, 500, 1500, 3000, 5000].forEach(ms => setTimeout(setVersion, ms));
})();
