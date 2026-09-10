/* EnergyIQ v2.2.6 unique panel element. */
import "./energyiq-panel.js?v=226";

const BASE_TAG = "energyiq-panel-v209";
const TAG = "energyiq-panel-v226";

if (!customElements.get(TAG)) {
  const Base = customElements.get(BASE_TAG);
  if (!Base) throw new Error(`EnergyIQ base panel ${BASE_TAG} was not defined.`);
  class EnergyIQPanelV226 extends Base {}
  customElements.define(TAG, EnergyIQPanelV226);
}
