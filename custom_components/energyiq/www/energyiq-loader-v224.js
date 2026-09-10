/* EnergyIQ v2.2.4 clean loader. Uses a brand-new custom element name so no legacy
 * v209 prototype patches can survive into this panel instance. */
(async () => {
  const VERSION = "2.2.4";
  const TAG = "energyiq-panel-v224";

  const loadTransformed = async (path) => {
    const response = await fetch(`${path}?v=224`, { cache: "no-store" });
    if (!response.ok) throw new Error(`EnergyIQ could not load ${path}: HTTP ${response.status}`);
    let source = await response.text();
    source = source.replaceAll("energyiq-panel-v209", TAG);
    const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
    try { await import(url); } finally { URL.revokeObjectURL(url); }
  };

  try {
    // Re-execute the base panel source under a new element name. This avoids
    // inheriting the already-defined v209 element and all of its old wrappers.
    await loadTransformed("./energyiq-panel.js");

    const Panel = customElements.get(TAG);
    if (!Panel) throw new Error(`EnergyIQ ${TAG} was not defined.`);

    // Keep the existing WebSocket timeout/fallback behavior.
    Panel.prototype._ws = function (message) {
      const hass = this._hass;
      if (hass?.callWS) {
        return Promise.race([
          hass.callWS(message),
          new Promise((_, reject) => setTimeout(() => reject(new Error(`EnergyIQ WebSocket timeout: ${message?.type || "unknown command"}`)), 10000)),
        ]);
      }
      if (hass?.connection?.sendMessagePromise) return hass.connection.sendMessagePromise(message);
      throw new Error("EnergyIQ: Home Assistant WebSocket API is not available.");
    };

    // Preserve Long Cycle training, but execute that layer against v224 only.
    await loadTransformed("./energyiq-long-cycle.js");

    const proto = Panel.prototype;
    if (!proto.__energyiqClean224) {
      proto.__energyiqClean224 = true;
      const originalRender = proto._render;
      const originalSave = proto._save;

      const deviceForRow = (panel, row) => {
        const box = row?.querySelector?.("input.monitor-box");
        const id = box?.dataset?.device;
        return id == null ? null : (panel.data?.devices || []).find(d => String(d.device_id) === String(id)) || null;
      };

      const normalize = panel => {
        const table = panel.querySelector(".table-wrap table");
        if (!table) return;
        const rows = [...table.querySelectorAll("tr")];
        if (!rows.length) return;
        const header = rows[0];

        // Remove every State column produced by any old/stale layer.
        const stateIndexes = [...header.children]
          .map((cell, index) => (cell.textContent || "").trim().toLowerCase() === "state" ? index : -1)
          .filter(index => index >= 0)
          .sort((a, b) => b - a);
        for (const index of stateIndexes) {
          for (const row of rows) if (row.children[index]) row.removeChild(row.children[index]);
        }

        // The base panel's Status column is the one canonical state cell.
        let stateIndex = [...header.children].findIndex(cell =>
          (cell.textContent || "").trim().toLowerCase() === "status"
        );
        if (stateIndex < 0) return;
        header.children[stateIndex].textContent = "State";

        // Put State immediately after Source: Monitor, Train, Device, Area,
        // Source, State, Current Power, Training Method, Action.
        const targetIndex = 5;
        if (stateIndex !== targetIndex) {
          for (const row of [...table.querySelectorAll("tr")]) {
            const cell = row.children[stateIndex];
            if (cell) row.insertBefore(cell, row.children[targetIndex] || null);
          }
          stateIndex = targetIndex;
        }

        for (const row of [...table.querySelectorAll("tr")].slice(1)) {
          const cell = row.children[stateIndex];
          if (!cell) continue;
          const device = deviceForRow(panel, row);
          let state = null;
          for (const item of (device?.controls || [])) {
            const value = item?.entity_id ? panel._hass?.states?.[item.entity_id]?.state : null;
            if (value === "on" || value === "off") { state = value; break; }
          }
          if (state == null) {
            for (const item of (device?.measurements || [])) {
              const value = item?.entity_id ? panel._hass?.states?.[item.entity_id]?.state : null;
              const number = Number(value);
              if (Number.isFinite(number)) { state = number > 0 ? "on" : "off"; break; }
            }
          }
          cell.textContent = state === "on" ? "ON" : state === "off" ? "OFF" : "—";
          cell.style.fontWeight = "600";
          cell.style.whiteSpace = "nowrap";
          cell.style.color = state === "on" ? "var(--success-color,#2e7d32)" : state === "off" ? "var(--error-color,#c62828)" : "var(--secondary-text-color)";
        }
      };

      proto._render = function (...args) {
        const table = this.querySelector(".table-wrap");
        const scrollLeft = table?.scrollLeft || 0;
        const result = originalRender.apply(this, args);
        normalize(this);
        requestAnimationFrame(() => {
          const current = this.querySelector(".table-wrap");
          if (current) current.scrollLeft = scrollLeft;
        });
        return result;
      };

      proto._save = async function (...args) {
        const button = this.querySelector("#save");
        if (button) { button.disabled = true; button.textContent = "Saving…"; }
        try {
          await originalSave.apply(this, args);
          const current = this.querySelector("#save");
          if (current) { current.disabled = true; current.textContent = "✓ Saved"; }
          setTimeout(() => {
            const b = this.querySelector(`${"#save"}`);
            if (b) { b.disabled = false; b.textContent = "Save monitoring selections"; }
          }, 2200);
        } catch (error) {
          const b = this.querySelector("#save");
          if (b) { b.disabled = false; b.textContent = "Save monitoring selections"; }
          this._showNotice?.("Save failed");
          throw error;
        }
      };

      const tick = () => document.querySelectorAll(TAG).forEach(normalize);
      setInterval(tick, 500);
    }

    const setVersion = () => {
      const panel = document.querySelector(TAG);
      const sub = panel?.querySelector?.(".sub");
      if (sub) sub.textContent = `Whole-home electrical intelligence · v${VERSION}`;
    };
    [0, 100, 500, 1500, 3000, 5000].forEach(ms => setTimeout(setVersion, ms));
  } catch (error) {
    console.error("EnergyIQ v2.2.4 loader failed", error);
  }
})();
