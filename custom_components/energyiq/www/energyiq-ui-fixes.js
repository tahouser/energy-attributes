/* EnergyIQ UI fixes: keep pending unchecked loads visible until Save and confirm saves. */
(() => {
  const TAG = "energy-attribution-panel-v35";
  const install = (panel) => {
    if (!panel || panel.__energyiqUiFixesInstalled) return;
    panel.__energyiqUiFixesInstalled = true;

    const ensurePending = () => {
      if (!(panel._pendingSelections instanceof Set)) {
        panel._pendingSelections = new Set(
          (panel.data?.devices || [])
            .filter(x => x.classification === "monitor")
            .map(x => x.device_id)
        );
      }
      return panel._pendingSelections;
    };

    if (typeof panel._save === "function") {
      const originalSave = panel._save.bind(panel);
      panel._save = async (...args) => {
        await originalSave(...args);
        panel._showNotice?.("Monitoring selections saved");
      };
    }

    // Capture CLICK before the panel's own checkbox handler. The panel can
    // otherwise rerender/sort the row before the later change event fires.
    panel.addEventListener("click", (event) => {
      const box = event.target?.closest?.("input[data-device]");
      if (!(box instanceof HTMLInputElement) || panel._listMode !== "monitored") return;

      event.preventDefault();
      event.stopImmediatePropagation();

      const nextChecked = !box.checked;
      box.checked = nextChecked;
      const pending = ensurePending();
      if (nextChecked) pending.add(box.dataset.device);
      else pending.delete(box.dataset.device);

      panel._listMode = "monitored";
      panel._render();
    }, true);

    // Also guard direct/programmatic change events.
    panel.addEventListener("change", (event) => {
      const box = event.target;
      if (!(box instanceof HTMLInputElement) || !box.matches("input[data-device]")) return;
      if (panel._listMode !== "monitored") return;

      event.preventDefault();
      event.stopImmediatePropagation();
      const pending = ensurePending();
      if (box.checked) pending.add(box.dataset.device);
      else pending.delete(box.dataset.device);
      panel._listMode = "monitored";
      panel._render();
    }, true);

    // Safety net for any other renderer invocation while edits are pending.
    const originalRender = panel._render.bind(panel);
    panel._render = (...args) => {
      const pending = panel._pendingSelections;
      const originalMonitored = new Set(
        (panel.data?.devices || [])
          .filter(x => x.classification === "monitor")
          .map(x => x.device_id)
      );
      originalRender(...args);

      if (!(pending instanceof Set) || panel._listMode !== "monitored") return;
      const table = panel.querySelector(".table-wrap table");
      if (!table) return;
      const devices = panel.data?.devices || [];

      for (const device of devices) {
        if (!originalMonitored.has(device.device_id) || pending.has(device.device_id)) continue;
        if (table.querySelector(`input[data-device="${CSS.escape(device.device_id)}"]`)) continue;

        const training = device.training || {};
        const status = panel._status?.(training) || {label:"Not trained", cls:"nottrained", icon:"○"};
        const isManual = String(device.source || "").toLowerCase() === "manual";
        const row = document.createElement("tr");
        row.innerHTML = `
          <td><input class="monitor-box" type="checkbox" data-device="${panel._esc(device.device_id)}"></td>
          <td>${!isManual ? `<input class="train-box" type="checkbox" data-train="${panel._esc(device.device_id)}" ${training.status === "active" ? "disabled" : ""}>` : "—"}</td>
          <td><b>${panel._esc(device.name)}</b><br><span class="method">${panel._esc(device.model || device.category || "")}</span></td>
          <td>${panel._esc(device.area || "")}</td>
          <td class="source">${isManual ? "Manual" : "HA"}</td>
          <td>${panel._currentPower(device)}</td>
          <td class="status ${status.cls}">${status.icon} ${status.label}</td>
          <td>${training.method ? panel._esc(training.method === "quick" ? "Auto — Quick" : training.method === "full_cycle" ? "Auto — Long Run" : "Manual") : "—"}</td>
          <td></td>`;
        table.appendChild(row);
      }
    };
  };

  const findPanel = () => {
    const panel = document.querySelector(TAG);
    if (panel) install(panel);
  };

  if (customElements.get(TAG)) findPanel();
  else customElements.whenDefined(TAG).then(findPanel);
  const observer = new MutationObserver(findPanel);
  observer.observe(document.documentElement, {childList: true, subtree: true});
})();
