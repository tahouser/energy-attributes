/* EnergyIQ stable monitoring/state UI extension. */
(() => {
  const TAG = "energyiq-panel";
  const install = () => {
    const Panel = customElements.get(TAG);
    if (!Panel?.prototype) return false;
    const proto = Panel.prototype;
    if (proto.__energyiqCleanStable) return true;
    proto.__energyiqCleanStable = true;
    const devices = panel => panel?.data?.devices || [];
    const deviceForBox = (panel, box) => {
      const id = box?.dataset?.deviceId || box?.dataset?.device || box?.dataset?.id || box?.dataset?.monitor;
      return id == null ? null : devices(panel).find(d => String(d.device_id) === String(id)) || null;
    };
    const normalizeStateColumn = panel => {
      const table = panel.querySelector(".table-wrap table");
      if (!table) return;
      const headerRow = table.querySelector("tr");
      if (!headerRow) return;
      const rows = [...table.querySelectorAll("tr")];
      const headers = [...headerRow.children];
      for (const index of headers.map((h,i)=>(h.textContent||"").trim().toLowerCase()==="state"?i:-1).filter(i=>i>=0).sort((a,b)=>b-a)) {
        for (const row of rows) if (row.children[index]) row.removeChild(row.children[index]);
      }
      const currentHeaders = [...headerRow.children];
      let stateIndex = currentHeaders.findIndex(h=>(h.textContent||"").trim().toLowerCase()==="status");
      if (stateIndex < 0) return;
      currentHeaders[stateIndex].textContent = "State";
      if (stateIndex !== 5) {
        for (const row of rows) {
          const cell = row.children[stateIndex];
          if (cell) row.insertBefore(cell, row.children[5] || null);
        }
        stateIndex = 5;
      }
      for (const row of rows.slice(1)) {
        const cell = row.children[stateIndex];
        if (!cell) continue;
        const d = deviceForBox(panel, row.querySelector("input.monitor-box"));
        let state = null;
        for (const item of (d?.controls || [])) {
          const s = item?.entity_id ? panel._hass?.states?.[item.entity_id]?.state : null;
          if (s === "on" || s === "off") { state = s; break; }
        }
        if (state == null) for (const item of (d?.measurements || [])) {
          const n = Number(item?.entity_id ? panel._hass?.states?.[item.entity_id]?.state : NaN);
          if (Number.isFinite(n)) { state = n > 0 ? "on" : "off"; break; }
        }
        cell.textContent = state === "on" ? "ON" : state === "off" ? "OFF" : "—";
        cell.style.fontWeight = "600";
        cell.style.whiteSpace = "nowrap";
        cell.style.color = state === "on" ? "var(--success-color,#2e7d32)" : state === "off" ? "var(--error-color,#c62828)" : "var(--secondary-text-color)";
      }
    };
    const originalRender = proto._render;
    proto._render = function(...args) {
      const wrap = this.querySelector(".table-wrap");
      const scroll = wrap?.scrollLeft || 0;
      const result = originalRender.apply(this,args);
      normalizeStateColumn(this);
      requestAnimationFrame(()=>{const w=this.querySelector(".table-wrap");if(w)w.scrollLeft=scroll;});
      return result;
    };
    const originalSave = proto._save;
    proto._save = async function(...args) {
      const b=this.querySelector("#save"); if(b){b.disabled=true;b.textContent="Saving…";}
      try { await originalSave.apply(this,args); const x=this.querySelector("#save"); if(x){x.disabled=true;x.textContent="✓ Saved";} setTimeout(()=>{const y=this.querySelector("#save");if(y){y.disabled=false;y.textContent="Save monitoring selections";}},2200); }
      catch(e){const x=this.querySelector("#save");if(x){x.disabled=false;x.textContent="Save monitoring selections";}this._showNotice?.("Save failed");throw e;}
    };
    const tick=()=>document.querySelectorAll(TAG).forEach(normalizeStateColumn);
    setInterval(tick,500);
    return true;
  };
  if (!install()) { const timer=setInterval(()=>{if(install())clearInterval(timer);},50); }
})();
