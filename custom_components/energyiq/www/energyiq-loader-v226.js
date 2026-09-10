/* EnergyIQ v2.2.6 frontend loader. Proven unique panel startup with early WebSocket patch. */
(async () => {
  const VERSION = "2.2.6";
  const ws = function(message) {
    const hass = this._hass;
    if (hass?.connection?.sendMessagePromise) {
      return Promise.race([
        hass.connection.sendMessagePromise(message),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`EnergyIQ WebSocket timeout: ${message?.type || "unknown command"}`)), 15000)),
      ]);
    }
    if (hass?.callWS) {
      return Promise.race([
        hass.callWS(message),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`EnergyIQ WebSocket timeout: ${message?.type || "unknown command"}`)), 15000)),
      ]);
    }
    throw new Error("EnergyIQ: Home Assistant WebSocket connection is not ready.");
  };

  try {
    await import(`./energyiq-panel.js?v=226`);
    const legacy = customElements.get("energyiq-panel-v209");
    if (!legacy) throw new Error("EnergyIQ base panel did not register.");
    legacy.prototype._ws = ws;

    if (!customElements.get("energyiq-panel-v226")) {
      customElements.define("energyiq-panel-v226", class EnergyIQPanelV226 extends legacy {});
    }
    const Panel = customElements.get("energyiq-panel-v226");
    Panel.prototype._ws = ws;

    const load = async path => {
      try { await import(`${path}?v=226`); return true; }
      catch (error) {
        console.error(`EnergyIQ frontend layer failed: ${path}`, error);
        const panel = document.querySelector("energyiq-panel-v226");
        if (panel) panel.innerHTML = `<ha-card style="display:block;padding:24px"><h2>EnergyIQ</h2><p style="color:var(--error-color)">EnergyIQ frontend failed to load: ${String(error?.message || error).replace(/[<>&]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]))}</p></ha-card>`;
        return false;
      }
    };

    await load("./energyiq-long-cycle-v226.js");
    await load("./energyiq-clean-v226.js");

    const setVersion = () => {
      const panel = document.querySelector("energyiq-panel-v226");
      const sub = panel?.querySelector?.(".sub");
      if (sub) sub.textContent = `Whole-home electrical intelligence · v${VERSION}`;
    };
    [0, 100, 500, 1500, 3000, 5000].forEach(ms => setTimeout(setVersion, ms));
  } catch (error) {
    console.error("EnergyIQ v2.2.6 startup failed", error);
    const panel = document.querySelector("energyiq-panel-v226");
    if (panel) panel.innerHTML = `<ha-card style="display:block;padding:24px"><h2>EnergyIQ</h2><p style="color:var(--error-color)">EnergyIQ startup failed: ${String(error?.message || error).replace(/[<>&]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]))}</p></ha-card>`;
  }
})();
