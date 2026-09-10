/* EnergyIQ diagnostic layer. Presentation-only mobile touch and entity ownership diagnostics. */
(() => {
  const TAG = "energyiq-panel-v209";
  const install = () => {
    const panel = document.querySelector(TAG);
    if (!panel || panel.__energyIqDiagInstalled) return;
    panel.__energyIqDiagInstalled = true;
    const mobileTouchFix = document.createElement("style");
    mobileTouchFix.id = "energyiq-mobile-touch-fix";
    mobileTouchFix.textContent = `${TAG} .table-wrap { touch-action: auto !important; } ${TAG} .table-wrap input.monitor-box, ${TAG} .table-wrap input.train-box { touch-action: manipulation !important; }`;
    document.head.appendChild(mobileTouchFix);
    const esc = (v) => String(v ?? "").replace(/[&<>\"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
    const show = async () => {
      const modal=panel.querySelector("#add-modal"),choice=modal?.querySelector("#entity-choice"),ownership=modal?.querySelector("#entity-ownership");
      if(!modal||!choice||!ownership||!choice.value||!panel.entryId)return;
      const entities=panel.__energyIqEntities||[],selected=entities.find(e=>e.entity_id===choice.value); if(!selected)return;
      try { const workspace=await panel._ws({type:"energy_attribution/workspace",entry_id:panel.entryId}),match=(selected.candidate_matches||[])[0],row=match?(workspace.devices||[]).find(d=>d.device_id===match.device_id):null,monitoredRows=(workspace.devices||[]).filter(d=>d.classification==="monitor"),sameName=match?(workspace.devices||[]).filter(d=>d.name===match.name):[],status=row?`Workspace candidate: <b>YES</b> · Monitor list membership: <b>${row.classification==="monitor"?"YES":"NO"}</b>`:`Workspace candidate: <b>NO</b> · Monitor list membership: <b>NO</b>`; ownership.innerHTML=`${ownership.innerHTML||""}<br><span style="display:block;margin-top:6px;padding:7px;border:1px solid var(--divider-color);border-radius:6px">${status}<br><span class="note">Workspace rows: ${workspace.devices?.length??0} · monitored rows: ${monitoredRows.length} · matching-name rows: ${sameName.length}</span></span>`;
      } catch(err){ownership.innerHTML=`${ownership.innerHTML||""}<br><span style="color:var(--error-color)">Diagnostic failed: ${esc(err.message||err)}</span>`;}
    };
    const wire=()=>{const modal=panel.querySelector("#add-modal"),choice=modal?.querySelector("#entity-choice");if(!choice||choice.__energyIqDiagWired)return;choice.__energyIqDiagWired=true;choice.addEventListener("change",show);show();};
    const originalWs=panel._ws.bind(panel);panel._ws=async msg=>{const result=await originalWs(msg);if(msg?.type==="energy_attribution/list_available_entities")panel.__energyIqEntities=result.entities||[];return result;};
    const observer=new MutationObserver(()=>wire());observer.observe(panel,{childList:true,subtree:true});wire();
  };
  const timer=setInterval(()=>{const panel=document.querySelector(TAG);if(panel){clearInterval(timer);install();}},250);
})();
