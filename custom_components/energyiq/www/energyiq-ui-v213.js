/* EnergyIQ v2.1.3 UI behavior layer. Keeps monitoring edits pending until Save,
 * adds ALL view, Save feedback, and independent red/green entity-state indicators. */
(async () => {
  const tag = "energyiq-panel-v209";
  const panel = customElements.get(tag);
  if (!panel || !panel.prototype) return;
  const proto = panel.prototype;
  if (proto.__energyiqUi213) return;
  proto.__energyiqUi213 = true;

  const originalRender = proto._render;
  const originalSave = proto._save;

  const devicesFor = (self) => self?.data?.devices || [];
  const persistedIds = (self) => {
    if (!self.__energyiqPersistedMonitorIds || !self._pendingSelections) {
      self.__energyiqPersistedMonitorIds = new Set(
        devicesFor(self).filter(d => d.classification === "monitor").map(d => d.device_id)
      );
    }
    return self.__energyiqPersistedMonitorIds;
  };

  const saveButton = (self) => [...self.querySelectorAll("button")].find(b => /^save$/i.test((b.textContent || "").trim()) || /^saving…?$/i.test((b.textContent || "").trim()) || /^saved$/i.test((b.textContent || "").trim()));

  const stateFor = (self, d) => {
    const entityId = d?.entity_id || d?.ha_entity_id || d?.entity || d?.entity_id_text;
    const haState = entityId && self._hass?.states?.[entityId]?.state;
    const raw = d?.state ?? d?.entity_state ?? d?.ha_state ?? d?.current_state ?? haState;
    if (raw === true || String(raw).toLowerCase() === "on") return "on";
    if (raw === false || String(raw).toLowerCase() === "off") return "off";
    return "unknown";
  };

  const findDeviceForRow = (self, row) => {
    const devices = devicesFor(self);
    const text = (row.textContent || "").toLowerCase();
    let d = devices.find(x => x.device_id && text.includes(String(x.device_id).toLowerCase()));
    if (d) return d;
    d = devices.find(x => x.entity_id && text.includes(String(x.entity_id).toLowerCase()));
    if (d) return d;
    return devices.find(x => x.name && text.includes(String(x.name).toLowerCase())) || null;
  };

  const applyStateIndicators = (self) => {
    self.querySelectorAll(".entity-state-radio").forEach(x => x.remove());
    self.querySelectorAll(".table-wrap tbody tr").forEach(row => {
      const d = findDeviceForRow(self, row);
      if (!d) return;
      const state = stateFor(self, d);
      const cell = row.querySelector(".monitor-box")?.closest("td") || row.querySelector("td");
      if (!cell) return;
      const radio = document.createElement("span");
      radio.className = `entity-state-radio ${state}`;
      radio.title = state === "on" ? "Entity is ON" : state === "off" ? "Entity is OFF" : "Entity state unavailable";
      radio.setAttribute("aria-label", radio.title);
      radio.innerHTML = "<span></span>";
      cell.insertBefore(radio, cell.firstChild);
    });
  };

  const monitorBoxDevice = (self, box) => {
    const row = box.closest("tr");
    if (!row) return null;
    const ds = box.dataset || {};
    const id = ds.deviceId || ds.device || ds.id || ds.monitor;
    if (id) return devicesFor(self).find(d => String(d.device_id) === String(id)) || null;
    return findDeviceForRow(self, row);
  };

  const applyPendingChecks = (self) => {
    const pending = self._pendingSelections || persistedIds(self);
    self.querySelectorAll("input.monitor-box").forEach(box => {
      const d = monitorBoxDevice(self, box);
      if (d) box.checked = pending.has(d.device_id);
    });
  };

  const bindMonitorCapture = (self) => {
    if (self.__energyiqMonitorCapture) return;
    self.__energyiqMonitorCapture = true;
    self.addEventListener("click", (ev) => {
      const box = ev.target?.closest?.("input.monitor-box");
      if (!box) return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
      const d = monitorBoxDevice(self, box);
      if (!d) return;
      const pending = new Set(self._pendingSelections || persistedIds(self));
      const next = !box.checked;
      box.checked = next;
      if (next) pending.add(d.device_id); else pending.delete(d.device_id);
      self._pendingSelections = pending;
      self.__energyiqSaveState = "dirty";
      self.__energyiqPersistedMonitorIds = new Set(persistedIds(self));
      self._render();
    }, true);
  };

  const applySaveFeedback = (self) => {
    const b = saveButton(self);
    if (!b) return;
    if (self.__energyiqSaveState === "saving") {
      b.disabled = true;
      b.textContent = "Saving…";
    } else if (self.__energyiqSaveState === "saved") {
      b.disabled = true;
      b.textContent = "✓ Saved";
    } else {
      b.disabled = false;
      b.textContent = "Save";
    }
  };

  proto._render = function (...args) {
    const self = this;
    const pending = self._pendingSelections;
    const persisted = persistedIds(self);
    const requestedMode = self._listMode || "monitored";

    // Render against persisted classification so pending edits never make rows disappear.
    self._pendingSelections = null;

    if (requestedMode === "all") {
      self._listMode = "monitored";
      originalRender.apply(self, args);
      const table = self.querySelector(".table-wrap table");
      const monitoredRows = table ? [...table.querySelectorAll("tbody tr")] : [];
      self._listMode = "excluded";
      originalRender.apply(self, args);
      const table2 = self.querySelector(".table-wrap table");
      const excludedRows = table2 ? [...table2.querySelectorAll("tbody tr")] : [];
      if (table2) {
        const tbody = table2.querySelector("tbody");
        if (tbody) {
          tbody.replaceChildren(...monitoredRows, ...excludedRows);
        }
      }
      self._listMode = "all";
    } else {
      self._listMode = requestedMode;
      originalRender.apply(self, args);
    }

    self._pendingSelections = pending;
    self._listMode = requestedMode;

    // Add the third list mode without changing the existing panel structure.
    const toggle = self.querySelector(".list-toggle");
    if (toggle) {
      if (!toggle.querySelector('[data-energyiq-mode="all"]')) {
        const all = document.createElement("button");
        all.type = "button";
        all.className = "toggle-btn";
        all.dataset.energyiqMode = "all";
        all.textContent = "ALL";
        toggle.appendChild(all);
      }
      toggle.querySelectorAll(".toggle-btn").forEach(b => {
        const text = (b.textContent || "").trim().toLowerCase();
        const mode = b.dataset.energyiqMode || (text.includes("monitor") ? "monitored" : text.includes("exclude") ? "excluded" : "all");
        b.classList.toggle("active", mode === requestedMode);
        b.onclick = () => { self._listMode = mode; self._render(); };
      });
    }

    applyPendingChecks(self);
    applyStateIndicators(self);
    bindMonitorCapture(self);
    applySaveFeedback(self);
  };

  proto._save = async function (...args) {
    const self = this;
    if (self.__energyiqSaveState === "saving") return;
    self.__energyiqSaveState = "saving";
    self._render();
    try {
      await originalSave.apply(self, args);
      self.__energyiqPersistedMonitorIds = new Set(
        devicesFor(self).filter(d => d.classification === "monitor").map(d => d.device_id)
      );
      self.__energyiqSaveState = "saved";
      self._render();
      clearTimeout(self.__energyiqSavedTimer);
      self.__energyiqSavedTimer = setTimeout(() => {
        self.__energyiqSaveState = "idle";
        self._render();
      }, 2200);
    } catch (e) {
      self.__energyiqSaveState = "dirty";
      self._render();
      self._showNotice?.("Save failed");
      throw e;
    }
  };

  // Capture the persisted state before the first edit and after a successful save.
  if (!proto.__energyiqRefresh213) {
    const originalRefresh = proto._refresh;
    proto._refresh = async function (...args) {
      const hadPending = !!this._pendingSelections;
      const result = await originalRefresh.apply(this, args);
      if (!hadPending && !this._pendingSelections) {
        this.__energyiqPersistedMonitorIds = new Set(
          devicesFor(this).filter(d => d.classification === "monitor").map(d => d.device_id)
        );
      }
      return result;
    };
    proto.__energyiqRefresh213 = true;
  }
})();
