/* EnergyIQ v2.2.5 isolated panel element. */
import "./energyiq-panel.js?v=225";

const BASE_TAG = "energyiq-panel-v209";
const TAG = "energyiq-panel-v225";

if (!customElements.get(TAG)) {
  const Base = customElements.get(BASE_TAG);
  if (!Base) throw new Error(`EnergyIQ base panel ${BASE_TAG} was not defined.`);
  class EnergyIQPanelV225 extends Base {
    _setVersionLabel() {
      const sub = this.querySelector?.(".sub");
      if (sub) sub.textContent = "Whole-home electrical intelligence · v2.2.5";
    }
    _render(...args) {
      const result = super._render(...args);
      this._setVersionLabel();
      requestAnimationFrame(() => this._setVersionLabel());
      return result;
    }
    connectedCallback() {
      super.connectedCallback();
      this._setVersionLabel();
      requestAnimationFrame(() => this._setVersionLabel());
    }
  }
  customElements.define(TAG, EnergyIQPanelV225);
}
