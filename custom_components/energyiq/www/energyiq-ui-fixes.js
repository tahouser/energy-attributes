/* EnergyIQ UI fixes: keep pending unchecked loads visible until Save and confirm saves. */
(() => {
  const TAG = "energy-attribution-panel-v35";
  const install = (panel) => {
    if (!panel || panel.__energyiqUiFixesInstalled) return;
    panel.__energyiqUiFixesInstalled = true;

    // Confirm a successful Save after the existing save/refresh cycle completes.
    if (typeof panel._save === "function") {
      const originalSave = panel._save.bind(panel);
      panel._save = async (...args) => {
        await originalSave(...args);
        panel._showNotice?.("Monitoring selections saved");
      };
    }

    // The normal renderer intentionally hides unchecked devices. During a
    // pending edit, keep the originally monitored device visible so its box
    // can be seen unchecked. The next workspace refresh after Save removes it.
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
        const box = row.querySelector("input[data-device]");
        box.addEventListener("change", () => {
          if (!panel._pendingSelections) {
            panel._pendingSelections = new Set(
              (panel.data?.devices || [])
                .filter(x => x.classification === "monitor")
                .map(x => x.device_id)
            );
          }
          if (box.checked) panel._pendingSelections.add(box.dataset.device);
          else panel._pendingSelections.delete(box.dataset.device);
          panel._render();
        });
        table.appendChild(row);
      }
    };

    // The original checkbox listener updates pending selections and immediately
    // rerenders. Run after it so the wrapper can restore any unchecked rows.
    panel.addEventListener("change", (event) => {
      const box = event.target;
      if (!(box instanceof HTMLInputElement) || !box.matches("input[data-device]")) return;
      if (!box.checked) queueMicrotask(() => panel._render());
    });
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
