/* EnergyIQ accounting + mobile monitoring UX extension. */
(() => {
  const TAG = "energy-attribution-panel-v35";
  const install = () => {
    const panel = document.querySelector(TAG);
    if (!panel || panel.__energyIqAccountingInstalled) return;
    panel.__energyIqAccountingInstalled = true;

    const originalRender = panel._render.bind(panel);
    const originalSave = panel._save.bind(panel);
    const committedIds = () => new Set((panel.data?.devices || []).filter(x => x.classification === "monitor").map(x => x.device_id));
    const fetchAccounting = () => panel._ws({type:"energy_attribution/accounting_state",entry_id:panel.entryId});
    const updateAccounting = async () => {
      try {
        panel._accounting = await fetchAccounting();
        const home = panel.data?.whole_home_power;
        const trained = panel.data?.trained_live_power_w;
        panel._accounting.unaccounted_now_w = home != null ? Math.max(0, Number(home) - Number(trained || 0)) : null;
      } catch (err) { console.warn("EnergyIQ accounting extension failed", err); }
    };

    // The base panel refreshes once per second for live power. Do not rebuild
    // the table on every refresh: replacing the table DOM interrupts mobile
    // scrolling, especially after an inertial scroll comes to rest. Re-render
    // only when the table does not exist or when a committed Save requires it.
    panel._refresh = async () => {
      if (!panel._hass || !panel.entryId) return;
      try {
        panel.data = await panel._ws({type:"energy_attribution/workspace",entry_id:panel.entryId});
        panel.bulk = await panel._ws({type:"energy_attribution/bulk_training_state",entry_id:panel.entryId});
        await updateAccounting();
        const needsRender = panel._energyIqForceRender || !panel.querySelector(".table-wrap");
        panel._energyIqForceRender = false;
        if (!panel.querySelector("#add-modal") && !panel._pendingSelections && needsRender) originalRender();
        restoreCheckboxes();
        patchDashboard();
      } catch (e) { console.error(e); }
    };

    panel._save = async () => {
      panel._energyIqForceRender = true;
      await originalSave();
      await updateAccounting();
      patchDashboard();
    };

    panel._render = () => { originalRender(); restoreCheckboxes(); patchDashboard(); };
    const restoreCheckboxes = () => {
      const pending = panel._pendingSelections;
      if (!pending) return;
      panel.querySelectorAll('input[data-device]').forEach(box => { box.checked = pending.has(box.dataset.device); });
    };

    panel.addEventListener("change", event => {
      const box = event.target?.closest?.('input[data-device]');
      if (!box) return;
      event.stopImmediatePropagation();
      if (!panel._pendingSelections) panel._pendingSelections = committedIds();
      if (box.checked) panel._pendingSelections.add(box.dataset.device); else panel._pendingSelections.delete(box.dataset.device);
      box.checked = panel._pendingSelections.has(box.dataset.device);
    }, true);

    // Mobile scrolling: keep the table as a horizontal scroll surface only.
    // Vertical scrolling must remain with the Home Assistant page. A nested
    // vertical overflow container caused iOS to lose subsequent swipe gestures
    // after momentum scrolling stopped.
    const style = document.createElement("style");
    style.textContent = `${TAG} .table-wrap { touch-action: pan-x pan-y !important; overflow-x:auto !important; overflow-y:visible !important; max-height:none !important; -webkit-overflow-scrolling:auto !important; } ${TAG} .monitor-box { touch-action:manipulation; }`;
    document.head.appendChild(style);

    function patchDashboard() {
      const a = panel._accounting;
      if (!a) return;
      const tiles = panel.querySelectorAll(".dash .tile");
      if (tiles.length >= 3) { const strong = tiles[2].querySelector("strong"); if (strong) strong.textContent = a.mystery_w != null ? `${Number(a.mystery_w).toFixed(0)} W` : "—"; }
      const dash = panel.querySelector(".dash"); if (!dash) return;
      let unaccounted = dash.querySelector('[data-energyiq-tile="unaccounted"]');
      let coverage = dash.querySelector('[data-energyiq-tile="coverage"]');
      if (!unaccounted) { unaccounted=makeTile("Unaccounted now","—","Current whole-home power not attributed to trained active loads"); unaccounted.dataset.energyiqTile="unaccounted"; dash.append(unaccounted); }
      if (!coverage) { coverage=makeTile("Training coverage","—","Learned load capacity ÷ reference maximum"); coverage.dataset.energyiqTile="coverage"; dash.append(coverage); }
      unaccounted.querySelector("strong").textContent = a.unaccounted_now_w != null ? `${Number(a.unaccounted_now_w).toFixed(0)} W` : "—";
      coverage.querySelector("strong").textContent = a.training_coverage_pct != null ? `${Number(a.training_coverage_pct).toFixed(1)}%` : "—";
      patchReferenceControl();
    }
    function makeTile(label,value,note) { const tile=document.createElement("div"); tile.className="tile"; const l=document.createElement("div"); l.className="label"; l.textContent=label; const s=document.createElement("strong"); s.textContent=value; tile.append(l,s); if(note){const n=document.createElement("div");n.className="tile-note";n.textContent=note;tile.append(n);} return tile; }
    function patchReferenceControl() {
      const actions=panel.querySelector(".actions"); if(!actions)return;
      let wrap=actions.querySelector("[data-energyiq-reference]");
      if(!wrap){
        wrap=document.createElement("span"); wrap.dataset.energyiqReference="true"; wrap.style.cssText="display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap";
        const label=document.createElement("span"); label.className="note"; label.textContent="Reference max (W):";
        const input=document.createElement("input"); input.type="number"; input.min="1"; input.step="10"; input.inputMode="numeric"; input.style.cssText="width:105px;box-sizing:border-box;padding:7px";
        const save=document.createElement("button"); save.type="button"; save.textContent="Set reference"; save.className="primary";
        const observed=document.createElement("button"); observed.type="button"; observed.textContent="Use observed peak";
        save.onclick=async()=>{const value=Number(input.value);if(!Number.isFinite(value)||value<=0){alert("Enter a reference maximum greater than 0 W.");return;}try{await panel._ws({type:"energy_attribution/set_reference_max",entry_id:panel.entryId,reference_max_w:value});await updateAccounting();patchDashboard();}catch(e){alert(`EnergyIQ could not save the reference maximum: ${e.message||e}`);}};
        observed.onclick=()=>{if(panel._accounting?.observed_peak_w!=null)input.value=Math.round(panel._accounting.observed_peak_w);};
        wrap.append(label,input,save,observed); actions.append(wrap);
      }
      const input=wrap.querySelector("input"); if(input&&document.activeElement!==input&&panel._accounting?.reference_max_w!=null)input.value=Math.round(panel._accounting.reference_max_w);
    }
    updateAccounting().then(patchDashboard);
  };
  const timer=setInterval(()=>{const panel=document.querySelector(TAG);if(panel){clearInterval(timer);install();}},250);
})();
