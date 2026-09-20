/*
 * EnergyIQ — single frontend application.
 *
 * The backend remains the source of truth. This file owns presentation and
 * interaction; training algorithms and electrical measurements stay in the
 * backend.
 */
(() => {
  const TAG = "energyiq-panel-v335";
  const VERSION = "31404";
  const UI_VERSION = "3.1.123";

  if (customElements.get(TAG)) return;

  class EnergyIQPanel extends HTMLElement {
    constructor() {
      super();
      this.hass = null;
      this.entryId = null;
      this.workspace = null;
      this.bulk = null;
      this.brandUrl = "/energyiq-brand/icon.png?v=31404";
      this.view = "all";
      this.pendingIncluded = null;
      this.selectedIds = new Set();
      this.searchTerm = "";
      this.page = 1;
      this.pageSize = 25;
      this.trainingQueue = [];
      this.trainingWorkspaceOpen = false;
      this.activeTrainingId = null;
      this.loading = false;
      this.refreshTimer = null;
      this.bulkTimer = null;
      this.bulkStarting = false;
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

    async loadBrandUrl() {
      try {
        const result = await this.ws({ type: "brands/access_token" });
        if (result?.token) {
          this.brandUrl = `/api/brands/integration/energyiq/icon.png?placeholder=no&token=${encodeURIComponent(result.token)}&v=${VERSION}`;
        }
      } catch (error) {
        console.warn("EnergyIQ brand image token unavailable; using local fallback.", error);
      }
    }

    async load() {
      if (this.loading) return;
      this.loading = true;
      try {
        await this.loadBrandUrl();
        const result = await this.ws({ type: "energy_attribution/list_entries" });
        if (!result.entries?.length) throw new Error("EnergyIQ is not configured.");
        this.entryId = result.entries[0].entry_id;
        await this.refresh();
        this.refreshTimer = setInterval(() => this.refresh(), 1000);
      } catch (error) { this.renderError(error); }
      finally { this.loading = false; }
    }

    async refresh(forceRender = false) {
      if (!this.hass || !this.entryId) return;
      try {
        const hadWorkspace = !!this.workspace;
        this.workspace = await this.ws({ type: "energy_attribution/workspace", entry_id: this.entryId });
        this.bulk = await this.ws({ type: "energy_attribution/bulk_training_state", entry_id: this.entryId });
        if (this.bulk?.status === "running") { this.bulkStarting = true; this.startBulkPolling(); } else { this.bulkStarting = false; this.stopBulkPolling(); }
        const trainingViewChanged = this.handleTrainingCompletion();
        const trainedChanged = hadWorkspace && this.view === "trained" && (
          this.getDevices().filter(d => d.training?.status === "complete").length !==
          this._lastTrainedCount
        );
        this._lastTrainedCount = this.getDevices().filter(d => d.training?.status === "complete").length;
        if (!hadWorkspace || forceRender || trainingViewChanged || trainedChanged) this.render(); else this.updateLiveData();
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
    getIncludedIds() { return this.pendingIncluded ? new Set(this.pendingIncluded) : this.getPersistedIds(); }
    getSelectedIds() { return new Set(this.selectedIds); }
    hasPendingChanges() {
      const current = this.getPersistedIds(), pending = this.getIncludedIds();
      if (current.size !== pending.size) return true;
      for (const id of current) if (!pending.has(id)) return true;
      return false;
    }
    filteredDevices() {
      const term = this.searchTerm.trim().toLowerCase(), included = this.getIncludedIds();
      return this.getDevices().filter(d => {
        const isIncluded = included.has(d.device_id);
        if (this.view === "excluded" && isIncluded) return false;
        if (this.view !== "excluded" && !isIncluded) return false;
        if (this.view === "trained" && d.training?.status !== "complete") return false;
        if (!term) return true;
        const haystack = [d.name,d.device_id,d.area,d.source,d.category,d.model,...(d.controls||[]).map(x=>x?.entity_id),...(d.measurements||[]).map(x=>x?.entity_id)].join(" ").toLowerCase();
        return haystack.includes(term);
      }).sort((a,b)=>String(a.name).localeCompare(String(b.name)));
    }
    selectedCanTrain() {
      if (this.bulkStarting || this.bulk?.status === "running") return false;
      if (!this.selectedIds.size || this.hasPendingChanges()) return false;
      const included=this.getPersistedIds();
      return [...this.selectedIds].every(id=>included.has(id)&&this.getDevice(id));
    }

    livePower(device) {
      const values = [];
      for (const measurement of device?.measurements || []) {
        if (measurement?.kind !== "power") continue;
        const entityId = measurement?.entity_id;
        const state = entityId ? this.hass?.states?.[entityId] : null;
        if (!state) continue;
        let value = Number(state.state);
        if (!Number.isFinite(value)) continue;
        const unit = String(state.attributes?.unit_of_measurement || measurement?.unit || "").toLowerCase();
        if (unit === "kw") value *= 1000;
        if (unit !== "w" && unit !== "kw") continue;
        values.push(Math.max(0, value));
      }
      if (values.length) return values.reduce((sum, value) => sum + value, 0);
      const fallback = Number(device?.current_power);
      return Number.isFinite(fallback) ? Math.max(0, fallback) : null;
    }

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
          const power = this.livePower(device);
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
      if (summary) {
        summary.innerHTML = this.renderSummary();
        this.bindSummaryActions();
      }
      const training = this.querySelector("#training-area");
      if (training && this.trainingWorkspaceOpen) training.innerHTML = this.renderTrainingWorkspace();
      this.bindTrainingWorkspace();
    }

    renderLoading() { this.innerHTML = `<ha-card class="loading"><h2>EnergyIQ</h2><p>Loading workspace…</p></ha-card>`; }
    renderError(error) { this.innerHTML = `<ha-card class="error"><h2>EnergyIQ</h2><p>${this.escape(error?.message || error)}</p></ha-card>`; }

    showActiveConsumers() {
      const devices = this.getDevices()
        .filter(d => this.getIncludedIds().has(d.device_id) && Number(this.livePower(d) || d.current_power) > 5)
        .sort((a,b) => Number(this.livePower(b) || b.current_power || 0) - Number(this.livePower(a) || a.current_power || 0));
      const fmt = d => { const w = this.livePower(d); return Number.isFinite(w) ? `${w.toFixed(0)} W` : "—"; };
      const rows = devices.length
        ? devices.map(d => `<div class="active-consumer-row"><span>${this.escape(d.name || d.device_id)}</span><strong>${fmt(d)}</strong></div>`).join("")
        : '<div class="active-consumer-empty">No included loads are consuming right now.</div>';
      this.closeActiveConsumers();
      this.insertAdjacentHTML("beforeend", `<div class="active-consumer-backdrop"><div class="active-consumer-dialog" role="dialog" aria-modal="true" aria-label="Active consumers"><div class="active-consumer-head"><div><div class="eyebrow">ENERGYIQ</div><h2>Active Consumers</h2><p>${devices.length} currently drawing power</p></div><button id="close-active-consumers" aria-label="Close">×</button></div><div class="active-consumer-list">${rows}</div></div></div>`);
      this.querySelector("#close-active-consumers")?.addEventListener("click", () => this.closeActiveConsumers());
      this.querySelector(".active-consumer-backdrop")?.addEventListener("click", e => { if (e.target.classList.contains("active-consumer-backdrop")) this.closeActiveConsumers(); });
    }
    closeActiveConsumers() { this.querySelector(".active-consumer-backdrop")?.remove(); }

    renderSummary() {
      const devices=this.getDevices(), included=this.getIncludedIds();
      const trained=devices.filter(d=>included.has(d.device_id)&&d.training?.status==="complete").length;
      const active=devices.filter(d=>included.has(d.device_id)&&Number(d.current_power)>5).length;
      const home=Number(this.workspace?.whole_home_power), trainedWatts=Number(this.workspace?.trained_live_power_w||0);
      const mystery=Number.isFinite(home)?Math.max(0,home-trainedWatts):null;
      const fmt=v=>Number.isFinite(v)?`${v.toFixed(0)} W`:"—", progress=included.size?`${trained} / ${included.size}`:"0 / 0";
      return `<div class="summary">
        <div class="metric hero-metric"><span>Total Power</span><strong>${fmt(home)}</strong><small>Whole home</small></div>
        <button class="metric metric-button" id="active-consumers" type="button"><span>Active Consumers</span><strong>${active}</strong><small>Tap to view active loads</small></button>
        <div class="metric mystery"><span>Mystery Watts</span><strong>${fmt(mystery)}</strong><small>Not yet attributed</small></div>
        <div class="metric"><span>Trained Power</span><strong>${fmt(trainedWatts)}</strong><small>Currently attributed</small></div>
        <div class="metric"><span>Training Progress</span><strong>${progress}</strong><small>Completed / included</small></div>
      </div>`;
    }

    renderMeters() {
      const meters = Array.isArray(this.workspace?.meters) ? this.workspace.meters : [];
      if (!meters.length) return "";
      const fmt=(v,unit,dec=0)=>Number.isFinite(Number(v))?`${Number(v).toFixed(dec)} ${unit}`:"—";
      return `<section class="meter-section">
        <div class="section-heading"><div><span class="eyebrow">Electrical system</span><h2>Individual meters</h2><p>Live readings from the electrical source behind EnergyIQ.</p></div><span class="meter-count">${meters.length} meter${meters.length===1?"":"s"} detected</span></div>
        <div class="meter-grid">${meters.map((m,index)=>`<article class="meter-card ${Number(m.power)>5?"active-meter":""}">
          <div class="meter-card-head"><div class="meter-icon">ϟ</div><div><strong>${this.escape(m.label || `Meter ${index}`)}</strong><small>${this.escape(m.name || "Power meter")}</small></div><span class="meter-status ${Number(m.power)>5?"on":"idle"}">${Number(m.power)>5?"ACTIVE":"IDLE"}</span></div>
          <div class="meter-power"><strong>${fmt(m.power,"W")}</strong><span>current power</span></div>
          <div class="meter-details">
            <div><span>Energy</span><strong>${fmt(m.energy,"kWh",2)}</strong></div>
            <div><span>Voltage</span><strong>${fmt(m.voltage,"V",1)}</strong></div>
            <div><span>Current</span><strong>${fmt(m.current,"A",2)}</strong></div>
          </div>
          <div class="meter-source">${this.escape(m.source || "Home Assistant")}</div>
        </article>`).join("")}</div>
      </section>`;
    }

    render() {
      if (!this.workspace) return;
      const devices=this.getDevices(), included=this.getIncludedIds();
      const trainedCount=devices.filter(d=>included.has(d.device_id)&&d.training?.status==="complete").length;
      const excludedCount=devices.filter(d=>!included.has(d.device_id)).length;
      const all=this.filteredDevices(), rows=all, selected=this.selectedIds.size, dirty=this.hasPendingChanges(), canTrain=this.selectedCanTrain();
      this.innerHTML=`<style>${this.styles()}</style><div class="shell">
        <header><div class="title-block"><div class="title-row"><button id="back" class="back-button" title="Back to Home Assistant" aria-label="Back to Home Assistant">←</button><div class="brand-logo" aria-label="EnergyIQ"><svg viewBox="0 0 128 128" role="img" aria-hidden="true"><circle cx="64" cy="64" r="54" fill="none" stroke="#24d7a1" stroke-width="7"/><path d="M30 58 64 31l34 27v37a6 6 0 0 1-6 6H36a6 6 0 0 1-6-6Z" fill="none" stroke="#fff" stroke-width="7" stroke-linejoin="round"/><path d="M69 42 52 70h15l-8 22 22-31H66Z" fill="#fff"/></svg></div><div class="brand-copy"><div class="brand-name-row"><h1>EnergyIQ</h1><span class="tagline">Know your power</span></div><p>Whole-home electrical intelligence · v${UI_VERSION}</p></div></div></div></header>
        <div id="summary-area">${this.renderSummary()}</div>
        ${this.renderMeters()}
        ${this.trainingWorkspaceOpen?`<div id="training-area">${this.renderTrainingWorkspace()}</div>`:""}
        <div class="toolbar"><div class="views"><button id="all" class="${this.view==="all"?"selected":""}">All <span>${devices.length}</span></button><button id="trained" class="${this.view==="trained"?"selected":""}">Trained <span>${trainedCount}</span></button><button id="excluded" class="${this.view==="excluded"?"selected":""}">Excluded <span>${excludedCount}</span></button></div><div class="toolbar-actions"><button id="add">＋ Add Device / Entity</button><button id="save" class="primary" ${dirty?"":"disabled"}>Save Changes</button></div></div>
        <div class="list-tools"><label class="search-box"><span>⌕</span><input id="device-search" type="search" value="${this.escape(this.searchTerm)}" placeholder="Search devices, areas, entities…" autocomplete="off"></label></div>
        <div class="selection-bar"><div class="selection-count"><span class="selection-box">☐</span><strong>${selected}</strong> selected</div><div class="selection-actions"><button id="begin-training" class="action-training" ${canTrain?"":"disabled"}>Begin Training</button><button id="include" class="action-include" ${selected?"":"disabled"}>Include</button><button id="exclude" class="action-exclude" ${selected?"":"disabled"}>Exclude</button><button id="clear-selection" ${selected?"":"disabled"}>Clear Selection</button></div></div>
        <div class="table-scroll"><table><thead><tr><th class="select-col">☐</th><th>Device</th><th>Area</th><th>Source</th><th>Live Watts</th><th>Trained Watts</th><th>State</th><th>Training</th><th>Method</th></tr></thead><tbody>${rows.length?rows.map(d=>this.row(d)).join(""):`<tr><td colspan="9" class="empty">No devices match this view.</td></tr>`}</tbody></table></div>
      </div>`;
      this.bind();
    }

    row(device) {
      const selected=this.selectedIds.has(device.device_id), training=device.training||{}, name=this.escape(device.name||device.device_id);
      const live=this.livePower(device), learned=Number(training.learned_signature?.load_w); return `<tr data-device-id="${this.attr(device.device_id)}"><td class="select-col"><input class="select-device" type="checkbox" data-select="${this.attr(device.device_id)}" ${selected?"checked":""} aria-label="Select ${name}"></td><td class="device-name-cell"><strong>${name}</strong><small>${this.escape(device.category||device.model||"")}</small></td><td>${this.escape(device.area||"")}</td><td>${String(device.source||"").toLowerCase()==="manual"?"Manual":"HA"}</td><td class="power-cell">${Number.isFinite(live)?`${live.toFixed(0)} W`:"—"}</td><td class="trained-power-cell">${Number.isFinite(learned)?`${learned.toFixed(0)} W`:"—"}</td><td class="state-cell">${this.renderState(device)}</td><td class="training-status">${this.renderTrainingStatus(device)}</td><td class="method-cell">${this.escape(training.method||"—")}</td></tr>`;
    }

    renderState(device) { const state = this.stateFor(device), label = state === "on" ? "ON" : state === "off" ? "OFF" : "—"; return `<span class="state-box ${state || "unknown"}">${label}</span>`; }
    renderTrainingStatus(device) { const status = this.trainingStatus(device), labels = { trained: "Trained", active: "Training", error: "Error", untrained: "Not trained" }; return `<span class="training-box ${status}" title="${labels[status]}" aria-label="${labels[status]}"></span>`; }

    bindSummaryActions() {
      this.querySelector("#active-consumers")?.addEventListener("click",()=>this.showActiveConsumers());
    }

    bind() {
      this.querySelector("#back")?.addEventListener("click",()=>{if(window.history.length>1)window.history.back();else window.location.href="/";});
      this.querySelector("#save")?.addEventListener("click",()=>this.saveChanges());
      this.bindSummaryActions();
      this.querySelector("#add")?.addEventListener("click",()=>this.openAddDialog());
      this.querySelector("#all")?.addEventListener("click",()=>{this.view="all";this.page=1;this.render();});
      this.querySelector("#trained")?.addEventListener("click",()=>{this.view="trained";this.page=1;this.render();});
      this.querySelector("#excluded")?.addEventListener("click",()=>{this.view="excluded";this.page=1;this.render();});
      this.querySelector("#device-search")?.addEventListener("input",event=>{this.searchTerm=event.currentTarget.value;this.page=1;this.render();requestAnimationFrame(()=>{const el=this.querySelector("#device-search");if(el){el.focus();el.setSelectionRange(this.searchTerm.length,this.searchTerm.length);}});});
      this.querySelectorAll("[data-select]").forEach(box=>box.addEventListener("change",event=>{const list=this.querySelector(".table-scroll"),top=list?.scrollTop||0,left=list?.scrollLeft||0,id=event.currentTarget.dataset.select;if(event.currentTarget.checked)this.selectedIds.add(id);else this.selectedIds.delete(id);this.render();requestAnimationFrame(()=>{const next=this.querySelector(".table-scroll");if(next){next.scrollTop=top;next.scrollLeft=left;}});}));
      this.querySelector("#include")?.addEventListener("click",()=>this.applyClassification("include"));
      this.querySelector("#exclude")?.addEventListener("click",()=>this.applyClassification("exclude"));
      this.querySelector("#clear-selection")?.addEventListener("click",()=>{this.selectedIds.clear();this.render();});
      this.querySelector("#begin-training")?.addEventListener("click",()=>this.beginSelectedTraining());
      this.bindTrainingWorkspace();
    }
    applyClassification(action) {
      if(!this.selectedIds.size)return;
      if(!this.pendingIncluded)this.pendingIncluded=this.getPersistedIds();
      for(const id of this.selectedIds){if(action==="include")this.pendingIncluded.add(id);else this.pendingIncluded.delete(id);}
      this.page=1;this.render();
    }
    async beginSelectedTraining() {
      if (!this.selectedCanTrain()) return;
      const deviceIds = [...this.selectedIds];
      this.bulkStarting = false;
      this.openTrainingWorkspace(deviceIds);
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
    handleTrainingCompletion() {
      if (!this.trainingWorkspaceOpen || !this.activeTrainingId || !this.trainingComplete(this.activeTrainingId)) return false;
      const remaining = this.trainingQueue.filter(id => id !== this.activeTrainingId && !this.trainingComplete(id));
      if (remaining.length) {
        this.trainingQueue = remaining;
        this.activeTrainingId = remaining[0];
        return true;
      }
      this.selectedIds.clear();
      this.trainingWorkspaceOpen = false;
      this.trainingQueue = [];
      this.activeTrainingId = null;
      this.view = "trained";
      return true;
    }
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
      const training = device.training || {}, method = training.method || "quick", result = training.result || {};
      const baseline = Number(training.baseline_w), live = Number(training.live_delta_w), stable = Number(result.stable_load_w ?? training.stable_load_w), range = Number(result.stability_range_w ?? training.stability_range_w), elapsed = Number(training.duration_s);
      const valid = result.capture_valid === true || training.capture_valid === true, active = training.status === "active", complete = training.status === "complete", phase = String(training.phase || ""), legacyFullCycle = training.method === "full_cycle";
      const instruction = training.instruction || this.defaultInstruction(method, phase, device), fmt = value => Number.isFinite(value) ? `${value.toFixed(0)} W` : "—";
      const elapsedText = Number.isFinite(elapsed) ? `${elapsed.toFixed(1)} s` : "—", stableClass = valid ? "valid" : "";
      const shownLoad = valid ? stable : complete ? Number(training.learned_signature?.load_w) : live;
      return `<div class="training-grid"><div class="training-main"><div class="method-picker"><span class="method-label">Training method</span><div class="method-options"><label><input type="checkbox" class="training-method-choice" data-method="quick" ${method === "quick" ? "checked" : ""} ${active ? "disabled" : ""}> Quick ON/OFF</label><label><input type="checkbox" class="training-method-choice" data-method="manual" ${method === "manual" ? "checked" : ""} ${active ? "disabled" : ""}> Manual</label></div>${legacyFullCycle ? `<p class="legacy-method-note">This device has an existing Full Cycle session. Stop it without saving to choose Quick ON/OFF or Manual.</p>` : ""}</div><div class="instruction-card"><span class="eyebrow">Instructions</span><strong>${this.escape(instruction)}</strong></div><div class="capture-grid"><div><span>Baseline</span><strong>${fmt(baseline)}</strong></div><div class="capture-value ${stableClass}"><span>Learned / live</span><strong>${fmt(shownLoad)}</strong></div><div><span>Stability range</span><strong>${fmt(range)}</strong></div><div><span>Elapsed</span><strong>${elapsedText}</strong></div></div><div class="capture-state ${valid ? "valid" : ""}"><span class="status-light ${valid ? "green" : active ? "amber" : complete ? "green" : "red"}"></span><strong>${valid ? "Capture valid — you may Stop & Save" : complete ? "Training saved" : active ? (phase || "Training in progress") : "Ready to train"}</strong></div><div class="training-actions">${this.renderTrainingActions(device, method, active, complete, valid, legacyFullCycle)}</div>${complete ? this.renderCompletedResult(device) : ""}</div><aside class="training-info"><span class="eyebrow">Selected device</span><h3>${this.escape(device.name || device.device_id)}</h3><p>${this.escape(device.area || "No area assigned")}</p><dl><dt>Source</dt><dd>${String(device.source || "").toLowerCase() === "manual" ? "Manual" : "Home Assistant"}</dd><dt>Method</dt><dd>${this.escape(training.method || method)}</dd><dt>Status</dt><dd>${complete ? "Trained" : active ? "In progress" : "Not trained"}</dd></dl></aside></div>`;
    }

    renderTrainingActions(device, method, active, complete, valid, legacyFullCycle = false) {
      if (active) {
        if (legacyFullCycle) return `<button data-training-stop>Stop Without Saving</button>`;
        return `<button data-training-stop>Stop Without Saving</button>`;
      }
      if (complete) return `<button class="primary" data-training-retrain>Retrain</button>`;
      return `<button class="primary" data-training-start>Start ${method === "manual" ? "Manual Training" : "Quick ON/OFF"}</button>`;
    }

    renderCompletedResult(device) {
      const sig = device.training?.learned_signature || {}, load = Number(sig.load_w);
      return `<div class="completed-card"><span class="eyebrow">Learned result</span><strong>${Number.isFinite(load) ? `${load.toFixed(0)} W` : "Learned signature saved"}</strong><p>The training result remains visible until you press Close.</p></div>`;
    }

    defaultInstruction(method, phase, device) {
      if (method === "manual") return "Enter the electrical load information supplied by your measurement process.";
      return `EnergyIQ will automatically cycle “${device.name || device.device_id}” ON and OFF.`;
    }

    bindTrainingWorkspace() {
      this.querySelector("[data-training-close]")?.addEventListener("click", () => this.closeTrainingWorkspace());
      this.querySelectorAll(".training-method-choice").forEach(box => box.addEventListener("change", event => {
        if (event.currentTarget.checked) {
          this.querySelectorAll(".training-method-choice").forEach(other => { if (other !== event.currentTarget) other.checked = false; });
        } else if (!this.querySelector(".training-method-choice:checked")) {
          event.currentTarget.checked = true;
        }
        this.renderTrainingDetailInPlace();
      }));
      this.querySelector("[data-training-start]")?.addEventListener("click", () => this.startWorkspaceTraining());
      this.querySelector("[data-training-retrain]")?.addEventListener("click", () => this.startWorkspaceTraining(true));
      this.querySelector("[data-training-stop]")?.addEventListener("click", () => this.stopWorkspaceTraining());
    }
    renderTrainingDetailInPlace() { const active = this.activeTrainingDevice(), area = this.querySelector(".training-detail"); if (active && area) area.innerHTML = this.renderTrainingDetail(active); this.bindTrainingWorkspace(); }
    selectedWorkspaceMethod() { return this.querySelector(".training-method-choice:checked")?.dataset.method || "quick"; }

    async startWorkspaceTraining(retrain = false) {
      const device = this.activeTrainingDevice(); if (!device) return;
      const method = this.selectedWorkspaceMethod();
      if (this.bulkStarting || this.bulk?.status === "running") return;
      try {
        if (!retrain && method === "quick" && this.trainingQueue.length > 1) {
          const deviceIds = this.trainingQueue.filter(id => this.getDevice(id) && this.getPersistedIds().has(id) && !this.trainingComplete(id));
          if (!deviceIds.length) return;
          this.bulkStarting = true;
          this.startBulkPolling();
          this.refresh(true);
          this.ws({
            type: "energy_attribution/bulk_auto_training",
            entry_id: this.entryId,
            device_ids: deviceIds,
          }).then(async () => {
            await this.refresh(true);
          }).catch(async error => {
            this.bulkStarting = false;
            this.showToast(error?.message || "Unable to start automatic training", true);
            await this.refresh(true);
          });
          return;
        }
        if (retrain && device.training?.status === "complete") {
          await this.ws({ type: "energy_attribution/retry_training", entry_id: this.entryId, device_id: device.device_id });
        } else {
          await this.ws({ type: "energy_attribution/start_training", entry_id: this.entryId, device_id: device.device_id, method });
        }
        await this.refresh(true);
      } catch (error) { this.showToast(error?.message || "Unable to start training", true); }
    }
    async stopWorkspaceTraining() { const device = this.activeTrainingDevice(); if (!device) return; try { await this.ws({ type: "energy_attribution/stop_training", entry_id: this.entryId, device_id: device.device_id }); await this.refresh(true); } catch (error) { this.showToast(error?.message || "Unable to stop training", true); } }

    async saveChanges() {
      if(!this.hasPendingChanges())return;
      try{await this.ws({type:"energy_attribution/set_monitoring",entry_id:this.entryId,device_ids:[...this.getIncludedIds()]});this.pendingIncluded=null;this.selectedIds.clear();await this.refresh(true);this.showToast("Changes saved.");}
      catch(error){this.showToast(error?.message||"Unable to save changes",true);}
    }

    async openAddDialog() { try { const result = await this.ws({ type: "energy_attribution/list_available_entities", entry_id: this.entryId }); this.showAddDialog(result.entities || []); } catch (error) { this.showToast(error?.message || "Unable to load Home Assistant entities", true); } }
    showAddDialog(entities) {
      const backdrop = document.createElement("div"); backdrop.className = "modal-backdrop"; backdrop.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><div class="modal-head"><div><h2>Add Device / Entity</h2><p>Search the complete Home Assistant entity registry.</p></div><button id="close">×</button></div><div class="search-row"><input id="search" type="search" placeholder="Search name, entity ID, domain, state…" autocomplete="off"><select id="domain"><option value="">All domains</option></select></div><select id="choices" size="11"></select><div id="ownership" class="ownership">Select an entity to see its EnergyIQ association.</div><div class="modal-actions"><button id="manual">Add Manual Device</button><span></span><button id="cancel">Cancel</button><button id="add-selected" class="primary">Add Entity</button></div></div>`;
      this.appendChild(backdrop); const search = backdrop.querySelector("#search"), domain = backdrop.querySelector("#domain"), choices = backdrop.querySelector("#choices"), ownership = backdrop.querySelector("#ownership");
      [...new Set(entities.map(e => e.domain).filter(Boolean))].sort().forEach(d => { const option = document.createElement("option"); option.value = d; option.textContent = d; domain.appendChild(option); });
      const matches = () => { const term = search.value.trim().toLowerCase(), selectedDomain = domain.value; return entities.filter(e => { if (selectedDomain && e.domain !== selectedDomain) return false; if (!term) return true; return [e.name, e.entity_id, e.domain, e.state, e.hvac_action].some(v => String(v || "").toLowerCase().includes(term)); }); };
      const updateOwnership = () => { const entity = entities.find(e => e.entity_id === choices.value); if (!entity) { ownership.textContent = "No entity selected."; return; } if (entity.disabled) ownership.innerHTML = `<strong>Disabled in Home Assistant.</strong> Enable the entity before adding it.`; else if (entity.candidate_matches?.length) ownership.innerHTML = `<strong>Already associated.</strong> ${entity.candidate_matches.map(m => `${this.escape(m.name)} <code>${this.escape(m.device_id)}</code> · ${m.classification === "monitor" ? "Included" : "Excluded"}`).join("<br>")}`; else ownership.innerHTML = `<strong>Not associated with EnergyIQ.</strong> Adding it will create/extend an included load.`; };
      const draw = () => { choices.innerHTML = ""; matches().forEach(e => { const o = document.createElement("option"); o.value = e.entity_id; o.textContent = `${e.name} — ${e.entity_id}${e.disabled ? " · DISABLED" : e.monitored ? " · INCLUDED" : e.already_added ? " · ASSOCIATED" : ""}`; choices.appendChild(o); }); if (choices.options.length) choices.selectedIndex = 0; updateOwnership(); };
      search.addEventListener("input", draw); domain.addEventListener("change", draw); choices.addEventListener("change", updateOwnership); choices.addEventListener("dblclick", () => backdrop.querySelector("#add-selected").click()); backdrop.querySelector("#close").onclick = () => backdrop.remove(); backdrop.querySelector("#cancel").onclick = () => backdrop.remove(); backdrop.addEventListener("click", event => { if (event.target === backdrop) backdrop.remove(); }); backdrop.querySelector("#manual").onclick = () => { backdrop.remove(); this.openManualDialog(); };
      backdrop.querySelector("#add-selected").onclick = async () => { const entityId = choices.value, entity = entities.find(e => e.entity_id === entityId); if (!entity) return; if (entity.disabled) { this.showToast("Enable the entity in Home Assistant before adding it.", true); return; } try { const result = await this.ws({ type: "energy_attribution/add_entity", entry_id: this.entryId, entity_id: entityId }); backdrop.remove(); this.view = "all"; this.page = 1; await this.refresh(true); if (result?.action === "already_monitored") this.showToast("That exact entity is already associated with EnergyIQ."); } catch (error) { this.showToast(error?.message || "Unable to add entity", true); } };
      draw(); search.focus();
    }
    openManualDialog() { const backdrop = document.createElement("div"); backdrop.className = "modal-backdrop"; backdrop.innerHTML = `<div class="modal small"><div class="modal-head"><div><h2>Manual Electrical Device</h2><p>For a physical load with no usable HA entity.</p></div><button id="close">×</button></div><label>Name<input id="name" type="text" placeholder="e.g. Shop Compressor"></label><label>Category<input id="category" type="text" value="Appliance"></label><div class="modal-actions"><span></span><button id="cancel">Cancel</button><button id="create" class="primary">Add Device</button></div></div>`; this.appendChild(backdrop); const name = backdrop.querySelector("#name"); backdrop.querySelector("#close").onclick = () => backdrop.remove(); backdrop.querySelector("#cancel").onclick = () => backdrop.remove(); backdrop.querySelector("#create").onclick = async () => { if (!name.value.trim()) { name.focus(); return; } try { await this.ws({ type: "energy_attribution/add_manual_device", entry_id: this.entryId, name: name.value.trim(), category: backdrop.querySelector("#category").value.trim() || "Appliance" }); backdrop.remove(); this.view = "all"; this.page = 1; await this.refresh(true); } catch (error) { this.showToast(error?.message || "Unable to add manual device", true); } }; name.focus(); }
    showToast(message, error = false) { const old = this.querySelector(".toast"); if (old) old.remove(); const toast = document.createElement("div"); toast.className = `toast ${error ? "error-toast" : ""}`; toast.textContent = message; this.appendChild(toast); setTimeout(() => toast.remove(), 4500); }
    attr(value) { return this.escape(value); }
    escape(value) { return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "\"":"&quot;", "'":"&#39;" }[ch])); }
    styles() { return `
      :host{display:block;min-height:100vh;color:var(--primary-text-color)}.shell{height:100vh;min-height:0;box-sizing:border-box;padding:0 24px 22px;max-width:1680px;margin:auto;display:flex;flex-direction:column;overflow:hidden}
      header{position:relative;overflow:hidden;margin:0 -24px 18px;padding:22px 28px 28px;background:linear-gradient(120deg,rgba(6,18,29,.99),rgba(8,25,39,.98) 55%,rgba(7,31,43,.98));border-bottom:1px solid rgba(42,194,255,.35);box-shadow:0 8px 30px rgba(0,0,0,.18)}header:after{content:"";position:absolute;left:38%;right:-4%;bottom:-30px;height:92px;background:linear-gradient(180deg,transparent 0 28%,rgba(20,242,184,.04) 29%,rgba(20,242,184,.18) 31%,transparent 34%),linear-gradient(168deg,transparent 0 45%,rgba(20,242,184,.05) 46%,rgba(20,242,184,.65) 48%,rgba(28,205,255,.9) 50%,rgba(28,205,255,.18) 52%,transparent 54%);filter:blur(.2px);transform:skewX(-10deg);pointer-events:none}header:before{content:"";position:absolute;left:46%;right:-3%;bottom:-18px;height:76px;border-top:2px solid rgba(20,242,184,.7);border-radius:55% 45% 0 0;transform:rotate(-11deg);box-shadow:0 -4px 16px rgba(20,242,184,.22),0 -1px 5px rgba(30,210,255,.5);pointer-events:none}.title-row{position:relative;z-index:2;display:flex;align-items:center;gap:15px;max-width:1624px;margin:auto}.brand-logo{flex:none}.back-button{width:38px;height:38px;border:0;border-radius:0;padding:0;background:transparent;color:var(--primary-text-color);font-size:23px;line-height:1;cursor:pointer}.back-button:hover{background:transparent}
      .brand-logo{width:60px;height:60px;flex:none;display:grid;place-items:center}.brand-logo svg{width:60px;height:60px;display:block}.brand-copy{min-width:0}.brand-name-row{display:flex;align-items:baseline;gap:18px;flex-wrap:wrap}.tagline{font-size:20px;font-weight:600;font-style:italic;color:#36c8ff;white-space:nowrap}h1{margin:0 0 4px;font-size:31px;letter-spacing:.01em}p{margin:0;color:var(--secondary-text-color)}
      .meter-section{margin:0 0 16px;padding:14px 0 2px}.section-heading{display:flex;justify-content:space-between;align-items:flex-end;gap:14px;margin:0 2px 9px}.section-heading h2{font-size:17px;margin:0 0 2px}.section-heading p{font-size:11px}.meter-count{font-size:11px;color:var(--secondary-text-color);border:1px solid var(--divider-color);border-radius:999px;padding:5px 9px;white-space:nowrap}.meter-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(245px,1fr));gap:10px}.meter-card{border:1px solid var(--divider-color);border-radius:12px;padding:13px;background:linear-gradient(145deg,rgba(15,27,40,.94),rgba(9,20,31,.9));box-shadow:inset 0 1px 0 rgba(255,255,255,.03)}.meter-card.active-meter{border-color:rgba(20,242,184,.4);box-shadow:inset 0 1px 0 rgba(255,255,255,.04),0 0 18px rgba(20,242,184,.05)}.meter-card-head{display:flex;align-items:center;gap:9px}.meter-card-head>div:nth-child(2){min-width:0;flex:1}.meter-icon{width:31px;height:31px;border-radius:9px;display:grid;place-items:center;background:rgba(28,205,255,.1);color:#36c8ff;font-size:22px;font-weight:800}.meter-card-head strong{display:block;font-size:14px}.meter-card-head small{display:block;color:var(--secondary-text-color);font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.meter-status{font-size:9px;font-weight:800;letter-spacing:.07em;padding:4px 7px;border-radius:999px}.meter-status.on{background:rgba(20,242,184,.14);color:#35e7b0;border:1px solid rgba(20,242,184,.35)}.meter-status.idle{background:rgba(255,255,255,.06);color:var(--secondary-text-color);border:1px solid var(--divider-color)}.meter-power{display:flex;align-items:baseline;gap:8px;margin:11px 0 9px}.meter-power strong{font-size:26px;font-variant-numeric:tabular-nums}.meter-power span{font-size:10px;color:var(--secondary-text-color)}.meter-details{display:grid;grid-template-columns:repeat(3,1fr);gap:7px}.meter-details>div{padding:8px;border-radius:8px;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.045)}.meter-details span{display:block;font-size:9px;text-transform:uppercase;letter-spacing:.05em;color:var(--secondary-text-color)}.meter-details strong{display:block;margin-top:3px;font-size:12px;font-variant-numeric:tabular-nums}.meter-source{margin-top:9px;font-size:9px;color:var(--secondary-text-color);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .summary{display:grid;grid-template-columns:repeat(5,minmax(140px,1fr));gap:10px;margin:0 0 16px}.metric-button{appearance:none;text-align:left;font:inherit;color:inherit;cursor:pointer}.metric-button:hover{border-color:var(--primary-color)}.active-consumer-backdrop{position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.58);display:flex;align-items:center;justify-content:center;padding:16px}.active-consumer-dialog{width:min(460px,100%);max-height:82vh;overflow:auto;background:var(--card-background-color);border:1px solid var(--divider-color);border-radius:14px;box-shadow:var(--ha-card-box-shadow);padding:16px;box-sizing:border-box}.active-consumer-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.active-consumer-head h2{margin:2px 0 2px;font-size:1.3rem}.active-consumer-head p{margin:0;color:var(--secondary-text-color);font-size:.8rem}.active-consumer-head button{width:38px;height:38px;padding:0;border:0;border-radius:50%;background:var(--secondary-background-color);color:var(--primary-text-color);font-size:1.5rem}.active-consumer-row{display:flex;justify-content:space-between;gap:12px;padding:10px 2px;border-bottom:1px solid var(--divider-color)}.active-consumer-row span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.active-consumer-row strong{white-space:nowrap;font-variant-numeric:tabular-nums}.active-consumer-empty{text-align:center;padding:24px;color:var(--secondary-text-color)}.metric{padding:13px 14px;border:1px solid var(--divider-color);border-radius:12px;background:linear-gradient(145deg,var(--card-background-color),rgba(20,31,44,.65));display:flex;flex-direction:column;gap:3px;min-width:0}.metric span{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--secondary-text-color)}.metric strong{font-size:22px;font-variant-numeric:tabular-nums}.metric small{font-size:10px;color:var(--secondary-text-color)}.metric.mystery{border-color:rgba(54,200,255,.35)}
      button{border:1px solid var(--divider-color);border-radius:8px;background:var(--card-background-color);color:var(--primary-text-color);padding:8px 12px;cursor:pointer;font:inherit;transition:.15s ease}button:hover{background:var(--secondary-background-color);transform:translateY(-1px)}button:disabled{opacity:.38;cursor:not-allowed;transform:none}button.primary{background:#26b8f0;color:#07131d;border-color:#26b8f0;font-weight:800}button.primary:disabled{background:var(--card-background-color);color:var(--secondary-text-color);border-color:var(--divider-color)}
      .toolbar{display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:10px}.views,.toolbar-actions,.selection-actions{display:flex;gap:7px;align-items:center;flex-wrap:wrap}.views button{border-radius:9px;padding:8px 13px}.views button.selected{background:rgba(38,184,240,.16);border-color:#26b8f0;color:#5dd5ff}.views button span{opacity:.7;margin-left:3px}
      .list-tools{display:flex;justify-content:space-between;gap:12px;align-items:center;margin:4px 0 8px}.search-box{display:flex;align-items:center;gap:8px;flex:1;max-width:520px;border:1px solid var(--divider-color);border-radius:9px;background:var(--card-background-color);padding:0 11px}.search-box span{font-size:21px;color:var(--secondary-text-color)}.search-box input{width:100%;border:0;outline:0;background:transparent;color:var(--primary-text-color);padding:10px 0;font:inherit}.result-count{font-size:12px;color:var(--secondary-text-color)}
      .selection-bar{display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap;padding:9px 11px;margin-bottom:10px;border:1px solid var(--divider-color);border-radius:10px;background:rgba(18,28,42,.55)}.selection-count{font-size:13px;white-space:nowrap}.selection-count strong{font-size:15px;margin-right:4px}.selection-box{color:#36c8ff;margin-right:5px}.action-training{border-color:#36c8ff;color:#63d7ff}.action-include{background:#35b85a;border-color:#35b85a;color:#07140b;font-weight:800}.action-exclude{border-color:#ff4d5f;color:#ff6574}.action-exclude:hover{background:rgba(255,77,95,.12)}
      .table-scroll{overflow:auto;min-height:0;flex:1;border:1px solid var(--divider-color);border-radius:11px}table{border-collapse:collapse;width:100%;min-width:900px;background:var(--card-background-color)}th,td{padding:10px 11px;border-bottom:1px solid var(--divider-color);text-align:left;vertical-align:middle}th{position:sticky;top:0;background:var(--card-background-color);z-index:1;font-size:11px;color:var(--secondary-text-color);text-transform:uppercase;letter-spacing:.05em;white-space:nowrap}.select-col{width:44px;text-align:center}td small{display:block;color:var(--secondary-text-color);font-size:11px;margin-top:2px}.select-device{width:21px;height:21px;margin:0;accent-color:#36c8ff}.device-name-cell{min-width:190px}.power-cell,.trained-power-cell{white-space:nowrap;font-variant-numeric:tabular-nums}.method-cell{text-transform:capitalize;color:var(--secondary-text-color)}.state-cell{text-align:center;width:70px}.state-box{display:inline-flex;align-items:center;justify-content:center;min-width:46px;height:23px;padding:0 8px;border-radius:12px;font-size:11px;font-weight:800}.state-box.on{background:#35b85a;color:#07140b}.state-box.off{background:rgba(255,255,255,.08);color:var(--secondary-text-color);border:1px solid var(--divider-color)}.state-box.unknown{background:rgba(255,77,95,.12);color:#ff6574}.training-dot{display:inline-block;width:15px;height:15px;border-radius:50%;vertical-align:middle}.training-dot{display:none}.training-box{display:inline-flex;width:46px;height:23px;border-radius:12px;box-sizing:border-box;vertical-align:middle}.training-box.trained{background:rgba(53,184,90,.28);border:1px solid rgba(53,184,90,.55)}.training-box.active,.training-box.error{background:rgba(255,77,95,.28);border:1px solid rgba(255,77,95,.58)}.training-box.untrained{background:rgba(255,255,255,.07);border:1px solid var(--divider-color)}
      .empty{text-align:center;padding:36px;color:var(--secondary-text-color)}.pagination{display:none}.training-workspace{flex:none;border:1px solid #36c8ff;border-radius:14px;padding:16px;margin:0 0 16px;background:var(--card-background-color);scroll-margin-top:12px}.training-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start}.eyebrow{display:block;text-transform:uppercase;letter-spacing:.08em;font-size:10px;font-weight:800;color:var(--secondary-text-color);margin-bottom:4px}h2{margin:0 0 5px}h3{margin:5px 0}
      .queue-strip{display:grid;grid-template-columns:1.4fr 1fr 1fr auto;gap:8px;margin:14px 0}.queue-slot,.queue-more{border:1px solid var(--divider-color);border-radius:10px;padding:10px;display:flex;flex-direction:column;gap:3px;min-height:58px}.queue-slot span,.queue-more span{font-size:10px;color:var(--secondary-text-color);text-transform:uppercase;letter-spacing:.06em}.queue-slot small{color:var(--secondary-text-color)}.active-slot{border-color:#36c8ff;box-shadow:0 0 0 1px #36c8ff inset}.empty-slot{opacity:.55}.queue-more{justify-content:center;min-width:170px}.training-grid{display:grid;grid-template-columns:minmax(0,1fr) 250px;gap:14px}.training-main{min-width:0}.training-info{border:1px solid var(--divider-color);border-radius:10px;padding:13px;background:var(--secondary-background-color)}.training-info dl{display:grid;grid-template-columns:auto 1fr;gap:7px;margin-top:14px}.training-info dt{color:var(--secondary-text-color)}.training-info dd{margin:0;text-align:right;font-weight:600}.method-picker{margin-bottom:4px}.method-label{display:block;font-size:12px;color:var(--secondary-text-color);margin-bottom:6px}.method-options{display:flex;gap:18px;align-items:center;flex-wrap:wrap}.method-options label{display:flex;align-items:center;gap:7px;font-size:14px;color:var(--primary-text-color);cursor:pointer}.method-options input{width:20px;height:20px;margin:0}.instruction-card{margin-top:12px;padding:12px;border-radius:10px;background:var(--secondary-background-color);border-left:4px solid #36c8ff}.instruction-card strong{display:block}.capture-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:12px}.capture-grid>div{border:1px solid var(--divider-color);border-radius:9px;padding:10px}.capture-grid span{display:block;font-size:10px;color:var(--secondary-text-color)}.capture-grid strong{display:block;font-size:18px;margin-top:3px}.capture-value.valid{border-color:#35b85a;background:rgba(53,184,90,.12)}.capture-state{display:flex;align-items:center;gap:8px;margin-top:10px;padding:10px;border-radius:9px;background:var(--secondary-background-color)}.capture-state.valid{border:1px solid #35b85a}.status-light{width:11px;height:11px;border-radius:50%;background:#ff4d5f;flex:none}.status-light.green{background:#35b85a}.status-light.amber{background:#ff4d5f}.training-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.completed-card{margin-top:12px;padding:12px;border:1px solid #35b85a;border-radius:10px}.completed-card>strong{font-size:22px;display:block}.completed-card p{font-size:12px;margin-top:3px}
      .modal-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.58);display:flex;align-items:center;justify-content:center;z-index:10000;padding:16px}.modal{width:min(760px,100%);max-height:90vh;overflow:auto;background:var(--card-background-color);border-radius:14px;padding:20px;box-shadow:var(--ha-card-box-shadow);color:var(--primary-text-color)}.modal.small{width:min(520px,100%)}.modal-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;margin-bottom:14px}.modal-head>button{font-size:22px;line-height:1;padding:4px 9px}.search-row{display:grid;grid-template-columns:minmax(0,1fr) 170px;gap:8px;margin-bottom:8px}.modal input,.modal select{box-sizing:border-box;width:100%;padding:9px;border:1px solid var(--divider-color);border-radius:6px;background:var(--primary-background-color);color:var(--primary-text-color);font:inherit}.modal>label{display:block;margin:12px 0}.modal>label input{display:block;margin-top:5px}.modal #choices{height:310px}.ownership{min-height:52px;margin-top:10px;padding:10px;border:1px solid var(--divider-color);border-radius:8px;background:var(--secondary-background-color);font-size:13px}.modal-actions{display:grid;grid-template-columns:auto 1fr auto auto;gap:8px;align-items:center;margin-top:14px}.toast{position:fixed;right:22px;bottom:22px;z-index:11000;padding:12px 16px;border-radius:8px;background:#26b8f0;color:#07131d;box-shadow:var(--ha-card-box-shadow);max-width:440px;font-weight:700}.toast.error-toast{background:#ff4d5f;color:#fff}
      @media(max-width:1100px){.summary{grid-template-columns:repeat(3,1fr)}.meter-grid{grid-template-columns:repeat(2,1fr)}.table-scroll{max-height:none}.queue-strip{grid-template-columns:repeat(3,1fr)}.queue-more{grid-column:1/-1}.training-grid{grid-template-columns:1fr}}@media(max-width:700px){.title-row{display:grid;grid-template-columns:34px 46px minmax(0,1fr);align-items:center;gap:9px;padding:0 2px}.back-button{grid-column:1;width:34px;height:34px;flex:none;align-self:center;padding:0;border:0;border-radius:0;background:transparent!important;box-shadow:none;color:var(--primary-text-color);font-size:25px;line-height:1}.back-button:hover,.back-button:focus,.back-button:active{background:transparent!important;box-shadow:none}.brand-logo{grid-column:2;width:46px;height:46px;flex:none}.brand-logo svg{width:46px;height:46px;display:block}.brand-copy{grid-column:3;min-width:0;flex:1}.brand-name-row{display:block;gap:0;flex-wrap:nowrap;align-items:initial}.brand-name-row h1{font-size:25px;line-height:1;margin:0 0 4px}.tagline{display:block;font-size:16px;line-height:1.05;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.brand-copy p{font-size:12px;line-height:1.15;margin-top:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.meter-grid{grid-template-columns:1fr}.section-heading{align-items:flex-start;flex-direction:column}.shell{padding:0 12px 16px}header{margin:0 -12px 12px;padding:12px 14px 13px}.summary{grid-template-columns:repeat(2,1fr);gap:7px}.metric{padding:10px}.metric strong{font-size:17px}.toolbar{align-items:stretch}.views,.toolbar-actions{width:100%}.views button,.toolbar-actions button{flex:1}.list-tools{align-items:stretch}.search-box{max-width:none}.result-count{display:none}.selection-bar{align-items:stretch}.selection-actions{width:100%}.selection-actions button{flex:1}.table-scroll{max-height:none}.queue-strip{grid-template-columns:1fr}.training-workspace{padding:12px}.capture-grid{grid-template-columns:repeat(2,1fr)}.training-head{align-items:center}.training-head h2{font-size:20px}.modal-actions{grid-template-columns:1fr 1fr}.modal-actions span{display:none}}
    `; }
  }
  customElements.define(TAG, EnergyIQPanel);
})();
