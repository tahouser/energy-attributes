/* EnergyIQ v2.1.1 frontend loader. Stable panel registration and cache-busted startup. */
(async () => {
  const load = async (path) => {
    try { await import(`${path}?v=211`); return true; }
    catch (error) { console.error(`EnergyIQ frontend layer failed: ${path}`, error); return false; }
  };

  const setVersion = (panel) => {
    const sub = panel?.querySelector?.(".sub");
    if (sub) sub.textContent = "Whole-home electrical intelligence · v2.1.1";
  };

  // Keep the Home Assistant panel element name stable. The loader itself is
  // uniquely versioned, so stale v2.0.9 loader assets are not reused.
  const panelLoaded = await load("./energyiq-panel.js");
  if (!panelLoaded) return;

  // The panel historically used HA's older connection API. Patch it after the
  // module registers the element, before normal panel startup requests run.
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
      if (hass?.connection?.sendMessagePromise) {
        return hass.connection.sendMessagePromise(message);
      }
      throw new Error("EnergyIQ: Home Assistant WebSocket API is not available.");
    };

    // _render() creates the header asynchronously, so changing the subtitle
    // only once at loader startup is too early. Wrap the render method so the
    // v2.1.1 label is applied every time the panel rebuilds its DOM.
    if (typeof proto._render === "function" && !proto.__energyiqVersionPatched) {
      const originalRender = proto._render;
      proto._render = function (...args) {
        const result = originalRender.apply(this, args);
        setVersion(this);
        return result;
      };
      proto.__energyiqVersionPatched = true;
    }
  }

  // Supporting layers are loaded after the panel transport is patched.
  await load("./energyiq-state.js");
  await load("./energyiq-all-views.js");
  await load("./energyiq-diagnostic.js");
  await load("./energyiq-long-cycle.js");
  await load("./energyiq-accounting.js");

  const panel = document.querySelector("energyiq-panel-v209");
  setVersion(panel);
  setTimeout(() => setVersion(document.querySelector("energyiq-panel-v209")), 100);
  setTimeout(() => setVersion(document.querySelector("energyiq-panel-v209")), 500);
})();
