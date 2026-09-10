/* EnergyIQ supervised Long Cycle training UI. Loaded after the main panel. */
(async () => {
  const TAG = "energy-attribution-panel-v35";
  await customElements.whenDefined(TAG);
  const Panel = customElements.get(TAG);
  if (!Panel || Panel.prototype.__energyIQLongCyclePatched) return;
  Panel.prototype.__energyIQLongCyclePatched = true;

  const originalTrain = Panel.prototype._train;
  Panel.prototype._train = async function(id, method) {
    if (method !== "full_cycle") return originalTrain.call(this, id, method);
    const d = this.data?.devices?.find(x => x.device_id === id);
    if (!d) return;
    const message = `LONG CYCLE TRAINING — CONTROLLED ENVIRONMENT\n\n` +
      `This training captures the complete electrical signature of “${d.name}”.\n\n` +
      `Before continuing:\n` +
      `• Turn off or disable other significant electrical loads.\n` +
      `• Do not operate other appliances during training.\n` +
      `• The selected load must be the only significant load changing state.\n` +
      `• The training may take several minutes or longer.\n\n` +
      `EnergyIQ will monitor whole-home power throughout the cycle.\n\n` +
      `Continue only when the environment is controlled.`;
    if (!confirm(message)) return;
    this._closedResult = false;
    try {
      await this._ws({type:"energy_attribution/start_training", entry_id:this.entryId, device_id:id, method:"full_cycle"});
      await this._refresh();
      this._scrollTraining();
    } catch (e) {
      alert(`EnergyIQ could not start Long Cycle training: ${e.message || e}`);
      await this._refresh();
    }
  };

  const esc = s => String(s ?? "").replace(/[&<>\"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c]));

  function removeOverlay() {
    document.getElementById("energyiq-long-cycle-overlay")?.remove();
  }

  function renderOverlay(panel, device) {
    if (!device?.training || device.training.status !== "active" || device.training.method !== "full_cycle") {
      removeOverlay();
      return;
    }
    const t = device.training;
    let box = document.getElementById("energyiq-long-cycle-overlay");
    if (!box) {
      box = document.createElement("div");
      box.id = "energyiq-long-cycle-overlay";
      box.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;z-index:1100;padding:16px;box-sizing:border-box";
      document.body.appendChild(box);
    }
    const phase = t.phase || "baseline";
    const baseline = t.baseline_w == null ? "—" : `${Number(t.baseline_w).toFixed(0)} W`;
    const live = t.live_power_w == null ? "—" : `${Number(t.live_power_w).toFixed(0)} W`;
    const delta = t.live_delta_w == null ? "—" : `${Number(t.live_delta_w).toFixed(0)} W`;
    const duration = t.duration_s == null ? "—" : `${Math.max(0, Number(t.duration_s)).toFixed(0)} s`;

    if (phase === "awaiting_confirmation") {
      box.innerHTML = `<div style="width:min(520px,100%);padding:24px;border-radius:14px;background:var(--card-background-color);box-shadow:var(--ha-box-shadow,0 8px 30px rgba(0,0,0,.25))"><h2>Load detected</h2><p style="font-size:16px">EnergyIQ detected a significant electrical event.</p><p><b>Is this the ${esc(device.name)}?</b></p><p class="note">Only confirm if this event was caused by the selected equipment. If another load caused it, reject the event and wait for the correct load to begin.</p><div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap"><button id="lc-no">NO — WAIT FOR NEXT EVENT</button><button id="lc-yes" class="primary">YES — CONTINUE TRAINING</button></div></div>`;
      box.querySelector("#lc-no").onclick = async () => {
        await panel._ws({type:"energy_attribution/confirm_long_cycle",entry_id:panel.entryId,device_id:device.device_id,accepted:false});
        await panel._refresh();
      };
      box.querySelector("#lc-yes").onclick = async () => {
        await panel._ws({type:"energy_attribution/confirm_long_cycle",entry_id:panel.entryId,device_id:device.device_id,accepted:true});
        await panel._refresh();
      };
      return;
    }

    if (phase === "capturing") {
      box.innerHTML = `<div style="width:min(560px,100%);padding:24px;border-radius:14px;background:var(--card-background-color);box-shadow:var(--ha-box-shadow,0 8px 30px rgba(0,0,0,.25))"><h2>Training ${esc(device.name)}</h2><p style="font-size:16px"><b>● Recording complete load cycle</b></p><p>EnergyIQ is monitoring the entire electrical footprint, including startup, stages, cycling and shutdown.</p><p><b>Do not operate other significant electrical loads.</b></p><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:14px 0"><div><small>Baseline</small><br><b>${baseline}</b></div><div><small>Current</small><br><b>${live}</b></div><div><small>Delta</small><br><b>${delta}</b></div><div><small>Capture time</small><br><b>${duration}</b></div></div><p class="note">For HVAC, wait until the compressor/heater and the indoor fan have completely stopped before ending training.</p><button id="lc-end" class="primary" style="width:100%;padding:12px">END TRAINING</button></div>`;
      box.querySelector("#lc-end").onclick = async () => {
        try {
          const result = await panel._ws({type:"energy_attribution/end_long_cycle",entry_id:panel.entryId,device_id:device.device_id,force:false});
          if (result?.action === "end_warning") {
            const ok = confirm(`EnergyIQ does not see a clean completed cycle yet.\n\nCurrent power: ${live}\nBaseline: ${baseline}\n\nIf the equipment really has finished, choose OK to end training anyway. Otherwise choose Cancel and wait.`);
            if (!ok) return;
            await panel._ws({type:"energy_attribution/end_long_cycle",entry_id:panel.entryId,device_id:device.device_id,force:true});
          }
          await panel._refresh();
        } catch (e) { alert(`EnergyIQ could not end Long Cycle training: ${e.message || e}`); }
      };
    }
  }

  const originalRefresh = Panel.prototype._refresh;
  Panel.prototype._refresh = async function() {
    await originalRefresh.call(this);
    const active = this.data?.devices?.find(x => x.training?.status === "active" && x.training?.method === "full_cycle");
    renderOverlay(this, active);
  };
})();
