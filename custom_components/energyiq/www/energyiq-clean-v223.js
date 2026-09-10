/* EnergyIQ v2.2.3 clean monitoring/state controller.
 * This deliberately does not load or depend on the older v2.1.x/v2.2.x
 * monitoring/state layers. The base panel already owns pending selections and
 * Save; this layer only prevents legacy event interference, normalizes the
 * table to exactly one State column, and preserves scroll position.
 */
(() => {
  const TAG = "energyiq-panel-v209";
  const install = () => {
    const Panel = customElements.get(TAG);
    if (!Panel?.prototype) return false;
    const proto = Panel.prototype;
    if (proto.__energyiqClean223) return true;
    proto.__energyiqClean223 = true;

    const devices = panel => panel?.data?.devices || [];
    const deviceForBox = (panel, box) => {
      const id = box?.dataset?.deviceId || box?.dataset?.device || box?.dataset?.id || box?.dataset?.monitor;
      if (id != null) return devices(panel).find(d => String(d.device_id) === String(id)) || null;
      return null;
    };

    const captureScroll = panel => ({
      x: window.scrollX || 0,
      y: window.scrollY || 0,
      table: panel.querySelector(".table-wrap") ? {
        x: panel.querySelector(".table-wrap").scrollLeft || 0,
        y: panel.querySelector(".table-wrap").scrollTop || 0,
      } : null,
    });
    const restoreScroll = snap => requestAnimationFrame(() => {
      if (snap.table) {
        const table = document.querySelector(`${TAG} .table-wrap`);
        if (table) { table.scrollLeft = snap.table.x; table.scrollTop = snap.table.y; }
      }
      if (snap.x || snap.y) window.scrollTo(snap.x, snap.y);
    });

    const normalizeStateColumn = panel => {
      const table = panel.querySelector(".table-wrap table");
      if (!table) return;
      const headerRow = table.querySelector("tr");
      if (!headerRow) return;
      const headers = [...headerRow.children];
      const stateIndexes = headers.map((h, i) =>
        (h.textContent || "").trim().toLowerCase() === "state" ? i : -1
      ).filter(i => i >= 0);
      // Remove every injected State column. The base panel's Status column is
      // the canonical location and will be renamed below.
      for (const index of [...stateIndexes].sort((a,b) => b-a)) {
        table.querySelectorAll("tr").forEach(row => {
          if (row.children[index]) row.removeChild(row.children[index]);
        });
      }
      const currentHeaders = [...headerRow.children];
      let statusIndex = currentHeaders.findIndex(h =>
        (h.textContent || "").trim().toLowerCase() === "status"
      );
      if (statusIndex < 0) {
        const currentPowerIndex = currentHeaders.findIndex(h =>
          (h.textContent || "").trim().toLowerCase() === "current power"
        );
        statusIndex = currentPowerIndex >= 0 ? currentPowerIndex + 1 : currentHeaders.length;
        const th = document.createElement("th");
        th.textContent = "State";
        headerRow.insertBefore(th, headerRow.children[statusIndex] || null);
        table.querySelectorAll("tr").forEach((row, i) => {
          if (i === 0) return;
          const td = document.createElement("td");
          td.textContent = "—";
          row.insertBefore(td, row.children[statusIndex] || null);
        });
      } else {
        currentHeaders[statusIndex].textContent = "State";
      }

      table.querySelectorAll("tr").forEach((row, rowIndex) => {
        if (rowIndex === 0) return;
        const box = row.querySelector("input.monitor-box");
        const d = deviceForBox(panel, box);
        const cell = row.children[statusIndex];
        if (!cell) return;
        let state = null;
        for (const item of (d?.controls || [])) {
          const s = item?.entity_id ? panel._hass?.states?.[item.entity_id]?.state : null;
          if (s === "on" || s === "off") { state = s; break; }
        }
        if (state == null) {
          for (const item of (d?.measurements || [])) {
            const s = item?.entity_id ? panel._hass?.states?.[item.entity_id]?.state : null;
            const n = Number(s);
            if (Number.isFinite(n)) { state = n > 0 ? "on" : "off"; break; }
          }
        }
        cell.textContent = state === "on" ? "ON" : state === "off" ? "OFF" : "—";
        cell.style.fontWeight = "600";
        cell.style.whiteSpace = "nowrap";
        cell.style.color = state === "on" ? "var(--success-color,#2e7d32)" : state === "off" ? "var(--error-color,#c62828)" : "var(--secondary-text-color)";
      });
    };

    const originalRender = proto._render;
    proto._render = function (...args) {
      const snap = captureScroll(this);
      const result = originalRender.apply(this, args);
      normalizeStateColumn(this);
      restoreScroll(snap);
      return result;
    };

    const originalSave = proto._save;
    proto._save = async function (...args) {
      if (this.__energyiqCleanSaving223) return;
      this.__energyiqCleanSaving223 = true;
      const button = this.querySelector("#save");
      if (button) { button.disabled = true; button.textContent = "Saving…"; }
      try {
        await originalSave.apply(this, args);
        const b = this.querySelector("#save");
        if (b) { b.disabled = true; b.textContent = "✓ Saved"; }
        setTimeout(() => {
          const current = document.querySelector(`${TAG} #save`);
          if (current) { current.disabled = false; current.textContent = "Save monitoring selections"; }
        }, 2200);
      } catch (error) {
        const b = this.querySelector("#save");
        if (b) { b.disabled = false; b.textContent = "Save monitoring selections"; }
        this._showNotice?.("Save failed");
        throw error;
      } finally {
        this.__energyiqCleanSaving223 = false;
      }
    };

    // Capture before any legacy panel-level listeners. This makes an already
    // loaded older layer harmless until the page is fully reloaded.
    const toggle = (ev, keyboard = false) => {
      if (keyboard && ev.key !== " " && ev.key !== "Enter") return;
      const box = ev.target?.closest?.("input.monitor-box");
      if (!box) return;
      const panel = box.closest(TAG);
      if (!panel) return;
      const d = deviceForBox(panel, box);
      if (!d) return;
      const pending = new Set(panel._pendingSelections ||
        devices(panel).filter(x => x.classification === "monitor").map(x => x.device_id));
      const next = !box.checked;
      ev.preventDefault();
      ev.stopImmediatePropagation();
      box.checked = next;
      if (next) pending.add(d.device_id); else pending.delete(d.device_id);
      panel._pendingSelections = pending;
      panel._render();
    };
    document.addEventListener("pointerdown", ev => toggle(ev), true);
    document.addEventListener("keydown", ev => toggle(ev, true), true);
    document.addEventListener("click", ev => {
      if (ev.target?.closest?.("input.monitor-box")) {
        const panel = ev.target.closest(TAG);
        if (panel) { ev.preventDefault(); ev.stopImmediatePropagation(); }
      }
    }, true);

    const tick = () => document.querySelectorAll(TAG).forEach(p => normalizeStateColumn(p));
    setInterval(tick, 500);
    return true;
  };
  if (!install()) {
    const timer = setInterval(() => { if (install()) clearInterval(timer); }, 50);
  }
})();
