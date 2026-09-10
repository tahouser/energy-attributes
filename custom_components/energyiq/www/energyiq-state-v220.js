/* EnergyIQ v2.2.0 state display.
 * Uses the single State column already rendered by the base panel.
 * Never inserts a second State column. State is resolved from the actual
 * device represented by each row.
 */
(() => {
  const TAG = "energyiq-panel-v209";

  const install = () => {
    const Panel = customElements.get(TAG);
    if (!Panel?.prototype) return false;
    const proto = Panel.prototype;
    if (proto.__energyiqState220) return true;
    proto.__energyiqState220 = true;

    proto._energyiqFindDevice220 = function (row) {
      const devices = this.data?.devices || [];
      const box = row?.querySelector?.("input.monitor-box");
      const id = box?.dataset?.deviceId || box?.dataset?.device || box?.dataset?.id || box?.dataset?.monitor;
      if (id != null) {
        const found = devices.find(d => String(d.device_id) === String(id));
        if (found) return found;
      }
      const text = (row?.textContent || "").toLowerCase();
      return devices.find(d => d.device_id && text.includes(String(d.device_id).toLowerCase()))
        || devices.find(d => d.name && text.includes(String(d.name).toLowerCase()))
        || null;
    };

    proto._energyiqState220 = function (device) {
      if (!device || !this._hass) return {kind:"unknown", label:"—"};
      for (const item of (device.controls || [])) {
        const state = item?.entity_id ? this._hass.states?.[item.entity_id]?.state : null;
        if (state === "on") return {kind:"on", label:"ON"};
        if (state === "off") return {kind:"off", label:"OFF"};
      }
      for (const item of (device.measurements || [])) {
        const state = item?.entity_id ? this._hass.states?.[item.entity_id]?.state : null;
        const value = Number(state);
        if (Number.isFinite(value)) return value > 0 ? {kind:"on", label:"ON"} : {kind:"off", label:"OFF"};
      }
      return {kind:"unknown", label:"—"};
    };

    proto._energyiqApplyStates220 = function () {
      const table = this.querySelector(".table-wrap table");
      if (!table) return;
      const headers = [...table.querySelectorAll("thead th")];
      const stateIndex = headers.findIndex(h => (h.textContent || "").trim().toLowerCase() === "state");
      if (stateIndex < 0) return;
      table.querySelectorAll("tbody tr").forEach(row => {
        const cell = row.querySelectorAll("td")[stateIndex];
        if (!cell) return;
        const device = this._energyiqFindDevice220(row);
        const state = this._energyiqState220(device);
        cell.textContent = state.label;
        cell.dataset.energyiqState220 = "1";
        cell.style.fontWeight = "600";
        cell.style.whiteSpace = "nowrap";
        cell.style.color = state.kind === "on" ? "var(--success-color,#2e7d32)" : state.kind === "off" ? "var(--error-color,#c62828)" : "var(--secondary-text-color)";
      });
    };

    const originalRender = proto._render;
    proto._render = function (...args) {
      const result = originalRender.apply(this, args);
      requestAnimationFrame(() => this._energyiqApplyStates220());
      return result;
    };

    const tick = () => document.querySelectorAll(TAG).forEach(panel => panel._energyiqApplyStates220?.());
    setInterval(tick, 500);
    return true;
  };

  if (!install()) {
    const timer = setInterval(() => { if (install()) clearInterval(timer); }, 50);
  }
})();
