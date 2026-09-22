(() => {
  const TARGET = "energyiq-panel-v339";
  const SOURCE = "/energyiq-static/energyiq-panel.js?v=31413";
  const CARD_SOURCE = "/energyiq-static/energyiq-card.js?v=31413";

  const loadCard = () => {
    if (customElements.get("energyiq-card")) return;
    const card = document.createElement("script");
    card.src = CARD_SOURCE;
    card.onload = () => console.info("EnergyIQ: dashboard card loaded.");
    card.onerror = () => console.error("EnergyIQ: failed to load dashboard card.");
    document.head.appendChild(card);
  };

  const loadPanel = () => {
    if (customElements.get(TARGET)) {
      loadCard();
      return;
    }
    const script = document.createElement("script");
    script.src = SOURCE;
    script.onload = loadCard;
    script.onerror = () => console.error("EnergyIQ: failed to load panel source.");
    document.head.appendChild(script);
  };

  loadPanel();
})();
