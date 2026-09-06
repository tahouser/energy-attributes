const TAG = "energy-attribution-card-v13";
if (!customElements.get(TAG)) {
  class EnergyAttributionCard extends HTMLElement {
    constructor() { super(); this._timer = null; this._loading = false; this._data = null; }
    setConfig(config) { this._config = config || {}; }
    set hass(hass) { this._hass = hass; if (!this._loading && !this._data) this._load(); }
    connectedCallback() { this._renderLoading(); if (this._hass && !this._data) this._load(); }
    disconnectedCallback() { if (this._timer) clearInterval(this._timer); }
    static getStubConfig() { return {}; }
    _renderLoading() { this.innerHTML = `<ha-card><div class="wrap"><h2>Energy Attribution</h2><div class="muted">Loading…</div></div></ha-card>`; }
    async _ws(message) {
      if (!this._hass?.connection?.sendMessagePromise) throw new Error("Home Assistant connection is not ready");
      return this._hass.connection.sendMessagePromise(message);
    }
    async _load() {
      if (this._loading) return;
      this._loading = true;
      try {
        let entryId = this._config?.entry_id;
        if (!entryId) {
          const r = await this._ws({type:"energy_attribution/list_entries"});
          entryId = r.entries?.[0]?.entry_id;
        }
        if (!entryId) throw new Error("Energy Attribution is not configured.");
        this._entryId = entryId;
        await this._refresh();
        this._timer = setInterval(() => this._refresh(), 2000);
      } catch (e) {
        this.innerHTML = `<ha-card><div class="wrap"><h2>Energy Attribution</h2><div class="error">${this._esc(e.message || e)}</div></div></ha-card>`;
      } finally { this._loading = false; }
    }
    async _refresh() {
      if (!this._entryId || !this._hass) return;
      try { this._data = await this._ws({type:"energy_attribution/workspace",entry_id:this._entryId}); this._render(); } catch (e) { console.error(e); }
    }
    _render() {
      const d = this._data || {};
      const devices = d.devices || [];
      const monitored = devices.filter(x => x.classification === "monitor");
      const learned = monitored.filter(x => x.training?.status === "complete" && (x.training?.learned || x.training?.completed));
      const active = devices.find(x => x.training?.status === "active");
      const power = d.whole_home_power == null || d.whole_home_power === "unknown" ? "—" : `${Number(d.whole_home_power).toFixed(0)} W`;
      const recent = [...learned].sort((a,b) => (Number(b.training?.completed_at)||0) - (Number(a.training?.completed_at)||0)).slice(0,5);
      this.innerHTML = `<style>
        :host{display:block}.wrap{padding:16px}.muted{color:var(--secondary-text-color)}.error{color:var(--error-color)}
        .hero{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap}.power{font-size:2.1rem;font-weight:700}.label{font-size:.85rem;color:var(--secondary-text-color)}
        .grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:14px}.tile{border:1px solid var(--divider-color);border-radius:12px;padding:12px}.tile strong{font-size:1.4rem}.bar{height:7px;background:var(--divider-color);border-radius:8px;overflow:hidden;margin-top:8px}.fill{height:100%;background:var(--primary-color)}
        .section{margin-top:18px}.row{display:flex;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px solid var(--divider-color)}.complete{color:var(--success-color,var(--primary-color));font-weight:600}.active{color:var(--primary-color);font-weight:600}
        @media(max-width:600px){.wrap{padding:12px}.grid{grid-template-columns:1fr 1fr}.grid .tile:last-child{grid-column:1/-1}.power{font-size:1.8rem}}
      </style><ha-card><div class="wrap">
        <div class="hero"><div><div class="label">Whole-home power</div><div class="power">${this._esc(power)}</div></div><div class="label">Energy Attribution</div></div>
        <div class="grid">
          <div class="tile"><div class="label">Monitored</div><strong>${monitored.length}</strong></div>
          <div class="tile"><div class="label">Learned</div><strong>${learned.length}</strong></div>
          <div class="tile"><div class="label">Remaining</div><strong>${Math.max(0,monitored.length-learned.length)}</strong><div class="bar"><div class="fill" style="width:${monitored.length ? Math.min(100,learned.length/monitored.length*100) : 0}%"></div></div></div>
        </div>
        <div class="section"><div class="label">Training status</div>${active ? `<div class="row"><span>${this._esc(active.name)}</span><span class="active">Training…</span></div>` : recent.length ? recent.map(x=>`<div class="row"><span>${this._esc(x.name)}</span><span class="complete">☑ Learned</span></div>`).join("") : `<div class="row muted"><span>No learned loads yet</span><span>—</span></div>`}</div>
      </div></ha-card>`;
    }
    _esc(v){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  }
  customElements.define(TAG, EnergyAttributionCard);
  window.customCards = window.customCards || [];
  window.customCards.push({type:TAG,name:"Energy Attribution",description:"Current whole-home power and Energy Attribution commissioning status.",preview:false});
}
