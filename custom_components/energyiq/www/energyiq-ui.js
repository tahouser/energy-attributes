/* EnergyIQ stable monitoring/state UI extension. */
(() => {
  const TAG = "energyiq-panel";
  const install = () => {
    const Panel = customElements.get(TAG);
    if (!Panel?.prototype) return false;
    const proto = Panel.prototype;
    if (proto.__energyiqCleanStable) return false;
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
      if (stateIndex < 0) {
        stateIndex = Math.min(5, currentHeaders.length);
        const th = document.createElement("th");
        th.textContent = "State";
        headerRow.insertBefore(th, headerRow.children[stateIndex] || null);
        for (const row of rows.slice(1)) {
          const td = document.createElement("td");
          row.insertBefore(td, row.children[stateIndex] || null);
        }
      } else {
        currentHeaders[stateIndex].textContent = "State";
        if (stateIndex !== 5) {
          for (const row of rows) {
            const cell = row.children[stateIndex];
            if (cell) row.insertBefore(cell, row.children[5] || null);
          }
          stateIndex = 5;
        }
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
        cell.innerHTML = state === "on" ? '<span class="energyiq-state energyiq-state-on">ON</span>' : state === "off" ? '<span class="energyiq-state energyiq-state-off">OFF</span>' : '<span class="energyiq-state energyiq-state-unknown">—</span>';
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
    const style = document.createElement("style");
    style.textContent = `
      .energyiq-state{display:inline-flex;align-items:center;justify-content:center;width:44px;height:22px;box-sizing:border-box;border-radius:3px;font-size:11px;font-weight:700;line-height:1;color:#fff;text-align:center;}
      .energyiq-state-on{background:#2e9d50;}
      .energyiq-state-off{background:#d13b3b;}
      .energyiq-state-unknown{background:var(--secondary-text-color);}
    `;
    document.head.appendChild(style);
    const tick=()=>document.querySelectorAll(TAG).forEach(normalizeStateColumn);
    setInterval(tick,500);
    return true;
  };
  if (!install()) { const timer=setInterval(()=>{if(install())clearInterval(timer);},50); }
})();
