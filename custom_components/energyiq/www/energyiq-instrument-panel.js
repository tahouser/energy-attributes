const TAG = "energyiq-panel-v370";

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
        .instrument { width:min(900px,100%); border-radius:20px; padding:30px 34px 28px; box-sizing:border-box; background:#fff; box-shadow:0 12px 32px rgba(0,0,0,.10); text-align:center; }
        .version { font-size:11px; color:#78909c; letter-spacing:.08em; margin-bottom:5px; }
        .label { font-size:15px; letter-spacing:.25em; color:#455a64; }
        .value { margin-top:70px; font-size:64px; line-height:1; font-weight:400; letter-spacing:.015em; color:#30343a; font-variant-numeric:tabular-nums; }
        .unit { margin-top:58px; font-size:24px; color:#455a64; }
        .status { margin-top:20px; font-size:14px; color:#455a64; font-variant-numeric:tabular-nums; }
        .error { margin-top:7px; min-height:15px; font-size:11px; color:#a94442; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .rule { width:100%; border-top:1px solid #ddd; margin:15px 0 22px; }
        .stats { width:100%; display:grid; grid-template-columns:repeat(4,1fr); gap:18px; }
        .stat b { display:block; min-height:22px; font-size:18px; font-weight:400; color:#263238; font-variant-numeric:tabular-nums; }
        .stat span { display:block; margin-top:7px; font-size:10px; letter-spacing:.10em; color:#607d8b; }
        .sources { margin-top:24px; border-top:1px solid #eee; padding-top:17px; text-align:left; display:grid; grid-template-columns:1fr 1fr; gap:8px 22px; }
        .source { display:grid; grid-template-columns:110px 1fr; gap:8px; align-items:baseline; font-size:11px; font-variant-numeric:tabular-nums; }
        .source .name { color:#607d8b; letter-spacing:.06em; }
        .source .detail { color:#37474f; }
        .ws { margin-top:12px; font-size:10px; color:#90a4ae; text-align:left; word-break:break-all; }
        @media(max-width:650px){ .instrument{padding:25px 18px}.value{margin-top:50px;font-size:48px}.unit{margin-top:40px}.stats{gap:5px}.status{font-size:12px}.sources{grid-template-columns:1fr}.source{grid-template-columns:95px 1fr} }
      </style>
      <div class="shell"><main class="instrument">
        <div class="version">ENERGYIQ • v3.1.70</div>
        <div class="label">TOTAL ELECTRICAL LOAD</div>
        <div class="value">—</div><div class="unit">watts</div>
        <div class="status">Shelly 192.168.1.251 · MULTI-PATH · WAITING</div>
        <div class="error"></div>
        <div class="rule"></div>
        <div class="stats">
          <div class="stat"><b class="rate">—</b><span>CALC RATE</span></div>
          <div class="stat"><b class="min">—</b><span>MINIMUM</span></div>
          <div class="stat"><b class="max">—</b><span>MAXIMUM</span></div>
          <div class="stat"><b class="avg">—</b><span>AVERAGE</span></div>
        </div>
        <section class="sources">
          <div class="source"><span class="name">HTTP AGG</span><span class="detail" data-source="http_aggregate">—</span></div>
          <div class="source"><span class="name">HTTP EM1</span><span class="detail" data-source="http_em1">—</span></div>
          <div class="source"><span class="name">MQTT</span><span class="detail" data-source="mqtt">—</span></div>
          <div class="source"><span class="name">MODBUS</span><span class="detail" data-source="modbus">—</span></div>
          <div class="source"><span class="name">WEBSOCKET</span><span class="detail" data-source="websocket">—</span></div>
          <div class="source"><span class="name">L1 + L2</span><span class="detail phase">—</span></div>
        </section>
        <div class="ws"></div>
      </main></div>`;
    try {
      const snapshot = await this._hass.callWS({ type: "energyiq/snapshot" });
      this.render(snapshot);
      await this._hass.connection.subscribeMessage(
        data => this.render(data),
        { type: "energyiq/subscribe" }
      );
    } catch (err) {
      this.setStatus("EnergyIQ connection error");
      this.shadowRoot.querySelector(".error").textContent = err.message || String(err);
    }
  }

  render(data) {
    if (!data) return;
    const q = s => this.shadowRoot.querySelector(s);
    q(".value").textContent = data.power_w == null ? "—" : Number(data.power_w).toLocaleString(undefined, {minimumFractionDigits:1, maximumFractionDigits:1});
    q(".rate").textContent = data.calculation_rate_hz == null ? "—" : `${data.calculation_rate_hz.toFixed(1)} Hz`;
    q(".min").textContent = data.min_w == null ? "—" : `${Number(data.min_w).toLocaleString(undefined, {maximumFractionDigits:1})} W`;
    q(".max").textContent = data.max_w == null ? "—" : `${Number(data.max_w).toLocaleString(undefined, {maximumFractionDigits:1})} W`;
    q(".avg").textContent = data.avg_w == null ? "—" : `${Number(data.avg_w).toLocaleString(undefined, {maximumFractionDigits:1})} W`;
    q(".phase").textContent = data.phase_power_w ? `L1 ${this.f(data.phase_power_w["0"])} · L2 ${this.f(data.phase_power_w["1"])}` : "—";
    const source = data.source || "Shelly measurement source";
    const status = data.status || "WAITING";
    q(".status").textContent = `${source} · MULTI-PATH · ${status}`;
    q(".error").textContent = data.error || "";
    for (const [name, state] of Object.entries(data.sources || {})) {
      const node = this.shadowRoot.querySelector(`[data-source="${name}"]`);
      if (!node) continue;
      const rate = state.rate_hz != null ? `${state.rate_hz.toFixed(1)} Hz changes` : `${state.updates} updates`;
      const value = state.last_value == null ? "—" : `${this.f(state.last_value)} W`;
      node.textContent = `${value} · ${rate}`;
    }
    q(".ws").textContent = data.websocket_endpoint ? `Outbound WS endpoint: ${data.websocket_endpoint}` : "";
  }

  f(value) {
    return value == null ? "—" : Number(value).toLocaleString(undefined, {maximumFractionDigits:1});
  }

  setStatus(text) {
    const node = this.shadowRoot?.querySelector(".status");
    if (node) node.textContent = text;
  }
}

customElements.define(TAG, EnergyIQInstrumentPanel);
