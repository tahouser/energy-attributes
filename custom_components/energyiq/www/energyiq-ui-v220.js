/* EnergyIQ v2.2.0 interaction fix.
 * Uses document-level capture to replace the older checkbox click interception.
 * This prevents the legacy v2.1.4/v2.1.6 handlers from double-toggling boxes and
 * guarantees that the pending device_ids sent by Save match the visible checks.
 */
(() => {
  const TAG = "energyiq-panel-v209";
  const install = () => {
    const Panel = customElements.get(TAG);
    if (!Panel?.prototype) return false;
    const proto = Panel.prototype;
    if (proto.__energyiqUi220) return true;
    proto.__energyiqUi220 = true;

    const deviceForBox = (panel, box) => {
      const row = box?.closest?.("tr");
      if (!row) return null;
      const id = box.dataset?.deviceId || box.dataset?.device || box.dataset?.id || box.dataset?.monitor;
      const devices = panel?.data?.devices || [];
      if (id != null) return devices.find(d => String(d.device_id) === String(id)) || null;
      const text = (row.textContent || "").toLowerCase();
      return devices.find(d => d.device_id && text.includes(String(d.device_id).toLowerCase()))
        || devices.find(d => d.name && text.includes(String(d.name).toLowerCase()))
        || null;
    };

    const apply = (panel, box, checked) => {
      const d = deviceForBox(panel, box);
      if (!d) return false;
      const pending = new Set(panel._pendingSelections ||
        (panel.data?.devices || []).filter(x => x.classification === "monitor").map(x => x.device_id));
      box.checked = checked;
      if (checked) pending.add(d.device_id); else pending.delete(d.device_id);
      panel._pendingSelections = pending;
      panel.__energyiqSaveState = "dirty";
      panel._render();
      return true;
    };

    // Intercept before the legacy panel-level capture listener can see the event.
    document.addEventListener("pointerdown", (ev) => {
      const box = ev.target?.closest?.("input.monitor-box");
      if (!box) return;
      const panel = box.closest(TAG);
      if (!panel) return;
      const desired = !box.checked;
      ev.preventDefault();
      ev.stopImmediatePropagation();
      box.__energyiqDesired220 = desired;
      apply(panel, box, desired);
    }, true);

    document.addEventListener("keydown", (ev) => {
      if (ev.key !== " " && ev.key !== "Enter") return;
      const box = ev.target?.closest?.("input.monitor-box");
      if (!box) return;
      const panel = box.closest(TAG);
      if (!panel) return;
      const desired = !box.checked;
      ev.preventDefault();
      ev.stopImmediatePropagation();
      box.__energyiqDesired220 = desired;
      apply(panel, box, desired);
    }, true);

    // Some browsers can still dispatch a click after pointerdown was cancelled.
    // Stop it before it reaches the legacy v2.1.4 handler.
    document.addEventListener("click", (ev) => {
      const box = ev.target?.closest?.("input.monitor-box");
      if (!box) return;
      const panel = box.closest(TAG);
      if (!panel) return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
      delete box.__energyiqDesired220;
    }, true);

    return true;
  };

  if (!install()) {
    const timer = setInterval(() => { if (install()) clearInterval(timer); }, 50);
  }
})();
