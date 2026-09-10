/* EnergyIQ v2.2.2 clean monitoring controller.
 * This is intentionally the final UI layer: it owns checkbox state, Save,
 * and the single State column instead of stacking older event/state layers.
 */
(() => {
  const TAG = "energyiq-panel-v209";

  const install = () => {
    const Panel = customElements.get(TAG);
    if (!Panel?.prototype) return false;
    const proto = Panel.prototype;
    if (proto.__energyiqUi222) return true;
    proto.__energyiqUi222 = true;

    const devices = panel => panel?.data?.devices || [];
    const persisted = panel => new Set(devices(panel).filter(d => d.classification === "monitor").map(d => d.device_id));

    const findDevice = (panel, boxOrRow) => {
      const box = boxOrRow?.matches?.("input.monitor-box") ? boxOrRow : boxOrRow?.querySelector?.("input.monitor-box");
      const id = box?.dataset?.device || box?.dataset?.deviceId || box?.dataset?.id || box?.dataset?.monitor;
      if (id != null) return devices(panel).find(d => String(d.device_id) === String(id)) || null;
      const row = boxOrRow?.closest?.("tr") || boxOrRow;
      const rowId = row?.dataset?.energyiqRow;
      if (rowId) return devices(panel).find(d => String(d.device_id) === String(rowId)) || null;
      const text = String(row?.textContent || "").toLowerCase();
      return devices(panel).find(d => d.name && text.includes(String(d.name).toLowerCase())) || null;
    };

    const pendingFor = panel => {
      if (panel._pendingSelections instanceof Set) return panel._pendingSelections;
      panel._pendingSelections = persisted(panel);
      return panel._pendingSelections;
    };

    const captureScroll = panel => {
      const positions = [];
      let node = panel;
      while (node) {
        if (typeof node.scrollTop === "number" && node.scrollTop !== 0) positions.push([node, node.scrollTop]);
        node = node.parentElement;
      }
      positions.push([document.scrollingElement, document.scrollingElement?.scrollTop || 0]);
      return { y: window.scrollY, table: panel.querySelector(".table-wrap")?.scrollLeft || 0, positions };
    };

    const restoreScroll = (panel, saved) => {
      requestAnimationFrame(() => {
        if (saved.table != null) {
          const table = panel.querySelector(".table-wrap");
          if (table) table.scrollLeft = saved.table;
        }
        for (const [node, top] of saved.positions || []) if (node) node.scrollTop = top;
        window.scrollTo(window.scrollX, saved.y || 0);
      });
    };

    const stateFor = (panel, device) => {
      if (!device || !panel._hass) return {kind:"unknown", label:"—"};
      for (const item of [...(device.controls || []), ...(device.measurements || [])]) {
        const id = item?.entity_id;
        const raw = id ? panel._hass.states?.[id]?.state : null;
        if (raw === "on") return {kind:"on", label:"ON"};
        if (raw === "off") return {kind:"off", label:"OFF"};
      }
      return {kind:"unknown", label:"—"};
    };

    const normalizeStateColumn = panel => {
      const table = panel.querySelector(".table-wrap table");
      if (!table) return;
      const headerRow = table.querySelector("thead tr") || table.querySelector("tr:first-child");
      if (!headerRow) return;
      const headers = [...headerRow.children];
      const stateIndexes = headers.map((h, i) => ({h, i})).filter(x => String(x.h.textContent || "").trim().toLowerCase() === "state").map(x => x.i);
      for (const index of stateIndexes.sort((a,b) => b-a)) {
        headerRow.children[index]?.remove();
        table.querySelectorAll("tbody tr, tr").forEach(row => {
          if (row === headerRow) return;
          row.children[index]?.remove();
        });
      }
      const freshHeader = document.createElement("th");
      freshHeader.textContent = "State";
      headerRow.insertBefore(freshHeader, headerRow.children[5] || null);
      const rows = [...table.querySelectorAll("tbody tr, tr")].filter(row => row !== headerRow && row.querySelector("input.monitor-box"));
      for (const row of rows) {
        const cell = document.createElement("td");
        const device = findDevice(panel, row);
        const state = stateFor(panel, device);
        cell.textContent = state.label;
        cell.dataset.energyiqState222 = "1";
        cell.style.fontWeight = "600";
        cell.style.whiteSpace = "nowrap";
        cell.style.color = state.kind === "on" ? "var(--success-color,#2e7d32)" : state.kind === "off" ? "var(--error-color,#c62828)" : "var(--secondary-text-color)";
        row.insertBefore(cell, row.children[5] || null);
      }
    };

    const applyCheckboxes = panel => {
      const pending = pendingFor(panel);
      panel.querySelectorAll("input.monitor-box").forEach(box => {
        const d = findDevice(panel, box);
        if (d) box.checked = pending.has(d.device_id);
      });
    };

    const renderFinal = proto._render;
    proto._render = function (...args) {
      const saved = captureScroll(this);
      const result = renderFinal.apply(this, args);
      normalizeStateColumn(this);
      applyCheckboxes(this);
      restoreScroll(this, saved);
      return result;
    };

    const setPendingFromBox = (panel, box, desired) => {
      const d = findDevice(panel, box);
      if (!d) return false;
      const pending = new Set(pendingFor(panel));
      if (desired) pending.add(d.device_id); else pending.delete(d.device_id);
      panel._pendingSelections = pending;
      panel.__energyiqSaveState = "dirty";
      box.checked = desired;
      panel._render();
      return true;
    };

    // Document capture runs before the older panel-level listeners installed by
    // the historical layers. This makes the visible checkbox and pending set
    // change exactly once.
    document.addEventListener("pointerdown", ev => {
      const box = ev.target?.closest?.("input.monitor-box");
      if (!box) return;
      const panel = box.closest(TAG);
      if (!panel) return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
      setPendingFromBox(panel, box, !box.checked);
    }, true);

    document.addEventListener("keydown", ev => {
      if (ev.key !== " " && ev.key !== "Enter") return;
      const box = ev.target?.closest?.("input.monitor-box");
      if (!box) return;
      const panel = box.closest(TAG);
      if (!panel) return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
      setPendingFromBox(panel, box, !box.checked);
    }, true);

    document.addEventListener("click", ev => {
      const box = ev.target?.closest?.("input.monitor-box");
      if (!box) return;
      const panel = box.closest(TAG);
      if (!panel) return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
    }, true);

    const originalSave = proto._save;
    proto._save = async function () {
      const panel = this;
      if (panel.__energyiqSaveState === "saving") return;
      const pending = new Set(pendingFor(panel));
      panel.__energyiqSaveState = "saving";
      panel._render();
      try {
        const result = await panel._ws({
          type: "energy_attribution/set_monitoring",
          entry_id: panel.entryId,
          device_ids: [...pending],
        });
        if (!result?.saved) throw new Error("EnergyIQ did not confirm the monitoring update.");
        panel._pendingSelections = null;
        await panel._refresh();
        panel.__energyiqSaveState = "saved";
        panel._render();
        clearTimeout(panel.__energyiqSavedTimer222);
        panel.__energyiqSavedTimer222 = setTimeout(() => {
          panel.__energyiqSaveState = "idle";
          panel._render();
        }, 2200);
      } catch (error) {
        panel.__energyiqSaveState = "dirty";
        panel._pendingSelections = pending;
        panel._render();
        panel._showNotice?.(`Save failed: ${error?.message || error}`);
        console.error("EnergyIQ monitoring save failed", error);
      }
    };

    const originalRefresh = proto._refresh;
    proto._refresh = async function (...args) {
      const hadPending = this._pendingSelections instanceof Set;
      const result = await originalRefresh.apply(this, args);
      if (!hadPending && !(this._pendingSelections instanceof Set)) this.__energyiqPersistedMonitorIds222 = persisted(this);
      return result;
    };

    const style = document.createElement("style");
    style.id = "energyiq-ui-222-style";
    style.textContent = `
      .energyiq-state222{font-weight:600;white-space:nowrap}
      .table-wrap{touch-action:auto!important;overflow-y:visible!important;-webkit-overflow-scrolling:touch!important;overscroll-behavior-x:auto!important}
    `;
    document.head.appendChild(style);
    return true;
  };

  if (!install()) {
    const timer = setInterval(() => { if (install()) clearInterval(timer); }, 50);
  }
})();
