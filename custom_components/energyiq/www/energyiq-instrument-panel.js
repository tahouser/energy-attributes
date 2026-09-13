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
        .shell { min-height:100vh; box-sizing:border-box; display:flex; align-items:center; justify-content:center; padding:24px; }
        .instrument { width:min(900px,100%); border-radius:24px; padding:36px; box-sizing:border-box; background:var(--card-background-color,#fff); box-shadow:0 10px 40px rgba(0,0,0,.12); text-align:center; }
        .version { font-size:12px; opacity:.5; letter-spacing:.08em; }
        .label { font-size:18px; letter-spacing:.16em; text-transform:uppercase; opacity:.65; margin-top:6px; }
        .value { font-size:clamp(64px,12vw,150px); line-height:1; font-weight:600; font-variant-numeric:tabular-nums; margin:22px 0 8px; }
        .unit { font-size:28px; opacity:.7; }
        .status { margin:26px 0 20px; font-size:15px; opacity:.72; font-variant-numeric:tabular-nums; }
        .stats { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; border-top:1px solid var(--divider-color,#ddd); padding-top:22px; }
        .stat { font-variant-numeric:tabular-nums; }
        .stat b { display:block; font-size:20px; }
        .stat span { font-size:12px; text-transform:uppercase; opacity:.6; letter-spacing:.08em; }
        @media(max-width:600px){ .instrument{padding:24px 16px}.stats{grid-template-columns:1fr 1fr}.value{font-size:72px} }
      </style>
      <div class="shell"><main class="instrument">
        <div class="version">ENERGYIQ • v3.1.60</div>
        <div class="label">Total Electrical Load</div>
        <div class="value">—</div><div class="unit">watts</div>
        <div class="status">Connecting to live measurement…</div>
        <div class="stats">
          <div class="stat"><b class="rate">—</b><span>source rate</span></div>
          <div class="stat"><b class="min">—</b><span>minimum</span></div>
          <div class="stat"><b class="max">—</b><span>maximum</span></div>
          <div class="stat"><b class="avg">—</b><span>average</span></div>
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
      this.setStatus(`Live connection error: ${err.message}`);
    }
  }

  render(data) {
    if (!data) return;
    const q = s => this.shadowRoot.querySelector(s);
    q(".value").textContent = data.power_w == null ? "—" : Math.round(data.power_w).toLocaleString();
    q(".rate").textContent = data.sample_rate_hz == null ? "—" : `${data.sample_rate_hz.toFixed(1)} Hz`;
    q(".min").textContent = data.min_w == null ? "—" : `${Math.round(data.min_w).toLocaleString()} W`;
    q(".max").textContent = data.max_w == null ? "—" : `${Math.round(data.max_w).toLocaleString()} W`;
    q(".avg").textContent = data.avg_w == null ? "—" : `${Math.round(data.avg_w).toLocaleString()} W`;
    const source = data.source_entity || "power source";
    const rate = data.sample_rate_hz == null ? "measuring" : `${data.sample_rate_hz.toFixed(1)} Hz`;
    q(".status").textContent = `${source} · LIVE · ${rate}`;
  }

  setStatus(text) {
    const node = this.shadowRoot?.querySelector(".status");
    if (node) node.textContent = text;
  }
}

customElements.define("energyiq-panel-v360", EnergyIQInstrumentPanel);
