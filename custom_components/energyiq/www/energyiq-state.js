/* EnergyIQ live state indicator overlay. */
(() => {
  const TAG = "energyiq-panel-v209";
  const install = () => {
    const Panel = customElements.get(TAG);
    if (!Panel || Panel.prototype.__energyiqStatePatched) return !!Panel;
    Panel.prototype.__energyiqStatePatched = true;
    const originalRender = Panel.prototype._render;
    Panel.prototype._render = function (...args) {
      const result = originalRender.apply(this, args);
      requestAnimationFrame(() => this._energyiqAddStateColumn());
      return result;
    };
    Panel.prototype._energyiqAddStateColumn = function () {
      const table = this.querySelector(".table-wrap table");
      if (!table || table.dataset.energyiqStateReady === "1") return;
      const devices = this.data?.devices || [];
      const selectedIds = this._pendingSelections || new Set(devices.filter(x => x.classification === "monitor").map(x => x.device_id));
      const visible = devices.filter(x => this._listMode === "excluded" ? !selectedIds.has(x.device_id) : selectedIds.has(x.device_id));
      const ordered = [...visible].sort((a,b) => { const an=!!a.manual_added,bn=!!b.manual_added; if(an!==bn)return an?-1:1; const am=String(a.source||"").toLowerCase()==="manual",bm=String(b.source||"").toLowerCase()==="manual"; if(am!==bm)return am?-1:1; return String(a.name).localeCompare(String(b.name)); });
      const header = table.querySelector("tr"); if (!header) return;
      const th = document.createElement("th"); th.textContent = "State"; header.insertBefore(th, header.children[5] || null);
      const rows = [...table.querySelectorAll("tr")].slice(1);
      rows.forEach((row, index) => { const device = ordered[index]; const td = document.createElement("td"); td.className = "energyiq-state-cell"; td.innerHTML = this._energyiqStateHtml(device); row.insertBefore(td, row.children[5] || null); });
      table.dataset.energyiqStateReady = "1";
      this._energyiqStateTimer && clearInterval(this._energyiqStateTimer);
      this._energyiqStateTimer = setInterval(() => this._energyiqRefreshStates(), 500);
    };
    Panel.prototype._energyiqEntityState = function (device) {
      const hass = this._hass; if (!hass || !device) return {kind:"unknown", label:"Unknown"};
      const controls = device.controls || [];
      for (const item of controls) { const entityId = item?.entity_id; const state = entityId ? hass.states?.[entityId] : null; if (!state) continue; if (state.state === "on") return {kind:"on", label:"ON"}; if (state.state === "off") return {kind:"off", label:"OFF"}; }
      const measurements = device.measurements || [];
      for (const item of measurements) { const entityId = item?.entity_id; const state = entityId ? hass.states?.[entityId] : null; if (!state) continue; const value = Number(state.state); if (Number.isFinite(value)) return value > 0 ? {kind:"on", label:"ON"} : {kind:"off", label:"OFF"}; }
      return {kind:"unknown", label:"—"};
    };
    Panel.prototype._energyiqStateHtml = function (device) { const state = this._energyiqEntityState(device); const title = state.kind === "on" ? "Entity is ON" : state.kind === "off" ? "Entity is OFF" : "Entity state unavailable"; return `<span class="energyiq-state ${state.kind}" title="${title}" aria-label="${state.label}"><span class="energyiq-state-dot"></span><span>${state.label}</span></span>`; };
    Panel.prototype._energyiqRefreshStates = function () {
      if (!this.isConnected) return;
      const rows = [...this.querySelectorAll(".table-wrap table tr")].slice(1); const devices = this.data?.devices || []; const selectedIds = this._pendingSelections || new Set(devices.filter(x => x.classification === "monitor").map(x => x.device_id)); const visible = devices.filter(x => this._listMode === "excluded" ? !selectedIds.has(x.device_id) : selectedIds.has(x.device_id)); const ordered = [...visible].sort((a,b) => { const an=!!a.manual_added,bn=!!b.manual_added; if(an!==bn)return an?-1:1; const am=String(a.source||"").toLowerCase()==="manual",bm=String(b.source||"").toLowerCase()==="manual"; if(am!==bm)return am?-1:1; return String(a.name).localeCompare(String(b.name)); });
      rows.forEach((row,index) => { const cell = row.querySelector(".energyiq-state-cell"); if (cell && ordered[index]) cell.innerHTML = this._energyiqStateHtml(ordered[index]); });
    };
    const style = document.createElement("style"); style.textContent = `.energyiq-state{display:inline-flex;align-items:center;gap:7px;font-weight:600;white-space:nowrap}.energyiq-state-dot{width:13px;height:13px;border-radius:50%;display:inline-block;box-sizing:border-box;border:1px solid var(--divider-color)}.energyiq-state.on .energyiq-state-dot{background:#2e7d32;border-color:#2e7d32}.energyiq-state.off .energyiq-state-dot{background:#c62828;border-color:#c62828}.energyiq-state.unknown{color:var(--secondary-text-color);font-weight:400}`; document.head.appendChild(style);
    return true;
  };
  if (!install()) { const timer = setInterval(() => { if (install()) clearInterval(timer); }, 50); }
})();
