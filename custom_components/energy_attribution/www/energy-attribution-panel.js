class EnergyAttributionPanel extends HTMLElement {
  set hass(value) {
    this._hass = value;
    this._render();
    if (!this._loaded) {
      this._loaded = true;
      this._load();
    }
  }
  set narrow(value) { this._narrow = value; this._render(); }
  connectedCallback() {
    this._selected = null;
    this._entry = null;
    this._workspace = null;
    this._timer = null;
    this._error = null;
    // Home Assistant may set the hass property before or after connectedCallback.
    // Do not reset _loaded in a way that can strand the panel on the loading screen.
    if (this._loaded !== true) this._loaded = false;
    this._render();
    if (this._hass && !this._loaded) {
      this._loaded = true;
      this._load();
    }
  }
  disconnectedCallback() { if (this._timer) clearInterval(this._timer); }
  async _cmd(msg) { return this._hass.connection.sendMessagePromise(msg); }
  async _load() {
    if (!this._hass) return;
    try {
      const data = await Promise.race([
        this._cmd({type:"energy_attribution/list_entries"}),
        new Promise((_, reject) => setTimeout(() => reject(new Error("The Energy Attribution WebSocket command did not respond.")), 8000))
      ]);
      this._entry = data.entries?.[0]?.entry_id || null;
      if (!this._entry) {
        this._error = "Energy Attribution is installed, but no loaded configuration entry was found.";
        this._render();
        return;
      }
      await this._refresh();
      if (this._timer) clearInterval(this._timer);
      this._timer = setInterval(() => this._refresh(), 1000);
    } catch (e) {
      this._error = e?.message || String(e);
      this._render();
    }
  }
  async _refresh() {
    if (!this._entry) return;
    try { this._workspace = await this._cmd({type:"energy_attribution/workspace", entry_id:this._entry}); this._render(); }
    catch(e) { this._error = e.message || String(e); this._render(); }
  }
  async _start(device, method) {
    this._selected = {device_id:device.device_id, method};
    await this._cmd({type:"energy_attribution/start_training", entry_id:this._entry, device_id:device.device_id, method});
    await this._refresh();
  }
  async _retry(device) {
    await this._cmd({type:"energy_attribution/retry_training", entry_id:this._entry, device_id:device.device_id});
    await this._refresh();
  }
  async _stop(device) {
    await this._cmd({type:"energy_attribution/stop_training", entry_id:this._entry, device_id:device.device_id});
    await this._refresh();
  }
  _render() {
    if (!this._hass) return;
    const w=this._workspace;
    this.innerHTML=`<style>
      :host{display:block;padding:24px;box-sizing:border-box;color:var(--primary-text-color);font-family:var(--paper-font-body1_-_font-family,Roboto,sans-serif)}
      .wrap{max-width:1100px;margin:auto}.muted{color:var(--secondary-text-color)}
      .row{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px}
      .card{background:var(--card-background-color);border-radius:14px;padding:18px;box-shadow:var(--ha-card-box-shadow,0 1px 3px #0002)}
      button{min-height:44px;border:0;border-radius:10px;padding:9px 15px;background:var(--primary-color);color:white;font-size:15px;cursor:pointer}
      button.secondary{background:var(--secondary-background-color);color:var(--primary-text-color)}
      .value{font-size:30px;font-weight:600}.phase{font-weight:600;text-transform:capitalize}.ok{color:var(--success-color,#2e7d32)}
      .dialog{border:2px solid var(--primary-color)}.bar{height:8px;background:var(--divider-color);border-radius:8px;overflow:hidden}.bar>i{display:block;height:100%;background:var(--primary-color);width:50%}
    </style><div class="wrap">${this._content(w)}</div>`;
    this.querySelectorAll('[data-start]').forEach(b=>b.addEventListener('click',()=>this._start(JSON.parse(b.dataset.start),b.dataset.method)));
    this.querySelectorAll('[data-retry]').forEach(b=>b.addEventListener('click',()=>this._retry(JSON.parse(b.dataset.retry))));
    this.querySelectorAll('[data-stop]').forEach(b=>b.addEventListener('click',()=>this._stop(JSON.parse(b.dataset.stop))));
    this.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>{this._selected=null;this._render()}));
    this.querySelectorAll('[data-reload]').forEach(b=>b.addEventListener('click',()=>{this._error=null;this._loaded=false;this._load();}));
  }
  _content(w) {
    if(this._error) return `<h1>Energy Attribution</h1><div class="card dialog"><h2>Unable to load the training workspace</h2><p>${this._error}</p><p class="muted">The panel is running, but its backend connection did not respond.</p><button data-reload>Retry</button></div>`;
    if(!w) return '<h1>Energy Attribution</h1><p class="muted">Loading the training workspace…</p>';
    const active=w.devices?.find(d=>d.training?.status==='active');
    const complete=w.devices?.find(d=>d.training?.status==='complete');
    if(active) return this._training(active,w);
    if(complete && this._selected?.device_id===complete.device_id) return this._complete(complete);
    return `<h1>Energy Attribution</h1><p class="muted">Whole-home power: ${w.whole_home_power ?? '—'} W</p><div class="grid">${w.devices.map(d=>this._device(d)).join('')}</div>`;
  }
  _device(d) {
    const disabled=d.classification!=='monitor'; const t=d.training||{};
    return `<div class="card"><div class="row"><div><strong>${d.name}</strong><div class="muted">${d.area||'No area'} · ${d.evidence||'Load-style device'}</div></div></div>
      <p>${t.status==='complete'?'<span class="ok">✓ Trained</span>':t.status==='interrupted'?'Interrupted':'Not trained'}</p>
      <div class="row"><button ${disabled?'disabled':''} data-start='${JSON.stringify(d).replaceAll("'","&apos;")}' data-method="quick">Quick ON/OFF</button><button class="secondary" ${disabled?'disabled':''} data-start='${JSON.stringify(d).replaceAll("'","&apos;")}' data-method="full_cycle">Full Cycle</button></div></div>`;
  }
  _training(d,w) {
    const t=d.training||{}; const r=t.result||{}; const peak=r.peak_delta_w ?? t.peak_delta_w; const base=r.baseline_w ?? t.baseline_w;
    let instruction=t.instruction||'Monitoring whole-home power…';
    if(t.method==='quick' && t.phase==='baseline') instruction='Establishing the normal household power baseline…';
    if(t.method==='quick' && t.phase==='waiting_for_on') instruction='Baseline established. Preparing to turn the device ON automatically…';
    if(t.method==='quick' && t.phase==='on_stabilizing') instruction='Device is ON. Measuring and waiting for the power level to stabilize…';
    if(t.method==='quick' && t.phase==='waiting_for_off') instruction='The ON power has been measured. Turning the device OFF automatically…';
    if(t.method==='full_cycle' && t.phase==='waiting_for_start') instruction='Baseline established. Start the appliance normally. I will capture the entire cycle.';
    if(t.method==='full_cycle' && t.phase==='capturing') instruction='Full cycle captured in the background. Keep the appliance running normally until it finishes.';
    return `<div class="card dialog"><h1>Training ${d.name}</h1><p class="phase">${t.phase||'starting'}</p><p>${instruction}</p>
      <div class="row"><div><div class="muted">Whole-home power</div><div class="value">${w.whole_home_power??'—'} W</div></div><div><div class="muted">Baseline</div><div class="value">${base==null?'—':base.toFixed(1)} W</div></div><div><div class="muted">Detected load</div><div class="value">${peak==null?'—':peak.toFixed(1)} W</div></div></div>
      <p class="muted">Events detected: ${r.events_detected??t.events_detected??0} · Energy: ${r.energy_wh==null?'—':r.energy_wh.toFixed(2)+' Wh'}</p>
      <div class="bar"><i></i></div></div>`;
  }
  _complete(d) {
    const t=d.training||{}, r=t.result||{}; const peak=r.peak_delta_w??t.peak_delta_w;
    return `<div class="card dialog"><h1>Training Complete</h1><p><strong>${d.name}</strong> has a captured electrical signature.</p>
      <div class="row"><div><div class="muted">Baseline</div><div class="value">${r.baseline_w==null?'—':r.baseline_w.toFixed(1)} W</div></div><div><div class="muted">Detected load</div><div class="value">${peak==null?'—':peak.toFixed(1)} W</div></div><div><div class="muted">Energy</div><div class="value">${r.energy_wh==null?'—':r.energy_wh.toFixed(2)} Wh</div></div></div>
      <p>Review the measured result before accepting it as this device's learned signature.</p><div class="row"><button data-close>Close</button><button class="secondary" data-retry='${JSON.stringify(d).replaceAll("'","&apos;")}'>Retry training</button></div></div>`;
  }
}
customElements.define('energy-attribution-panel', EnergyAttributionPanel);
