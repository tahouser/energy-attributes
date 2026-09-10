/* EnergyIQ v2.1.8 live state indicator overlay.
 * Keeps each state indicator attached to its actual EnergyIQ device instead of
 * assigning states by row index. This prevents one entity's state from appearing
 * on another entity when pending monitor selections change the visible rows.
 */
(() => {
  const TAG = "energyiq-panel-v209";

  const install = () => {
    const Panel = customElements.get(TAG);
    if (!Panel || Panel.prototype.__energyiqStatePatched218) return !!Panel;
    Panel.prototype.__energyiqStatePatched218 = true;

    const originalRender = Panel.prototype._render;
    Panel.prototype._render = function (...args) {
      const result = originalRender.apply(this, args);
      requestAnimationFrame(() => this._energyiqAddStateColumn218());
      return result;
    };

    Panel.prototype._energyiqFindDeviceForRow218 = function (row) {
      const devices = this.data?.devices || [];
      const box = row?.querySelector?.("input.monitor-box");
      const ds = box?.dataset || {};
      const id = ds.deviceId || ds.device || ds.id || ds.monitor;
      if (id != null) {
        const found = devices.find(d => String(d.device_id) === String(id));
        if (found) return found;
      }

      const text = (row?.textContent || "").toLowerCase();
      let found = devices.find(d => d.device_id && text.includes(String(d.device_id).toLowerCase()));
      if (found) return found;
      found = devices.find(d => d.entity_id && text.includes(String(d.entity_id).toLowerCase()));
      if (found) return found;
      return devices.find(d => d.name && text.includes(String(d.name).toLowerCase())) || null;
    };

    Panel.prototype._energyiqEntityState218 = function (device) {
      const hass = this._hass;
      if (!hass || !device) return {kind: "unknown", label: "—"};

      const controls = device.controls || [];
      for (const item of controls) {
        const entityId = item?.entity_id;
        const state = entityId ? hass.states?.[entityId] : null;
        if (!state) continue;
        if (state.state === "on") return {kind: "on", label: "ON"};
        if (state.state === "off") return {kind: "off", label: "OFF"};
      }

      const measurements = device.measurements || [];
      for (const item of measurements) {
        const entityId = item?.entity_id;
        const state = entityId ? hass.states?.[entityId] : null;
        if (!state) continue;
        const value = Number(state.state);
        if (Number.isFinite(value)) return value > 0 ? {kind: "on", label: "ON"} : {kind: "off", label: "OFF"};
      }

      return {kind: "unknown", label: "—"};
    };

    Panel.prototype._energyiqStateHtml218 = function (device) {
      const state = this._energyiqEntityState218(device);
      const title = state.kind === "on" ? "Entity is ON" : state.kind === "off" ? "Entity is OFF" : "Entity state unavailable";
      const id = device?.device_id ? String(device.device_id).replace(/"/g, "&quot;") : "";
      return `<span class="energyiq-state energyiq-state-218 ${state.kind}" data-device-id="${id}" title="${title}" aria-label="${state.label}"><span class="energyiq-state-dot"></span><span>${state.label}</span></span>`;
    };

    Panel.prototype._energyiqAddStateColumn218 = function () {
      const table = this.querySelector(".table-wrap table");
      if (!table || table.dataset.energyiqStateReady218 === "1") return;

      const header = table.querySelector("tr");
      if (!header) return;

      const rows = [...table.querySelectorAll("tr")].slice(1);
      const th = document.createElement("th");
      th.textContent = "State";
      header.insertBefore(th, header.children[5] || null);

      rows.forEach(row => {
        const device = this._energyiqFindDeviceForRow218(row);
        const td = document.createElement("td");
        td.className = "energyiq-state-cell-218";
        td.innerHTML = this._energyiqStateHtml218(device);
        row.insertBefore(td, row.children[5] || null);
      });

      table.dataset.energyiqStateReady218 = "1";
      this._energyiqStateTimer218 && clearInterval(this._energyiqStateTimer218);
      this._energyiqStateTimer218 = setInterval(() => this._energyiqRefreshStates218(), 500);
    };

    Panel.prototype._energyiqRefreshStates218 = function () {
      if (!this.isConnected) return;
      const table = this.querySelector(".table-wrap table");
      if (!table) return;

      table.querySelectorAll(".energyiq-state-cell-218").forEach(cell => {
        const row = cell.closest("tr");
        const device = this._energyiqFindDeviceForRow218(row);
        if (device) cell.innerHTML = this._energyiqStateHtml218(device);
      });
    };

    const style = document.createElement("style");
    style.textContent = `
      .energyiq-state-218{display:inline-flex;align-items:center;gap:7px;font-weight:600;white-space:nowrap}
      .energyiq-state-218 .energyiq-state-dot{width:13px;height:13px;border-radius:50%;display:inline-block;box-sizing:border-box;border:1px solid var(--divider-color)}
      .energyiq-state-218.on .energyiq-state-dot{background:#2e7d32;border-color:#2e7d32}
      .energyiq-state-218.off .energyiq-state-dot{background:#c62828;border-color:#c62828}
      .energyiq-state-218.unknown{color:var(--secondary-text-color);font-weight:400}
    `;
    document.head.appendChild(style);

    return true;
  };

  if (!install()) {
    const timer = setInterval(() => { if (install()) clearInterval(timer); }, 50);
  }
})();
