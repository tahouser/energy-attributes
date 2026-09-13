const TAG = "energyiq-panel-v365";

class EnergyIQInstrumentPanel extends HTMLElement {
  set hass(value) {
    this._hass = value;
    if (!this._started) this.start();
  }

  async start() {
    this._started = true;
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `
      <style>
        :host { display:block; min-height:100%; box-sizing:border-box; }
        .shell { min-height:100vh; box-sizing:border-box; display:flex; align-items:center; justify-content:center; padding:24px; background:#f7f7f7; }
        .instrument { width:min(810px,100%); min-height:410px; border-radius:20px; padding:30px 34px 28px; box-sizing:border-box; background:#fff; box-shadow:0 12px 32px rgba(0,0,0,.10); text-align:center; display:flex; flex-direction:column; align-items:center; }
        .version { font-size:11px; color:#78909c; letter-spacing:.08em; margin-bottom:5px; }
        .label { font-size:15px; letter-spacing:.25em; color:#455a64; }
        .value { margin-top:78px; font-size:64px; line-height:1; font-weight:400; letter-spacing:.015em; color:#30343a; font-variant-numeric:tabular-nums; }
        .unit { margin-top:64px; font-size:24px; color:#455a64; }
        .status { margin-top:24px; font-size:14px; color:#455a64; font-variant-numeric:tabular-nums; }
        .error { margin-top:8px; max-width:690px; font-size:11px; color:#a94442; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .rule { width:100%; border-top:1px solid #ddd; margin:17px 0 27px; }
        .stats { width:100%; display:grid; grid-template-columns:repeat(4,1fr); gap:18px; }
        .stat b { display:block; min-height:22px; font-size:18px; font-weight:400; color:#263238; font-variant-numeric:tabular-nums; }
        .stat span { display:block; margin-top:7px; font-size:10px; letter-spacing:.10em; color:#607d8b; }
        @media(max-width:650px){ .instrument{padding:25px 18px}.value{margin-top:55px;font-size:48px}.unit{margin-top:45px}.stats{gap:5px}.status{font-size:12px} }
      </style>
      <div class="shell"><main class="instrument">
        <div class="version">ENERGYIQ • v3.1.65</div>
        <div class="label">TOTAL ELECTRICAL LOAD</div>
        <div class="value">—</div><div class="unit">watts</div>
        <div class="status">Shelly 192.168.1.251 · DIRECT · WAITING</div>
        <div class="error"></div>
        <div class="rule"></div>
        <div class="stats">
          <div class="stat"><b class="rate">—</b><span>SOURCE RATE</span></div>
          <div class="stat"><b class="min">—</b><span>MINIMUM</span></div>
          <div class="stat"><b class="max">—</b><span>MAXIMUM</span></div>
          <div class="stat"><b class="avg">—</b><span>AVERAGE</span></div>
        </div>
      </main></div>`;
    try {
      const snapshot = await this._hass.callWS({ type: "energyiq/snapshot" });
      this.render(snapshot);
      await this._hass.connection.subscribeMessage(
        data => this.render(data),
        { type: "energyiq/subscribe" }
      );
    } catch (err) {
      this.setStatus("Shelly connection error");
      const node = this.shadowRoot.querySelector(".error");
      if (node) node.textContent = err.message || String(err);
    }
  }

  render(data) {
    if (!data) return;
    const q = s => this.shadowRoot.querySelector(s);
    q(".value").textContent = data.power_w == null ? "—" : Number(data.power_w).toLocaleString(undefined, {minimumFractionDigits:1, maximumFractionDigits:1});
    q(".rate").textContent = data.sample_rate_hz == null ? "—" : `${data.sample_rate_hz.toFixed(1)} Hz`;
    q(".min").textContent = data.min_w == null ? "—" : `${Number(data.min_w).toLocaleString(undefined, {maximumFractionDigits:1})} W`;
    q(".max").textContent = data.max_w == null ? "—" : `${Number(data.max_w).toLocaleString(undefined, {maximumFractionDigits:1})} W`;
    q(".avg").textContent = data.avg_w == null ? "—" : `${Number(data.avg_w).toLocaleString(undefined, {maximumFractionDigits:1})} W`;
    const source = data.source || "Shelly measurement source";
    const status = data.status || "WAITING";
    q(".status").textContent = `${source} · DIRECT · ${status}`;
    q(".error").textContent = status === "ERROR" ? (data.error || "Acquisition failed") : "";
  }

  setStatus(text) {
    const node = this.shadowRoot?.querySelector(".status");
    if (node) node.textContent = text;
  }
}

customElements.define(TAG, EnergyIQInstrumentPanel);
