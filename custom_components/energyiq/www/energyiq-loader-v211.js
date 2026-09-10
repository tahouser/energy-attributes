/* EnergyIQ v2.1.1 frontend loader. Unique panel element and robust startup. */
(async () => {
  const load = async (path) => {
    try { await import(`${path}?v=211`); return true; }
    catch (error) { console.error(`EnergyIQ frontend layer failed: ${path}`, error); return false; }
  };

  const panelLoaded = await load("./energyiq-panel.js");
  if (!panelLoaded) return;

  // energyiq-panel.js historically registers v209. Create a genuinely new
  // element name for v2.1.1 so Home Assistant cannot reuse a stale v209 class.
  const legacy = customElements.get("energyiq-panel-v209");
  if (legacy && !customElements.get("energyiq-panel-v211")) {
    customElements.define("energyiq-panel-v211", class EnergyIQPanelV211 extends legacy {});
  }

  // Patch the panel's websocket transport before its first request.
  const proto = customElements.get("energyiq-panel-v211")?.prototype || legacy?.prototype;
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
    const panel = document.querySelector("energyiq-panel-v211");
    const sub = panel?.querySelector(".sub");
    if (sub) sub.textContent = "Whole-home electrical intelligence · v2.1.1";
  };
  setVersion();
  setTimeout(setVersion, 100);
  setTimeout(setVersion, 500);
})();
