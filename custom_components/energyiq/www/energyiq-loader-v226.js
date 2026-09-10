/* EnergyIQ v2.2.6 frontend loader. Unique panel element and cache-busted startup. */
(async () => {
  const VERSION = "2.2.6";
  const load = async (path) => {
    try { await import(`${path}?v=226`); return true; }
    catch (error) {
      console.error(`EnergyIQ frontend layer failed: ${path}`, error);
      const panel = document.querySelector("energyiq-panel-v226");
      if (panel) panel.innerHTML = `<ha-card style="display:block;padding:24px"><h2>EnergyIQ</h2><p style="color:var(--error-color)">EnergyIQ frontend failed to load: ${String(error?.message || error).replace(/[<>&]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]))}</p></ha-card>`;
      return false;
    }
  };

  if (!await load("./energyiq-panel-v226.js")) return;

  const Panel = customElements.get("energyiq-panel-v226");
  if (!Panel) return;

  Panel.prototype._ws = function(message) {
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

  await load("./energyiq-long-cycle-v226.js");
  await load("./energyiq-clean-v226.js");

  const setVersion = () => {
    const panel = document.querySelector("energyiq-panel-v226");
    const sub = panel?.querySelector?.(".sub");
    if (sub) sub.textContent = `Whole-home electrical intelligence · v${VERSION}`;
  };
  [0, 100, 500, 1500, 3000, 5000].forEach(ms => setTimeout(setVersion, ms));
})();
