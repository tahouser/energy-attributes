/*
 * EnergyIQ — single frontend application.
 *
 * The backend remains the source of truth. This file owns presentation and
 * interaction; training algorithms and electrical measurements stay in the
 * backend.
 */
(() => {
  const TAG = "energyiq-panel-v325";
  const VERSION = "31520";

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
      this.trainingQueue = [];
      this.trainingWorkspaceOpen = false;
      this.activeTrainingId = null;
      this.loading = false;
      this.refreshTimer = null;
      this.bulkTimer = null;
    }

    setConfig() {}
    set hass(value) {
      this._hass = value;
      if (value && !this.loading && !this.workspace) this.load();
    }
    get hass() { return this._hass; }
    connectedCallback() {
      if (!this.workspace) this.renderLoading();
      if (this.hass && !this.loading) this.load();
    }
    disconnectedCallback() { this.stopTimers(); }
    stopTimers() {
      if (this.refreshTimer) clearInterval(this.refreshTimer);
      if (this.bulkTimer) clearInterval(this.bulkTimer);
      this.refreshTimer = null;
      this.bulkTimer = null;
    }

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
      } catch (error) {
        console.error("EnergyIQ refresh failed", error);
        if (!this.workspace) this.renderError(error);
      }
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

    getDevices() { return Array.isArray(this.workspace?.devices) ? this.workspace.devices : []; }
    getDevice(deviceId) { return this.getDevices().find(d => d.device_id === deviceId); }
    getPersistedIds() { return new Set(this.getDevices().filter(d => d.classification === "monitor").map(d => d.device_id)); }
    getSelectedIds() { return this.pending ? new Set(this.pending) : this.getPersistedIds(); }

    stateFor(device) {
      const candidates = [...(device.controls || []), ...(device.measurements || [])];
      for (const item of candidates) {
        const id = item?.entity_id;
        const state = id ? this.hass?.states?.[id]?.state : null;
        if (state === "on" || state === "off") return state;
      }
      return null;
    }

    trainingStatus(device) {
      const training = device?.training || {};
      if (training.status === "complete") return "trained";
      if (training.status === "active") return "active";
      if (training.status === "error") return "error";
      return "untrained";
    }

    updateLiveData() {
      const devices = this.getDevices();
      const byId = new Map(devices.map(d => [d.device_id, d]));
      this.querySelectorAll("tr[data-device-id]").forEach(row => {
        const device = byId.get(row.dataset.deviceId);
        if (!device) return;
        const powerCell = row.querySelector(".power-cell");
        if (powerCell) {
          const power = Number(device.current_power);
          powerCell.textContent = Number.isFinite(power) ? `${power.toFixed(0)} W` : "—";
        }
        const stateCell = row.querySelector(".state-cell");
        if (stateCell) stateCell.innerHTML = this.renderState(device);
        const statusCell = row.querySelector(".training-status");
        if (statusCell) statusCell.innerHTML = this.renderTrainingStatus(device);
        const methodCell = row.querySelector(".method-cell");
        if (methodCell) methodCell.textContent = device.training?.method || "—";
      });
      const summary = this.querySelector("#summary-area");
      if (summary) summary.innerHTML = this.renderSummary();
      const training = this.querySelector("#training-area");
      if (training && this.trainingWorkspaceOpen) training.innerHTML = this.renderTrainingWorkspace();
      this.bindTrainingWorkspace();
    }

    renderLoading() { this.innerHTML = `<ha-card class="loading"><h2>EnergyIQ</h2><p>Loading workspace…</p></ha-card>`; }
    renderError(error) { this.innerHTML = `<ha-card class="error"><h2>EnergyIQ</h2><p>${this.escape(error?.message || error)}</p></ha-card>`; }

    renderSummary() {
      const devices = this.getDevices(), monitored = devices.filter(d => this.getPersistedIds().has(d.device_id));
      const trained = monitored.filter(d => d.training?.status === "complete").length;
      const untrained = monitored.length - trained;
      const home = Number(this.workspace?.whole_home_power), trainedWatts = Number(this.workspace?.trained_live_power_w || 0);
      const mystery = Number.isFinite(home) ? Math.max(0, home - trainedWatts) : null;
      const fmt = value => Number.isFinite(value) ? `${value.toFixed(0)} W` : "—";
      return `<div class="summary"><div class="metric"><span>Home Power Now</span><strong>${fmt(home)}</strong></div><div class="metric"><span>Trained Active Watts</span><strong>${fmt(trainedWatts)}</strong></div><div class="metric mystery"><span>Mystery Watts</span><strong>${fmt(mystery)}</strong></div><div class="metric"><span>Monitored</span><strong>${monitored.length}</strong></div><div class="metric"><span>Trained</span><strong>${trained}</strong></div><div class="metric"><span>Untrained</span><strong>${untrained}</strong></div></div>`;
    }

    render() {
      if (!this.workspace) return;
      const devices = this.getDevices(), persisted = this.getPersistedIds();
      const visible = devices.filter(d => {
        if (this.view === "all") return true;
        if (this.view === "monitored") return persisted.has(d.device_id);
        return !persisted.has(d.device_id);
      }).sort((a, b) => String(a.name).localeCompare(String(b.name)));
      this.innerHTML = `<style>${this.styles()}</style><div class="shell"><header><div><h1>EnergyIQ</h1><p>Whole-home electrical intelligence · v${this.workspace?.version || "?"}</p></div></header><div id="summary-area">${this.renderSummary()}</div>${this.trainingWorkspaceOpen ? `<div id="training-area">${this.renderTrainingWorkspace()}</div>` : ""}<div class="toolbar"><div class="views"><button id="all" class="${this.view === "all" ? "selected" : ""}">All (${devices.length})</button><button id="monitored" class="${this.view === "monitored" ? "selected" : ""}">Monitored (${persisted.size})</button><button id="excluded" class="${this.view === "excluded" ? "selected" : ""}">Excluded (${Math.max(0, devices.length - persisted.size)})</button></div><div class="toolbar-actions"><button id="add">＋ Add Device / Entity</button><button id="save" class="primary">Save Monitoring</button></div></div><div class="table-scroll"><table><thead><tr><th>Monitor</th><th class="train-header ${this.trainSelected.size ? "has-selection" : ""}" id="train-header" title="${this.trainSelected.size ? "Open Training for selected devices" : "Select devices, then open Training"}">Train${this.trainSelected.size ? ` (${this.trainSelected.size})` : ""}</th><th>Device</th><th>Area</th><th>Source</th><th>Power</th><th>State</th><th>Training</th><th>Method</th></tr></thead><tbody>${visible.length ? visible.map(d => this.row(d)).join("") : `<tr><td colspan="9" class="empty">No loads in this view.</td></tr>`}</tbody></table></div></div>`;
      this.bind();
    }

    row(device) {
      const persisted = this.getPersistedIds().has(device.device_id), training = device.training || {};
      const trainChecked = this.trainSelected.has(device.device_id), name = this.escape(device.name || device.device_id);
      const canTrainByName = persisted && training.status !== "active";
      return `<tr data-device-id="${this.attr(device.device_id)}"><td><input class="monitor" type="checkbox" data-monitor="${this.attr(device.device_id)}" ${persisted ? "checked" : ""}></td><td><input class="train" type="checkbox" data-train="${this.attr(device.device_id)}" ${trainChecked ? "checked" : ""} ${persisted ? "" : "disabled"}></td><td class="device-name-cell">${canTrainByName ? `<button class="device-link" data-device-train="${this.attr(device.device_id)}" title="Open Training">${name}</button>` : `<strong>${name}</strong>`}<small>${this.escape(device.category || device.model || "")}</small></td><td>${this.escape(device.area || "")}</td><td>${String(device.source || "").toLowerCase() === "manual" ? "Manual" : "HA"}</td><td class="power-cell">${Number.isFinite(Number(device.current_power)) ? `${Number(device.current_power).toFixed(0)} W` : "—"}</td><td class="state-cell">${this.renderState(device)}</td><td class="training-status">${this.renderTrainingStatus(device)}</td><td class="method-cell">${this.escape(training.method || "—")}</td></tr>`;
    }

    renderState(device) { const state = this.stateFor(device), label = state === "on" ? "ON" : state === "off" ? "OFF" : "—"; return `<span class="state-box ${state || "unknown"}">${label}</span>`; }
    renderTrainingStatus(device) { const status = this.trainingStatus(device), labels = { trained: "Trained", active: "Training", error: "Error", untrained: "Not trained" }; return `<span class="training-dot ${status}" title="${labels[status]}"></span>`; }

    bind() {
      this.querySelector("#save")?.addEventListener("click", () => this.saveMonitoring());
      this.querySelector("#add")?.addEventListener("click", () => this.openAddDialog());
      this.querySelector("#all")?.addEventListener("click", () => { this.view = "all"; this.render(); });
      this.querySelector("#monitored")?.addEventListener("click", () => { this.view = "monitored"; this.render(); });
      this.querySelector("#excluded")?.addEventListener("click", () => { this.view = "excluded"; this.render(); });
      this.querySelector("#train-header")?.addEventListener("click", () => { if (this.trainSelected.size) this.openTrainingWorkspace([...this.trainSelected]); });
      this.querySelectorAll("[data-train]").forEach(box => box.addEventListener("change", event => { const id = event.currentTarget.dataset.train; if (event.currentTarget.checked) this.trainSelected.add(id); else this.trainSelected.delete(id); this.updateTrainHeader(); }));
      this.querySelectorAll("[data-monitor]").forEach(box => box.addEventListener("change", event => { const selected = this.getSelectedIds(), id = event.currentTarget.dataset.monitor; if (event.currentTarget.checked) selected.add(id); else selected.delete(id); this.pending = selected; const row = event.currentTarget.closest("tr"), trainBox = row?.querySelector("[data-train]"); if (trainBox) trainBox.disabled = !event.currentTarget.checked; }));
      this.querySelectorAll("[data-device-train]").forEach(button => button.addEventListener("click", () => this.openTrainingWorkspace([button.dataset.deviceTrain])));
      this.bindTrainingWorkspace();
    }

    updateTrainHeader() {
      const header = this.querySelector("#train-header"); if (!header) return;
      header.textContent = this.trainSelected.size ? `Train (${this.trainSelected.size})` : "Train";
      header.classList.toggle("has-selection", this.trainSelected.size > 0);
    }

    openTrainingWorkspace(deviceIds) {
      const valid = deviceIds.filter(id => this.getDevice(id) && this.getPersistedIds().has(id));
      if (!valid.length) return;
      this.trainingQueue = [...new Set(valid)]; this.activeTrainingId = this.trainingQueue[0] || null; this.trainingWorkspaceOpen = true;
      this.render();
      requestAnimationFrame(() => this.querySelector("#training-area")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
    closeTrainingWorkspace() { this.trainingWorkspaceOpen = false; this.trainingQueue = []; this.activeTrainingId = null; this.render(); requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" })); }
    trainingQueueSlots() { const ids = this.trainingQueue.slice(0, 3); return [ids[0] || null, ids[1] || null, ids[2] || null]; }
    activeTrainingDevice() { return this.activeTrainingId ? this.getDevice(this.activeTrainingId) : null; }
    trainingComplete(deviceId) { return this.getDevice(deviceId)?.training?.status === "complete"; }
    advanceQueueIfComplete() { if (!this.activeTrainingId || !this.trainingComplete(this.activeTrainingId)) return; if (this.trainingQueue[0] === this.activeTrainingId) this.trainingQueue.shift(); else this.trainingQueue = this.trainingQueue.filter(id => id !== this.activeTrainingId); this.activeTrainingId = this.trainingQueue[0] || null; }

    renderTrainingWorkspace() {
      this.advanceQueueIfComplete();
      const active = this.activeTrainingDevice(), slots = this.trainingQueueSlots(), remaining = Math.max(0, this.trainingQueue.length - 3);
      if (!active) return `<section class="training-workspace"><div class="training-head"><div><span class="eyebrow">Training</span><h2>Training complete</h2><p>All selected devices have completed or left the queue.</p></div><button data-training-close>Close</button></div></section>`;
      return `<section class="training-workspace" id="training-workspace"><div class="training-head"><div><span class="eyebrow">Training workspace</span><h2>${this.escape(active.name || active.device_id)}</h2><p>Complete the active device before moving to the next. The queue stays visible while you work.</p></div><button data-training-close>Close</button></div><div class="queue-strip">${this.renderQueueSlot(slots[0], "Active", true)}${this.renderQueueSlot(slots[1], "Queue #1", false)}${this.renderQueueSlot(slots[2], "Queue #2", false)}${remaining ? `<div class="queue-more"><strong>${remaining} additional device${remaining === 1 ? "" : "s"} waiting</strong><span>They remain in the background queue.</span></div>` : ""}</div><div class="training-detail">${this.renderTrainingDetail(active)}</div></section>`;
    }

    renderQueueSlot(deviceId, label, active) {
      if (!deviceId) return `<div class="queue-slot empty-slot"><span>${label}</span><strong>—</strong></div>`;
      const device = this.getDevice(deviceId), status = this.trainingStatus(device);
      return `<div class="queue-slot ${active ? "active-slot" : ""}"><span>${label}</span><strong>${this.escape(device?.name || deviceId)}</strong><small>${status === "trained" ? "Trained" : active ? "Ready / active" : "Queued"}</small></div>`;
    }

    renderTrainingDetail(device) {
      const training = device.training || {}, method = training.method || "full_cycle", result = training.result || {};
      const baseline = Number(training.baseline_w), live = Number(training.live_delta_w), stable = Number(result.stable_load_w ?? training.stable_load_w), range = Number(result.stability_range_w ?? training.stability_range_w), elapsed = Number(training.duration_s);
      const valid = result.capture_valid === true || training.capture_valid === true, active = training.status === "active", complete = training.status === "complete", phase = String(training.phase || "");
      const instruction = training.instruction || this.defaultInstruction(method, phase, device), fmt = value => Number.isFinite(value) ? `${value.toFixed(0)} W` : "—";
      const elapsedText = Number.isFinite(elapsed) ? `${elapsed.toFixed(1)} s` : "—", stableClass = valid ? "valid" : "";
      const shownLoad = valid ? stable : complete ? Number(training.learned_signature?.load_w) : live;
      return `<div class="training-grid"><div class="training-main"><div class="method-picker"><label>Training method<select id="training-method" ${active ? "disabled" : ""}><option value="quick" ${method === "quick" ? "selected" : ""}>Quick ON/OFF</option><option value="full_cycle" ${method === "full_cycle" ? "selected" : ""}>Full Cycle</option><option value="manual" ${method === "manual" ? "selected" : ""}>Manual</option></select></label></div><div class="instruction-card"><span class="eyebrow">Instructions</span><strong>${this.escape(instruction)}</strong>${method === "full_cycle" ? `<p>EnergyIQ establishes the OFF baseline first. It will not start the load for you. Turn the load ON when instructed, then start the power capture.</p>` : ""}</div><div class="capture-grid"><div><span>Baseline</span><strong>${fmt(baseline)}</strong></div><div class="capture-value ${stableClass}"><span>${method === "full_cycle" ? "Captured / stable load" : "Learned / live"}</span><strong>${fmt(shownLoad)}</strong></div><div><span>Stability range</span><strong>${fmt(range)}</strong></div><div><span>Elapsed</span><strong>${elapsedText}</strong></div></div><div class="capture-state ${valid ? "valid" : ""}"><span class="status-light ${valid ? "green" : active ? "amber" : complete ? "green" : "red"}"></span><strong>${valid ? "Capture valid — you may Stop & Save" : complete ? "Training saved" : active ? (phase || "Training in progress") : "Ready to train"}</strong></div><div class="training-actions">${this.renderTrainingActions(device, method, active, complete, valid)}</div>${complete ? this.renderCompletedResult(device) : ""}</div><aside class="training-info"><span class="eyebrow">Selected device</span><h3>${this.escape(device.name || device.device_id)}</h3><p>${this.escape(device.area || "No area assigned")}</p><dl><dt>Source</dt><dd>${String(device.source || "").toLowerCase() === "manual" ? "Manual" : "Home Assistant"}</dd><dt>Method</dt><dd>${this.escape(training.method || method)}</dd><dt>Status</dt><dd>${complete ? "Trained" : active ? "In progress" : "Not trained"}</dd></dl></aside></div>`;
    }

    renderTrainingActions(device, method, active, complete, valid) {
      if (active) {
        if (method === "full_cycle") {
          const phase = String(device.training?.phase || "");
          if (phase === "awaiting_confirmation" || phase === "waiting_for_start") return `<button class="primary" data-training-full-start>Start Power Capture</button><button data-training-stop>Stop Without Saving</button>`;
          if (phase === "capturing") return `<button class="primary" data-training-full-save ${valid ? "" : "disabled"}>Stop &amp; Save</button><button data-training-stop>Stop Without Saving</button>`;
        }
        return `<button data-training-stop>Stop Without Saving</button>`;
      }
      if (complete) return `<button class="primary" data-training-retrain>Retrain</button>`;
      return `<button class="primary" data-training-start>Start ${method === "full_cycle" ? "Full Cycle" : method === "manual" ? "Manual Training" : "Quick ON/OFF"}</button>`;
    }

    renderCompletedResult(device) {
      const sig = device.training?.learned_signature || {}, load = Number(sig.load_w);
      return `<div class="completed-card"><span class="eyebrow">Learned result</span><strong>${Number.isFinite(load) ? `${load.toFixed(0)} W` : "Learned signature saved"}</strong><p>The training result remains visible until you press Close.</p></div>`;
    }

    defaultInstruction(method, phase, device) {
      if (method === "full_cycle") return phase === "capturing" ? "Leave the device ON. When the wattage is stable and the capture indicator turns green, press Stop & Save." : "Leave the device OFF so EnergyIQ can establish a controlled OFF baseline. Turn it ON only when instructed.";
      if (method === "manual") return "Enter the electrical load information supplied by your measurement process.";
      return `EnergyIQ will automatically cycle “${device.name || device.device_id}” ON and OFF.`;
    }

    bindTrainingWorkspace() {
      this.querySelector("[data-training-close]")?.addEventListener("click", () => this.closeTrainingWorkspace());
      this.querySelector("#training-method")?.addEventListener("change", () => this.renderTrainingDetailInPlace());
      this.querySelector("[data-training-start]")?.addEventListener("click", () => this.startWorkspaceTraining());
      this.querySelector("[data-training-retrain]")?.addEventListener("click", () => this.startWorkspaceTraining(true));
      this.querySelector("[data-training-stop]")?.addEventListener("click", () => this.stopWorkspaceTraining());
      this.querySelector("[data-training-full-start]")?.addEventListener("click", () => this.fullWorkspaceAction("start_capture"));
      this.querySelector("[data-training-full-save]")?.addEventListener("click", () => this.fullWorkspaceAction("stop_capture"));
    }
    renderTrainingDetailInPlace() { const active = this.activeTrainingDevice(), area = this.querySelector(".training-detail"); if (active && area) area.innerHTML = this.renderTrainingDetail(active); this.bindTrainingWorkspace(); }
    selectedWorkspaceMethod() { return this.querySelector("#training-method")?.value || "full_cycle"; }

    async startWorkspaceTraining(retrain = false) {
      const device = this.activeTrainingDevice(); if (!device) return;
      const method = this.selectedWorkspaceMethod();
      const message = method === "quick" ? `EnergyIQ will automatically turn “${device.name}” ON and OFF during Quick Training. Continue?` : method === "manual" ? `Manual training for “${device.name}”. No command will be sent to the device. Continue?` : `Prepare “${device.name}” OFF. EnergyIQ will establish the baseline first, then wait for you to turn the load ON. Continue?`;
      if (!window.confirm(message)) return;
      try {
        if (retrain && device.training?.status === "complete") await this.ws({ type: "energy_attribution/retry_training", entry_id: this.entryId, device_id: device.device_id });
        else await this.ws({ type: "energy_attribution/start_training", entry_id: this.entryId, device_id: device.device_id, method });
        await this.refresh(true);
      } catch (error) { this.showToast(error?.message || "Unable to start training", true); }
    }
    async stopWorkspaceTraining() { const device = this.activeTrainingDevice(); if (!device) return; try { await this.ws({ type: "energy_attribution/stop_training", entry_id: this.entryId, device_id: device.device_id }); await this.refresh(true); } catch (error) { this.showToast(error?.message || "Unable to stop training", true); } }
    async fullWorkspaceAction(action) { const device = this.activeTrainingDevice(); if (!device) return; try { if (action === "start_capture") await this.ws({ type: "energy_attribution/confirm_long_cycle", entry_id: this.entryId, device_id: device.device_id, accepted: true }); else await this.ws({ type: "energy_attribution/end_long_cycle", entry_id: this.entryId, device_id: device.device_id, force: false }); await this.refresh(true); } catch (error) { this.showToast(error?.message || "Unable to control Full Cycle capture", true); } }

    async saveMonitoring() { try { await this.ws({ type: "energy_attribution/set_monitoring", entry_id: this.entryId, device_ids: [...this.getSelectedIds()] }); this.pending = null; await this.refresh(true); } catch (error) { this.showToast(error?.message || "Unable to save monitoring selections", true); } }

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
    escape(value) { return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "\"":"&quot;", "'":"&#39;" }[ch])); }
    styles() { return `:host{display:block;color:var(--primary-text-color)}.shell{padding:18px 20px;max-width:1600px;margin:auto;min-height:calc(100vh - 20px);box-sizing:border-box;display:flex;flex-direction:column}header{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;margin-bottom:16px}h1{margin:0 0 4px;font-size:26px}h2{margin:0 0 5px}h3{margin:5px 0}p{margin:0;color:var(--secondary-text-color)}button{border:1px solid var(--divider-color);border-radius:7px;background:var(--card-background-color);color:var(--primary-text-color);padding:8px 12px;cursor:pointer;font:inherit}button:hover{background:var(--secondary-background-color)}button:disabled{opacity:.45;cursor:not-allowed}button.primary,.views button.selected{background:var(--primary-color);color:var(--text-primary-color,#fff);border-color:var(--primary-color)}.summary{display:grid;grid-template-columns:repeat(6,minmax(110px,1fr));gap:10px;margin:12px 0 16px}.metric{padding:11px;border:1px solid var(--divider-color);border-radius:10px;background:var(--card-background-color);display:flex;flex-direction:column;gap:5px}.metric span{font-size:11px;color:var(--secondary-text-color)}.metric strong{font-size:19px}.metric.mystery strong{font-size:21px}.toolbar{display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:10px}.views,.toolbar-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.table-scroll{overflow:auto;flex:1 1 auto;min-height:0;border:1px solid var(--divider-color);border-radius:10px}table{border-collapse:collapse;width:100%;min-width:900px;background:var(--card-background-color)}th,td{padding:9px 10px;border-bottom:1px solid var(--divider-color);text-align:left;vertical-align:middle}th{position:sticky;top:0;background:var(--card-background-color);z-index:1;font-size:12px;color:var(--secondary-text-color);white-space:nowrap}td small{display:block;color:var(--secondary-text-color);font-size:11px;margin-top:2px}.monitor,.train{width:22px;height:22px;margin:0}.state-cell{text-align:center;width:74px}.power-cell{white-space:nowrap;font-variant-numeric:tabular-nums}.method-cell{text-transform:capitalize;color:var(--secondary-text-color)}.train-header.has-selection{color:var(--primary-color);font-weight:800;cursor:pointer}.device-name-cell{min-width:170px}.device-link{border:0;background:none;padding:0;text-align:left;color:var(--primary-color);font-weight:700;cursor:pointer}.device-link:hover{text-decoration:underline}.state-box{display:inline-flex;align-items:center;justify-content:center;width:44px;height:22px;border-radius:4px;font-size:12px;font-weight:700;color:#fff}.state-box.on{background:#2e7d32}.state-box.off{background:#c62828}.state-box.unknown{background:var(--secondary-text-color)}.training-dot{display:inline-block;width:16px;height:16px;border-radius:50%;vertical-align:middle;border:2px solid var(--divider-color);box-sizing:border-box}.training-dot.trained{background:#2e7d32;border-color:#2e7d32}.training-dot.active{background:#f9a825;border-color:#f9a825}.training-dot.error{background:#c62828;border-color:#c62828}.training-dot.untrained{background:#c62828;border-color:#c62828}.empty{text-align:center;padding:30px;color:var(--secondary-text-color)}.loading,.error{display:block;padding:24px}.error{color:var(--error-color)}.training-workspace{border:2px solid var(--primary-color);border-radius:14px;padding:16px;margin:0 0 16px;background:var(--card-background-color);scroll-margin-top:12px}.training-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start}.eyebrow{display:block;text-transform:uppercase;letter-spacing:.08em;font-size:10px;font-weight:800;color:var(--secondary-text-color);margin-bottom:4px}.queue-strip{display:grid;grid-template-columns:1.4fr 1fr 1fr auto;gap:8px;margin:14px 0}.queue-slot,.queue-more{border:1px solid var(--divider-color);border-radius:10px;padding:10px;display:flex;flex-direction:column;gap:3px;min-height:58px}.queue-slot span,.queue-more span{font-size:10px;color:var(--secondary-text-color);text-transform:uppercase;letter-spacing:.06em}.queue-slot small{color:var(--secondary-text-color)}.active-slot{border-color:var(--primary-color);box-shadow:0 0 0 1px var(--primary-color) inset}.empty-slot{opacity:.55}.queue-more{justify-content:center;min-width:170px}.training-grid{display:grid;grid-template-columns:minmax(0,1fr) 250px;gap:14px}.training-main{min-width:0}.training-info{border:1px solid var(--divider-color);border-radius:10px;padding:13px;background:var(--secondary-background-color)}.training-info dl{display:grid;grid-template-columns:auto 1fr;gap:7px;margin-top:14px}.training-info dt{color:var(--secondary-text-color)}.training-info dd{margin:0;text-align:right;font-weight:600}.method-picker label{display:flex;flex-direction:column;gap:5px;font-size:12px;color:var(--secondary-text-color)}select{padding:9px;border:1px solid var(--divider-color);border-radius:7px;background:var(--primary-background-color);color:var(--primary-text-color);font:inherit}.method-picker select{max-width:260px}.instruction-card{margin-top:12px;padding:12px;border-radius:10px;background:var(--secondary-background-color);border-left:4px solid var(--primary-color)}.instruction-card strong{display:block}.instruction-card p{font-size:12px;margin-top:6px}.capture-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:12px}.capture-grid>div{border:1px solid var(--divider-color);border-radius:9px;padding:10px}.capture-grid span{display:block;font-size:10px;color:var(--secondary-text-color)}.capture-grid strong{display:block;font-size:18px;margin-top:3px}.capture-value.valid{border-color:#2e7d32;background:rgba(46,125,50,.12)}.capture-state{display:flex;align-items:center;gap:8px;margin-top:10px;padding:10px;border-radius:9px;background:var(--secondary-background-color)}.capture-state.valid{border:1px solid #2e7d32}.status-light{width:11px;height:11px;border-radius:50%;background:#c62828;flex:none}.status-light.green{background:#2e7d32}.status-light.amber{background:#f9a825}.training-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.completed-card{margin-top:12px;padding:12px;border:1px solid #2e7d32;border-radius:10px}.completed-card>strong{font-size:22px;display:block}.completed-card p{font-size:12px;margin-top:3px}.modal-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;z-index:10000;padding:16px}.modal{width:min(760px,100%);max-height:90vh;overflow:auto;background:var(--card-background-color);border-radius:14px;padding:20px;box-shadow:var(--ha-card-box-shadow);color:var(--primary-text-color)}.modal.small{width:min(520px,100%)}.modal-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;margin-bottom:14px}.modal-head>button{font-size:22px;line-height:1;padding:4px 9px}.search-row{display:grid;grid-template-columns:minmax(0,1fr) 170px;gap:8px;margin-bottom:8px}.modal input,.modal select{box-sizing:border-box;width:100%;padding:9px;border:1px solid var(--divider-color);border-radius:6px;background:var(--primary-background-color);color:var(--primary-text-color);font:inherit}.modal>label{display:block;margin:12px 0}.modal>label input{display:block;margin-top:5px}.modal #choices{height:310px}.ownership{min-height:52px;margin-top:10px;padding:10px;border:1px solid var(--divider-color);border-radius:8px;background:var(--secondary-background-color);font-size:13px}.modal-actions{display:grid;grid-template-columns:auto 1fr auto auto;gap:8px;align-items:center;margin-top:14px}.toast{position:fixed;right:22px;bottom:22px;z-index:11000;padding:12px 16px;border-radius:8px;background:var(--primary-color);color:var(--text-primary-color,#fff);box-shadow:var(--ha-card-box-shadow);max-width:440px}.toast.error-toast{background:var(--error-color)}@media(max-width:1100px){.summary{grid-template-columns:repeat(3,1fr)}.queue-strip{grid-template-columns:repeat(3,1fr)}.queue-more{grid-column:1/-1}.training-grid{grid-template-columns:1fr}.training-info{display:none}}@media(max-width:700px){.shell{padding:12px}.summary{grid-template-columns:repeat(2,1fr);gap:7px}.metric{padding:9px}.metric strong{font-size:16px}.toolbar{align-items:stretch}.views,.toolbar-actions{width:100%}.views button,.toolbar-actions button{flex:1}.queue-strip{grid-template-columns:1fr}.training-workspace{padding:12px}.capture-grid{grid-template-columns:repeat(2,1fr)}.training-head{align-items:center}.training-head h2{font-size:20px}.table-scroll{max-height:none}}
    `; }
  }
  customElements.define(TAG, EnergyIQPanel);
})();
