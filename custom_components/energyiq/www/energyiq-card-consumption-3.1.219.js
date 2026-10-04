/* EnergyIQ consumption graph overlay — 3.1.219 */
(async () => {
  await import("/energyiq-static/energyiq-card-3.1.194.js?v=31700");
  const Card = customElements.get("energyiq-card");
  if (!Card) throw new Error("EnergyIQ card failed to load");

  const DEFAULT_LIMITS = {
    peak_expected_kwh: 1.5,
    peak_high_kwh: 3.0,
    off_peak_expected_kwh: 1.5,
    off_peak_high_kwh: 3.0,
  };

  const esc = (value) => String(value).replace(/[&<>"']/g, (c) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));

  const num = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };

  const rowTime = (row, key) => {
    const raw = row?.[key];
    const t = typeof raw === "number" ? (raw < 1e12 ? raw * 1000 : raw) : Date.parse(raw || "");
    return Number.isFinite(t) ? t : null;
  };

  const periodStart = (card, period, from = new Date()) => {
    const d = new Date(from);
    d.setHours(0, 0, 0, 0);
    if (period === "week") d.setDate(d.getDate() - d.getDay());
    if (period === "month") d.setDate(1);
    return d;
  };

  const periodEnd = (card, period, start) => {
    const d = new Date(start);
    if (period === "week") d.setDate(d.getDate() + 7);
    else if (period === "month") d.setMonth(d.getMonth() + 1);
    else d.setDate(d.getDate() + 1);
    return d;
  };

  const buildBins = (period, start, end, now, rows, expected, high) => {
    const step = 2 * 60 * 60 * 1000;
    const bins = [];
    for (let t = start.getTime(); t < end.getTime(); t += step) {
      const a = new Date(t);
      const b = new Date(Math.min(t + step, end.getTime()));
      const visibleEnd = new Date(Math.min(b.getTime(), now.getTime()));
      const visibleMs = Math.max(0, visibleEnd.getTime() - a.getTime());
      let value = 0;
      if (visibleMs > 0) {
        for (const row of rows || []) {
          const rs = rowTime(row, "start");
          const re = rowTime(row, "end");
          const change = num(row?.change);
          if (rs == null || re == null || change == null) continue;
          if (re <= a.getTime() || rs >= visibleEnd.getTime()) continue;
          if (rs >= a.getTime() && re <= visibleEnd.getTime()) value += Math.max(0, change);
        }
      }
      const visible = visibleMs > 0;
      let color = "neutral";
      if (visible) color = value <= expected ? "green" : value <= high ? "yellow" : "red";
      bins.push({
        start: a, end: b, value: visible ? value : null, visible,
        visibleFraction: Math.min(1, visibleMs / Math.max(1, b.getTime() - a.getTime())),
        color
      });
    }
    return bins;
  };

  const labelFor = (period, date, index, count) => {
    if (period === "day") {
      const h = date.getHours();
      if (h === 0) return "12 AM";
      if (h === 6) return "6 AM";
      if (h === 12) return "NOON";
      if (h === 18) return "6 PM";
      return "";
    }
    if (period === "week") {
      return date.getHours() === 0 ? date.toLocaleDateString([], {weekday:"short"}) : "";
    }
    if (date.getHours() === 0 && date.getDate() === 1) return "1";
    if (date.getHours() === 0 && date.getDate() % 5 === 0) return String(date.getDate());
    return "";
  };

  const chart = (label, item, limitExpected, limitHigh, period, now) => {
    const bins = item?.bins || [];
    const observed = bins.map(b => b.visible ? (b.value || 0) : 0);
    const maxObserved = Math.max(0, ...observed);
    const yMax = Math.max(limitHigh, maxObserved, 0.5) * 1.15;
    const W = 760, H = 225, L = 42, R = 10, T = 18, B = 32;
    const PW = W - L - R, PH = H - T - B;
    const x = (i) => L + (i / Math.max(1, bins.length)) * PW;
    const y = (v) => T + PH - Math.min(1, Math.max(0, v / yMax)) * PH;
    let area = "", line = "", labels = "", previous = null;
    bins.forEach((bin, i) => {
      if (!bin.visible) return;
      const x0 = x(i), x1 = x(i + bin.visibleFraction);
      const yy = y(bin.value || 0), base = y(0);
      const cls = bin.color;
      area += '<polygon points="' + x0.toFixed(1) + ',' + base.toFixed(1) + ' ' +
        x0.toFixed(1) + ',' + yy.toFixed(1) + ' ' + x1.toFixed(1) + ',' + yy.toFixed(1) +
        ' ' + x1.toFixed(1) + ',' + base.toFixed(1) + '" class="area ' + cls + '"/>';
      if (previous) {
        line += '<path d="M ' + previous.x.toFixed(1) + ' ' + previous.y.toFixed(1) +
          ' H ' + x0.toFixed(1) + ' V ' + yy.toFixed(1) + '" class="usage-line"/>';
      } else {
        line += '<path d="M ' + x0.toFixed(1) + ' ' + yy.toFixed(1) + ' H ' + x1.toFixed(1) + '" class="usage-line"/>';
      }
      previous = {x:x1,y:yy};
      const text = labelFor(period, bin.start, i, bins.length);
      if (text) labels += '<text x="' + x0.toFixed(1) + '" y="' + (H - 9) + '" text-anchor="middle" class="axis-label">' + esc(text) + '</text>';
    });

    const total = observed.reduce((a,b) => a+b, 0);
    const highY = y(limitHigh);
    const expectedY = y(limitExpected);
    const thresholdLines =
      '<line x1="' + L + '" y1="' + expectedY.toFixed(1) + '" x2="' + (W-R) + '" y2="' + expectedY.toFixed(1) + '" class="expected-line"/>' +
      '<line x1="' + L + '" y1="' + highY.toFixed(1) + '" x2="' + (W-R) + '" y2="' + highY.toFixed(1) + '" class="high-line"/>';
    return '<div class="consumption-chart">' +
      '<div class="consumption-chart-head"><span>' + esc(label) + '</span><strong>' + total.toFixed(1) + ' kWh</strong></div>' +
      '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-label="' + esc(label) + ' consumption graph">' +
      '<line x1="' + L + '" y1="' + (T+PH) + '" x2="' + (W-R) + '" y2="' + (T+PH) + '" class="axis-line"/>' +
      thresholdLines + area + line + labels +
      '</svg></div>';
  };

  Card.prototype._loadConsumptionHistory = async function () {
    if (!this._hass || !this._data) return;
    try {
      const period = this._costPeriod;
      const now = new Date();
      const start = periodStart(this, period, now);
      const end = periodEnd(this, period, start);
      const ids = ["sensor.dte_house_energy_peak", "sensor.dte_house_energy_off_peak"];
      const stats = await this._ws({
        type: "recorder/statistics_during_period",
        start_time: start.toISOString(),
        end_time: now.toISOString(),
        statistic_ids: ids,
        period: "hour",
        types: ["change"]
      }).catch(() => ({}));
      const limits = Object.assign({}, DEFAULT_LIMITS, this._data?.consumption_limits || {});
      const build = (id, expectedKey, highKey) => {
        const expected = Math.max(0, num(limits[expectedKey]) ?? DEFAULT_LIMITS[expectedKey]);
        const high = Math.max(expected, num(limits[highKey]) ?? DEFAULT_LIMITS[highKey]);
        const bins = buildBins(period, start, end, now, stats?.[id] || [], expected, high);
        return {bins, expected, high, current: bins.filter(b => b.visible).reduce((a,b) => a + (b.value || 0), 0)};
      };
      const peak = build(ids[0], "peak_expected_kwh", "peak_high_kwh");
      const off = build(ids[1], "off_peak_expected_kwh", "off_peak_high_kwh");
      this._dashboardHistory = {peak, off, total: peak.current + off.current};
      this._dashboardHistoryAt = Date.now();
    } catch (e) {
      console.error("EnergyIQ consumption graph", e);
      this._dashboardHistory = null;
      this._dashboardHistoryAt = Date.now();
    }
    this._render();
  };

  Card.prototype._consumption = function () {
    const h = this._dashboardHistory;
    const labels = {day:"DAY", week:"WEEK", month:"MONTH"};
    const period = this._costPeriod;
    const periodLabel = labels[period] || "DAY";
    if (!h) return '<div class="cost-loading">Loading consumption history…</div>';
    const limits = Object.assign({}, DEFAULT_LIMITS, this._data?.consumption_limits || {});
    const body =
      chart("Peak", h.peak, Number(limits.peak_expected_kwh), Number(limits.peak_high_kwh), period, new Date()) +
      chart("Off-Peak", h.off, Number(limits.off_peak_expected_kwh), Number(limits.off_peak_high_kwh), period, new Date());
    return '<div class="consumption-swipe" role="group" aria-label="Consumption ' + esc(periodLabel) +
      '. Swipe left or right to change period.">' +
      '<div class="consumption-threshold-note">Color limits are per 2-hour segment</div>' +
      body +
      '<div class="cost-period-nav"><button type="button" data-cost-period="prev" aria-label="Previous consumption period">‹</button>' +
      '<strong>' + periodLabel + '</strong>' +
      '<button type="button" data-cost-period="next" aria-label="Next consumption period">›</button></div></div>';
  };

  const oldCss = Card.prototype._css;
  Card.prototype._css = function () {
    let css = oldCss.call(this);
    css += '.consumption-swipe{width:100%;min-width:0}.consumption-threshold-note{font-size:.68rem;color:var(--secondary-text-color);text-align:right;margin:0 2px 3px}.consumption-chart{width:100%;min-width:0;margin:0 0 7px}.consumption-chart-head{display:flex;justify-content:space-between;align-items:baseline;margin:0 2px 2px}.consumption-chart-head span{font-size:clamp(.9rem,2.7cqw,1.08rem);font-weight:800}.consumption-chart-head strong{font-size:clamp(.9rem,2.8cqw,1.12rem);font-variant-numeric:tabular-nums}.consumption-chart svg{width:100%;height:clamp(92px,19cqw,145px);min-height:92px;display:block;overflow:hidden}.axis-line{stroke:var(--divider-color);stroke-width:1}.expected-line{stroke:#43d85b;stroke-width:1;stroke-dasharray:4 4;opacity:.75}.high-line{stroke:#e8453c;stroke-width:1;stroke-dasharray:4 4;opacity:.75}.area{opacity:.48}.area.green{fill:#43d85b}.area.yellow{fill:#f2c21f}.area.red{fill:#e8453c}.area.neutral{fill:transparent}.usage-line{fill:none;stroke:var(--primary-text-color);stroke-width:2.2;vector-effect:non-scaling-stroke}.axis-label{fill:var(--secondary-text-color);font-size:10px}.consumption-chart:last-of-type{margin-bottom:2px}@container energyiq-card (max-width:420px){.consumption-threshold-note{font-size:.61rem}.consumption-chart{margin-bottom:4px}.consumption-chart svg{height:100px;min-height:90px}.axis-label{font-size:9px}}';
    return css;
  };
})();