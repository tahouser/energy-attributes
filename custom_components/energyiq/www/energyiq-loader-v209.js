/* EnergyIQ v2.0.9 frontend loader. Clean EnergyIQ custom-element identity; no legacy panel tag. */
(async () => {
  const load = async (path) => {
    try { await import(`${path}?v=209`); }
    catch (error) { console.error(`EnergyIQ frontend layer failed: ${path}`, error); }
  };

  await load("./energyiq-panel.js");
  await customElements.whenDefined("energyiq-panel-v209");
  await load("./energyiq-state.js");
  await load("./energyiq-all-views.js");
  await load("./energyiq-diagnostic.js");
  await load("./energyiq-long-cycle.js");
  await load("./energyiq-accounting.js");

  const setVersion = () => {
    const panel = document.querySelector("energyiq-panel-v209");
    const sub = panel?.querySelector(".sub");
    if (sub) sub.textContent = "Whole-home electrical intelligence · v2.0.9";
  };
  setVersion();
  new MutationObserver(setVersion).observe(document.documentElement, {childList:true, subtree:true});
})();
