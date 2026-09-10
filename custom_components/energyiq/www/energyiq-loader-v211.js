/* EnergyIQ v2.1.1 frontend loader. Stable panel registration and cache-busted startup. */
(async () => {
  const load = async (path) => {
    try { await import(`${path}?v=211`); return true; }
    catch (error) { console.error(`EnergyIQ frontend layer failed: ${path}`, error); return false; }
  };

  const setVersion = (panel) => {
    const sub = panel?.querySelector?.(".sub");
    if (sub && sub.textContent !== "Whole-home electrical intelligence · v2.1.1") {
      sub.textContent = "Whole-home electrical intelligence · v2.1.1";
    }
  };

  // Keep the Home Assistant panel element name stable. The loader itself is
  // uniquely versioned, so stale v2.0.9 loader assets are not reused.
  const panelLoaded = await load("./energyiq-panel.js");
  if (!panelLoaded) return;

  const proto = customElements.get("energyiq-panel-v209")?.prototype;
  if (proto) {
    // The panel historically used HA's older connection API. Patch it after the
    // module registers the element, before normal panel startup requests run.
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

    // _render() replaces the panel's innerHTML. Keep the version label correct
    // even if an initial render happened before this loader patched the method.
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

  const applyVersion = () => setVersion(document.querySelector("energyiq-panel-v209"));
  applyVersion();

  // The panel can render/re-render asynchronously. Observe its light DOM so
  // the visible build label cannot be overwritten by the legacy v2.0.9 markup.
  const panel = document.querySelector("energyiq-panel-v209");
  if (panel && !panel.__energyiqVersionObserver) {
    const observer = new MutationObserver(applyVersion);
    observer.observe(panel, { childList: true, subtree: true, characterData: true });
    panel.__energyiqVersionObserver = observer;
    applyVersion();
  }

  setTimeout(applyVersion, 100);
  setTimeout(applyVersion, 500);
  setTimeout(applyVersion, 1500);
  setTimeout(applyVersion, 3000);
})();
