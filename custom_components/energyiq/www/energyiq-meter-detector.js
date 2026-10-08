(() => {
  const TAG = "energyiq-meter-detector";
  const VERSION = "44000";
  if (customElements.get(TAG)) return;

  class EnergyIQMeterDetector extends HTMLElement {
    constructor() {
      super();
      this.hass = null;
      this.data = null;
      this.loading = false;
      this.error = null;
      this.probeResults = new Map();
      this.probingIds = new Set();
      this.selected = new Set();
      this.entryId = null;
      this.currentPowerEntity = null;
      this.currentPowerEntities = new Set();
      this.notice = "";
      this.openMeterIds = new Set();
      this.openEntityIds = new Set();
      this.timer = null;
      this.refreshing = false;
      this.brandUrl = "/energyiq-brand/icon@2x.png?v=" + VERSION;
    }

    set hass(value) {
      this._hass = value;
      if (value && !this.loading && !this.data) this.load();
    }
    get hass() { return this._hass; }

    formatError(e) {
      if (e == null) return "Unknown WebSocket error";
      if (typeof e === "string") return e;
      const code = e.code || e.error?.code || e.details?.code;
      const message = e.message || e.error?.message || e.details?.message;
      if (code && message) return `${code}: ${message}`;
      if (code) return `WebSocket error code: ${code}`;
      if (message) return message;
      try { return JSON.stringify(e); } catch (_) { return String(e); }
    }

    connectedCallback() {
      if (this._hass && !this.loading && !this.data) this.load();
    }
    disconnectedCallback() { if (this.timer) clearInterval(this.timer); }

    async ws(message) {
      if (this._hass?.callWS) return this._hass.callWS(message);
      return this._hass.connection.sendMessagePromise(message);
    }

    async load() {
      if (this.loading) return;
      this.loading = true;
      this.error = null;
      this.render();
      try {
        const entries = await this.ws({type:"energy_attribution/list_entries"});
        this.entryId = entries?.entries?.[0]?.entry_id || null;
        if (!this.entryId) throw new Error("EnergyIQ is not configured.");
        const workspace = await this.ws({type:"energy_attribution/workspace", entry_id:this.entryId});
        this.currentPowerEntity = workspace?.power_entity || null;
        this.currentPowerEntities = new Set(workspace?.power_entities || (this.currentPowerEntity ? [this.currentPowerEntity] : []));
        this.data = await this.ws({type:"energy_attribution/meter_detector"});
        this.render();
        this.startAutomaticInterrogation();
        if (this.timer) clearInterval(this.timer);
        this.timer = setInterval(() => this.refresh(), 3000);
      } catch (e) {
        this.error = this.formatError(e);
        this.render();
      } finally {
        this.loading = false;
      }
    }

    async refresh() {
      if (this.refreshing || this.probingIds.size) return;
      this.refreshing = true;
      try {
        const workspace = this.entryId ? await this.ws({type:"energy_attribution/workspace", entry_id:this.entryId}) : null;
        if (workspace) {
          this.currentPowerEntity = workspace.power_entity || null;
          this.currentPowerEntities = new Set(workspace.power_entities || (this.currentPowerEntity ? [this.currentPowerEntity] : []));
        }
        this.data = await this.ws({type:"energy_attribution/meter_detector"});
        this.error = null;
        this.render();
      } catch (e) {
        // HA may briefly drop/reconnect the frontend WebSocket. Keep the last
        // successful discovery visible instead of replacing it with a red
        // transient "connection lost" panel. The next interval retries.
        const message = this.formatError(e);
        if (!this.data || !/^3:\s*Connection lost$/i.test(message)) {
          this.error = message;
          this.render();
        }
      } finally {
        this.refreshing = false;
      }
    }


    startAutomaticInterrogation() {
      const candidates = Array.isArray(this.data?.candidates) ? this.data.candidates : [];
      for (const candidate of candidates) {
        if (String(candidate.meter_class || "").toUpperCase() !== "A") continue;
        const id = candidate.device_id;
        if (!id || this.probingIds.has(id) || this.probeResults.has(id)) continue;
        this.probingIds.add(id);
        this.runAutomaticProbe(id);
      }
    }

    async runAutomaticProbe(deviceId) {
      try {
        const result = await this.ws({
          type: "energy_attribution/meter_detector_probe",
          device_id: deviceId,
        });
        this.probeResults.set(deviceId, result);
        this.error = null;
        this.render();
      } catch (e) {
        this.probeResults.set(deviceId, { device_id: deviceId, error: this.formatError(e) });
        this.render();
      } finally {
        this.probingIds.delete(deviceId);
        if (!this.probingIds.size && this.data) this.refresh();
      }
    }
    renderProbe(p) {
      if (!p) return "";
      const source = p.meter_source;
      const ids = source?.power_entity_ids || [];
      const selected = ids.length > 0 && ids.every(x => this.currentPowerEntities.has(x));
      return \`
        <div class="probe">
          <div class="probe-head">
            <div><span class="eyebrow">Live interrogation</span><strong>30-second channel test</strong><small>\${this.escape(p.conclusion)}</small></div>
            <span class="probe-count">\${p.active_channel_count} active / \${p.channel_count_observed} observed</span>
          </div>
          <div class="channel-grid">
            \${(p.channels||[]).map(ch => \`
              <div class="channel-card \${ch.active ? "active" : ""}">
                <div class="channel-top"><strong>\${this.escape(ch.channel)}</strong><span>\${ch.active ? "SIGNAL" : "QUIET"}</span></div>
                <div class="channel-assessment">\${this.escape(ch.assessment)}</div>
                \${(ch.entities||[]).map(e=>\`<div class="probe-row"><span>\${this.escape(e.kind)}</span><strong>\${e.max == null ? "—" : this.escape(Number(e.max).toFixed(2))} \${this.escape(e.unit||"")}</strong><small>range \${e.range == null ? "—" : this.escape(Number(e.range).toFixed(2))}</small></div>\`).join("")}
              </div>\`).join("")}
          </div>
          \${source && source.mode !== "insufficient" ? \`
            <div class="source-result">
              <div><span class="eyebrow">EnergyIQ interpretation</span><strong>\${this.escape(source.label)}</strong>
              <small>\${this.escape(ids.map(x => x.split(".").pop()).join(" + "))}\${source.current_w == null ? "" : \` · \${this.escape(Number(source.current_w).toFixed(0))} W observed\`}</small></div>
              \${ids.length ? \`<button type="button" class="meter-use primary" data-use-source="\${this.escape(ids.join(","))}" data-source-mode="\${this.escape(source.mode)}">\${selected ? "Current EnergyIQ meter" : "Use this meter"}</button>\` : ""}
            </div>\` : ""}
          <div class="probe-note">\${(p.limitations||[]).map(x=>\`<div>• \${this.escape(x)}</div>\`).join("")}</div>
        </div>\`;
    }

    escape(v) {
      return String(v ?? "").replace(/[&<>"']/g, c => ({
        "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
      }[c]));
    }

    num(v) {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }

    captureDetailsState() {
      this.openMeterIds = new Set(
        [...this.querySelectorAll("details.meter-item[open][data-device-id]")].map(el => el.dataset.deviceId)
      );
      this.openEntityIds = new Set(
        [...this.querySelectorAll("details.subdetails[open][data-device-id]")].map(el => el.dataset.deviceId)
      );
    }

    render() {
      if (this.isConnected && this.innerHTML) this.captureDetailsState();
      const d = this.data;
      this.innerHTML = `<style>${this.styles()}</style>
        <div class="guard"></div>
        <div class="shell">
          <header>
            <div class="title-row">
              <button class="back" id="back" title="Back to Home Assistant" aria-label="Back to Home Assistant"><ha-icon icon="mdi:arrow-left"></ha-icon></button>
              <img class="logo" src="${this.brandUrl}" alt="EnergyIQ">
              <div class="copy">
                <div class="name-row"><h1>EnergyIQ</h1><span>Meter Detector</span></div>
                <p>Discover what Home Assistant already knows about your electrical meter.</p>
              </div>
            </div>
          </header>
          <main>
            <section class="hero">
              <div>
                <span class="eyebrow">Commissioning research</span>
                <h2>Whole-home meter discovery</h2>
                <p>EnergyIQ interrogates related channels and builds one logical whole-home meter. Nothing is changed until you select a detected source.</p>
              </div>
              <button id="refresh" class="primary" ${this.loading ? "disabled" : ""}>${this.loading ? "Scanning…" : "Scan again"}</button>
            </section>
            ${this.notice ? `<section class="panel notice"><strong>${this.escape(this.notice)}</strong></section>` : ""}${this.error ? `<section class="error"><strong>Detector error</strong><p>${this.escape(this.error)}</p></section>` : ""}${d?.error ? `<section class="error"><strong>Detector backend error</strong><p>${this.escape(d.error)}</p></section>` : ""}
            ${!d && !this.error ? `<section class="empty"><span class="spinner"></span><strong>Scanning Home Assistant…</strong></section>` : ""}
            ${d ? this.renderResults(d) : ""}
          </main>
        </div>`;
      this.bind();
    }

    renderResults(d) {
      const candidates = Array.isArray(d.candidates) ? d.candidates : [];
      return `
        <div class="selection-bar"><div><strong>${d.candidate_count} sources detected</strong><small>EnergyIQ looks at the related power, voltage, current, and energy channels and determines whether they form one whole-home meter.</small></div></div>
        ${candidates.length ? candidates.map((c,i)=>this.renderCandidate(c,i===0)).join("") : `
          <section class="panel"><span class="eyebrow">No strong candidates</span><h2>No whole-home meter candidate found</h2><p>EnergyIQ can still fall back to a manual entity selector later. This test intentionally does not modify configuration.</p></section>`}
        <section class="panel">
          <div class="panel-head"><div><span class="eyebrow">What the detector can see</span><h2>Detection boundary</h2></div></div>
          <ul class="notes">${(d.analysis_notes||[]).map(x=>`<li>${this.escape(x)}</li>`).join("")}</ul>
        </section>
        ${d.unattached?.length ? `<section class="panel"><div class="panel-head"><div><span class="eyebrow">Fallback candidates</span><h2>Power entities without a device</h2></div></div><div class="entity-list">${d.unattached.map(e=>this.renderEntity(e)).join("")}</div></section>` : ""}
      `;
    }

    renderCandidate(c, top) {
      const tier = String(c.meter_class || "C").toLowerCase();
      const power = c.entities.filter(e => e.kind === "power").length;
      const energy = c.entities.filter(e => e.kind === "energy").length;
      const voltage = c.entities.filter(e => e.kind === "voltage").length;
      const current = c.entities.filter(e => e.kind === "current").length;
      return `
        <details class="meter-item tier-${tier}" data-device-id="${this.escape(c.device_id)}" ${(top || this.openMeterIds.has(c.device_id)) ? "open" : ""}>
          <summary class="meter-summary">
            <div class="meter-name"><span class="meter-select-placeholder" title="Choose a power entity below">↳</span>
              <span class="tier-badge">${this.escape(tier.toUpperCase())}</span>
              <div><strong>${this.escape(c.name)}</strong><small>${this.escape(c.manufacturer || "Unknown")} ${c.model ? "· " + this.escape(c.model) : ""}${c.member_device_ids?.length > 1 ? ` · ${c.member_device_ids.length} HA records grouped` : ""}</small></div>
            </div>
            <div class="meter-counts">
              <span>${power} W</span><span>${energy} kWh</span><span>${voltage} V</span><span>${current} A</span>
            </div>
          </summary>
          <div class="meter-detail">
            ${tier === "d" ? `<div class="unsupported-note">Not an EnergyIQ measurement source.</div>` : ""}
            ${this.probeResults.get(c.device_id) ? this.renderProbe(this.probeResults.get(c.device_id)) : this.probingIds.has(c.device_id) ? `<div class="probe"><span class="eyebrow">Automatic interrogation</span><strong>Analyzing channels for 30 seconds…</strong><small>This Class A source is being observed automatically.</small></div>` : ""}
            <details class="subdetails" data-device-id="${this.escape(c.device_id)}" ${this.openEntityIds.has(c.device_id) ? "open" : ""}><summary>Show Home Assistant entities (${c.entities.length})</summary>
              <div class="entity-table">
                <div class="entity-row entity-head"><span>Type</span><span>Name</span><span>Value</span><span>Unit</span><span>Action</span></div>
                ${c.entities.map(e=>this.renderEntityRow(e)).join("")}
              </div>
            </details>
          </div>
        </details>
      `;
    }

    renderEntityRow(e) {
      const value = e.value == null ? e.state : (Number.isFinite(Number(e.value)) ? Number(e.value).toFixed(2) : e.state);
      const usablePower = e.kind === "power" && ["w","kw"].includes(String(e.unit || "").toLowerCase());
      const current = usablePower && this.currentPowerEntities.has(e.entity_id);
      const role = e.role === "whole_home"
        ? '<span class="role whole-home">WHOLE HOME</span>'
        : e.role === "phase"
          ? '<span class="role phase-role">CHANNEL</span>'
          : "";
      const action = usablePower && e.role !== "phase"
        ? (current
          ? '<button type="button" class="meter-use current" disabled>Current EnergyIQ meter</button>'
          : '<button type="button" class="meter-use primary" data-use-meter="' + this.escape(e.entity_id) + '">Use as EnergyIQ meter</button>')
        : (e.role === "phase"
          ? '<span class="phase-note">Used through detected meter group</span>'
          : "");
      return '<div class="entity-row"><span class="type ' + this.escape(e.kind) + '">' + this.escape(e.kind) + '</span><span><strong>' + this.escape(e.name) + '</strong><small>' + role + ' ' + this.escape(e.entity_id) + '</small></span><span>' + this.escape(value) + '</span><span>' + this.escape(e.unit || "—") + '</span><span>' + action + '</span></div>';
    }
    renderEntity(e) {
      return `<div class="simple-row"><span><strong>${this.escape(e.name)}</strong><small>${this.escape(e.entity_id)}</small></span><strong>${this.escape(e.state)} ${this.escape(e.unit||"")}</strong></div>`;
    }

    bind() {
      this.querySelector("#back")?.addEventListener("click", () => {
        if (window.history.length > 1) window.history.back(); else window.location.href="/";
      });
      this.querySelector("#refresh")?.addEventListener("click", () => this.load());
      this.querySelectorAll("[data-use-meter]").forEach(button => button.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        this.useAsMeter(button.dataset.useMeter);
      }))
      this.querySelectorAll("[data-use-source]").forEach(button => button.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        this.usePowerSource(button.dataset.useSource, button.dataset.sourceMode);
      }));;
    }

    async useAsMeter(entityId) {
      return this.usePowerSource(entityId, "single_channel");
    }

    async usePowerSource(entityIds, mode) {
      if (!this.entryId || !entityIds) return;
      const ids = String(entityIds).split(",").map(x => x.trim()).filter(Boolean);
      if (!ids.length) return;
      try {
        const result = await this.ws({
          type:"energy_attribution/set_power_source",
          entry_id:this.entryId,
          entity_ids:ids,
          mode:mode || (ids.length > 1 ? "combined_channels" : "single_channel"),
        });
        this.currentPowerEntity = result.entity_id || ids[0];
        this.currentPowerEntities = new Set(result.entity_ids || ids);
        this.notice = ids.length > 1
          ? "Combined whole-home meter saved. EnergyIQ will use the channels together as one source."
          : "Whole-home meter saved. You can stay here and verify the selected reading.";
        this.render();
      } catch (e) {
        this.notice = this.formatError(e);
        this.render();
      }
    }

    styles() { return `
      :host{display:block;min-height:100vh;color:var(--primary-text-color);background:var(--primary-background-color)}
      .guard{position:fixed;top:0;left:0;right:0;height:var(--safe-area-inset-top,0px);z-index:2147483646;background:var(--primary-background-color)}
      .shell{min-height:100vh;box-sizing:border-box;padding:154px 24px 30px;max-width:1400px;margin:auto}
      header{position:fixed;top:var(--safe-area-inset-top,0px);left:var(--app-drawer-width,0px);right:var(--safe-area-content-inset-right,0px);z-index:2147483647;padding:22px 28px 24px;background:#06121d;border-bottom:1px solid rgba(42,194,255,.35);box-shadow:0 10px 30px rgba(0,0,0,.38)}
      .title-row{display:flex;align-items:center;gap:14px;max-width:1344px;margin:auto}.back{width:40px;height:40px;border:0;border-radius:50%;background:transparent;color:var(--primary-text-color);padding:0;display:grid;place-items:center}.back ha-icon{--mdc-icon-size:27px}.logo{width:56px;height:56px;object-fit:contain}.copy{min-width:0}.name-row{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap}.name-row h1{font-size:30px;margin:0 0 4px}.name-row span{font-size:19px;color:#36c8ff;font-weight:650;font-style:italic}.copy p{margin:0;color:var(--secondary-text-color)}
      main{display:grid;gap:14px}.hero,.panel,.metric,.error,.empty{border:1px solid var(--divider-color);border-radius:14px;background:linear-gradient(145deg,var(--card-background-color),rgba(20,31,44,.65));box-shadow:var(--ha-card-box-shadow)}.hero{padding:18px;display:flex;justify-content:space-between;gap:16px;align-items:center;border-color:rgba(54,200,255,.35)}.hero h2{margin:2px 0 5px;font-size:22px}.hero p{margin:0;color:var(--secondary-text-color)}.eyebrow{display:block;text-transform:uppercase;letter-spacing:.08em;font-size:10px;font-weight:800;color:var(--secondary-text-color);margin-bottom:4px}
      button{border:1px solid var(--divider-color);border-radius:8px;background:var(--card-background-color);color:var(--primary-text-color);padding:9px 13px;cursor:pointer;font:inherit}button:hover{background:var(--secondary-background-color);transform:translateY(-1px)}button.primary{background:#26b8f0;color:#07131d;border-color:#26b8f0;font-weight:800}button:disabled{opacity:.45}
      .summary-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.metric{padding:13px 14px;display:flex;flex-direction:column;gap:4px}.metric span{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--secondary-text-color)}.metric strong{font-size:20px}.metric small{font-size:10px;color:var(--secondary-text-color)}
      .panel{padding:17px}.panel.top{border-color:rgba(20,242,184,.42);box-shadow:inset 0 1px 0 rgba(255,255,255,.03),0 0 18px rgba(20,242,184,.05)}.candidate-head,.panel-head{display:flex;justify-content:space-between;gap:15px;align-items:flex-start}.candidate-head h2,.panel-head h2{margin:2px 0 4px}.candidate-head p{margin:0;color:var(--secondary-text-color)}.score{min-width:74px;text-align:center;border:1px solid rgba(54,200,255,.3);border-radius:11px;padding:7px 8px}.score strong{display:block;font-size:24px;color:#36c8ff}.score span{font-size:9px;color:var(--secondary-text-color)}
      .probe-action{margin:12px 0}.secondary{font-weight:700}.probe{margin:12px 0;padding:12px;border:1px solid rgba(54,200,255,.25);border-radius:11px;background:rgba(54,200,255,.035)}.probe-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.probe-head strong{display:block}.probe-head small{display:block;color:var(--secondary-text-color);margin-top:3px}.probe-count{font-size:10px;text-transform:uppercase;color:#35e7b0;white-space:nowrap}.channel-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:10px}.channel-card{border:1px solid var(--divider-color);border-radius:9px;padding:9px;background:rgba(255,255,255,.02)}.channel-card.active{border-color:rgba(20,242,184,.45)}.channel-top{display:flex;justify-content:space-between}.channel-top span{font-size:9px;color:var(--secondary-text-color)}.channel-assessment{font-size:10px;color:var(--secondary-text-color);margin:6px 0}.probe-row{display:grid;grid-template-columns:55px 1fr auto;gap:5px;border-top:1px solid var(--divider-color);padding-top:5px;margin-top:5px;font-size:9px}.probe-row small{color:var(--secondary-text-color)}.probe-note{margin-top:9px;color:var(--secondary-text-color);font-size:9px;line-height:1.45}.chips,.evidence>div{display:flex;flex-wrap:wrap;gap:6px;margin-top:11px}.chip,.evidence span{padding:5px 8px;border-radius:999px;background:rgba(54,200,255,.08);border:1px solid rgba(54,200,255,.16);font-size:10px;color:var(--secondary-text-color)}.evidence{margin:12px 0}.evidence>strong{font-size:11px}.inference{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:12px;border-radius:10px;margin:13px 0;border:1px solid var(--divider-color);background:rgba(255,255,255,.025)}.inference.promising{border-color:rgba(20,242,184,.4)}.inference.limited{border-color:rgba(255,193,7,.38)}.inference strong{display:block;font-size:15px}.confidence{font-size:10px;text-transform:uppercase;letter-spacing:.07em;color:var(--secondary-text-color);white-space:nowrap}
      .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin-bottom:13px}.stats>div{padding:9px;border:1px solid rgba(255,255,255,.05);border-radius:8px;background:rgba(255,255,255,.03)}.stats span{display:block;font-size:9px;text-transform:uppercase;color:var(--secondary-text-color)}.stats strong{display:block;margin-top:3px;font-size:17px}
      details{border-top:1px solid var(--divider-color);padding-top:10px;margin-top:10px}summary{cursor:pointer;font-weight:700;font-size:12px;color:var(--primary-text-color)}.entity-table{margin-top:9px;border:1px solid var(--divider-color);border-radius:9px;overflow:hidden}.entity-row{display:grid;grid-template-columns:90px minmax(180px,1fr) 90px 65px minmax(130px,auto);gap:8px;align-items:center;padding:8px 10px;border-top:1px solid var(--divider-color);font-size:11px}.entity-row:first-child{border-top:0}.entity-head{background:rgba(255,255,255,.03);font-size:9px;text-transform:uppercase;color:var(--secondary-text-color);letter-spacing:.06em}.entity-row small,.simple-row small{display:block;color:var(--secondary-text-color);font-size:9px;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.type{font-size:9px;text-transform:uppercase;font-weight:800}.type.power{color:#36c8ff}.type.energy{color:#35e7b0}.type.voltage{color:#ffd166}.type.current{color:#ff9f68}.registry{display:grid;gap:5px;margin-top:8px}.registry code{font-size:10px;overflow-wrap:anywhere}.notes{margin:8px 0 0;padding-left:19px;color:var(--secondary-text-color);line-height:1.5;font-size:12px}.simple-row{display:flex;justify-content:space-between;gap:12px;padding:9px 0;border-top:1px solid var(--divider-color);font-size:11px}
      .meter-use{white-space:nowrap;font-size:10px;padding:6px 8px}.meter-use.current{opacity:.7;cursor:default}.notice{border-color:rgba(20,242,184,.4)}.role{display:inline-block;margin-right:5px;padding:2px 5px;border-radius:5px;font-size:8px;font-weight:900;letter-spacing:.04em}.whole-home{color:#35e7b0;background:rgba(53,231,176,.10)}.phase-role{color:#ffd166;background:rgba(255,209,102,.10)}.phase-note{font-size:9px;color:var(--secondary-text-color)}
      .selection-bar{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 10px;border:1px solid rgba(54,200,255,.20);border-radius:9px;background:rgba(54,200,255,.04)}.selection-bar strong{font-size:12px}.selection-bar small{display:block;margin-top:2px;color:var(--secondary-text-color);font-size:10px}.meter-select{width:18px;height:18px;accent-color:#36c8ff;flex:0 0 auto}.meter-select-placeholder{display:grid;place-items:center;width:18px;height:18px;color:var(--secondary-text-color);font-size:14px}.unsupported-note{padding:8px 10px;margin-bottom:8px;border-radius:8px;background:rgba(160,160,160,.08);color:var(--secondary-text-color);font-size:10px}.meter-item{border:1px solid var(--divider-color);border-radius:12px;margin:8px 0;overflow:hidden;background:rgba(255,255,255,.025)}
      .meter-item.tier-a{background:rgba(53,231,176,.11);border-color:rgba(53,231,176,.35)}
      .meter-item.tier-b{background:rgba(54,200,255,.09);border-color:rgba(54,200,255,.30)}
      .meter-item.tier-c{background:rgba(255,209,102,.09);border-color:rgba(255,209,102,.28)}
      .meter-item.tier-d{background:rgba(160,160,160,.07);border-color:rgba(160,160,160,.22)}
      .meter-summary{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 13px;cursor:pointer;list-style:none}
      .meter-summary::-webkit-details-marker{display:none}.meter-name{display:flex;align-items:center;gap:10px;min-width:0}.meter-name strong{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:13px}.meter-name small{display:block;color:var(--secondary-text-color);font-size:10px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .tier-badge{display:grid;place-items:center;min-width:30px;height:26px;border-radius:7px;background:rgba(0,0,0,.16);font-size:11px;font-weight:900}.tier-a .tier-badge{color:#35e7b0}.tier-b .tier-badge{color:#36c8ff}.tier-c .tier-badge{color:#ffd166}.tier-d .tier-badge{color:#aaa}
      .meter-counts{display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-end}.meter-counts span{font-size:9px;padding:4px 6px;border-radius:6px;background:rgba(0,0,0,.13);color:var(--secondary-text-color)}
      .meter-detail{padding:0 13px 13px;border-top:1px solid rgba(255,255,255,.06)}.meter-detail-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 0}.meter-detail-head strong{display:block;font-size:12px}.score-mini{font-size:10px;color:var(--secondary-text-color)}.meter-actions{margin-bottom:9px}.compact-evidence{margin:8px 0}.subdetails{margin-top:9px}.subdetails summary{font-size:10px}
      @media(max-width:600px){.meter-summary{align-items:flex-start}.meter-counts{max-width:155px}.meter-counts span{font-size:8px}.meter-name strong{max-width:190px}}
      .error{padding:17px;border-color:rgba(255,77,95,.5)}.error p{margin:5px 0 0}.empty{min-height:180px;display:grid;place-items:center;gap:8px;padding:20px}.spinner{width:24px;height:24px;border:3px solid var(--divider-color);border-top-color:#36c8ff;border-radius:50%;animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
      @media(max-width:800px){.channel-grid{grid-template-columns:1fr}.probe-head{flex-direction:column}.shell{padding:105px 12px 18px}.hero{align-items:stretch;flex-direction:column}.summary-grid{grid-template-columns:1fr 1fr}.entity-row{grid-template-columns:70px minmax(150px,1fr) 90px 55px}.stats{grid-template-columns:repeat(2,1fr)}header{left:0;right:0;padding:12px 14px 13px}.title-row{display:grid;grid-template-columns:34px 46px minmax(0,1fr);gap:9px}.back{width:34px;height:34px}.logo{width:46px;height:46px}.name-row{gap:8px}.name-row h1{font-size:24px}.name-row span{font-size:15px}.copy p{font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}}
      @media(max-width:520px){.summary-grid{grid-template-columns:1fr}.entity-row{grid-template-columns:62px minmax(120px,1fr) 70px 45px;padding:7px 6px}.entity-row{font-size:10px}.candidate-head{flex-direction:column}.score{align-self:flex-start}.chips{max-height:100px;overflow:auto}}
    `; }
  }

  customElements.define(TAG, EnergyIQMeterDetector);
})();