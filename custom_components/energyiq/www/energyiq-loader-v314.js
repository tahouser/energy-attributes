/* EnergyIQ v3.1.14 frontend loader. Uses a unique custom-element identity so a stale browser module cannot keep an older panel instance alive. */
(async () => {
  const path = "./energyiq-panel.js?v=314";
  try {
    await import(path);
    const Base = customElements.get("energyiq-panel-v309");
    const TAG = "energyiq-panel-v314";
    if (!Base || customElements.get(TAG)) return;
    class EnergyIQPanelV314 extends Base {}
    customElements.define(TAG, EnergyIQPanelV314);
  } catch (error) {
    console.error("EnergyIQ frontend loader v3.1.14 failed", error);
  }
})();
