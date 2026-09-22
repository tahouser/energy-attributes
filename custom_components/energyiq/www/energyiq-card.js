/* EnergyIQ dashboard card — 3.1.157 */
const TAG = "energyiq-card";
if (!customElements.get(TAG)) {
  class EnergyIQCard extends HTMLElement {
    constructor() { super(); this._hass=null; this._cfg={}; this._data=null; this._entryId=null; this._view=0; this._timer=null; this._busy=false; this._ro=null; this._click=this._handleClick.bind(this); this._costPeriod="day"; this._costHistory=null; this._costHistoryAt=0; this._costSwipeStartX=0; this._costSwipeStartY=0; this._costSwipeActive=false; }
    static getConfigForm() {
      return {
        schema: [
          {
            name: "cost_entity",
            selector: { entity: { domain: "sensor" } },
          },
          {
            name: "peak_cost_entity",
            selector: { entity: { domain: "sensor" } },
          },
          {
            name: "off_peak_cost_entity",
            selector: { entity: { domain: "sensor" } },
          },
        ],
        computeLabel: (schema) => ({
          cost_entity: "Total energy cost sensor",
          peak_cost_entity: "Peak energy cost sensor",
          off_peak_cost_entity: "Off-peak energy cost sensor",
        }[schema?.name]),
        computeHelper: (schema) => ({
          cost_entity: "Optional. Used by the COST view.",
          peak_cost_entity: "Optional. Used for the Peak breakdown.",
          off_peak_cost_entity: "Optional. Used for the Off-peak breakdown.",
        }[schema?.name]),
      };
    }

    static getStubConfig() {
      return {};
    }

    static getConfigElement() {
      return document.createElement("energyiq-card-editor");
    }

    setConfig(c){ this._cfg=c||{}; if(this.isConnected)this._start(); }
    set hass(h){ this._hass=h; if(!this._busy&&!this._data)this._start(); else if(this._data)this._render(); }
    connectedCallback(){ this.addEventListener("click",this._click); this._loading(); this._observeSize(); if(this._hass)this._start(); }
    disconnectedCallback(){ if(this._timer)clearInterval(this._timer); if(this._ro)this._ro.disconnect(); this.removeEventListener("click",this._click); }
    getCardSize(){return 4;}
    getGridOptions(){return {columns:"full",rows:4,min_rows:4};}
    async _ws(m){return this._hass.connection.sendMessagePromise(m);}
    _observeSize(){
      if(typeof ResizeObserver==="undefined"||this._ro)return;
      this._ro=new ResizeObserver(entries=>{
        const r=entries[0]&&entries[0].contentRect; if(!r)return;
        const w=r.width,h=r.height;
        this.dataset.size=w<360||h<230?"compact":w>700&&h>300?"large":"standard";
      });
      this._ro.observe(this);
    }
    async _start(){
      if(this._busy||!this._hass)return; this._busy=true;
      try{ let id=this._cfg.entry_id; if(!id){let r=await this._ws({type:"energy_attribution/list_entries"});id=r.entries&&r.entries[0]&&r.entries[0].entry_id;}
        if(!id)throw new Error("EnergyIQ is not configured."); this._entryId=id; await this._refresh(); if(this._timer)clearInterval(this._timer); this._timer=setInterval(()=>this._refresh(),2000);
      }catch(e){this._error(e.message||e);} finally{this._busy=false;}
    }
    async _refresh(){try{this._data=await this._ws({type:"energy_attribution/workspace",entry_id:this._entryId});if(this._view===2&&Date.now()-this._costHistoryAt>30000)await this._loadCostHistory();this._render();}catch(e){console.error("EnergyIQ card",e);}}
    _num(v){v=Number(v);return Number.isFinite(v)?v:null;}
    _periodBounds(period){
      const now=new Date(), start=new Date(now);
      if(period==="hour"){start.setMinutes(0,0,0);}
      else if(period==="month"){start.setDate(1);start.setHours(0,0,0,0);}
      else if(period==="week"){start.setHours(0,0,0,0);start.setDate(start.getDate()-start.getDay());}
      else {start.setHours(0,0,0,0);}
      return {start,end:now};
    }
    async _loadCostHistory(){
      if(!this._hass||!this._cfg.cost_entity&&!this._cfg.peak_cost_entity&&!this._cfg.off_peak_cost_entity)return;
      const ids=[this._cfg.peak_cost_entity||"sensor.dte_peak_energy_cost",this._cfg.off_peak_cost_entity||"sensor.dte_off_peak_energy_cost"];
      try{
        const {start,end}=this._periodBounds(this._costPeriod);
        const history=await this._ws({type:"history/history_during_period",start_time:start.toISOString(),end_time:end.toISOString(),entity_ids:ids,include_start_time_state:true,significant_changes_only:true,minimal_response:true,no_attributes:true});
        const values={};
        ids.forEach(id=>{
          const states=(history&&history[id])||[];
          const nums=states.map(x=>Number(x.s??x.state)).filter(Number.isFinite);
          const current=this._state(id);
          const first=nums.length?nums[0]:null;
          const last=nums.length?nums[nums.length-1]:current;
          values[id]=first==null||last==null?null:Math.max(0,last-first);
        });
        const peak=values[ids[0]],off=values[ids[1]];
        this._costHistory={peak:peak==null?null:peak,off:off==null?null:off,total:peak==null&&off==null?null:(peak||0)+(off||0)};
        this._costHistoryAt=Date.now();
      }catch(e){console.error("EnergyIQ cost history",e);this._costHistory={peak:null,off:null,total:null};this._costHistoryAt=Date.now();}
      this._render();
    }
    _state(id){return this._num(this._hass&&this._hass.states&&this._hass.states[id]&&this._hass.states[id].state);}
    _next(e){if(!e.target.closest||!e.target.closest("[data-next]"))return;e.stopPropagation();this._view=(this._view+1)%3;if(this._view===2&&Date.now()-this._costHistoryAt>30000)this._loadCostHistory();this._render();}
    _handleClick(e){this._next(e);const active=e.target.closest&&e.target.closest("[data-active-loads]");if(active){e.stopPropagation();this._showActiveLoads();return;}const open=e.target.closest&&e.target.closest("[data-open-energyiq]");if(open){e.stopPropagation();this._openEnergyIQ();return;}const close=e.target.closest&&e.target.closest("[data-close-active]");if(close){e.stopPropagation();this._closeActiveLoads();return;}}
    _bindCostSwipe(){
      const el=this.querySelector(".cost-swipe");
      if(!el)return;
      el.addEventListener("touchstart",event=>{
        const touch=event.touches?.[0];
        if(!touch)return;
        this._costSwipeStartX=touch.clientX;
        this._costSwipeStartY=touch.clientY;
        this._costSwipeActive=false;
      },{passive:true});
      el.addEventListener("touchmove",event=>{
        const touch=event.touches?.[0];
        if(!touch)return;
        const dx=touch.clientX-this._costSwipeStartX;
        const dy=touch.clientY-this._costSwipeStartY;
        if(Math.abs(dx)>Math.abs(dy)&&Math.abs(dx)>10){
          this._costSwipeActive=true;
          if(event.cancelable)event.preventDefault();
          event.stopPropagation();
        }
      },{passive:false});
      el.addEventListener("touchend",event=>{
        if(!this._costSwipeActive)return;
        const touch=event.changedTouches?.[0];
        if(!touch)return;
        const dx=touch.clientX-this._costSwipeStartX;
        const periods=["day","week","month"],index=periods.indexOf(this._costPeriod);
        const nextIndex=dx<0?Math.min(periods.length-1,index+1):Math.max(0,index-1);
        this._costSwipeActive=false;
        event.stopPropagation();
        if(nextIndex!==index){
          this._costPeriod=periods[nextIndex];
          this._costHistory=null;
          this._costHistoryAt=0;
          this._render();
          this._loadCostHistory();
        }
      },{passive:true});
      el.addEventListener("touchcancel",()=>{this._costSwipeActive=false;},{passive:true});
    }
    _openEnergyIQ(){if(this._hass&&typeof this._hass.navigate==="function"){this._hass.navigate("/energyiq");return;}window.history.pushState({}, "", "/energyiq");window.dispatchEvent(new Event("location-changed"));}
    _closeActiveLoads(){const modal=this.querySelector(".active-loads-backdrop");if(modal)modal.remove();}
    _showActiveLoads(){this._closeActiveLoads();const d=this._data||{},home=this._num(d.whole_home_power),trained=Math.max(0,this._num(d.trained_live_power_w)||0),mystery=home==null?null:Math.max(0,home-trained);const active=(d.devices||[]).filter(x=>x.classification==="monitor").map(x=>Object.assign({},x,{w:Math.max(0,Number(x.current_power)||0)})).filter(x=>x.w>0).sort((a,b)=>b.w-a.w);const known=active.reduce((s,x)=>s+x.w,0);const rows=active.length?active.map(x=>`<div class="active-load-row"><span>${this._esc(x.name||x.device_id)}</span><strong>${x.w.toFixed(0)} W</strong></div>`).join(""):`<div class="active-load-empty">No active attributed loads right now.</div>`;const fmt=v=>Number.isFinite(v)?`${v.toFixed(0)} W`:"—";this.insertAdjacentHTML("beforeend",`<div class="active-loads-backdrop" role="presentation"><div class="active-loads" role="dialog" aria-modal="true" aria-label="Active EnergyIQ loads"><div class="active-loads-head"><div><div class="eyebrow">ENERGYIQ</div><div class="active-loads-title">Active Loads</div><div class="sub">${active.length} currently consuming</div></div><button data-close-active aria-label="Close">×</button></div><div class="active-load-list">${rows}</div><div class="active-load-summary"><div><span>Known</span><strong>${fmt(known)}</strong></div><div><span>Unattributed</span><strong>${fmt(mystery)}</strong></div><div><span>House total</span><strong>${fmt(home)}</strong></div></div></div></div>`);}

    _esc(v){return String(v).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c];});}
    _loading(){this.innerHTML='<ha-card><div class="pad"><b>EnergyIQ</b> <span>Loading...</span></div></ha-card>';}
    _error(m){this.innerHTML='<ha-card><div class="pad"><b>EnergyIQ</b><div class="err">'+this._esc(m)+'</div></div></ha-card>';}
    _render(){
      var d=this._data||{}, home=this._num(d.whole_home_power), trained=Math.max(0,this._num(d.trained_live_power_w)||0), known=home==null?null:Math.min(home,trained), mystery=home==null?null:Math.max(0,home-trained);
      var devices=(d.devices||[]).filter(function(x){return x.classification==="monitor";}).map(function(x){return Object.assign({},x,{w:Math.max(0,Number(x.current_power)||0)});}).filter(function(x){return x.w>0;}).sort(function(a,b){return b.w-a.w;});
      var total=this._state(this._cfg.cost_entity||"sensor.dte_variable_energy_cost"), peak=this._state(this._cfg.peak_cost_entity||"sensor.dte_peak_energy_cost"), off=this._state(this._cfg.off_peak_cost_entity||"sensor.dte_off_peak_energy_cost");
      var titles=["CONSUMPTION","MYSTERY WATTS","COST"], subs=["Current attributed power","Known vs. unexplained power",this._costPeriod==="week"?"This week":this._costPeriod==="month"?"This month":"Today"], body=this._view===0?this._pareto(devices):this._view===1?this._mystery(home,known,mystery):this._cost(total,peak,off),costMoney=this._costHistory&&this._costHistory.total!=null?"$"+Number(this._costHistory.total).toFixed(2):"—",costLabel=this._costPeriod==="week"?"TOTAL THIS WEEK":this._costPeriod==="month"?"TOTAL THIS MONTH":"TOTAL TODAY",headExtra=this._view===2?'<div class="cost-head-total"><span>'+costLabel+'</span><strong>'+costMoney+'</strong></div>':"";
      this.innerHTML='<style>'+this._css()+'</style><ha-card><div class="pad"><div class="head"><div class="card-title-wrap"><div class="card-icon" aria-hidden="true">'+(this._view===2?"$":"ϟ")+'</div><div><div class="eyebrow">ENERGYIQ</div><div class="title">'+titles[this._view]+'</div><div class="sub">'+subs[this._view]+'</div></div></div>'+headExtra+'<div class="head-actions"><button class="active-shortcut" data-active-loads aria-label="Show active loads">⚡</button><button class="open-shortcut" data-open-energyiq aria-label="Open EnergyIQ">↗</button><button data-next aria-label="Next view">→</button></div></div><div class="body">'+body+'</div><div class="dots"><i class="'+(this._view===0?'on':'')+'"></i><i class="'+(this._view===1?'on':'')+'"></i><i class="'+(this._view===2?'on':'')+'"></i></div></div></ha-card>';
      if(this._view===2)this._bindCostSwipe();
    }
    _pareto(a){
      if(!a.length)return '<div class="empty">No active attributed loads right now.</div>';
      var top=a.slice(0,6), other=a.slice(6).reduce(function(s,x){return s+x.w;},0); if(other)top.push({name:"Other",w:other});
      var total=top.reduce(function(s,x){return s+x.w;},0), max=Math.max.apply(null,top.map(function(x){return x.w;})), W=640,H=205,L=34,R=18,T=14,B=48, slot=(W-L-R)/top.length,bw=Math.min(56,slot*.62),ch=H-T-B,cum=0,bars=[];
      top.forEach(function(x,i){var xx=L+slot*i+(slot-bw)/2,bh=Math.max(2,x.w/max*ch),y=T+ch-bh;cum+=x.w;bars.push({x:xx,cx:xx+bw/2,y:y,bh:bh,cy:T+ch-(cum/total)*ch,w:x.w,n:x.name.length>12?x.name.slice(0,11)+"...":x.name});});
      var points=bars.map(function(x){return x.cx+","+x.cy;}).join(" "), svg='<svg viewBox="0 0 '+W+' '+H+'"><line x1="'+L+'" y1="'+(T+ch)+'" x2="'+(W-R)+'" y2="'+(T+ch)+'" class="axis"/><polyline points="'+points+'" class="line"/>';
      bars.forEach(function(x,i){svg+='<rect x="'+x.x+'" y="'+x.y+'" width="'+bw+'" height="'+x.bh+'" rx="7" class="c'+(i%5)+'"/><text x="'+x.cx+'" y="'+(x.y-5)+'" text-anchor="middle" class="v">'+Math.round(x.w)+'W</text><text x="'+x.cx+'" y="'+(T+ch+20)+'" text-anchor="middle" class="x">'+this._esc(x.n)+'</text><circle cx="'+x.cx+'" cy="'+x.cy+'" r="3.5" class="dotline"/>';},this); svg+='</svg>';
      return '<div class="chart"><div class="summary"><b>'+Math.round(total)+' W</b><span>attributed now</span></div>'+svg+'</div>';
    }
    _mystery(home,known,mystery){
      if(home==null)return '<div class="empty">Whole-home power is unavailable.</div>'; var kp=home?Math.min(100,known/home*100):0, up=100-kp;
      return '<div class="myst"><div class="big">'+Math.round(mystery)+' <span>W</span></div><div class="status"><span>Unexplained right now</span><b>'+up.toFixed(0)+'%</b></div><div class="stack"><div class="known" style="width:'+kp+'%"></div><div class="unknown" style="width:'+up+'%"></div></div><div class="legend"><span><i class="kd"></i>Known <b>'+Math.round(known)+' W</b></span><span><i class="ud"></i>Unknown <b>'+Math.round(mystery)+' W</b></span></div><div class="total">Whole-home power <b>'+Math.round(home)+' W</b></div></div>';
    }
    _cost(total,peak,off){
      const h=this._costHistory;
      if(!h||h.total==null)return '<div class="cost-loading">Loading cost history…</div>';
      const periods=["day","week","month"], labels={day:"DAY",week:"WEEK",month:"MONTH"}, periodLabel=labels[this._costPeriod]||"DAY";
      const peakValue=h.peak||0, offValue=h.off||0, totalValue=h.total;
      const max=Math.max(0.01,peakValue,offValue);
      const peakPct=Math.min(100,peakValue/max*100), offPct=Math.min(100,offValue/max*100);
      const money=v=>"$"+Number(v||0).toFixed(2);
      return '<div class="cost-swipe" role="group" aria-label="Cost period '+periodLabel+'. Swipe left or right to change period."><div class="cost-bars"><div class="cost-bar-row"><div class="cost-bar-label"><span>Peak</span><b>'+money(peakValue)+'</b></div><div class="cost-track"><div class="cost-fill peak" style="width:'+peakPct+'%"></div><div class="cost-marker" style="left:'+peakPct+'%"></div></div></div><div class="cost-bar-row"><div class="cost-bar-label"><span>Off-Peak</span><b>'+money(offValue)+'</b></div><div class="cost-track"><div class="cost-fill off" style="width:'+offPct+'%"></div><div class="cost-marker" style="left:'+offPct+'%"></div></div></div></div><div class="cost-swipe-hint">'+periodLabel+' · SWIPE</div><div class="cost-dots">'+periods.map(function(p){return '<i class="'+(p===this._costPeriod?"on":"")+'"></i>';},this).join("")+'</div></div>';
    }
    _css(){return ':host{display:block;width:100%;min-width:0;max-width:100%;height:auto;box-sizing:border-box;container-type:inline-size;container-name:energyiq-card}.pad{padding:clamp(10px,2.2cqw,16px) clamp(10px,2.4cqw,16px) clamp(8px,1.7cqw,10px);color:var(--primary-text-color);min-width:0;width:100%;height:auto;box-sizing:border-box;overflow:hidden;display:flex;flex-direction:column}ha-card{display:flex;flex-direction:column;width:100%;height:auto;max-width:100%;box-sizing:border-box;overflow:hidden}.head{display:flex;justify-content:space-between;align-items:flex-start;gap:clamp(6px,1.5cqw,10px);flex:0 0 auto}.card-title-wrap{display:flex;align-items:center;gap:clamp(6px,1.5cqw,9px);min-width:0}.card-icon{width:clamp(28px,5.5cqw,34px);height:clamp(28px,5.5cqw,34px);flex:none;display:grid;place-items:center;border-radius:clamp(8px,1.7cqw,10px);background:rgba(28,205,255,.12);border:1px solid rgba(28,205,255,.28);color:#36c8ff;font-size:clamp(17px,3.3cqw,20px);font-weight:800}.head-actions{display:flex;align-items:center;gap:clamp(3px,1cqw,6px);flex:none}.eyebrow{font-size:clamp(.62rem,1.9cqw,.72rem);letter-spacing:.12em;font-weight:700;color:var(--secondary-text-color)}.title{font-size:clamp(.98rem,3.2cqw,1.2rem);font-weight:700;line-height:1.15}.sub{font-size:clamp(.68rem,2cqw,.78rem);color:var(--secondary-text-color);line-height:1.2}.head-actions button{width:clamp(30px,5.8cqw,36px);height:clamp(30px,5.8cqw,36px);padding:0}button{width:clamp(34px,6.5cqw,40px);height:clamp(34px,6.5cqw,40px);border:0;border-radius:50%;background:var(--primary-color,#03a9f4);color:#fff;font-size:clamp(1.15rem,3.5cqw,1.5rem);cursor:pointer}.active-shortcut{background:rgba(20,242,184,.14);color:#35e7b0;border:1px solid rgba(20,242,184,.35)}.open-shortcut{background:rgba(28,205,255,.12);color:#36c8ff;border:1px solid rgba(28,205,255,.28)}.body{min-height:0;flex:1;display:flex;align-items:center;min-width:0;width:100%;overflow:hidden}.dots{display:flex;justify-content:center;gap:6px;flex:0 0 auto;padding-top:4px}.dots i{width:6px;height:6px;border-radius:50%;background:var(--divider-color)}.dots i.on{background:var(--primary-color)}.chart{width:100%;min-width:0;overflow:hidden}.summary{display:flex;gap:7px;align-items:baseline;margin:4px}.summary b,.big{font-size:clamp(1.65rem,5.5cqw,2.1rem);line-height:1.05}.summary span,.sub{color:var(--secondary-text-color);font-size:clamp(.68rem,2cqw,.76rem)}svg{display:block;width:100%;max-width:100%;height:min(175px,30cqw);min-height:105px;overflow:hidden}.axis{stroke:var(--divider-color)}.line{fill:none;stroke:var(--primary-color);stroke-width:3;stroke-linecap:round}.dotline{fill:var(--primary-color);stroke:var(--ha-card-background,#1c1c1c);stroke-width:2}.v{fill:var(--primary-text-color);font-size:clamp(9px,1.8cqw,11px);font-weight:700}.x{fill:var(--secondary-text-color);font-size:clamp(8px,1.8cqw,11px)}.c0{fill:#2196f3}.c1{fill:#42a5f5}.c2{fill:#26a69a}.c3{fill:#ffb300}.c4{fill:#ef5350}.myst,.cost{width:100%;padding:0;box-sizing:border-box;min-width:0}.cost-swipe{width:100%;min-width:0;touch-action:pan-y}.cost-bars{display:flex;flex-direction:column;gap:10px;margin:0;padding:1px 0 0}.cost-bar-row{min-width:0}.cost-bar-label{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:3px;font-size:clamp(.68rem,1.9cqw,.78rem)}.cost-bar-label span{color:var(--secondary-text-color)}.cost-bar-label b{font-variant-numeric:tabular-nums}.cost-track{position:relative;height:21px;border-radius:7px;background:var(--secondary-background-color);border:1px solid var(--divider-color);box-sizing:border-box;overflow:visible}.cost-fill{height:100%;border-radius:6px;min-width:2px}.cost-fill.peak{background:var(--primary-color)}.cost-fill.off{background:var(--accent-color,var(--primary-color));opacity:.62}.cost-marker{position:absolute;top:-4px;width:2px;height:29px;background:var(--primary-text-color);transform:translateX(-1px)}.cost-swipe-hint{text-align:center;color:var(--secondary-text-color);font-size:clamp(.56rem,1.5cqw,.64rem);letter-spacing:.08em;margin-top:6px;opacity:.75}.cost-dots{display:flex;justify-content:center;gap:5px;margin-top:3px}.cost-dots i{width:5px;height:5px;border-radius:50%;background:var(--divider-color)}.cost-dots i.on{background:var(--primary-color)}.cost-loading{width:100%;text-align:center;color:var(--secondary-text-color);padding:18px 10px}.cost-head-total{display:flex;flex-direction:column;align-items:flex-end;justify-content:flex-start;min-width:68px;margin-left:auto;margin-right:clamp(2px,1cqw,6px);padding-top:1px}.cost-head-total span{font-size:clamp(.52rem,1.5cqw,.62rem);letter-spacing:.07em;color:var(--secondary-text-color);white-space:nowrap}.cost-head-total strong{font-size:clamp(1rem,3cqw,1.28rem);line-height:1.05;font-variant-numeric:tabular-nums;white-space:nowrap}.body:has(.cost-swipe)+.dots{display:none}@container energyiq-card (max-width:420px){.cost-bars{gap:8px}.cost-track{height:19px}.cost-swipe-hint{margin-top:4px}.cost-dots{margin-top:2px}.cost-head-total{min-width:60px}.cost-head-total span{font-size:.5rem}.cost-head-total strong{font-size:1rem}}@container energyiq-card (max-width:420px){.pad{padding:9px 10px 7px}.head-actions button{width:29px;height:29px}.active-shortcut{font-size:0}.active-shortcut::before{content:"⚡";font-size:1rem}.title{font-size:1rem}.sub{font-size:.67rem}.summary{margin:2px}.summary b,.big{font-size:1.7rem}svg{height:120px;min-height:100px}.legend{gap:5px}.break{gap:6px}}@container energyiq-card (max-height:240px){.pad{padding-top:8px;padding-bottom:6px}.body{overflow:hidden}.sub{display:none}.dots{padding-top:2px}.track{margin-top:8px}.break{margin-top:7px}}@container energyiq-card (min-width:700px){.body{padding-left:4px;padding-right:4px}.summary{margin-left:0}.chart svg{height:min(185px,28cqw)}}.empty{width:100%;text-align:center;color:var(--secondary-text-color);font-size:clamp(.78rem,2.3cqw,.9rem);padding:10px}.err{margin-top:10px;color:var(--error-color)}.active-loads-backdrop{position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.58);display:flex;align-items:center;justify-content:center;padding:16px}.active-loads{width:min(430px,100%);max-height:82vh;overflow:auto;background:var(--card-background-color);border:1px solid var(--divider-color);border-radius:14px;box-shadow:var(--ha-card-box-shadow);padding:16px;box-sizing:border-box}.active-loads-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.active-loads-title{font-size:1.25rem;font-weight:800}.active-loads-head button{width:38px;height:38px;padding:0}.active-load-list{margin-top:12px}.active-load-row{display:flex;justify-content:space-between;gap:12px;padding:9px 2px;border-bottom:1px solid var(--divider-color)}.active-load-row span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.active-load-row strong{white-space:nowrap;font-variant-numeric:tabular-nums}.active-load-empty{text-align:center;padding:22px;color:var(--secondary-text-color)}.active-load-summary{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-top:12px}.active-load-summary div{padding:9px;border-radius:9px;background:var(--secondary-background-color);border:1px solid var(--divider-color)}.active-load-summary span{display:block;font-size:9px;text-transform:uppercase;color:var(--secondary-text-color)}.active-load-summary strong{display:block;margin-top:3px;font-size:14px;font-variant-numeric:tabular-nums}@media(max-width:500px){.active-loads-backdrop{padding:10px}.active-loads{max-height:88vh;padding:14px}.active-load-summary{grid-template-columns:1fr 1fr}.active-load-summary div:last-child{grid-column:1/-1}}';}
  }
  class EnergyIQCardEditor extends HTMLElement {
    constructor() {
      super();
      this._config = {};
      this._hass = null;
      this._form = null;
    }
    setConfig(config) {
      this._config = Object.assign({}, config || {});
      this._render();
    }
    set hass(hass) {
      this._hass = hass;
      if (this._form) this._form.hass = hass;
      else this._render();
    }
    _render() {
      if (!this._hass || this._form) return;
      const spec = EnergyIQCard.getConfigForm();
      const form = document.createElement("ha-form");
      form.hass = this._hass;
      form.schema = spec.schema;
      form.data = this._config;
      form.computeLabel = spec.computeLabel;
      form.computeHelper = spec.computeHelper;
      form.addEventListener("value-changed", (ev) => {
        this._config = Object.assign({}, this._config, ev.detail.value || {});
        this.dispatchEvent(new CustomEvent("config-changed", {
          bubbles: true,
          composed: true,
          detail: { config: this._config },
        }));
      });
      this.innerHTML = "";
      this.appendChild(form);
      this._form = form;
    }
  }
  if (!customElements.get("energyiq-card-editor")) {
    customElements.define("energyiq-card-editor", EnergyIQCardEditor);
  }
  customElements.define(TAG,EnergyIQCard); window.customCards=window.customCards||[]; window.customCards.push({type:TAG,name:"EnergyIQ",description:"EnergyIQ dashboard card for whole-home power attribution, Mystery Watts, and cost.",preview:true,documentationURL:"https://github.com/tahouser/energy-attributes",configurable:true});
}
