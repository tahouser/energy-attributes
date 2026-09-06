const TAG = "energy-attribution-panel-v10";
if (!customElements.get(TAG)) {
  class EnergyAttributionPanel extends HTMLElement {
    set hass(hass) { this._hass = hass; if (!this._loaded) this._load(); }
    connectedCallback() { this._renderLoading(); if (this._hass) this._load(); }
    disconnectedCallback() { if (this._timer) clearInterval(this._timer); }
    _renderLoading() { this.innerHTML = `<ha-card style="display:block;padding:24px"><h2>Energy Attribution</h2><p>Loading workspace…</p></ha-card>`; }
    async _load() {
      if (this._loading) return; this._loading = true;
      try {
        const r = await this._hass.callWS({type:"energy_attribution/list_entries"});
        if (!r.entries.length) throw new Error("Energy Attribution is not configured.");
        this.entryId = r.entries[0].entry_id;
        await this._refresh();
        this._loaded = true;
        this._timer = setInterval(() => this._refresh(), 1000);
      } catch (e) { this.innerHTML = `<ha-card style="display:block;padding:24px"><h2>Energy Attribution</h2><p style="color:var(--error-color)">${this._esc(e.message || e)}</p></ha-card>`; }
      finally { this._loading = false; }
    }
    async _refresh() {
      if (!this._hass || !this.entryId) return;
      try { this.data = await this._hass.callWS({type:"energy_attribution/workspace",entry_id:this.entryId}); this._render(); } catch(e) { console.error(e); }
    }
    async _save() {
      const ids=[...this.querySelectorAll('input[data-device]:checked')].map(x=>x.dataset.device);
      await this._hass.callWS({type:"energy_attribution/set_monitoring",entry_id:this.entryId,device_ids:ids});
      await this._refresh();
    }
    async _train(id, method) {
      this._closedResult=false;
      const d=this.data.devices.find(x=>x.device_id===id); if(!d) return;
      if(method==='quick') {
        const ok=confirm(`Energy Attribution will automatically turn “${d.name}” ON and OFF during training. Make sure it is safe to operate. Continue?`);
        if(!ok) return;
      }
      await this._hass.callWS({type:"energy_attribution/start_training",entry_id:this.entryId,device_id:id,method});
      await this._refresh();
    }
    async _retry(id) {
      this._closedResult=false; await this._hass.callWS({type:"energy_attribution/retry_training",entry_id:this.entryId,device_id:id}); await this._refresh(); }
    async _stop(id) { await this._hass.callWS({type:"energy_attribution/stop_training",entry_id:this.entryId,device_id:id}); await this._refresh(); }
    _render() {
      const d=this.data; const active=d.devices.find(x=>x.training?.status==='active');
      let html=`<style>ha-card{display:block;margin:16px;padding:20px}button{margin:4px;padding:8px 12px}table{width:100%;border-collapse:collapse}td,th{padding:8px;border-bottom:1px solid var(--divider-color);text-align:left}.muted{color:var(--secondary-text-color)}.complete{padding:16px;border:1px solid var(--primary-color);border-radius:8px;margin-top:16px}</style><ha-card><h1>Energy Attribution</h1><p class="muted">Whole-home power: <b>${this._esc(d.whole_home_power ?? '—')} W</b></p><h2>Commissioned loads</h2><p>Monitor any candidates you want the attribution system to learn. Ignored devices remain available later.</p><table><tr><th>Monitor</th><th>Device</th><th>Area</th><th>Evidence</th><th>Training</th></tr>`;
      for(const x of d.devices){ const t=x.training||{}; let action=''; if(x.classification==='monitor'){ if(t.status==='active') action=`<span>${this._phaseText(t)}</span> <button data-stop="${x.device_id}">Stop</button>`; else if(t.status==='complete') action=`<button data-retry="${x.device_id}">Retrain</button>`; else action=`<button data-quick="${x.device_id}">Quick ON/OFF</button> <button data-full="${x.device_id}">Full Cycle</button>`; } html+=`<tr><td><input type="checkbox" data-device="${x.device_id}" ${x.classification==='monitor'?'checked':''}></td><td><b>${this._esc(x.name)}</b><br><span class="muted">${this._esc(x.model||'')}</span></td><td>${this._esc(x.area||'')}</td><td>${this._esc(x.evidence||'')}</td><td>${action}</td></tr>`; }
      html+=`</table><button id="save">Save monitoring selections</button>`;
      if(active){ const t=active.training; html+=`<div class="complete"><h2>${t.status==='complete'?'Training Complete':'Training in progress'}</h2><p><b>${this._esc(active.name)}</b></p><p>${this._esc(this._phaseText(t))}</p>${t.baseline_w!=null?`<p>Baseline: <b>${Number(t.baseline_w).toFixed(0)} W</b></p>`:''}${t.peak_delta_w!=null?`<p>Detected load: <b>${Number(t.peak_delta_w).toFixed(0)} W</b></p>`:''}${t.duration_s!=null?`<p>Duration: <b>${this._duration(t.duration_s)}</b></p>`:''}${t.energy_wh!=null&&t.energy_wh>0?`<p>Additional energy: <b>${(t.energy_wh/1000).toFixed(2)} kWh</b></p>`:''}${t.status==='complete' && !this._closedResult?`<p><button id="close-result">CLOSE</button></p>`:''}</div>`; }
      this.innerHTML=html+`</ha-card>`;
      this.querySelector('#save')?.addEventListener('click',()=>this._save());
      this.querySelectorAll('[data-quick]').forEach(b=>b.onclick=()=>this._train(b.dataset.quick,'quick'));
      this.querySelectorAll('[data-full]').forEach(b=>b.onclick=()=>this._train(b.dataset.full,'full_cycle'));
      this.querySelectorAll('[data-retry]').forEach(b=>b.onclick=()=>this._retry(b.dataset.retry));
      this.querySelectorAll('[data-stop]').forEach(b=>b.onclick=()=>this._stop(b.dataset.stop));
      this.querySelector('#close-result')?.addEventListener('click',()=>{this._closedResult=true;this._render();});
    }
    _phaseText(t){const map={baseline:'Establishing the normal background load…',waiting_for_on:'Baseline established. Preparing the automatic ON test…',on_stabilizing:'Power change detected. Measuring and stabilizing…',waiting_for_off:'ON measurement captured. Turning the device OFF…',waiting_for_start:'Baseline established. Start the appliance now. Monitoring will continue in the background.',capturing:'Cycle detected. Monitoring the complete cycle…',complete:'Training Complete. Review the measured signature, then close this result.'};return t.instruction||map[t.phase]||t.phase||'Waiting…';}
    _duration(s){const n=Math.round(s);if(n<60)return `${n}s`;if(n<3600)return `${Math.floor(n/60)}m ${n%60}s`;return `${Math.floor(n/3600)}h ${Math.floor((n%3600)/60)}m`;}
    _esc(v){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  }
  customElements.define(TAG, EnergyAttributionPanel);
}
