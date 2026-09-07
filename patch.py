from pathlib import Path
p=Path('/mnt/data/build1612/custom_components/energy_attribution/www/energy-attribution-panel.js')
s=p.read_text()
s=s.replace('const TAG = "energy-attribution-panel-v22";', 'const TAG = "energy-attribution-panel-v23";')
s=s.replace('class EnergyAttributionPanel extends HTMLElement {\n', 'class EnergyAttributionPanel extends HTMLElement {\n    constructor(){super();this._listMode="monitored";}\n')
s=s.replace('''<div class="actions"><button id="add-device" class="primary">＋ Add Device / Entity</button><button id="save" class="primary">Save monitoring selections</button></div>`;''', '''<div class="actions"><button id="add-device" class="primary">＋ Add Device / Entity</button><button id="save" class="primary">Save monitoring selections</button><span class="list-toggle" role="group" aria-label="Device list filter"><button id="show-monitored" class="toggle-btn">Monitored (${monitored.length})</button><button id="show-excluded" class="toggle-btn">Excluded (${devices.length-monitored.length})</button></span></div>`;''')
s=s.replace('''html+=`<div class="dashboard-section"><h2>Current Energy Dashboard</h2><p class="note">Home power and trained-device watts are live readings from HA power entities. Trained device watts is the sum of the current power readings for devices with a completed training signature; it does not use the learned training value from an earlier event.</p><div class="table-wrap"><table><tr><th>Monitor</th><th>Train</th><th>Device</th><th>Area</th><th>Source</th><th>Current Power</th><th>Status</th><th>Training Method</th><th>Action</th></tr>`;
      const ordered=[...devices].sort((a,b)=>{''', '''html+=`<div class="dashboard-section"><h2>Current Energy Dashboard</h2><p class="note">Home power and trained-device watts are live readings from HA power entities. Trained device watts is the sum of the current power readings for devices with a completed training signature; it does not use the learned training value from an earlier event.</p><div class="table-wrap"><table><tr><th>Monitor</th><th>Train</th><th>Device</th><th>Area</th><th>Source</th><th>Current Power</th><th>Status</th><th>Training Method</th><th>Action</th></tr>`;
      const selectedIds=this._pendingSelections||new Set(monitored.map(x=>x.device_id));
      const visibleDevices=devices.filter(x=>this._listMode==='excluded'?!selectedIds.has(x.device_id):selectedIds.has(x.device_id));
      const ordered=[...visibleDevices].sort((a,b)=>{''')
s=s.replace('''const t=x.training||{},st=this._status(t),isManual=String(x.source||'').toLowerCase()==='manual',isMonitored=this._pendingSelections?this._pendingSelections.has(x.device_id):x.classification==='monitor';''', '''const t=x.training||{},st=this._status(t),isManual=String(x.source||'').toLowerCase()==='manual',isMonitored=selectedIds.has(x.device_id);''')
s=s.replace('''this.querySelectorAll('input[data-device]').forEach(box=>box.addEventListener('change',()=>{if(!this._pendingSelections)this._pendingSelections=new Set(devices.filter(x=>x.classification==='monitor').map(x=>x.device_id));if(box.checked)this._pendingSelections.add(box.dataset.device);else this._pendingSelections.delete(box.dataset.device);}));''', '''this.querySelectorAll('input[data-device]').forEach(box=>box.addEventListener('change',()=>{if(!this._pendingSelections)this._pendingSelections=new Set(devices.filter(x=>x.classification==='monitor').map(x=>x.device_id));if(box.checked)this._pendingSelections.add(box.dataset.device);else this._pendingSelections.delete(box.dataset.device);this._render();}));this.querySelector('#show-monitored')?.addEventListener('click',()=>{this._listMode="monitored";this._render();});this.querySelector('#show-excluded')?.addEventListener('click',()=>{this._listMode="excluded";this._render();});''')
s=s.replace('.actions{display:flex;gap:8px;flex-wrap:wrap;', '.actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;')
s=s.replace('.primary{font-weight:600}.dashboard-section', '.primary{font-weight:600}.list-toggle{display:inline-flex;margin-left:auto;border:1px solid var(--divider-color);border-radius:8px;overflow:hidden}.toggle-btn{border:0;border-radius:0;background:var(--card-background-color)}.toggle-btn:first-child{border-right:1px solid var(--divider-color)}.dashboard-section')
p.write_text(s)

m=Path('/mnt/data/build1612/custom_components/energy_attribution/manifest.json')
ms=m.read_text().replace('"version": "1.6.11"','"version": "1.6.12"')
m.write_text(ms)

ip=Path('/mnt/data/build1612/custom_components/energy_attribution/__init__.py')
is_=ip.read_text().replace('energy-attribution-panel-v22','energy-attribution-panel-v23').replace('energy-attribution-panel.js?v=44','energy-attribution-panel.js?v=45')
ip.write_text(is_)
