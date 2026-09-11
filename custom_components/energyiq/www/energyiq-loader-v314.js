/* EnergyIQ isolated frontend loader. Top-level await guarantees the panel element exists before Home Assistant instantiates it. */
const path = "./energyiq-panel.js?v=314";

try {
  await import(path);
  const Base = customElements.get("energyiq-panel-v309");
  const TAG = "energyiq-panel-v314";
  if (!Base) throw new Error("EnergyIQ base panel element was not loaded.");
  if (!customElements.get(TAG)) {
    class EnergyIQPanelV314 extends Base {}
    customElements.define(TAG, EnergyIQPanelV314);
  }
} catch (error) {
  console.error("EnergyIQ isolated frontend loader failed", error);
  throw error;
}
