/*
 * EnergyIQ — single frontend application.
 *
 * The backend is the source of truth. This file owns presentation and user
 * interaction only; it does not maintain a second copy of EnergyIQ state.
 */
(() => {
  const TAG = "energyiq-panel-v316";
  const VERSION = null;

  if (customElements.get(TAG)) return;

  class EnergyIQPanel extends HTMLElement {
    constructor() {
      super();
      this.hass = null;
      this.entryId = null;
      this.workspace = null;
      this.bulk = null;
      this.view = "monitored";
      this.pending = null;
      this.trainSelected = new Set();
      this.loading = false;
      this.refreshTimer = null;
      this.bulkTimer = null;
    }

    setConfig() {}
    set hass(value) { this._hass = value; if (value && !this.loading && !this.workspace) this.load(); }
    get hass() { return this._hass; }
    connectedCallback() { if (!this.workspace) this.renderLoading(); if (this.hass && !this.loading) this.load(); }
    disconnectedCallback() { this.stopTimers(); }
    stopTimers() { if (this.refreshTimer) clearInterval(this.refreshTimer); if (this.bulkTimer) clearInterval(this.bulkTimer); this.refreshTimer = null; this.bulkTimer = null; }

    async ws(message) {
      if (this.hass?.callWS) return this.hass.callWS(message);
      if (this.hass?.connection?.sendMessagePromise) return this.hass.connection.sendMessagePromise(message);
      throw new Error("Home Assistant WebSocket connection is not ready.");
    }

    async load() {
      if (this.loading) return;
      this.loading = true;
      try {
        const result = await this.ws({ type: "energy_attribution/list_entries" });
        if (!result.entries?.length) throw new Error("EnergyIQ is not configured.");
        this.entryId = result.entries[0].entry_id;
        await this.refresh();
        this.refreshTimer = setInterval(() => this.refresh(), 2000);
      } catch (error) { this.renderError(error); }
      finally { this.loading = false; }
    }

    async refresh(forceRender = false) {
      if (!this.hass || !this.entryId) return;
      try {
        const hadWorkspace = !!this.workspace;
        this.workspace = await this.ws({ type: "energy_attribution/workspace", entry_id: this.entryId });
        this.bulk = await this.ws({ type: "energy_attribution/bulk_training_state", entry_id: this.entryId });
        if (this.bulk?.status === "running") this.startBulkPolling(); else this.stopBulkPolling();
        if (!hadWorkspace || forceRender) this.render(); else this.updateLiveData();
      } catch (error) { console.error("EnergyIQ refresh failed", error); if (!this.workspace) this.renderError(error); }
    }

    startBulkPolling() {
      if (this.bulkTimer) return;
      this.bulkTimer = setInterval(async () => {
        try {
          this.bulk = await this.ws({ type: "energy_attribution/bulk_training_state", entry_id: this.entryId });
          this.updateLiveData();
          if (this.bulk?.status !== "running") this.stopBulkPolling();
        } catch (error) { console.error("EnergyIQ bulk status", error); }
      }, 1000);
    }
    stopBulkPolling() { if (this.bulkTimer) clearInterval(this.bulkTimer); this.bulkTimer = null; }

    updateLiveData() {
      const devices = this.getDevices();
      const byId = new Map(devices.map(d => [d.device_id, d]));
      this.querySelectorAll("tr[data-device-id]").forEach(row => {
        const device = byId.get(row.dataset.deviceId); if (!device) return;
        const training = device.training || {};
        const liveDelta = Number(training.live_delta_w), normalPower = Number(device.current_power);
        const power = training.status === "active" && Number.isFinite(liveDelta) ? liveDelta : normalPower;
        const powerCell = row.querySelector(".power-cell"); if (powerCell) powerCell.textContent = Number.isFinite(power) ? `${power.toFixed(0)} W` : "—";
        const stateCell = row.querySelector(".state-cell"); if (stateCell) stateCell.innerHTML = this.renderState(device);
        const trainingCell = row.querySelector(".training"); if (trainingCell) trainingCell.textContent = this.trainingLabel(training);
        const methodCell = row.querySelector(".method-cell"); if (methodCell) methodCell.textContent = training.method || "—";
        const actionsCell = row.querySelector(".actions");
        if (actionsCell) {
          const monitored = this.getSelectedIds().has(device.device_id), manual = String(device.source || "").toLowerCase() === "manual";
          const action = training.status === "active" ? `<button data-stop="${this.attr(device.device_id)}">Stop</button>` : manual ? `<button data-manual="${this.attr(device.device_id)}">${training.status === "complete" ? "Retrain Manual" : "Manual Training"}</button>` : `<button data-quick="${this.attr(device.device_id)}">Quick ON/OFF</button><button data-full="${this.attr(device.device_id)}">Full Cycle</button>`;
          actionsCell.innerHTML = monitored ? action : "";
        }
      });
      const summary = this.querySelector("#summary-area"); if (summary) summary.innerHTML = this.renderSummary();
      const bulk = this.querySelector("#bulk-area"); if (bulk) bulk.innerHTML = this.renderBulk();
      this.bindActionButtons();
    }

    bindActionButtons() {
      this.querySelectorAll("[data-quick]").forEach(b => b.onclick = () => this.startTraining(b.dataset.quick, "quick"));
      this.querySelectorAll("[data-full]").forEach(b => b.onclick = () => this.startTraining(b.dataset.full, "full_cycle"));
      this.querySelectorAll("[data-manual]").forEach(b => b.onclick = () => this.startTraining(b.dataset.manual, "manual"));
      this.querySelectorAll("[data-stop]").forEach(b => b.onclick = () => this.stopTraining(b.dataset.stop));
    }
    renderLoading() { this.innerHTML = `<ha-card class="loading"><h2>EnergyIQ</h2><p>Loading workspace…</p></ha-card>`; }
    renderError(error) { this.innerHTML = `<ha-card class="error"><h2>EnergyIQ</h2><p>${this.escape(error?.message || error)}</p></ha-card>`; }
    getDevices() { return Array.isArray(this.workspace?.devices) ? this.workspace.devices : []; }
    getPersistedIds() { return new Set(this.getDevices().filter(d => d.classification === "monitor").map(d => d.device_id)); }
    getSelectedIds() { if (this.pending) return new Set(this.pending); return this.getPersistedIds(); }

    stateFor(device) {
      const candidates = [...(device.controls || []), ...(device.measurements || [])];
      for (const item of candidates) { const id = item?.entity_id, state = id ? this.hass?.states?.[id]?.state : null; if (state === "on" || state === "off") return state; }
      return null;
    }
    quickObservationText(training) {
      const observations = training?.result?.observations || training?.learned_signature?.observations || [];
      if (!Array.isArray(observations) || !observations.length) return "";
      return observations.map((item, index) => { const value = Number(item?.delta_w); return `C${index + 1}: ${Number.isFinite(value) ? value.toFixed(0) : "—"} W`; }).join(" · ");
    }
    trainingLabel(training) {
      const status = training?.status || "not trained", observations = this.quickObservationText(training);
      if (status === "active") { const base = training.instruction || `Training: ${training.phase || "in progress"}`; return observations ? `${base} · ${observations}` : base; }
      if (status === "complete") return observations ? `Complete · ${observations}` : "Complete";
      if (status === "error") { const base = training.error || training.instruction || "training failed"; return observations ? `Error: ${base} · ${observations}` : `Error: ${base}`; }
      if (status === "stopped") return observations ? `Stopped · ${observations}` : "Stopped";
      if (status === "interrupted") return "Interrupted";
      return "Not trained";
    }
    renderState(device) { const state = this.stateFor(device), label = state === "on" ? "ON" : state === "off" ? "OFF" : "—"; return `<span class="state-box ${state || "unknown"}">${label}</span>`; }

    renderSummary() {
      const devices = this.getDevices(), monitored = devices.filter(d => this.getPersistedIds().has(d.device_id)), trained = monitored.filter(d => d.training?.status === "complete").length, untrained = monitored.length - trained;
      const home = Number(this.workspace?.whole_home_power), trainedWatts = Number(this.workspace?.trained_live_power_w || 0), mystery = Number.isFinite(home) ? Math.max(0, home - trainedWatts) : null;
      const fmt = value => Number.isFinite(value) ? `${value.toFixed(0)} W` : "—";
      return `<div class="summary"><div class="metric"><span>Home Power Now</span><strong>${fmt(home)}</strong></div><div class="metric"><span>Trained Active Watts</span><strong>${fmt(trainedWatts)}</strong></div><div class="metric mystery"><span>Mystery Watts</span><strong>${fmt(mystery)}</strong></div><div class="metric"><span>Monitored</span><strong>${monitored.length}</strong></div><div class="metric"><span>Trained</span><strong>${trained}</strong></div><div class="metric"><span>Untrained</span><strong>${untrained}</strong></div></div>`;
    }
    renderBulk() {
      const b = this.bulk || { status: "idle" }; if (b.status !== "running") return "";
      const total = Number(b.total || 0), completed = Number(b.completed || 0), current = Number(b.current_index || 0), percent = total ? Math.min(100, Math.round((completed / total) * 100)) : 0, currentDevice = this.getDevices().find(d => d.device_id === b.current_device_id);
      return `<div class="bulk"><strong>Bulk training in progress</strong><span>${current} of ${total}${currentDevice ? ` · ${this.escape(currentDevice.name)}` : ""}</span><div class="progress"><i style="width:${percent}%"></i></div><small>${completed} completed · ${percent}%</small></div>`;
    }

    render() {
      if (!this.workspace) return;
      const devices = this.getDevices(), persisted = this.getPersistedIds(), selected = this.getSelectedIds(), trainSelected = this.trainSelected;
      const visible = devices.filter(d => { if (this.view === "all") return true; if (this.view === "monitored") return persisted.has(d.device_id); return !persisted.has(d.device_id); }).sort((a, b) => String(a.name).localeCompare(String(b.name)));
      this.innerHTML = `<style>${this.styles()}</style><div class="shell"><header><div><h1>EnergyIQ</h1><p>Whole-home electrical intelligence · v${this.workspace?.version || "?"}</p></div><div class="header-actions"><button id="add">＋ Add Device / Entity</button><button id="save" class="primary">Save Monitoring</button></div></header><div id="summary-area">${this.renderSummary()}</div><div id="bulk-area">${this.renderBulk()}</div><div class="toolbar"><div class="views"><button id="all" class="${this.view === "all" ? "selected" : ""}">All (${devices.length})</button><button id="monitored" class="${this.view === "monitored" ? "selected" : ""}">Monitored (${persisted.size})</button><button id="excluded" class="${this.view === "excluded" ? "selected" : ""}">Excluded (${Math.max(0, devices.length - persisted.size)})</button></div><div class="bulk-actions"><button id="bulk-train" ${trainSelected.size ? "" : "disabled"}>Auto Train Selected (${trainSelected.size})</button></div></div><div class="table-scroll"><table><thead><tr><th>Monitor</th><th>Train</th><th>Device</th><th>Area</th><th>Source</th><th>Power</th><th>State</th><th>Training</th><th>Method</th><th>Action</th></tr></thead><tbody>${visible.length ? visible.map(d => this.row(d, selected)).join("") : `<tr><td colspan="10" class="empty">No loads in this view.</td></tr>`}</tbody></table></div></div>`;
      this.bind();
    }

    row(device, selected) {
      const monitored = selected.has(device.device_id), training = device.training || {}, manual = String(device.source || "").toLowerCase() === "manual", liveDelta = Number(training.live_delta_w), normalPower = Number(device.current_power), power = training.status === "active" && Number.isFinite(liveDelta) ? liveDelta : normalPower;
      const action = training.status === "active" ? `<button data-stop="${this.attr(device.device_id)}">Stop</button>` : manual ? `<button data-manual="${this.attr(device.device_id)}">${training.status === "complete" ? "Retrain Manual" : "Manual Training"}</button>` : `<button data-quick="${this.attr(device.device_id)}">Quick ON/OFF</button><button data-full="${this.attr(device.device_id)}">Full Cycle</button>`;
      const trainChecked = this.trainSelected.has(device.device_id);
      return `<tr data-device-id="${this.attr(device.device_id)}"><td><input class="monitor" type="checkbox" data-monitor="${this.attr(device.device_id)}" ${monitored ? "checked" : ""}></td><td><input class="train" type="checkbox" data-train="${this.attr(device.device_id)}" ${trainChecked ? "checked" : ""} ${monitored ? "" : "disabled"}></td><td><strong>${this.escape(device.name || device.device_id)}</strong><small>${this.escape(device.category || device.model || "")}</small></td><td>${this.escape(device.area || "")}</td><td>${manual ? "Manual" : "HA"}</td><td class="power-cell">${Number.isFinite(power) ? `${power.toFixed(0)} W` : "—"}</td><td class="state-cell">${this.renderState(device)}</td><td class="training">${this.escape(this.trainingLabel(training))}</td><td class="method-cell">${this.escape(training.method || "—")}</td><td class="actions">${monitored ? action : ""}</td></tr>`;
    }

    bind() {
      this.querySelector("#save")?.addEventListener("click", () => this.saveMonitoring()); this.querySelector("#add")?.addEventListener("click", () => this.openAddDialog());
      this.querySelector("#all")?.addEventListener("click", () => { this.view = "all"; this.render(); }); this.querySelector("#monitored")?.addEventListener("click", () => { this.view = "monitored"; this.render(); }); this.querySelector("#excluded")?.addEventListener("click", () => { this.view = "excluded"; this.render(); }); this.querySelector("#bulk-train")?.addEventListener("click", () => this.bulkTrain());
      this.querySelectorAll("[data-train]").forEach(box => box.addEventListener("change", event => { const id = event.currentTarget.dataset.train; if (event.currentTarget.checked) this.trainSelected.add(id); else this.trainSelected.delete(id); this.render(); }));
      this.querySelectorAll("[data-monitor]").forEach(box => box.addEventListener("change", event => { const scroller = this.querySelector(".table-scroll"), scrollTop = scroller ? scroller.scrollTop : 0, scrollLeft = scroller ? scroller.scrollLeft : 0, selected = this.getSelectedIds(), id = event.currentTarget.dataset.monitor; if (event.currentTarget.checked) selected.add(id); else selected.delete(id); this.pending = selected; this.render(); requestAnimationFrame(() => { const nextScroller = this.querySelector(".table-scroll"); if (nextScroller) { nextScroller.scrollTop = scrollTop; nextScroller.scrollLeft = scrollLeft; } }); }));
      this.querySelectorAll("[data-quick]").forEach(b => b.addEventListener("click", () => this.startTraining(b.dataset.quick, "quick"))); this.querySelectorAll("[data-full]").forEach(b => b.addEventListener("click", () => this.startTraining(b.dataset.full, "full_cycle"))); this.querySelectorAll("[data-manual]").forEach(b => b.addEventListener("click", () => this.startTraining(b.dataset.manual, "manual"))); this.querySelectorAll("[data-stop]").forEach(b => b.addEventListener("click", () => this.stopTraining(b.dataset.stop)));
    }

    async saveMonitoring() { try { await this.ws({ type: "energy_attribution/set_monitoring", entry_id: this.entryId, device_ids: [...this.getSelectedIds()] }); this.pending = null; await this.refresh(true); } catch (error) { this.showToast(error?.message || "Unable to save monitoring selections", true); } }
    async startTraining(deviceId, method) { const device = this.getDevices().find(d => d.device_id === deviceId); if (!device) return; const message = method === "quick" ? `EnergyIQ will automatically turn “${device.name}” ON and OFF during Quick Training. Continue?` : method === "manual" ? `Manual training for “${device.name}”. No command will be sent to the device. Continue?` : `Run a Full Cycle training session for “${device.name}”?`; if (!window.confirm(message)) return; try { await this.ws({ type: "energy_attribution/start_training", entry_id: this.entryId, device_id: deviceId, method }); await this.refresh(true); } catch (error) { this.showToast(error?.message || "Unable to start training", true); } }
    async stopTraining(deviceId) { try { await this.ws({ type: "energy_attribution/stop_training", entry_id: this.entryId, device_id: deviceId }); await this.refresh(true); } catch (error) { this.showToast(error?.message || "Unable to stop training", true); } }
    async bulkTrain() { const ids = [...this.trainSelected], autoIds = ids.filter(id => { const d = this.getDevices().find(x => x.device_id === id); return d && String(d.source || "").toLowerCase() !== "manual"; }); if (!autoIds.length || !window.confirm(`Auto Train ${autoIds.length} selected HA loads sequentially?`)) return; try { await this.ws({ type: "energy_attribution/bulk_auto_training", entry_id: this.entryId, device_ids: autoIds }); this.startBulkPolling(); await this.refresh(true); } catch (error) { this.showToast(error?.message || "Unable to start bulk training", true); } }

    async openAddDialog() { try { const result = await this.ws({ type: "energy_attribution/list_available_entities", entry_id: this.entryId }); this.showAddDialog(result.entities || []); } catch (error) { this.showToast(error?.message || "Unable to load Home Assistant entities", true); } }
    showAddDialog(entities) {
      const backdrop = document.createElement("div"); backdrop.className = "modal-backdrop"; backdrop.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><div class="modal-head"><div><h2>Add Device / Entity</h2><p>Search the complete Home Assistant entity registry.</p></div><button id="close">×</button></div><div class="search-row"><input id="search" type="search" placeholder="Search name, entity ID, domain, state…" autocomplete="off"><select id="domain"><option value="">All domains</option></select></div><select id="choices" size="11"></select><div id="ownership" class="ownership">Select an entity to see its EnergyIQ association.</div><div class="modal-actions"><button id="manual">Add Manual Device</button><span></span><button id="cancel">Cancel</button><button id="add-selected" class="primary">Add Entity</button></div></div>`;
      this.appendChild(backdrop); const search = backdrop.querySelector("#search"), domain = backdrop.querySelector("#domain"), choices = backdrop.querySelector("#choices"), ownership = backdrop.querySelector("#ownership");
      [...new Set(entities.map(e => e.domain).filter(Boolean))].sort().forEach(d => { const option = document.createElement("option"); option.value = d; option.textContent = d; domain.appendChild(option); });
      const matches = () => { const term = search.value.trim().toLowerCase(), selectedDomain = domain.value; return entities.filter(e => { if (selectedDomain && e.domain !== selectedDomain) return false; if (!term) return true; return [e.name, e.entity_id, e.domain, e.state, e.hvac_action].some(v => String(v || "").toLowerCase().includes(term)); }); };
      const updateOwnership = () => { const entity = entities.find(e => e.entity_id === choices.value); if (!entity) { ownership.textContent = "No entity selected."; return; } if (entity.disabled) ownership.innerHTML = `<strong>Disabled in Home Assistant.</strong> Enable the entity before adding it.`; else if (entity.candidate_matches?.length) ownership.innerHTML = `<strong>Already associated.</strong> ${entity.candidate_matches.map(m => `${this.escape(m.name)} <code>${this.escape(m.device_id)}</code> · ${this.escape(m.classification)}`).join("<br>")}`; else ownership.innerHTML = `<strong>Not associated with EnergyIQ.</strong> Adding it will create/extend a monitored load.`; };
      const draw = () => { choices.innerHTML = ""; matches().forEach(e => { const o = document.createElement("option"); o.value = e.entity_id; o.textContent = `${e.name} — ${e.entity_id}${e.disabled ? " · DISABLED" : e.monitored ? " · MONITORED" : e.already_added ? " · ASSOCIATED" : ""}`; choices.appendChild(o); }); if (choices.options.length) choices.selectedIndex = 0; updateOwnership(); };
      search.addEventListener("input", draw); domain.addEventListener("change", draw); choices.addEventListener("change", updateOwnership); choices.addEventListener("dblclick", () => backdrop.querySelector("#add-selected").click()); backdrop.querySelector("#close").onclick = () => backdrop.remove(); backdrop.querySelector("#cancel").onclick = () => backdrop.remove(); backdrop.addEventListener("click", event => { if (event.target === backdrop) backdrop.remove(); }); backdrop.querySelector("#manual").onclick = () => { backdrop.remove(); this.openManualDialog(); };
      backdrop.querySelector("#add-selected").onclick = async () => { const entityId = choices.value, entity = entities.find(e => e.entity_id === entityId); if (!entity) return; if (entity.disabled) { this.showToast("Enable the entity in Home Assistant before adding it.", true); return; } try { const result = await this.ws({ type: "energy_attribution/add_entity", entry_id: this.entryId, entity_id: entityId }); backdrop.remove(); this.view = "monitored"; await this.refresh(true); if (result?.action === "already_monitored") this.showToast("That exact entity is already associated with EnergyIQ."); } catch (error) { this.showToast(error?.message || "Unable to add entity", true); } };
      draw(); search.focus();
    }
    openManualDialog() { const backdrop = document.createElement("div"); backdrop.className = "modal-backdrop"; backdrop.innerHTML = `<div class="modal small"><div class="modal-head"><div><h2>Manual Electrical Device</h2><p>For a physical load with no usable HA entity.</p></div><button id="close">×</button></div><label>Name<input id="name" type="text" placeholder="e.g. Shop Compressor"></label><label>Category<input id="category" type="text" value="Appliance"></label><div class="modal-actions"><span></span><button id="cancel">Cancel</button><button id="create" class="primary">Add Device</button></div></div>`; this.appendChild(backdrop); const name = backdrop.querySelector("#name"); backdrop.querySelector("#close").onclick = () => backdrop.remove(); backdrop.querySelector("#cancel").onclick = () => backdrop.remove(); backdrop.querySelector("#create").onclick = async () => { if (!name.value.trim()) { name.focus(); return; } try { await this.ws({ type: "energy_attribution/add_manual_device", entry_id: this.entryId, name: name.value.trim(), category: backdrop.querySelector("#category").value.trim() || "Appliance" }); backdrop.remove(); this.view = "monitored"; await this.refresh(true); } catch (error) { this.showToast(error?.message || "Unable to add manual device", true); } }; name.focus(); }
    showToast(message, error = false) { const old = this.querySelector(".toast"); if (old) old.remove(); const toast = document.createElement("div"); toast.className = `toast ${error ? "error-toast" : ""}`; toast.textContent = message; this.appendChild(toast); setTimeout(() => toast.remove(), 4500); }
    attr(value) { return this.escape(value); }
    escape(value) { return String(value ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[ch])); }
    styles() { return `:host{display:block;color:var(--primary-text-color)}.shell{padding:18px 20px;max-width:1600px;margin:auto}header{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;margin-bottom:16px}h1{margin:0 0 4px;font-size:26px}h2{margin:0 0 5px}p{margin:0;color:var(--secondary-text-color)}.header-actions,.toolbar,.views,.bulk-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}button{border:1px solid var(--divider-color);border-radius:6px;background:var(--card-background-color);color:var(--primary-text-color);padding:8px 12px;cursor:pointer;font:inherit}button:hover{background:var(--secondary-background-color)}button:disabled{opacity:.45;cursor:not-allowed}button.primary,.views button.selected{background:var(--primary-color);color:var(--text-primary-color,#fff);border-color:var(--primary-color)}.summary{display:grid;grid-template-columns:repeat(3,minmax(220px,1fr));gap:10px;margin:12px 0 16px}.metric{padding:13px;border:1px solid var(--divider-color);border-radius:10px;background:var(--card-background-color);display:flex;flex-direction:column;gap:5px}.metric span{font-size:12px;color:var(--secondary-text-color)}.metric strong{font-size:20px}.metric.mystery strong{font-size:22px}.bulk{border:1px solid var(--primary-color);border-radius:10px;padding:12px 14px;margin-bottom:14px;display:grid;grid-template-columns:auto 1fr auto;gap:10px;align-items:center}.progress{height:7px;background:var(--divider-color);border-radius:8px;overflow:hidden;grid-column:1/-1}.progress i{display:block;height:100%;background:var(--primary-color)}.bulk small{grid-column:1/-1;color:var(--secondary-text-color)}.toolbar{justify-content:space-between;margin-bottom:10px}.table-scroll{overflow:auto;max-height:calc(100vh - 260px);border:1px solid var(--divider-color);border-radius:10px}table{border-collapse:collapse;width:100%;min-width:1180px;background:var(--card-background-color)}th,td{padding:9px 10px;border-bottom:1px solid var(--divider-color);text-align:left;vertical-align:middle}th{position:sticky;top:0;background:var(--card-background-color);z-index:1;font-size:12px;color:var(--secondary-text-color);white-space:nowrap}td small{display:block;color:var(--secondary-text-color);font-size:11px;margin-top:2px}.monitor,.train{width:22px;height:22px;margin:0}.state-cell{text-align:center;width:74px}.state-box{display:inline-flex;align-items:center;justify-content:center;width:44px;height:22px;border-radius:4px;font-size:12px;font-weight:700;color:#fff}.state-box.on{background:#2e7d32}.state-box.off{background:#c62828}.state-box.unknown{background:var(--secondary-text-color)}.training{max-width:330px}.actions{white-space:nowrap}.actions button{margin-right:5px}.empty{text-align:center;padding:30px;color:var(--secondary-text-color)}.loading,.error{display:block;padding:24px}.error{color:var(--error-color)}.modal-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;z-index:10000;padding:16px}.modal{width:min(760px,100%);max-height:90vh;overflow:auto;background:var(--card-background-color);border-radius:14px;padding:20px;box-shadow:var(--ha-card-box-shadow);color:var(--primary-text-color)}.modal.small{width:min(520px,100%)}.modal-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;margin-bottom:14px}.modal-head>button{font-size:22px;line-height:1;padding:4px 9px}.search-row{display:grid;grid-template-columns:minmax(0,1fr) 170px;gap:8px;margin-bottom:8px}.modal input,.modal select{box-sizing:border-box;width:100%;padding:9px;border:1px solid var(--divider-color);border-radius:6px;background:var(--primary-background-color);color:var(--primary-text-color);font:inherit}.modal>label{display:block;margin:12px 0}.modal>label input{display:block;margin-top:5px}.modal #choices{height:310px}.ownership{min-height:52px;margin-top:10px;padding:10px;border:1px solid var(--divider-color);border-radius:8px;background:var(--secondary-background-color);font-size:13px}.modal-actions{display:grid;grid-template-columns:auto 1fr auto auto;gap:8px;align-items:center;margin-top:14px}.toast{position:fixed;right:22px;bottom:22px;z-index:11000;padding:12px 16px;border-radius:8px;background:var(--primary-color);color:var(--text-primary-color,#fff);box-shadow:var(--ha-card-box-shadow);max-width:440px}.toast.error-toast{background:var(--error-color)}@media(max-width:900px){.summary{grid-template-columns:repeat(2,minmax(160px,1fr))}.bulk{grid-template-columns:1fr}.search-row{grid-template-columns:1fr}.header-actions{width:100%}}`; }
  }
  customElements.define(TAG, EnergyIQPanel);
})();
