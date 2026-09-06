const TAG = "energy-attribution-panel-v13";
if (!customElements.get(TAG)) {
  class EnergyAttributionPanel extends HTMLElement {
    set hass(hass) { this._hass = hass; if (!this._loaded && !this._loading) this._load(); }
    connectedCallback() { this._renderLoading(); if (this._hass && !this._loaded) this._load(); }
    disconnectedCallback() { if (this._timer) clearInterval(this._timer); }
    _renderLoading() { this.innerHTML = `<ha-card style="display:block;padding:24px"><h2>Energy Attribution</h2><p>Loading workspace…</p></ha-card>`; }
    _ws(message) {
      if (!this._hass?.connection?.sendMessagePromise) throw new Error("Home Assistant WebSocket connection is not ready.");
      return this._hass.connection.sendMessagePromise(message);
    }
    async _load() {
      if (this._loading) return; this._loading = true;
      try {
        const r = await this._ws({type:"energy_attribution/list_entries"});
        if (!r.entries.length) throw new Error("Energy Attribution is not configured.");
        this.entryId = r.entries[0].entry_id;
        await this._refresh();
        this._loaded = true;
        this._timer = setInterval(() => this._refresh(), 1000);
      } catch (e) {
        this.innerHTML = `<ha-card style="display:block;padding:24px"><h2>Energy Attribution</h2><p style="color:var(--error-color)">${this._esc(e.message || e)}</p></ha-card>`;
      } finally { this._loading = false; }
    }
    async _refresh() {
      if (!this._hass || !this.entryId) return;
      try { this.data = await this._ws({type:"energy_attribution/workspace",entry_id:this.entryId}); this._render(); } catch(e) { console.error(e); }
    }
    async _save() {
      const ids=[...this.querySelectorAll('input[data-device]:checked')].map(x=>x.dataset.device);
      await this._ws({type:"energy_attribution/set_monitoring",entry_id:this.entryId,device_ids:ids});
      await this._refresh();
    }
    async _train(id, method) {
      this._closedResult=false;
      const d=this.data.devices.find(x=>x.device_id===id); if(!d) return;
      if(method==='quick') {
        const ok=confirm(`Energy Attribution will automatically turn “${d.name}” ON and OFF during training. Make sure it is safe to operate. Continue?`);
        if(!ok) return;
      }
      await this._ws({type:"energy_attribution/start_training",entry_id:this.entryId,device_id:id,method});
      await this._refresh();
    }
    async _retry(id) { this._closedResult=false; await this._ws({type:"energy_attribution/retry_training",entry_id:this.entryId,device_id:id}); await this._refresh(); }
    async _stop(id) { await this._ws({type:"energy_attribution/stop_training",entry_id:this.entryId,device_id:id}); await this._refresh(); }
    _status(t) {
      if (!t || !t.status) return {label:"Not trained", cls:"nottrained", icon:"☐"};
      if (t.status === "complete" && t.learned) return {label:"Complete", cls:"complete-status", icon:"☑"};
      if (t.status === "active") return {label:"In progress", cls:"progress", icon:"◐"};
      if (t.status === "interrupted") return {label:"Interrupted", cls:"error-status", icon:"⚠"};
      if (t.status === "error") return {label:"Not complete", cls:"error-status", icon:"☐"};
      if (t.status === "stopped") return {label:"Not complete", cls:"error-status", icon:"☐"};
      return {label:"Not trained", cls:"nottrained", icon:"☐"};
    }
    _render() {
      const d=this.data;
      const devices=d.devices || [];
      const monitored=devices.filter(x=>x.classification==='monitor');
      const trained=devices.filter(x=>x.training?.status==='complete' && (x.training?.learned || x.training?.completed));
      const active=devices.find(x=>x.training?.status==='active');
      const lastId=d.last_training_device_id;
      const resultDevice=lastId ? devices.find(x=>x.device_id===lastId) : devices.find(x=>x.training && ["complete","error","interrupted","stopped"].includes(x.training.status) && x.training.device_id);
      let html=`<style>
      ha-card{display:block;margin:0;padding:16px} @media (max-width:600px){ha-card{padding:12px}h1{font-size:1.5rem}h2{font-size:1.2rem}.summary{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.tile{min-width:0;padding:10px}.tile strong{font-size:20px}table{display:block;overflow-x:auto;white-space:nowrap;font-size:13px}td,th{padding:7px 6px}.training-box,.complete-box,.failure-box{padding:12px}button{min-height:40px;margin:3px 2px}}button{margin:4px;padding:8px 12px;cursor:pointer}table{width:100%;border-collapse:collapse}td,th{padding:9px 8px;border-bottom:1px solid var(--divider-color);text-align:left}.muted{color:var(--secondary-text-color)}
      .status{font-weight:600}.complete-status{color:var(--success-color,var(--primary-color))}.progress{color:var(--primary-color)}.error-status{color:var(--error-color)}.nottrained{color:var(--secondary-text-color)}
      .summary{display:flex;gap:12px;flex-wrap:wrap}.tile{padding:12px;border:1px solid var(--divider-color);border-radius:8px;min-width:155px}.tile strong{font-size:24px}.training-box{padding:18px;border:2px solid var(--primary-color);border-radius:10px;margin-top:18px}.complete-box{padding:18px;border:2px solid var(--success-color,var(--primary-color));border-radius:10px;margin-top:18px}.failure-box{padding:18px;border:2px solid var(--error-color);border-radius:10px;margin-top:18px}
      </style><ha-card><h1>Energy Attribution</h1>
      <p class="muted">Whole-home power: <b>${this._esc(d.whole_home_power ?? '—')} W</b></p>
      <h2>Commissioning Progress</h2>
      <div class="summary">
        <div class="tile"><div class="muted">Monitored</div><strong>${monitored.length}</strong></div>
        <div class="tile"><div class="muted">Training complete</div><strong>${trained.length} / ${monitored.length}</strong></div>
        <div class="tile"><div class="muted">Remaining</div><strong>${Math.max(0,monitored.length-trained.length)}</strong></div>
      </div>
      <h2>Commissioned Loads</h2><p>☑ Monitor means the load is included in attribution. <b>Training Complete</b> means a usable signature has actually been saved.</p>
      <table><tr><th>Monitor</th><th>Device</th><th>Area</th><th>Evidence</th><th>Training Status</th><th>Action</th></tr>`;
      for(const x of devices){
        const t=x.training||{}; const st=this._status(t); let action='';
        if(x.classification==='monitor') {
          if(t.status==='active') action=`<span>${this._esc(this._phaseText(t))}</span> <button data-stop="${this._esc(x.device_id)}">Stop</button>`;
          else if(t.status==='complete' && t.learned) action=`<button data-retry="${this._esc(x.device_id)}">Train Again</button>`;
          else action=`<button data-quick="${this._esc(x.device_id)}">Quick ON/OFF</button> <button data-full="${this._esc(x.device_id)}">Full Cycle</button>`;
        }
        html+=`<tr><td><input type="checkbox" data-device="${this._esc(x.device_id)}" ${x.classification==='monitor'?'checked':''}></td><td><b>${this._esc(x.name)}</b><br><span class="muted">${this._esc(x.model||'')}</span></td><td>${this._esc(x.area||'')}</td><td>${this._esc(x.evidence||'')}</td><td class="status ${st.cls}">${st.icon} ${st.label}</td><td>${action}</td></tr>`;
      }
      html+=`</table><button id="save">Save monitoring selections</button>`;
      if(active) {
        const t=active.training;
        html+=`<div class="training-box"><h2>Training in progress</h2><h3>${this._esc(active.name)}</h3><p>${this._esc(this._phaseText(t))}</p>${t.method==='quick'&&t.cycles_required?`<p>Cycle: <b>${t.cycles_completed||0} of ${t.cycles_required}</b></p>`:''}${t.baseline_w!=null?`<p>Baseline: <b>${Number(t.baseline_w).toFixed(0)} W</b></p>`:''}${t.peak_delta_w!=null?`<p>Detected load: <b>${Number(t.peak_delta_w).toFixed(0)} W</b></p>`:''}${t.duration_s!=null?`<p>Duration: <b>${this._duration(t.duration_s)}</b></p>`:''}<button data-stop="${this._esc(active.device_id)}">Stop</button></div>`;
      }
      if(!active && resultDevice) {
        const t=resultDevice.training; const complete=t.status==='complete' && (t.learned || t.completed);
        if(complete && !this._closedResult) {
          html+=`<div class="complete-box"><h2>Training Complete</h2><h3>${this._esc(resultDevice.name)}</h3><p>☑ <b>Training complete — signature saved</b></p>${t.method?`<p>Method: ${this._esc(t.method==='quick'?'Quick ON/OFF':'Full Cycle')}</p>`:''}${t.peak_delta_w!=null?`<p>Measured load: <b>${Number(t.peak_delta_w).toFixed(0)} W</b></p>`:''}${t.baseline_w!=null?`<p>Baseline: <b>${Number(t.baseline_w).toFixed(0)} W</b></p>`:''}${t.duration_s!=null?`<p>Duration: <b>${this._duration(t.duration_s)}</b></p>`:''}${t.energy_wh!=null&&t.energy_wh>0?`<p>Additional energy: <b>${(t.energy_wh/1000).toFixed(2)} kWh</b></p>`:''}<button id="close-result">CLOSE</button></div>`;
        } else if(!complete && t.status!=='stopped') {
          html+=`<div class="failure-box"><h2>Training Not Complete</h2><h3>${this._esc(resultDevice.name)}</h3><p>${this._esc(t.error || t.instruction || 'A reliable signature was not captured.')}</p><button data-retry="${this._esc(resultDevice.device_id)}">RETRY</button> <button id="dismiss-result">CLOSE</button></div>`;
        }
      }
      html+=`</ha-card>`; this.innerHTML=html;
      this.querySelector('#save')?.addEventListener('click',()=>this._save());
      this.querySelectorAll('[data-quick]').forEach(b=>b.onclick=()=>this._train(b.dataset.quick,'quick'));
      this.querySelectorAll('[data-full]').forEach(b=>b.onclick=()=>this._train(b.dataset.full,'full_cycle'));
      this.querySelectorAll('[data-retry]').forEach(b=>b.onclick=()=>this._retry(b.dataset.retry));
      this.querySelectorAll('[data-stop]').forEach(b=>b.onclick=()=>this._stop(b.dataset.stop));
      this.querySelector('#close-result')?.addEventListener('click',()=>{this._closedResult=true;this._render();});
      this.querySelector('#dismiss-result')?.addEventListener('click',()=>{this._closedResult=true;this._render();});
    }
    _phaseText(t){const map={baseline:'Establishing the normal background load…',request_on:'Baseline established. Starting test cycle…',waiting_for_on:'Device is ON. Measuring the power increase…',request_off:'Power increase captured. Turning the device OFF…',waiting_for_off:'Device is OFF. Confirming the return to normal power…',cooldown:'Cycle complete. Preparing the next cycle…',waiting_for_start:'Baseline established. Start the appliance now. Monitoring will continue in the background.',capturing:'Cycle detected. Monitoring the complete cycle…',complete:'Training Complete. Review the measured signature, then close this result.',timeout:'Training timed out.'};return t.instruction||map[t.phase]||t.phase||'Waiting…';}
    _duration(s){const n=Math.round(s);if(n<60)return `${n}s`;if(n<3600)return `${Math.floor(n/60)}m ${n%60}s`;return `${Math.floor(n/3600)}h ${Math.floor((n%3600)/60)}m`;}
    _esc(v){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  }
  customElements.define(TAG, EnergyAttributionPanel);
}
