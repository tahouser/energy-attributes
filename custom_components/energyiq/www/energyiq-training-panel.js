/* EnergyIQ training UI v2: five fresh readings, #5 is saved. */
(() => {
  const TAG = "energyiq-panel-training-v179";
  const BASE_TAG = "energyiq-panel-v325";
  const BASE_URL = "/energyiq-static/energyiq-panel.js?v=31790";
  const define = () => {
    const Base = customElements.get(BASE_TAG);
    if (!Base || customElements.get(TAG)) return !!Base;
    class EnergyIQTrainingPanel extends Base {
      renderSummary() {
        const devices = this.getDevices();
        const monitored = devices.filter(d => this.getPersistedIds().has(d.device_id));
        const trained = monitored.filter(d => d.training?.status === "complete").length;
        const untrained = monitored.length - trained;
        const home = Number(this.workspace?.whole_home_power);
        const trainedDevices = monitored.filter(d => d.training?.status === "complete");
        const activeTrained = trainedDevices.filter(d => this.deviceIsActive(d));
        const trainedExpected = trainedDevices.reduce((sum, d) => {
          const value = Number(d.training?.learned_signature?.load_w);
          return sum + (Number.isFinite(value) ? Math.max(0, value) : 0);
        }, 0);
        const actualActive = activeTrained.reduce((sum, d) => {
          const value = Number(d.current_power);
          return sum + (Number.isFinite(value) ? Math.max(0, value) : 0);
        }, 0);
        const mystery = Number.isFinite(home) ? Math.max(0, home - actualActive) : null;
        const fmt = value => Number.isFinite(value) ? `${value.toFixed(0)} W` : "—";
        return `<div class="summary">
          <div class="metric"><span>Home Power Now</span><strong>${fmt(home)}</strong></div>
          <div class="metric"><span>Trained Wattage</span><strong>${fmt(trainedExpected)}</strong></div>
          <div class="metric"><span>Actual Wattage</span><strong>${fmt(actualActive)}</strong></div>
          <div class="metric mystery"><span>Mystery Watts</span><strong>${fmt(mystery)}</strong></div>
          <div class="metric"><span>Monitored</span><strong>${monitored.length}</strong></div>
          <div class="metric"><span>Trained</span><strong>${trained}</strong></div>
          <div class="metric"><span>Untrained</span><strong>${untrained}</strong></div>
        </div>`;
      }

      deviceIsActive(device) {
        const controls = Array.isArray(device?.controls) ? device.controls : [];
        if (controls.length) {
          for (const control of controls) {
            const id = control?.entity_id;
            const stateObj = id ? this.hass?.states?.[id] : null;
            if (!stateObj) continue;
            const domain = String(control?.domain || id.split(".", 1)[0]).toLowerCase();
            const value = String(stateObj.state || "").toLowerCase();
            if (["off", "unavailable", "unknown", "none"].includes(value)) continue;
            if (domain === "climate") {
              const action = String(stateObj.attributes?.hvac_action || "").toLowerCase();
              if (["heating", "cooling", "fan", "drying"].includes(action)) return true;
              if (action === "idle") continue;
              if (!["off", "auto_off"].includes(value)) return true;
            } else if (["on", "active", "running", "playing", "heating", "cooling"].includes(value)) {
              return true;
            }
          }
          return false;
        }
        const power = Number(device?.current_power);
        return Number.isFinite(power) && power > 0;
      }

      renderTrainingStatus(device) {
        const status = this.trainingStatus(device);
        const labels = { trained: "Trained", active: "Training", error: "Error", untrained: "Not trained" };
        return `<span class="training-dot ${status}" title="${labels[status]}"></span>`;
      }

      startBulkPolling() {
        if (this.bulkTimer) return;
        this.bulkTimer = setInterval(async () => {
          try {
            const [bulk, workspace] = await Promise.all([
              this.ws({ type: "energy_attribution/bulk_training_state", entry_id: this.entryId }),
              this.ws({ type: "energy_attribution/workspace", entry_id: this.entryId }),
            ]);
            this.bulk = bulk;
            this.workspace = workspace;
            if (bulk?.status === "running" && bulk.current_device_id) {
              this.activeTrainingId = bulk.current_device_id;
            } else if (bulk?.status !== "running") {
              this.activeTrainingId = null;
              this.stopBulkPolling();
            }
            this.updateLiveData();
          } catch (error) {
            console.error("EnergyIQ bulk status", error);
          }
        }, 1000);
      }

      renderTrainingDetail(device) {
        const training = device?.training || {};
        const method = training.method === "manual" ? "manual" : "quick";
        const result = training.result || {};
        const baseline = Number(training.baseline_w);
        const live = Number(training.live_delta_w);
        const learned = Number(training.learned_signature?.load_w ?? result.learned_w);
        const sourceReading = Number(result.learned_source_w);
        const elapsed = Number(training.duration_s);
        const count = Number(result.fresh_readings_collected ?? training.fresh_readings_collected ?? 0);
        const readings = Array.isArray(result.fresh_readings) ? result.fresh_readings : [];
        const active = training.status === "active";
        const complete = training.status === "complete";
        const phase = String(training.phase || "");
        const instruction = complete ? `Training complete. Saved the fifth fresh Shelly reading as the learned load: ${Number.isFinite(learned) ? learned.toFixed(0) : "—"} W.` : (training.instruction || this.defaultInstruction(method, phase, device));
        const fmt = value => Number.isFinite(value) ? `${value.toFixed(0)} W` : "—";
        const shown = complete ? learned : (Number.isFinite(live) ? live : sourceReading);
        const slots = Array.from({ length: 5 }, (_, i) => { const value = Number(readings[i]); return `<div class="reading-slot ${i < count ? "filled" : ""}"><span>#${i + 1}</span><strong>${Number.isFinite(value) ? value.toFixed(0) + " W" : "—"}</strong></div>`; }).join("");
        const statusText = complete ? "Training saved" : active ? `Fresh readings ${Math.min(5, Math.max(0, count))} of 5` : "Ready to train";
        const methodText = method === "manual" ? "Manual · guided start" : "Automatic · controlled start";
        return `<div class="training-grid"><div class="training-main"><div class="method-picker"><label>Training method<select id="training-method" ${active ? "disabled" : ""}><option value="quick" ${method === "quick" ? "selected" : ""}>Automatic — 5 fresh readings</option><option value="manual" ${method === "manual" ? "selected" : ""}>Manual — guided 5-reading capture</option></select></label></div><div class="instruction-card"><span class="eyebrow">Instructions</span><strong>${this.escape(instruction)}</strong></div><div class="capture-grid"><div><span>Baseline</span><strong>${fmt(baseline)}</strong></div><div class="capture-value ${complete ? "valid" : ""}"><span>${complete ? "Learned load · reading #5" : "Live load delta"}</span><strong>${fmt(shown)}</strong></div><div><span>Fifth source reading</span><strong>${fmt(sourceReading)}</strong></div><div><span>Elapsed</span><strong>${Number.isFinite(elapsed) ? elapsed.toFixed(1) + " s" : "—"}</strong></div></div><div class="five-readings"><span class="eyebrow">Five fresh Shelly readings · #5 is the saved value</span><div class="reading-slots">${slots}</div></div><div class="capture-state ${complete ? "valid" : ""}"><span class="status-light ${complete ? "green" : active ? "amber" : "red"}"></span><strong>${statusText}</strong></div><div class="training-actions">${this.renderTrainingActions(device, method, active, complete)}</div>${complete ? this.renderCompletedResult(device) : ""}</div><aside class="training-info"><span class="eyebrow">Selected device</span><h3>${this.escape(device.name || device.device_id)}</h3><p>${this.escape(device.area || "No area assigned")}</p><dl><dt>Source</dt><dd>${String(device.source || "").toLowerCase() === "manual" ? "Manual" : "Home Assistant"}</dd><dt>Training</dt><dd>${methodText}</dd><dt>Result</dt><dd>${complete ? fmt(learned) : "Pending #5"}</dd></dl></aside></div>`;
      }

      renderTrainingActions(device, method, active, complete) { if (active) { if (method === "manual") return `<span class="training-lock">Manual capture cannot be ended early. It ends automatically after the fifth fresh reading and the 5-second minimum.</span>`; return `<button data-training-stop>Stop Without Saving</button>`; } if (complete) return `<button class="primary" data-training-retrain>Retrain</button>`; return `<button class="primary" data-training-start>Start ${method === "manual" ? "Manual Training" : "Automatic Training"}</button>`; }
      selectedWorkspaceMethod() { return this.querySelector("#training-method")?.value || "quick"; }

      async startWorkspaceTraining(retrain = false) {
        const device = this.activeTrainingDevice();
        if (!device) return;
        const method = this.selectedWorkspaceMethod();
        const bulkIds = [...new Set(this.trainingQueue)].filter(id => this.getDevice(id) && this.getPersistedIds().has(id));
        if (!retrain && method === "quick" && bulkIds.length > 1) {
          const message = `EnergyIQ will automatically train ${bulkIds.length} selected loads sequentially. Each load will use Quick Training, save reading #5, and then move to the next load. Continue?`;
          if (!window.confirm(message)) return;
          try {
            this.bulk = { status: "running", queue: bulkIds, current_index: 0, total: bulkIds.length, current_device_id: bulkIds[0], completed: 0, skipped: [], failed: [] };
            this.activeTrainingId = bulkIds[0];
            this.startBulkPolling();
            this.ws({ type: "energy_attribution/bulk_auto_training", entry_id: this.entryId, device_ids: bulkIds })
              .then(async () => { await this.refresh(true); })
              .catch(error => { this.stopBulkPolling(); this.showToast(error?.message || "Bulk training failed", true); });
          } catch (error) {
            this.stopBulkPolling();
            this.showToast(error?.message || "Unable to start bulk training", true);
          }
          return;
        }
        const message = method === "manual" ? `Manual training for “${device.name}”. Turn the load ON when the baseline is stable. It will capture five fresh Shelly readings, save #5, and end automatically. There is a 5-second minimum. Continue?` : `Automatic training for “${device.name}”. EnergyIQ will establish the baseline, turn the load ON, capture five fresh Shelly readings, save #5 only, then end automatically. Continue?`;
        if (!window.confirm(message)) return;
        try {
          if (retrain && device.training?.status === "complete") await this.ws({ type: "energy_attribution/retry_training", entry_id: this.entryId, device_id: device.device_id });
          else await this.ws({ type: "energy_attribution/start_training", entry_id: this.entryId, device_id: device.device_id, method });
          await this.refresh(true);
        } catch (error) { this.showToast(error?.message || "Unable to start training", true); }
      }

      bindTrainingWorkspace() { this.querySelector("[data-training-close]")?.addEventListener("click", () => this.closeTrainingWorkspace()); this.querySelector("#training-method")?.addEventListener("change", () => this.renderTrainingDetailInPlace()); this.querySelector("[data-training-start]")?.addEventListener("click", () => this.startWorkspaceTraining()); this.querySelector("[data-training-retrain]")?.addEventListener("click", () => this.startWorkspaceTraining(true)); this.querySelector("[data-training-stop]")?.addEventListener("click", () => this.stopWorkspaceTraining()); }
      styles() { return `${super.styles()} .summary{grid-template-columns:repeat(7,minmax(100px,1fr))}.five-readings{margin-top:12px;padding:10px;border:1px solid var(--divider-color);border-radius:9px}.reading-slots{display:grid;grid-template-columns:repeat(5,1fr);gap:7px}.reading-slot{border:1px solid var(--divider-color);border-radius:7px;padding:7px;text-align:center;opacity:.55}.reading-slot.filled{opacity:1}.reading-slot span{display:block;font-size:10px;color:var(--secondary-text-color)}.reading-slot strong{display:block;font-size:15px;margin-top:2px}.training-lock{display:block;padding:10px;border:1px solid var(--divider-color);border-radius:8px;color:var(--secondary-text-color);font-size:12px}.training-dot.trained{background:#9be56f !important}.train:checked{accent-color:#9be56f}@media(max-width:1100px){.summary{grid-template-columns:repeat(3,1fr)}}@media(max-width:700px){.summary{grid-template-columns:repeat(2,1fr)}}`; }
    }
    customElements.define(TAG, EnergyIQTrainingPanel); return true;
  };
  if (!define()) { const script = document.createElement("script"); script.src = BASE_URL; script.onload = define; document.head.appendChild(script); }
})();