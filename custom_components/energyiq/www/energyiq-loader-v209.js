/* EnergyIQ v2.1.1 compatibility loader. Keep the historical panel element name, but force the current frontend version and modules. */
(async () => {
  const load = async (path) => {
    try { await import(`${path}?v=211`); }
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
    if (sub) sub.textContent = "Whole-home electrical intelligence · v2.1.1";
  };
  setVersion();
  new MutationObserver(setVersion).observe(document.documentElement, {childList:true, subtree:true});
})();
