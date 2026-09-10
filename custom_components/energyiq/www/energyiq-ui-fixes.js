/* EnergyIQ UI fixes: keep pending unchecked loads visible until Save and confirm saves. */
(() => {
  const TAG = "energy-attribution-panel-v35";
  const install = (panel) => {
    if (!panel || panel.__energyiqUiFixesInstalled) return;
    panel.__energyiqUiFixesInstalled = true;

    // Save is the commit point. Do not let the UI classification change until
    // the user actually saves the pending monitoring selection.
    if (typeof panel._save === "function") {
      const originalSave = panel._save.bind(panel);
      panel._save = async (...args) => {
        await originalSave(...args);
        panel._showNotice?.("Monitoring selections saved");
      };
    }

    // The native handler changes the pending selection and can immediately
    // rebuild the monitored/excluded view. Capture the checkbox event first so
    // an unchecked device remains in the current Monitored view until Save.
    panel.addEventListener("change", (event) => {
      const box = event.target;
      if (!(box instanceof HTMLInputElement) || !box.matches("input[data-device]")) return;
      if (panel._listMode !== "monitored") return;

      event.preventDefault();
      event.stopImmediatePropagation();

      if (!(panel._pendingSelections instanceof Set)) {
        panel._pendingSelections = new Set(
          (panel.data?.devices || [])
            .filter(x => x.classification === "monitor")
            .map(x => x.device_id)
        );
      }
      if (box.checked) panel._pendingSelections.add(box.dataset.device);
      else panel._pendingSelections.delete(box.dataset.device);

      // Keep the user in the Monitored list while edits are pending.
      panel._listMode = "monitored";
      panel._render();
    }, true);

    // After the native renderer runs, restore any originally monitored rows
    // that are now unchecked. They remain visible until Save commits the change.
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
      const devices = panel.data?.devices || [];
      const table = panel.querySelector(".table-wrap table");
      if (!table) return;

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
