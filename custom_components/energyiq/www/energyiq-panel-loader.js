(() => {
  const TARGET = "energyiq-panel-v339";
  const SOURCE = "/energyiq-static/energyiq-panel.js?v=31413";
  const CARD_SOURCE = "/energyiq-static/energyiq-card-3.1.392.js?v=39200";
  const DIAGNOSTIC_SOURCE = "/energyiq-static/energyiq-cost-diagnostic-3.1.391.js?v=39100";

  const loadCard = () => {
    if (customElements.get("energyiq-card")) { const d=document.createElement("script"); d.src=DIAGNOSTIC_SOURCE; document.head.appendChild(d); return; }
    const card = document.createElement("script");
    card.src = CARD_SOURCE;
    card.onload = () => { console.info("EnergyIQ: dashboard card loaded."); const d=document.createElement("script"); d.src=DIAGNOSTIC_SOURCE; document.head.appendChild(d); };
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
