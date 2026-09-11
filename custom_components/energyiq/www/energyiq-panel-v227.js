/* EnergyIQ v2.2.7 clean panel entry point. */
import "./energyiq-panel.js?v=227";

const BASE_TAG = "energyiq-panel-v209";
const TAG = "energyiq-panel-v227";

if (!customElements.get(TAG)) {
  const Base = customElements.get(BASE_TAG);
  if (!Base) {
    throw new Error(`EnergyIQ base panel ${BASE_TAG} was not defined.`);
  }

  class EnergyIQPanelV227 extends Base {
    _ws(message) {
      const hass = this._hass;
      if (hass?.callWS) {
        return Promise.race([
          hass.callWS(message),
          new Promise((_, reject) => setTimeout(() => reject(new Error(`EnergyIQ WebSocket timeout: ${message?.type || "unknown command"}`)), 15000)),
        ]);
      }
      if (hass?.connection?.sendMessagePromise) {
        return Promise.race([
          hass.connection.sendMessagePromise(message),
          new Promise((_, reject) => setTimeout(() => reject(new Error(`EnergyIQ WebSocket timeout: ${message?.type || "unknown command"}`)), 15000)),
        ]);
      }
      throw new Error("EnergyIQ: Home Assistant WebSocket connection is not ready.");
    }

    _render() {
      super._render();
      const sub = this.querySelector?.(".sub");
      if (sub) sub.textContent = "Whole-home electrical intelligence · v2.2.7";
    }
  }

  customElements.define(TAG, EnergyIQPanelV227);
}
