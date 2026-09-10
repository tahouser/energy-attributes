/* EnergyIQ v2.2.5 clean static loader. */
(async () => {
  const VERSION = "2.2.5";
  const TAG = "energyiq-panel-v225";
  const load = async path => {
    try { await import(`${path}?v=225`); return true; }
    catch (error) {
      console.error(`EnergyIQ frontend layer failed: ${path}`, error);
      const panel = document.querySelector(TAG);
      if (panel) panel.innerHTML = `<ha-card style="display:block;padding:24px"><h2>EnergyIQ</h2><p style="color:var(--error-color)">EnergyIQ frontend failed to load: ${String(error?.message || error).replace(/[<>&]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]))}</p></ha-card>`;
      return false;
    }
  };
  if (!await load("./energyiq-panel-v225.js")) return;
  const Panel = customElements.get(TAG);
  if (!Panel) return;
  Panel.prototype._ws = function(message) {
    const hass=this._hass;
    if (hass?.callWS) return Promise.race([hass.callWS(message),new Promise((_,reject)=>setTimeout(()=>reject(new Error(`EnergyIQ WebSocket timeout: ${message?.type||"unknown command"}`)),10000))]);
    if (hass?.connection?.sendMessagePromise) return hass.connection.sendMessagePromise(message);
    throw new Error("EnergyIQ: Home Assistant WebSocket API is not available.");
  };
  await load("./energyiq-diagnostic.js");
  await load("./energyiq-long-cycle-v225.js");
  await load("./energyiq-clean-v225.js");
  const setVersion=()=>{const p=document.querySelector(TAG),s=p?.querySelector?.(".sub");if(s)s.textContent=`Whole-home electrical intelligence · v${VERSION}`;};
  [0,100,500,1500,3000,5000].forEach(ms=>setTimeout(setVersion,ms));
})();
