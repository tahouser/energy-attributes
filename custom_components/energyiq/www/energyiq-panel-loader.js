(() => {
  const TARGET = "energyiq-panel-v326";
  const SOURCE = "/energyiq-static/energyiq-panel.js?v=31380";
  const defineAlias = () => {
    if (customElements.get(TARGET)) return true;
    const Base = customElements.get("energyiq-panel-v325");
    if (!Base) return false;
    class EnergyIQPanelV326 extends Base {}
    customElements.define(TARGET, EnergyIQPanelV326);
    return true;
  };
  if (defineAlias()) return;
  const script = document.createElement("script");
  script.src = SOURCE;
  script.onload = () => {
    if (!defineAlias()) console.error("EnergyIQ: v325 panel did not register.");
  };
  script.onerror = () => console.error("EnergyIQ: failed to load panel source.");
  document.head.appendChild(script);
})();
