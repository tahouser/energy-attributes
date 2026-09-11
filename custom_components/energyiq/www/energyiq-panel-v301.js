/* EnergyIQ 3.0.1 panel. The versioned custom-element name intentionally changes with the panel release so an older EnergyIQ element already registered in the HA browser cannot win the race. */
(() => {
  const TAG = "energyiq-panel-v301";
  const VERSION = "3.0.1";
  if (customElements.get(TAG)) return;

  class EnergyIQPanel extends HTMLElement {
    constructor() {
      super();
      this._hass = null;
      this.entryId = null;
      this.workspace = null;
      this.bulk = null;
      this.view = "monitored";
      this.pending = null;
      this.scrollTop = 0;
      this.loading = false;
      this.refreshTimer = null;
      this.bulkTimer = null;
      this.modal = null;
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

    disconnectedCallback() {
      if (this.refreshTimer) clearInterval(this.refreshTimer);
      if (this.bulkTimer) clearInterval(this.bulkTimer);
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

    async refresh() {
      if (!this.hass || !this.entryId) return;
      try {
        const keep = this.scrollTop;
        this.workspace = await this.ws({ type: "energy_attribution/workspace", entry_id: this.entryId });
        this.bulk = await this.ws({ type: "energy_attribution/bulk_training_state", entry_id: this.entryId });
        if (this.bulk?.status === "running") this.startBulkPolling();
        else if (this.bulkTimer) { clearInterval(this.bulkTimer); this.bulkTimer = null; }
        this.render(keep);
      } catch (error) { console.error("EnergyIQ refresh failed", error); }
    }

    startBulkPolling() {
      if (this.bulkTimer) return;
      this.bulkTimer = setInterval(async () => {
        try {
          this.bulk = await this.ws({ type: "energy_attribution/bulk_training_state", entry_id: this.entryId });
          this.render(this.scrollTop);
          if (this.bulk?.status !== "running") { clearInterval(this.bulkTimer); this.bulkTimer = null; }
        } catch (error) { console.error("EnergyIQ bulk status", error); }
      }, 1000);
    }

    devices() { return Array.isArray(this.workspace?.devices) ? this.workspace.devices : []; }
    selectedIds() {
      if (this.pending) return new Set(this.pending);
      return new Set(this.devices().filter(d => d.classification === "monitor").map(d => d.device_id));
    }
    esc(value) {
      return String(value ?? "").replace(/[&<>\"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
    }
    attr(value) { return this.esc(value).replace(/`/g, "&#96;"); }

    stateFor(device) {
      const items = [...(device.controls || []), ...(device.measurements || [])];
      for (const item of items) {
        const state = item?.entity_id ? this.hass?.states?.[item.entity_id]?.state : null;
        if (state === "on" || state === "off") return state;
      }
      return null;
    }

    trainingText(training) {
      const s = training?.status || "not trained";
      if (s === "active") return training.instruction || `Training: ${training.phase || "in progress"}`;
      if (s === "complete") return "Complete";
      if (s === "error") return `Error: ${training.error || training.instruction || "training failed"}`;
      if (s === "stopped") return "Stopped";
      if (s === "interrupted") return "Interrupted";
      return "Not trained";
    }

    renderLoading() { this.innerHTML = `<ha-card class="message"><h2>EnergyIQ</h2><p>Loading workspace…</p></ha-card>`; }
    renderError(error) { this.innerHTML = `<ha-card class="message"><h2>EnergyIQ</h2><p>${this.esc(error?.message || error)}</p></ha-card>`; }

    summary() {
      const all = this.devices(), selected = this.selectedIds();
      const monitored = all.filter(d => selected.has(d.device_id));
      const trained = monitored.filter(d => d.training?.status === "complete").length;
      const home = Number(this.workspace?.whole_home_power);
      const active = Number(this.workspace?.trained_live_power_w || 0);
      const mystery = Number.isFinite(home) ? Math.max(0, home - active) : NaN;
      const f = n => Number.isFinite(n) ? `${n.toFixed(0)} W` : "—";
      return `<section class="summary">
        <div><span>Home Power Now</span><strong>${f(home)}</strong></div>
        <div><span>Trained Active Watts</span><strong>${f(active)}</strong></div>
        <div class="mystery"><span>Mystery Watts</span><strong>${f(mystery)}</strong></div>
        <div><span>Monitored Loads</span><strong>${monitored.length}</strong></div>
        <div><span>Trained</span><strong>${trained} / ${monitored.length}</strong></div>
        <div><span>Untrained</span><strong>${monitored.length - trained}</strong></div>
      </section>`;
    }

    row(d, selected) {
      const monitored = selected.has(d.device_id), manual = String(d.source || "").toLowerCase() === "manual";
      const power = Number(d.current_power), state = this.stateFor(d), t = d.training || {};
      const stateBox = `<span class="state ${state || "unknown"}">${state === "on" ? "ON" : state === "off" ? "OFF" : "—"}</span>`;
      let action = "";
      if (monitored) {
        if (t.status === "active") action = `<button data-stop="${this.attr(d.device_id)}">Stop</button>`;
        else if (manual) action = `<button data-manual="${this.attr(d.device_id)}">${t.status === "complete" ? "Retrain Manual" : "Manual Training"}</button>`;
        else action = `<button data-quick="${this.attr(d.device_id)}">Quick ON/OFF</button><button data-full="${this.attr(d.device_id)}">Full Cycle</button>`;
      }
      return `<tr>
        <td><input type="checkbox" data-monitor="${this.attr(d.device_id)}" ${monitored ? "checked" : ""}></td>
        <td><strong>${this.esc(d.name || d.device_id)}</strong><small>${this.esc(d.category || d.model || "")}</small></td>
        <td>${this.esc(d.area || "")}</td><td>${manual ? "Manual" : "HA"}</td>
        <td>${Number.isFinite(power) ? `${power.toFixed(0)} W` : "—"}</td><td>${stateBox}</td>
        <td class="training">${this.esc(this.trainingText(t))}</td><td>${this.esc(t.method || "—")}</td><td class="actions">${action}</td>
      </tr>`;
    }

    render(keep = 0) {
      if (!this.workspace) return;
      this.scrollTop = keep;
      const all = this.devices(), selected = this.selectedIds();
      const visible = all.filter(d => this.view === "monitored" ? selected.has(d.device_id) : !selected.has(d.device_id))
        .sort((a,b) => String(a.name).localeCompare(String(b.name)));
      this.innerHTML = `<style>${this.styles()}</style><div class="shell">
        <header><div><h1>EnergyIQ</h1><p>Whole-home electrical intelligence · v${VERSION}</p></div>
          <div class="head-actions"><button id="add">＋ Add Device / Entity</button><button id="save" class="primary">Save Monitoring</button></div></header>
        ${this.summary()}
        <div class="toolbar"><div><button id="monitored" class="${this.view === "monitored" ? "selected" : ""}">Monitored (${selected.size})</button><button id="excluded" class="${this.view === "excluded" ? "selected" : ""}">Excluded (${Math.max(0, all.length - selected.size)})</button></div>
          <button id="bulk" ${this.view !== "monitored" || !visible.some(d => String(d.source || "").toLowerCase() !== "manual") ? "disabled" : ""}>Auto Train Monitored</button></div>
        ${this.bulk?.status === "running" ? `<div class="bulk"><strong>Bulk training in progress</strong> · ${Number(this.bulk.completed || 0)} / ${Number(this.bulk.total || 0)} complete</div>` : ""}
        <div class="table-scroll"><table><thead><tr><th>Monitor</th><th>Device</th><th>Area</th><th>Source</th><th>Power</th><th>State</th><th>Training</th><th>Method</th><th>Action</th></tr></thead><tbody>
          ${visible.length ? visible.map(d => this.row(d, selected)).join("") : `<tr><td colspan="9" class="empty">No loads in this view.</td></tr>`}
        </tbody></table></div></div>`;
      this.bind();
      requestAnimationFrame(() => { const s = this.querySelector(".table-scroll"); if (s) { s.scrollTop = this.scrollTop; s.addEventListener("scroll", () => this.scrollTop = s.scrollTop, {passive:true}); } });
    }

    bind() {
      this.querySelector("#save")?.addEventListener("click", () => this.saveMonitoring());
      this.querySelector("#add")?.addEventListener("click", () => this.openAdd());
      this.querySelector("#monitored")?.addEventListener("click", () => { this.view = "monitored"; this.render(this.scrollTop); });
      this.querySelector("#excluded")?.addEventListener("click", () => { this.view = "excluded"; this.render(this.scrollTop); });
      this.querySelector("#bulk")?.addEventListener("click", () => this.bulkTrain());
      this.querySelectorAll("[data-monitor]").forEach(box => box.addEventListener("change", e => {
        const s = this.selectedIds(), id = e.currentTarget.dataset.monitor;
        e.currentTarget.checked ? s.add(id) : s.delete(id); this.pending = s; this.render(this.scrollTop);
      }));
      this.querySelectorAll("[data-quick]").forEach(b => b.addEventListener("click", () => this.train(b.dataset.quick, "quick")));
      this.querySelectorAll("[data-full]").forEach(b => b.addEventListener("click", () => this.train(b.dataset.full, "full_cycle")));
      this.querySelectorAll("[data-manual]").forEach(b => b.addEventListener("click", () => this.train(b.dataset.manual, "manual")));
      this.querySelectorAll("[data-stop]").forEach(b => b.addEventListener("click", () => this.stop(b.dataset.stop)));
    }

    async saveMonitoring() {
      try { await this.ws({type:"energy_attribution/set_monitoring",entry_id:this.entryId,device_ids:[...this.selectedIds()]}); this.pending=null; await this.refresh(); }
      catch(e) { this.toast(e.message || "Unable to save monitoring selections"); }
    }

    async train(deviceId, method) {
      const d = this.devices().find(x => x.device_id === deviceId); if (!d) return;
      const msg = method === "quick" ? `EnergyIQ will automatically turn “${d.name}” ON and OFF during Quick Training. Continue?` : method === "manual" ? `Manual training for “${d.name}”. No command will be sent to the device. Continue?` : `Run a Full Cycle training session for “${d.name}”?`;
      if (!window.confirm(msg)) return;
      try { await this.ws({type:"energy_attribution/start_training",entry_id:this.entryId,device_id:deviceId,method}); await this.refresh(); }
      catch(e) { this.toast(e.message || "Unable to start training"); }
    }

    async stop(deviceId) { try { await this.ws({type:"energy_attribution/stop_training",entry_id:this.entryId,device_id:deviceId}); await this.refresh(); } catch(e) { this.toast(e.message); } }

    async bulkTrain() {
      const ids = [...this.selectedIds()].filter(id => { const d=this.devices().find(x=>x.device_id===id); return d && String(d.source||"").toLowerCase() !== "manual"; });
      if (!ids.length || !window.confirm(`Auto Train ${ids.length} monitored HA loads sequentially?`)) return;
      try { await this.ws({type:"energy_attribution/bulk_auto_training",entry_id:this.entryId,device_ids:ids}); this.startBulkPolling(); await this.refresh(); }
      catch(e) { this.toast(e.message || "Unable to start bulk training"); }
    }

    toast(message) { window.alert(message); }

    async openAdd() {
      try { const r = await this.ws({type:"energy_attribution/list_available_entities",entry_id:this.entryId}); this.showEntityModal(r.entities || []); }
      catch(e) { this.toast(e.message || "Unable to load Home Assistant entities"); }
    }

    showEntityModal(entities) {
      const domains = [...new Set(entities.map(e=>e.domain).filter(Boolean))].sort();
      const back = document.createElement("div"); back.className="backdrop";
      back.innerHTML = `<div class="modal"><div class="modal-head"><div><h2>Add Device / Entity</h2><p>Complete Home Assistant entity registry. Disabled entities are shown but cannot be added.</p></div><button id="x">×</button></div>
        <div class="search"><input id="q" type="search" placeholder="Search name, entity ID, domain, state, HVAC action…"><select id="dom"><option value="">All domains</option>${domains.map(d=>`<option>${this.esc(d)}</option>`).join("")}</select></div>
        <select id="entities" size="12"></select><div id="ownership" class="ownership">Select an entity to see its EnergyIQ association.</div>
        <div class="modal-actions"><button id="manual">Add Manual Device</button><span></span><button id="cancel">Cancel</button><button id="addEntity" class="primary">Add Entity</button></div></div>`;
      this.appendChild(back); this.modal = back;
      const list = back.querySelector("#entities"), q=back.querySelector("#q"), dom=back.querySelector("#dom"), own=back.querySelector("#ownership");
      const filtered = () => entities.filter(e => { const text=[e.name,e.entity_id,e.domain,e.state,e.hvac_action].join(" ").toLowerCase(); return (!q.value || text.includes(q.value.toLowerCase())) && (!dom.value || e.domain===dom.value); });
      const fill = () => { const a=filtered(); list.innerHTML=a.map((e,i)=>`<option value="${this.attr(e.entity_id)}" data-index="${i}" ${e.disabled?"disabled":""}>${this.esc(e.name)} · ${this.esc(e.entity_id)} · ${this.esc(e.state)}${e.disabled?" · DISABLED":""}</option>`).join(""); list._items=a; own.textContent=a.length ? "Select an entity to see its EnergyIQ association." : "No matching entities."; };
      const showOwn = () => { const e=list._items?.[list.selectedIndex]; if(!e) return; const m=e.candidate_matches||[]; own.innerHTML = m.length ? `<strong>Existing EnergyIQ association:</strong> ${m.map(x=>`${this.esc(x.name)} (${this.esc(x.classification)})`).join(", ")}` : "No existing EnergyIQ association for this exact entity ID."; if(e.disabled) own.innerHTML += "<br><strong>Disabled in Home Assistant — enable it before adding.</strong>"; };
      fill(); q.addEventListener("input",fill); dom.addEventListener("change",fill); list.addEventListener("change",showOwn);
      back.querySelector("#x").onclick=()=>back.remove(); back.querySelector("#cancel").onclick=()=>back.remove();
      back.querySelector("#addEntity").onclick=async()=>{ const e=list._items?.[list.selectedIndex]; if(!e||e.disabled) return; try { await this.ws({type:"energy_attribution/add_entity",entry_id:this.entryId,entity_id:e.entity_id}); back.remove(); this.modal=null; await this.refresh(); } catch(err){ this.toast(err.message); } };
      back.querySelector("#manual").onclick=()=>{ back.remove(); this.modal=null; this.showManualModal(); };
    }

    showManualModal() {
      const back=document.createElement("div"); back.className="backdrop"; back.innerHTML=`<div class="modal small"><div class="modal-head"><div><h2>Add Manual Device</h2><p>Manual training never sends a command to the device.</p></div><button id="x">×</button></div><label>Name<input id="name" autofocus></label><label>Category<input id="cat" value="Appliance"></label><div class="modal-actions"><span></span><button id="cancel">Cancel</button><button id="save" class="primary">Add Device</button></div></div>`; this.appendChild(back);
      back.querySelector("#x").onclick=()=>back.remove(); back.querySelector("#cancel").onclick=()=>back.remove(); back.querySelector("#save").onclick=async()=>{ const name=back.querySelector("#name").value.trim(), category=back.querySelector("#cat").value.trim()||"Appliance"; if(!name) return; try{await this.ws({type:"energy_attribution/add_manual_device",entry_id:this.entryId,name,category});back.remove();await this.refresh();}catch(e){this.toast(e.message);}};
    }

    styles() { return `
      :host{display:block;font-family:var(--paper-font-body1_-_font-family,Roboto,Arial,sans-serif);color:var(--primary-text-color,#222)}
      *{box-sizing:border-box}.shell{padding:20px;max-width:1400px;margin:auto}header{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:16px}h1{margin:0;font-size:28px}header p{margin:4px 0;color:var(--secondary-text-color,#666)}button{padding:7px 11px;border:1px solid #aaa;border-radius:3px;background:#fff;cursor:pointer}button.primary,.toolbar button.selected{background:#039be5;color:#fff;border-color:#039be5}.head-actions{display:flex;gap:8px}.summary{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:12px}.summary>div{border:1px solid #ddd;border-radius:8px;padding:12px 14px;background:var(--card-background-color,#fff)}.summary span{display:block;color:#666;font-size:12px}.summary strong{display:block;font-size:21px;margin-top:3px}.summary .mystery{border-left:4px solid #039be5}.toolbar{display:flex;justify-content:space-between;align-items:center;margin:12px 0;gap:10px}.toolbar>div{display:flex}.toolbar button{border-radius:0}.toolbar button:first-child{border-radius:3px 0 0 3px}.toolbar button:nth-child(2){border-radius:0 3px 3px 0}.bulk{padding:10px;border:1px solid #ddd;border-radius:6px;margin-bottom:10px}.table-scroll{overflow:auto;border:1px solid #ddd;border-radius:6px}table{width:100%;border-collapse:collapse;min-width:1050px}th,td{padding:8px 9px;border-bottom:1px solid #e5e5e5;text-align:left;vertical-align:middle}th{font-size:12px;color:#555;background:#fafafa;position:sticky;top:0;z-index:1}td strong{display:block}td small{display:block;color:#777;margin-top:2px}.actions{white-space:nowrap}.actions button{margin-right:4px}.state{display:inline-flex;width:44px;height:22px;align-items:center;justify-content:center;border-radius:3px;color:#fff;font-size:10px;font-weight:700}.state.on{background:#2e7d32}.state.off{background:#c62828}.state.unknown{background:#777}.training{max-width:260px}.empty{text-align:center;color:#777;padding:30px}.message{padding:20px}.backdrop{position:fixed;inset:0;background:rgba(0,0,0,.38);display:flex;align-items:center;justify-content:center;z-index:1000}.modal{width:min(900px,94vw);max-height:90vh;overflow:auto;background:var(--card-background-color,#fff);border-radius:8px;padding:16px;box-shadow:0 8px 30px rgba(0,0,0,.3)}.modal.small{width:min(480px,94vw)}.modal-head{display:flex;justify-content:space-between;gap:15px;align-items:flex-start}.modal h2{margin:0}.modal p{margin:4px 0 12px;color:#666;font-size:13px}.search{display:grid;grid-template-columns:1fr 180px;gap:8px;margin:10px 0}.search input,.search select,.modal label input{width:100%;padding:8px;border:1px solid #aaa;border-radius:4px;background:inherit;color:inherit}.modal>select{width:100%;border:1px solid #aaa}.ownership{min-height:44px;padding:9px;margin-top:8px;background:#f6f6f6;border-radius:4px;font-size:13px}.modal-actions{display:flex;gap:8px;align-items:center;margin-top:12px}.modal-actions span{flex:1}.modal label{display:block;margin:12px 0;font-weight:600}.modal label input{display:block;margin-top:5px;font-weight:400}.modal-actions .primary{background:#039be5;color:#fff;border-color:#039be5}
      @media(max-width:800px){.summary{grid-template-columns:1fr}.head-actions{flex-wrap:wrap}.shell{padding:10px}}
    `; }
  }
  customElements.define(TAG, EnergyIQPanel);
})();
