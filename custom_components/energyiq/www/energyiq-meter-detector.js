(() => {
  const TAG = "energyiq-meter-detector";
  const VERSION = "41000";
  if (customElements.get(TAG)) return;

  class EnergyIQMeterDetector extends HTMLElement {
    constructor() {
      super();
      this.hass = null;
      this.data = null;
      this.loading = false;
      this.error = null;
      this.probe = null;
      this.probing = false;
      this.timer = null;
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
        this.data = await this.ws({type:"energy_attribution/meter_detector"});
        this.render();
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
      try {
        this.data = await this.ws({type:"energy_attribution/meter_detector"});
        this.render();
      } catch (e) {
        this.error = this.formatError(e);
        this.render();
      }
    }


    async probe(deviceId) {
      if (this.probing) return;
      this.probing = true;
      this.probe = null;
      this.error = null;
      this.render();
      try {
        this.probe = await this.ws({type:"energy_attribution/meter_detector_probe", device_id:deviceId});
        this.render();
      } catch (e) {
        this.error = this.formatError(e);
        this.render();
      } finally {
        this.probing = false;
      }
    }

    renderProbe(p) {
      if (!p) return "";
      return `
        <div class="probe">
          <div class="probe-head">
            <div><span class="eyebrow">Live interrogation</span><strong>30-second channel test</strong><small>${this.escape(p.conclusion)}</small></div>
            <span class="probe-count">${p.active_channel_count} active / ${p.channel_count_observed} observed</span>
          </div>
          <div class="channel-grid">
            ${(p.channels||[]).map(ch => `
              <div class="channel-card ${ch.active ? "active" : ""}">
                <div class="channel-top"><strong>${this.escape(ch.channel)}</strong><span>${ch.active ? "SIGNAL" : "QUIET"}</span></div>
                <div class="channel-assessment">${this.escape(ch.assessment)}</div>
                ${(ch.entities||[]).map(e=>`<div class="probe-row"><span>${this.escape(e.kind)}</span><strong>${e.max == null ? "—" : this.escape(Number(e.max).toFixed(2))} ${this.escape(e.unit||"")}</strong><small>range ${e.range == null ? "—" : this.escape(Number(e.range).toFixed(2))}</small></div>`).join("")}
              </div>`).join("")}
          </div>
          <div class="probe-note">${(p.limitations||[]).map(x=>`<div>• ${this.escape(x)}</div>`).join("")}</div>
        </div>`;
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

    render() {
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
                <p>This is a read-only test. Nothing is saved and no EnergyIQ configuration is changed.</p>
              </div>
              <button id="refresh" class="primary" ${this.loading ? "disabled" : ""}>${this.loading ? "Scanning…" : "Scan again"}</button>
            </section>
            ${this.error ? `<section class="error"><strong>Detector error</strong><p>${this.escape(this.error)}</p></section>` : ""}${d?.error ? `<section class="error"><strong>Detector backend error</strong><p>${this.escape(d.error)}</p></section>` : ""}
            ${!d && !this.error ? `<section class="empty"><span class="spinner"></span><strong>Scanning Home Assistant…</strong></section>` : ""}
            ${d ? this.renderResults(d) : ""}
          </main>
        </div>`;
      this.bind();
    }

    renderResults(d) {
      const candidates = Array.isArray(d.candidates) ? d.candidates : [];
      return `
        <section class="summary-grid">
          <div class="metric"><span>Likely meters</span><strong>${d.candidate_count}</strong><small>Ranked from HA metadata</small></div>
          <div class="metric"><span>Detection depth</span><strong>Device + entity</strong><small>Registry, metadata & live state</small></div>
          <div class="metric"><span>Saved</span><strong>Nothing</strong><small>Diagnostic only</small></div>
        </section>
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
      const inf = c.inference || {};
      const power = c.entities.filter(e => e.kind === "power").length;
      const energy = c.entities.filter(e => e.kind === "energy").length;
      const voltage = c.entities.filter(e => e.kind === "voltage").length;
      const current = c.entities.filter(e => e.kind === "current").length;
      const label = tier === "a" ? "Class A · multi-channel meter" : tier === "b" ? "Class B · load meter" : tier === "c" ? "Class C · limited measurement" : "Class D · unsupported";
      return `
        <details class="meter-item tier-${tier}" ${top ? "open" : ""}>
          <summary class="meter-summary">
            <div class="meter-name">
              <span class="tier-badge">${this.escape(tier.toUpperCase())}</span>
              <div><strong>${this.escape(c.name)}</strong><small>${this.escape(c.manufacturer || "Unknown")} ${c.model ? "· " + this.escape(c.model) : ""}</small></div>
            </div>
            <div class="meter-counts">
              <span>${power} W</span><span>${energy} kWh</span><span>${voltage} V</span><span>${current} A</span>
            </div>
          </summary>
          <div class="meter-detail">
            <div class="meter-detail-head"><div><span class="eyebrow">${this.escape(label)}</span><strong>${this.escape(inf.inference || "Electrical measurement source")}</strong></div><span class="score-mini">${c.score} match</span></div>
            <div class="meter-actions"><button class="secondary probe-button" data-probe="${this.escape(c.device_id)}" ${this.probing ? "disabled" : ""}>${this.probing ? "Interrogating…" : "Interrogate channels (30 sec)"}</button></div>
            ${this.probe && this.probe.device_id===c.device_id ? this.renderProbe(this.probe) : ""}
            <div class="evidence compact-evidence">${(c.evidence||[]).slice(0,4).map(x=>`<span>${this.escape(x)}</span>`).join("")}</div>
            <details class="subdetails"><summary>Show Home Assistant entities (${c.entities.length})</summary>
              <div class="entity-table">
                <div class="entity-row entity-head"><span>Type</span><span>Name</span><span>Value</span><span>Unit</span></div>
                ${c.entities.map(e=>this.renderEntityRow(e)).join("")}
              </div>
            </details>
          </div>
        </details>
      `;
    }

    renderEntityRow(e) {
      const value = e.value == null ? e.state : (Number.isFinite(Number(e.value)) ? Number(e.value).toFixed(2) : e.state);
      return `<div class="entity-row"><span class="type ${e.kind}">${this.escape(e.kind)}</span><span><strong>${this.escape(e.name)}</strong><small>${this.escape(e.entity_id)}</small></span><span>${this.escape(value)}</span><span>${this.escape(e.unit || "—")}</span></div>`;
    }

    renderEntity(e) {
      return `<div class="simple-row"><span><strong>${this.escape(e.name)}</strong><small>${this.escape(e.entity_id)}</small></span><strong>${this.escape(e.state)} ${this.escape(e.unit||"")}</strong></div>`;
    }

    bind() {
      this.querySelector("#back")?.addEventListener("click", () => {
        if (window.history.length > 1) window.history.back(); else window.location.href="/";
      });
      this.querySelector("#refresh")?.addEventListener("click", () => this.load());
      this.querySelectorAll("[data-probe]").forEach(btn => btn.addEventListener("click", () => this.probe(btn.dataset.probe)));
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
      details{border-top:1px solid var(--divider-color);padding-top:10px;margin-top:10px}summary{cursor:pointer;font-weight:700;font-size:12px;color:var(--primary-text-color)}.entity-table{margin-top:9px;border:1px solid var(--divider-color);border-radius:9px;overflow:hidden}.entity-row{display:grid;grid-template-columns:90px minmax(220px,1fr) 120px 80px;gap:8px;align-items:center;padding:8px 10px;border-top:1px solid var(--divider-color);font-size:11px}.entity-row:first-child{border-top:0}.entity-head{background:rgba(255,255,255,.03);font-size:9px;text-transform:uppercase;color:var(--secondary-text-color);letter-spacing:.06em}.entity-row small,.simple-row small{display:block;color:var(--secondary-text-color);font-size:9px;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.type{font-size:9px;text-transform:uppercase;font-weight:800}.type.power{color:#36c8ff}.type.energy{color:#35e7b0}.type.voltage{color:#ffd166}.type.current{color:#ff9f68}.registry{display:grid;gap:5px;margin-top:8px}.registry code{font-size:10px;overflow-wrap:anywhere}.notes{margin:8px 0 0;padding-left:19px;color:var(--secondary-text-color);line-height:1.5;font-size:12px}.simple-row{display:flex;justify-content:space-between;gap:12px;padding:9px 0;border-top:1px solid var(--divider-color);font-size:11px}
      .meter-item{border:1px solid var(--divider-color);border-radius:12px;margin:8px 0;overflow:hidden;background:rgba(255,255,255,.025)}
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