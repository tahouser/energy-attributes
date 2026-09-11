/* EnergyIQ stable frontend entry point. */
import "./energyiq-panel.js?v=stable";

const BASE_TAG = "energyiq-panel-v209";
const TAG = "energyiq-panel";

if (!customElements.get(TAG)) {
  const Base = customElements.get(BASE_TAG);
  if (!Base) throw new Error(`EnergyIQ base panel ${BASE_TAG} was not defined.`);

  class EnergyIQPanel extends Base {
    _ws(message) {
      const hass = this._hass;
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error(`EnergyIQ WebSocket timeout: ${message?.type || "unknown command"}`)), 15000));
      if (hass?.callWS) return Promise.race([hass.callWS(message), timeout]);
      if (hass?.connection?.sendMessagePromise) return Promise.race([hass.connection.sendMessagePromise(message), timeout]);
      throw new Error("EnergyIQ: Home Assistant WebSocket connection is not ready.");
    }
    _render() {
      super._render();
      const sub = this.querySelector?.(".sub");
      if (sub) sub.textContent = "Whole-home electrical intelligence · v2.2.9";
    }
  }
  customElements.define(TAG, EnergyIQPanel);
}

import("./energyiq-ui.js?v=stable").catch(error => console.error("EnergyIQ UI extension failed", error));
import("./energyiq-long-cycle.js?v=stable").catch(error => console.error("EnergyIQ Long Cycle extension failed", error));
import("./energyiq-accounting.js?v=stable").catch(error => console.error("EnergyIQ accounting extension failed", error));
