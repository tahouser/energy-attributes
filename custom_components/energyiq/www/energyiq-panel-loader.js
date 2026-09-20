(() => {
  const TARGET = "energyiq-panel-v327";
  const SOURCE = "/energyiq-static/energyiq-panel.js?v=31387";
  const CARD_SOURCE = "/energyiq-static/energyiq-card.js?v=31385";

  const loadCard = () => {
    if (customElements.get("energyiq-card")) return;
    const card = document.createElement("script");
    card.src = CARD_SOURCE;
    card.onload = () => console.info("EnergyIQ: dashboard card loaded.");
    card.onerror = () => console.error("EnergyIQ: failed to load dashboard card.");
    document.head.appendChild(card);
  };

  const defineAlias = () => {
    if (customElements.get(TARGET)) return true;
    const Base = customElements.get("energyiq-panel-v327");
    if (!Base) return false;
    class EnergyIQPanelV327 extends Base {}
    customElements.define(TARGET, EnergyIQPanelV327);
    return true;
  };

  if (defineAlias()) {
    loadCard();
    return;
  }

  const script = document.createElement("script");
  script.src = SOURCE;
  script.onload = () => {
    if (!defineAlias()) console.error("EnergyIQ: v327 panel did not register.");
    loadCard();
  };
  script.onerror = () => console.error("EnergyIQ: failed to load panel source.");
  document.head.appendChild(script);
})();