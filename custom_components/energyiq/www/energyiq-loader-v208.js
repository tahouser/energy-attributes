/* EnergyIQ v2.0.8 resilient frontend loader. Load the base panel first, then optional layers independently. */
(async () => {
  const load = async (path) => {
    try { await import(`${path}?v=208`); }
    catch (error) { console.error(`EnergyIQ frontend layer failed: ${path}`, error); }
  };

  // The base panel is mandatory and must finish defining the custom element
  // before any overlay attempts to patch it.
  await load("./energy-attribution-panel.js");
  await customElements.whenDefined("energy-attribution-panel-v35");

  // Essential UI layers. Each is isolated so one bad optional module cannot
  // prevent the remaining EnergyIQ interface from loading.
  await load("./energy-attribution-state.js");
  await load("./energyiq-all-views-v206.js");

  // Secondary features are deliberately isolated from the core panel.
  await load("./energy-attribution-diagnostic.js");
  await load("./energy-attribution-long-cycle.js");
  await load("./energy-attribution-accounting.js");

  // Ensure the visible version is never supplied by an obsolete frontend layer.
  const setVersion = () => {
    const panel = document.querySelector("energy-attribution-panel-v35");
    const sub = panel?.querySelector(".sub");
    if (sub) sub.textContent = "Whole-home electrical intelligence · v2.0.8";
  };
  setVersion();
  new MutationObserver(setVersion).observe(document.documentElement, {childList:true, subtree:true});
})();
