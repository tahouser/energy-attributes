/* EnergyIQ load-list UX: All / Monitored / Excluded with real pending selection state. */
(() => {
  const TAG = "energy-attribution-panel-v35";
  const VERSION = "2.0.4";

  const esc = (panel, value) => panel._esc ? panel._esc(value ?? "") : String(value ?? "").replace(/[&<>\"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c]));

  const ensurePending = (panel) => {
    if (!(panel._pendingSelections instanceof Set)) {
      panel._pendingSelections = new Set(
        (panel.data?.devices || [])
          .filter(x => x.classification === "monitor")
          .map(x => x.device_id)
      );
    }
    return panel._pendingSelections;
  };

  const deviceRow = (panel, device, pending) => {
    const training = device.training || {};
    const status = panel._status?.(training) || {label:"Not trained", cls:"nottrained", icon:"○"};
    const isManual = String(device.source || "").toLowerCase() === "manual";
    const checked = pending.has(device.device_id) ? "checked" : "";
    const trainDisabled = training.status === "active" ? "disabled" : "";
    const controls = Array.isArray(device.controls) ? device.controls : [];
    const quick = !isManual && controls.length
      ? `<button type="button" data-energyiq-action="quick" data-energyiq-device="${esc(panel, device.device_id)}">Quick</button>`
      : "";
    const manual = !isManual
      ? `<button type="button" data-energyiq-action="manual" data-energyiq-device="${esc(panel, device.device_id)}">Manual</button>`
      : "";
    const stop = training.status === "active"
      ? `<button type="button" data-energyiq-action="stop" data-energyiq-device="${esc(panel, device.device_id)}">Stop</button>`
      : "";
    return `<tr data-energyiq-row="${esc(panel, device.device_id)}">
      <td><input class="monitor-box" type="checkbox" data-device="${esc(panel, device.device_id)}" ${checked}></td>
      <td>${!isManual ? `<input class="train-box" type="checkbox" data-train="${esc(panel, device.device_id)}" ${trainDisabled}>` : "—"}</td>
      <td><b>${esc(panel, device.name)}</b><br><span class="method">${esc(panel, device.model || device.category || "")}</span></td>
      <td>${esc(panel, device.area || "")}</td>
      <td class="source">${isManual ? "Manual" : "HA"}</td>
      <td>${panel._currentPower?.(device) ?? "—"}</td>
      <td class="status ${status.cls}">${status.icon} ${status.label}</td>
      <td>${training.method ? esc(panel, training.method === "quick" ? "Auto — Quick" : training.method === "full_cycle" ? "Auto — Long Run" : "Manual") : "—"}</td>
      <td class="energyiq-actions">${quick} ${manual} ${stop}</td>
    </tr>`;
  };

  const install = (panel) => {
    if (!panel || panel.__energyiqAllViewsInstalled) return;
    panel.__energyiqAllViewsInstalled = true;
    panel._energyiqView = "all";

    if (typeof panel._save === "function") {
      const originalSave = panel._save.bind(panel);
      panel._save = async (...args) => {
        await originalSave(...args);
        panel._showNotice?.("Monitoring selections saved");
      };
    }

    // Own the monitoring checkbox interaction so an unchecked row never vanishes
    // from the All view before Save.
    panel.addEventListener("click", (event) => {
      const box = event.target?.closest?.("input[data-device]");
      if (!(box instanceof HTMLInputElement)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const pending = ensurePending(panel);
      const next = !box.checked;
      box.checked = next;
      if (next) pending.add(box.dataset.device);
      else pending.delete(box.dataset.device);
      panel._render();
    }, true);

    panel.addEventListener("change", (event) => {
      const box = event.target;
      if (!(box instanceof HTMLInputElement) || !box.matches("input[data-device]")) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const pending = ensurePending(panel);
      if (box.checked) pending.add(box.dataset.device);
      else pending.delete(box.dataset.device);
      panel._render();
    }, true);

    panel.addEventListener("click", async (event) => {
      const button = event.target?.closest?.("button[data-energyiq-action]");
      if (!button) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const id = button.dataset.energyiqDevice;
      const action = button.dataset.energyiqAction;
      try {
        if (action === "quick") await panel._train(id, "quick");
        else if (action === "manual") await panel._train(id, "manual");
        else if (action === "stop") await panel._stop(id);
      } catch (e) {
        alert(`EnergyIQ could not perform that action: ${e.message || e}`);
      }
    }, true);

    const originalRender = panel._render.bind(panel);
    panel._render = (...args) => {
      // The original renderer already knows how to render selected/monitored
      // rows. We use it as the base and then make the complete candidate set
      // visible for All/Excluded without fighting its internal layout.
      originalRender(...args);
      panel._energyiqView = panel._energyiqView || "all";
      const pending = ensurePending(panel);
      const devices = panel.data?.devices || [];
      const table = panel.querySelector(".table-wrap table");
      const actions = panel.querySelector(".actions");
      if (!table || !actions) return;

      let bar = panel.querySelector(".energyiq-view-bar");
      if (!bar) {
        bar = document.createElement("div");
        bar.className = "energyiq-view-bar";
        actions.appendChild(bar);
      }
      bar.innerHTML = `
        <span class="energyiq-view-label">Loads</span>
        <button type="button" class="energyiq-view-btn" data-energyiq-view="all">All <span></span></button>
        <button type="button" class="energyiq-view-btn" data-energyiq-view="monitored">Monitored <span></span></button>
        <button type="button" class="energyiq-view-btn" data-energyiq-view="excluded">Excluded <span></span></button>`;
      const counts = {
        all: devices.length,
        monitored: devices.filter(d => pending.has(d.device_id)).length,
        excluded: devices.filter(d => !pending.has(d.device_id)).length,
      };
      for (const button of bar.querySelectorAll("[data-energyiq-view]")) {
        const view = button.dataset.energyiqView;
        button.classList.toggle("active", panel._energyiqView === view);
        button.querySelector("span").textContent = `(${counts[view]})`;
        button.onclick = () => {
          panel._energyiqView = view;
          panel._render();
        };
      }

      // The legacy two-way toggle is now redundant.
      panel.querySelectorAll(".list-toggle").forEach(x => x.style.display = "none");

      const existing = new Map();
      table.querySelectorAll("input[data-device]").forEach(box => {
        const row = box.closest("tr");
        if (row) existing.set(box.dataset.device, row);
      });

      // Append every device that the original renderer omitted. This makes All
      // a true inventory rather than a view of only currently monitored loads.
      for (const device of devices) {
        if (existing.has(device.device_id)) continue;
        table.insertAdjacentHTML("beforeend", deviceRow(panel, device, pending));
      }

      const rows = [...table.querySelectorAll("tr[data-energyiq-row], tr")].filter(r => r.querySelector("input[data-device]"));
      for (const row of rows) {
        const box = row.querySelector("input[data-device]");
        if (!box) continue;
        const monitored = pending.has(box.dataset.device);
        row.style.display = panel._energyiqView === "all" ||
          (panel._energyiqView === "monitored" && monitored) ||
          (panel._energyiqView === "excluded" && !monitored) ? "" : "none";
        box.checked = monitored;
      }

      // Make the active view and the version visible even if an older cached
      // panel shell supplied a stale subtitle.
      const sub = panel.querySelector(".sub");
      if (sub) sub.textContent = `Whole-home electrical intelligence · v${VERSION}`;
    };
  };

  const findPanel = () => {
    const panel = document.querySelector(TAG);
    if (panel) install(panel);
  };

  if (customElements.get(TAG)) findPanel();
  else customElements.whenDefined(TAG).then(findPanel);
  const observer = new MutationObserver(findPanel);
  observer.observe(document.documentElement, {childList:true, subtree:true});
})();
