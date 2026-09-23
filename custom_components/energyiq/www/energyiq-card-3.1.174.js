/* EnergyIQ dashboard card — 3.1.174 */
const TAG = "energyiq-card";
const BRAND_ICON_DATA = "data:image/png;base64,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";
if (!customElements.get(TAG)) {
  class EnergyIQCard extends HTMLElement {
    constructor() { super(); this._hass=null; this._cfg={}; this._data=null; this._entryId=null; this._view=0; this._timer=null; this._busy=false; this._ro=null; this._click=this._handleClick.bind(this); this._costPeriod="day"; this._costHistory=null; this._costHistoryAt=0; this._costLearned=null; this._costSwipeStartX=0; this._costSwipeStartY=0; this._costSwipeActive=false; this._costTimeline=null; this._costTimelineAt=0; }
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
    async _refresh(){try{this._data=await this._ws({type:"energy_attribution/workspace",entry_id:this._entryId});if(this._view===2&&(Date.now()-this._costHistoryAt>30000||Date.now()-this._costTimelineAt>120000))await this._loadCostHistory();this._render();}catch(e){console.error("EnergyIQ card",e);}}
    _num(v){v=Number(v);return Number.isFinite(v)?v:null;}
    _periodBounds(period){
      const now=new Date(), start=new Date(now);
      if(period==="hour"){start.setMinutes(0,0,0);}
      else if(period==="month"){start.setDate(1);start.setHours(0,0,0,0);}
      else if(period==="week"){start.setHours(0,0,0,0);start.setDate(start.getDate()-start.getDay());}
      else {start.setHours(0,0,0,0);}
      return {start,end:now};
    }
    _costLearningSpec(period){ return {count:30}; }
    _powerUnit(){
      const id=this._data&&this._data.power_entity;
      const state=id&&this._hass&&this._hass.states&&this._hass.states[id];
      return String(state&&state.attributes&&state.attributes.unit_of_measurement||"W").toLowerCase()==="kw"?"kw":"w";
    }
    _powerValue(v){
      const n=Number(v);
      if(!Number.isFinite(n))return null;
      return this._powerUnit()==="kw"?n*1000:n;
    }
    _historyPoint(item){
      if(!item)return null;
      const rawTime=item.lu??item.last_updated??item.lc??item.last_changed;
      let t=typeof rawTime==="number"?rawTime:Date.parse(rawTime||"");
      if(Number.isFinite(t)&&t<1e12)t*=1000;
      const v=this._powerValue(item.s??item.state);
      if(!Number.isFinite(t)||v==null)return null;
      return {t,v};
    }
    _integratePower(states,startMs,endMs){
      if(!Array.isArray(states)||endMs<=startMs)return 0;
      const pts=[];
      for(const item of states){
        const p=this._historyPoint(item);
        if(p)pts.push(p);
      }
      if(!pts.length)return 0;
      pts.sort((a,b)=>a.t-b.t);
      let current=null;
      for(const p of pts){
        if(p.t<=startMs)current=p;
        else break;
      }
      if(!current)return 0;
      let totalWh=0;
      let cursor=startMs;
      for(const p of pts){
        if(p.t<=startMs)continue;
        if(p.t>=endMs)break;
        if(current.v>=0)totalWh+=current.v*(p.t-cursor)/3600000;
        cursor=p.t;
        current=p;
      }
      if(current.v>=0&&cursor<endMs)totalWh+=current.v*(endMs-cursor)/3600000;
      return Math.max(0,totalWh);
    }
    _localDayStart(date){
      const d=new Date(date);
      d.setHours(0,0,0,0);
      return d;
    }
    _timelineFromHistory(states){
      const now=new Date();
      const today=this._localDayStart(now);
      const elapsed=Math.max(0,now.getTime()-today.getTime());
      const currentSegment=Math.min(11,Math.floor(elapsed/7200000));
      const partialMs=Math.max(0,elapsed-currentSegment*7200000);
      const segments=[];
      const historicalBySegment=Array.from({length:12},()=>[]);
      const days=30;
      for(let dayOffset=1;dayOffset<=days;dayOffset++){
        const dayStart=new Date(today);
        dayStart.setDate(dayStart.getDate()-dayOffset);
        for(let seg=0;seg<12;seg++){
          const segStart=dayStart.getTime()+seg*7200000;
          const duration=seg===currentSegment&&partialMs>0?partialMs:7200000;
          if(seg===currentSegment&&partialMs<=0)continue;
          const energy=this._integratePower(states,segStart,segStart+duration);
          if(Number.isFinite(energy))historicalBySegment[seg].push(energy);
        }
      }
      for(let seg=0;seg<12;seg++){
        const segStart=today.getTime()+seg*7200000;
        const fullEnd=segStart+7200000;
        let elapsedMs=0;
        if(seg<currentSegment)elapsedMs=7200000;
        else if(seg===currentSegment)elapsedMs=partialMs;
        if(elapsedMs<=0){
          segments.push({progress:0,color:"future",ratio:null,average:null,samples:historicalBySegment[seg].length});
          continue;
        }
        const actual=this._integratePower(states,segStart,Math.min(fullEnd,now.getTime()));
        const samples=historicalBySegment[seg];
        const clean=samples.filter(v=>Number.isFinite(v)&&v>=0);
        const average=clean.length?clean.reduce((a,b)=>a+b,0)/clean.length:null;
        const ratio=average>0?actual/average:null;
        const color=ratio==null?"neutral":ratio>1.10?"red":ratio>=0.90?"yellow":"green";
        segments.push({progress:Math.min(1,elapsedMs/7200000),color,ratio,average,samples:clean.length,actual});
      }
      return {segments,elapsedMs:Math.min(86400000,elapsed),currentSegment,updatedAt:Date.now()};
    }
    _timelineHtml(){
      const timeline=this._costTimeline;
      if(!timeline)return '<div class="cost-timeline-loading">Learning today\'s consumption pattern…</div>';
      const segs=timeline.segments||[];
      const cells=segs.map((seg,i)=>{
        const progress=Math.max(0,Math.min(1,Number(seg.progress)||0));
        const color=seg.color||"future";
        const title=seg.ratio==null?"No historical comparison":(seg.ratio*100).toFixed(0)+"% of historical average";
        const fill=progress>0?'<div class="cost-time-fill '+color+'" style="width:'+(progress*100).toFixed(2)+'%"></div>':"";
        return '<div class="cost-time-segment" title="Hour '+(i*2)+'–'+(i*2+2)+': '+title+'">'+fill+'</div>';
      }).join("");
      const marker=Math.min(100,Math.max(0,(timeline.elapsedMs/86400000)*100));
      return '<div class="cost-time-wrap"><div class="cost-time-track">'+cells+'<div class="cost-now" style="left:'+marker.toFixed(2)+'%"></div></div><div class="cost-time-labels"><span>12 AM</span><span>6 AM</span><span>12 PM</span><span>6 PM</span><span>12 AM</span></div></div>';
    }
    async _loadCostHistory(){
      if(!this._hass||!this._data)return;
      try{
        const powerId=this._data.power_entity;
        if(powerId){
          const end=new Date();
          const start=new Date(end);
          start.setDate(start.getDate()-30);
          start.setHours(0,0,0,0);
          const history=await this._ws({type:"history/history_during_period",start_time:start.toISOString(),end_time:end.toISOString(),entity_ids:[powerId],include_start_time_state:true,significant_changes_only:false,minimal_response:true,no_attributes:true});
          const states=(history&&history[powerId])||[];
          this._costTimeline=this._timelineFromHistory(states);
          this._costTimelineAt=Date.now();
        }
        const {start,end}=this._periodBounds(this._costPeriod);
        const peakCostId=this._cfg.peak_cost_entity||"sensor.dte_peak_energy_cost";
        const offPeakCostId=this._cfg.off_peak_cost_entity||"sensor.dte_off_peak_energy_cost";
        const ids=[peakCostId,offPeakCostId];
        const currentHistory=await this._ws({type:"history/history_during_period",start_time:start.toISOString(),end_time:end.toISOString(),entity_ids:ids,include_start_time_state:true,significant_changes_only:false,minimal_response:true,no_attributes:true});
        const historyDelta=id=>{
          const states=(currentHistory&&currentHistory[id])||[];
          const nums=states.map(x=>Number(x.s??x.state)).filter(Number.isFinite);
          const current=this._state(id);
          const first=nums.length?nums[0]:null;
          const last=nums.length?nums[nums.length-1]:current;
          return first==null||last==null?null:Math.max(0,last-first);
        };
        const off=historyDelta(offPeakCostId);
        let peakEnergy=null;
        try{
          const stats=await this._ws({type:"recorder/statistics_during_period",start_time:start.toISOString(),end_time:end.toISOString(),statistic_ids:["sensor.dte_house_energy_peak"],period:"5minute",types:["change","state","last_reset"]});
          const rows=(stats&&stats["sensor.dte_house_energy_peak"])||[];
          if(rows.length){
            const changes=rows.map(x=>Number(x.change)).filter(Number.isFinite).reduce((sum,v)=>sum+Math.max(0,v),0);
            const lastRow=rows[rows.length-1],lastState=Number(lastRow.state),current=this._state("sensor.dte_house_energy_peak");
            let tail=0;
            if(Number.isFinite(current)&&Number.isFinite(lastState))tail=current>=lastState?current-lastState:current;
            peakEnergy=Math.max(0,changes+tail);
          }
        }catch(e){console.warn("EnergyIQ peak statistics unavailable; using history",e);}
        if(peakEnergy==null)peakEnergy=historyDelta("sensor.dte_house_energy_peak");
        const peakEnergyRate=this._state("input_number.dte_peak_base_rate");
        const peak=peakEnergy==null||peakEnergyRate==null?null:Math.max(0,peakEnergy*peakEnergyRate);
        this._costHistory={peak,off,total:peak==null&&off==null?null:(peak||0)+(off||0)};
        this._costHistoryAt=Date.now();
      }catch(e){
        console.error("EnergyIQ cost history",e);
        this._costHistory={peak:null,off:null,total:null};
        this._costHistoryAt=Date.now();
      }
      this._render();
    }
    _state(id){return this._num(this._hass&&this._hass.states&&this._hass.states[id]&&this._hass.states[id].state);}
    _brandIconUrl(){return BRAND_ICON_DATA;}
    _next(e){if(!e.target.closest||!e.target.closest("[data-next]"))return;e.stopPropagation();this._view=(this._view+1)%3;if(this._view===2&&Date.now()-this._costHistoryAt>30000)this._loadCostHistory();this._render();}
    _handleClick(e){this._next(e);const costNav=e.target.closest&&e.target.closest("[data-cost-period]");if(costNav&&this._view===2){const periods=["day","week","month"],index=periods.indexOf(this._costPeriod),dir=costNav.getAttribute("data-cost-period")==="next"?1:-1,nextIndex=Math.max(0,Math.min(periods.length-1,index+dir));if(nextIndex!==index){this._costPeriod=periods[nextIndex];this._costHistory=null;this._costHistoryAt=0;this._render();this._loadCostHistory();}return;}const active=e.target.closest&&e.target.closest("[data-active-loads]");if(active){e.stopPropagation();this._showActiveLoads();return;}const open=e.target.closest&&e.target.closest("[data-open-energyiq]");if(open){e.stopPropagation();this._openEnergyIQ();return;}const close=e.target.closest&&e.target.closest("[data-close-active]");if(close){e.stopPropagation();this._closeActiveLoads();return;}}
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
      var titles=["CONSUMPTION","MYSTERY WATTS","COST"], subs=["Current attributed power","Known vs. unexplained power",""], body=this._view===0?this._pareto(devices):this._view===1?this._mystery(home,known,mystery):this._cost(total,peak,off),costMoney=this._costHistory&&this._costHistory.total!=null?"$"+Number(this._costHistory.total).toFixed(2):"—",costLabel=this._costPeriod==="week"?"TOTAL THIS WEEK":this._costPeriod==="month"?"TOTAL THIS MONTH":"TOTAL TODAY",headExtra=this._view===2?'<div class="cost-head-total"><span>'+costLabel+'</span><strong>'+costMoney+'</strong></div>':"";
      this.innerHTML='<style>'+this._css()+'</style><ha-card><div class="pad"><div class="head '+(this._view===2?"cost-view":"")+'"><div class="card-title-wrap"><div class="card-icon" aria-hidden="true"><img src="'+this._brandIconUrl()+'" alt=""></div><div><div class="eyebrow">ENERGYIQ</div><div class="title">'+titles[this._view]+'</div><div class="sub">'+subs[this._view]+'</div></div></div>'+headExtra+'<div class="head-actions"><button class="active-shortcut" data-active-loads aria-label="Show active loads">⚡</button><button class="open-shortcut" data-open-energyiq aria-label="Open EnergyIQ">↗</button><button data-next aria-label="Next view">→</button></div></div><div class="body">'+body+'</div><div class="dots"><i class="'+(this._view===0?'on':'')+'"></i><i class="'+(this._view===1?'on':'')+'"></i><i class="'+(this._view===2?'on':'')+'"></i></div></div></ha-card>';
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
      const periods=["day","week","month"],labels={day:"DAY",week:"WEEK",month:"MONTH"},periodLabel=labels[this._costPeriod]||"DAY";
      const peakValue=h.peak||0,offValue=h.off||0,money=v=>"$"+Number(v||0).toFixed(2);
      const timeline=this._timelineHtml();
      const legend='<div class="cost-time-legend"><span><i class="green-dot"></i>&lt; 90%</span><span><i class="yellow-dot"></i>90–110%</span><span><i class="red-dot"></i>&gt; 110%</span></div>';
      const barLabel=(label,value)=>'<div class="cost-money-row"><span>'+label+'</span><strong>'+money(value)+'</strong></div>';
      return '<div class="cost-swipe" role="group" aria-label="Cost period '+periodLabel+'. Swipe left or right to change period."><div class="cost-bars"><div class="cost-timeline-title">TODAY — CONSUMPTION VS. HISTORY</div>'+timeline+'<div class="cost-money-grid">'+barLabel("Peak",peakValue)+barLabel("Off-Peak",offValue)+'</div>'+legend+'</div><div class="cost-period-nav"><button type="button" data-cost-period="prev" aria-label="Previous cost period">‹</button><strong>'+periodLabel+'</strong><button type="button" data-cost-period="next" aria-label="Next cost period">›</button></div><div class="cost-dots">'+periods.map(function(p){return '<i class="'+(p===this._costPeriod?"on":"")+'"></i>';},this).join("")+'</div></div>';
    }
    _css(){return ':host{display:block;width:100%;min-width:0;max-width:100%;height:auto;box-sizing:border-box;container-type:inline-size;container-name:energyiq-card}.pad{padding:clamp(10px,2.2cqw,16px) clamp(10px,2.4cqw,16px) clamp(8px,1.7cqw,10px);color:var(--primary-text-color);min-width:0;width:100%;height:auto;box-sizing:border-box;overflow:hidden;display:flex;flex-direction:column}ha-card{display:flex;flex-direction:column;width:100%;height:auto;max-width:100%;box-sizing:border-box;overflow:hidden}.head{display:flex;justify-content:space-between;align-items:flex-start;gap:clamp(6px,1.5cqw,10px);flex:0 0 auto}.card-title-wrap{display:flex;align-items:center;gap:clamp(6px,1.5cqw,9px);min-width:0}.card-icon{width:clamp(28px,5.5cqw,34px);height:clamp(28px,5.5cqw,34px);flex:none;display:grid;place-items:center;border-radius:clamp(8px,1.7cqw,10px);background:rgba(28,205,255,.12);border:1px solid rgba(28,205,255,.28);overflow:hidden}.card-icon img{width:72%;height:72%;object-fit:contain;display:block}.head-actions{display:flex;align-items:center;gap:clamp(3px,1cqw,6px);flex:none}.eyebrow{font-size:clamp(.62rem,1.9cqw,.72rem);letter-spacing:.12em;font-weight:700;color:var(--secondary-text-color)}.title{font-size:clamp(.98rem,3.2cqw,1.2rem);font-weight:700;line-height:1.15}.cost-view .title{font-size:clamp(1.18rem,4.2cqw,1.58rem);font-weight:800}.sub{font-size:clamp(.68rem,2cqw,.78rem);color:var(--secondary-text-color);line-height:1.2}.head-actions button{width:clamp(30px,5.8cqw,36px);height:clamp(30px,5.8cqw,36px);padding:0}button{width:clamp(34px,6.5cqw,40px);height:clamp(34px,6.5cqw,40px);border:0;border-radius:50%;background:var(--primary-color,#03a9f4);color:#fff;font-size:clamp(1.15rem,3.5cqw,1.5rem);cursor:pointer}.active-shortcut{background:rgba(20,242,184,.14);color:#35e7b0;border:1px solid rgba(20,242,184,.35)}.open-shortcut{background:rgba(28,205,255,.12);color:#36c8ff;border:1px solid rgba(28,205,255,.28)}.body{min-height:0;flex:1;display:flex;align-items:center;min-width:0;width:100%;overflow:hidden}.dots{display:flex;justify-content:center;gap:6px;flex:0 0 auto;padding-top:4px}.dots i{width:6px;height:6px;border-radius:50%;background:var(--divider-color)}.dots i.on{background:var(--primary-color)}.chart{width:100%;min-width:0;overflow:hidden}.summary{display:flex;gap:7px;align-items:baseline;margin:4px}.summary b,.big{font-size:clamp(1.65rem,5.5cqw,2.1rem);line-height:1.05}.summary span,.sub{color:var(--secondary-text-color);font-size:clamp(.68rem,2cqw,.76rem)}svg{display:block;width:100%;max-width:100%;height:min(175px,30cqw);min-height:105px;overflow:hidden}.axis{stroke:var(--divider-color)}.line{fill:none;stroke:var(--primary-color);stroke-width:3;stroke-linecap:round}.dotline{fill:var(--primary-color);stroke:var(--ha-card-background,#1c1c1c);stroke-width:2}.v{fill:var(--primary-text-color);font-size:clamp(9px,1.8cqw,11px);font-weight:700}.x{fill:var(--secondary-text-color);font-size:clamp(8px,1.8cqw,11px)}.c0{fill:#2196f3}.c1{fill:#42a5f5}.c2{fill:#26a69a}.c3{fill:#ffb300}.c4{fill:#ef5350}.myst,.cost{width:100%;padding:0;box-sizing:border-box;min-width:0}.cost-swipe{width:100%;min-width:0;touch-action:pan-y}.cost-period-nav{display:flex;align-items:center;justify-content:center;gap:10px;margin:0 0 8px}.cost-period-nav strong{font-size:clamp(.95rem,3cqw,1.18rem);letter-spacing:.08em}.cost-period-nav button{width:30px;height:30px;font-size:1.35rem;line-height:1;background:transparent;color:var(--primary-text-color);border:1px solid var(--divider-color);cursor:pointer;display:grid;place-items:center}.cost-period-nav button:hover{background:var(--secondary-background-color);border-color:var(--primary-color)}.cost-bars{display:flex;flex-direction:column;gap:12px;margin:0;padding:1px 0 0}.cost-time-wrap{width:100%;min-width:0}.cost-time-track{position:relative;display:flex;width:100%;height:30px;border-radius:9px;overflow:hidden;border:1px solid var(--divider-color);background:var(--secondary-background-color);box-sizing:border-box}.cost-time-segment{position:relative;flex:1 1 0;min-width:0;border-right:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.025);overflow:hidden}.cost-time-segment:last-of-type{border-right:0}.cost-time-fill{position:absolute;inset:0 auto 0 0;transition:width .35s ease,background-color .25s ease}.cost-time-fill.green{background:#43d85b}.cost-time-fill.yellow{background:#f2c21f}.cost-time-fill.red{background:#e8453c}.cost-time-fill.neutral{background:#70757a}.cost-now{position:absolute;top:-1px;bottom:-1px;width:2px;background:#fff;box-shadow:0 0 5px rgba(255,255,255,.7);transform:translateX(-1px);z-index:3}.cost-time-labels{display:flex;justify-content:space-between;padding-top:5px;color:var(--secondary-text-color);font-size:clamp(.55rem,1.7cqw,.68rem);font-weight:600}.cost-time-labels span{white-space:nowrap}.cost-time-legend{display:flex;justify-content:center;gap:clamp(10px,3cqw,20px);padding-top:8px;color:var(--secondary-text-color);font-size:clamp(.58rem,1.8cqw,.7rem)}.cost-time-legend span{display:flex;align-items:center;gap:4px;white-space:nowrap}.cost-time-legend i{width:8px;height:8px;border-radius:50%;display:inline-block}.green-dot{background:#43d85b}.yellow-dot{background:#f2c21f}.red-dot{background:#e8453c}.cost-timeline-title{text-align:center;font-size:clamp(.62rem,1.9cqw,.74rem);letter-spacing:.08em;font-weight:800;color:var(--secondary-text-color);margin-bottom:5px}.cost-money-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px}.cost-money-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 10px;border-radius:8px;background:var(--secondary-background-color);border:1px solid var(--divider-color);font-size:clamp(.78rem,2.4cqw,.92rem);font-weight:700}.cost-money-row strong{font-variant-numeric:tabular-nums}.cost-loading,.cost-timeline-loading{width:100%;text-align:center;color:var(--secondary-text-color);padding:18px 10px}.cost-loading{width:100%;text-align:center;color:var(--secondary-text-color);padding:18px 10px}.cost-head-total{display:flex;flex-direction:column;align-items:flex-end;justify-content:flex-start;min-width:68px;margin-left:auto;margin-right:clamp(28px,4cqw,52px);padding-top:0;transform:translateY(-3px)}.cost-head-total span{font-size:clamp(.52rem,1.5cqw,.62rem);letter-spacing:.07em;color:var(--secondary-text-color);white-space:nowrap}.cost-head-total strong{font-size:clamp(1rem,3cqw,1.28rem);line-height:1.05;font-variant-numeric:tabular-nums;white-space:nowrap}.body:has(.cost-swipe)+.dots{display:none}.cost-loading{width:100%;text-align:center;color:var(--secondary-text-color);padding:18px 10px}.cost-head-total{display:flex;flex-direction:column;align-items:flex-end;justify-content:flex-start;min-width:68px;margin-left:auto;margin-right:clamp(28px,4cqw,52px);padding-top:0;transform:translateY(-3px)}.cost-head-total span{font-size:clamp(.52rem,1.5cqw,.62rem);letter-spacing:.07em;color:var(--secondary-text-color);white-space:nowrap}.cost-head-total strong{font-size:clamp(1rem,3cqw,1.28rem);line-height:1.05;font-variant-numeric:tabular-nums;white-space:nowrap}.body:has(.cost-swipe)+.dots{display:none}@media (pointer:fine){.cost-swipe-hint{display:none}}@container energyiq-card (max-width:420px){.cost-period-nav{gap:7px;margin-top:8px;margin-bottom:0}.cost-bars{gap:8px}.cost-time-track{height:23px}.cost-money-grid{gap:6px}.cost-money-row{padding:6px 8px;font-size:.82rem}.cost-head-total{min-width:60px}.cost-head-total span{font-size:.5rem}.cost-head-total strong{font-size:1rem}.cost-view .title{font-size:1.3rem}}@container energyiq-card (max-width:420px){.pad{padding:9px 10px 7px}.head-actions button{width:29px;height:29px}.active-shortcut{font-size:0}.active-shortcut::before{content:"⚡";font-size:1rem}.title{font-size:1rem}.sub{font-size:.67rem}.summary{margin:2px}.summary b,.big{font-size:1.7rem}svg{height:120px;min-height:100px}.legend{gap:5px}.break{gap:6px}}@container energyiq-card (max-height:240px){.pad{padding-top:8px;padding-bottom:6px}.body{overflow:hidden}.sub{display:none}.dots{padding-top:2px}.track{margin-top:8px}.break{margin-top:7px}}@container energyiq-card (min-width:700px){.body{padding-left:4px;padding-right:4px}.summary{margin-left:0}.chart svg{height:min(185px,28cqw)}}.empty{width:100%;text-align:center;color:var(--secondary-text-color);font-size:clamp(.78rem,2.3cqw,.9rem);padding:10px}.err{margin-top:10px;color:var(--error-color)}.active-loads-backdrop{position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.58);display:flex;align-items:center;justify-content:center;padding:16px}.active-loads{width:min(430px,100%);max-height:82vh;overflow:auto;background:var(--card-background-color);border:1px solid var(--divider-color);border-radius:14px;box-shadow:var(--ha-card-box-shadow);padding:16px;box-sizing:border-box}.active-loads-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.active-loads-title{font-size:1.25rem;font-weight:800}.active-loads-head button{width:38px;height:38px;padding:0}.active-load-list{margin-top:12px}.active-load-row{display:flex;justify-content:space-between;gap:12px;padding:9px 2px;border-bottom:1px solid var(--divider-color)}.active-load-row span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.active-load-row strong{white-space:nowrap;font-variant-numeric:tabular-nums}.active-load-empty{text-align:center;padding:22px;color:var(--secondary-text-color)}.active-load-summary{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-top:12px}.active-load-summary div{padding:9px;border-radius:9px;background:var(--secondary-background-color);border:1px solid var(--divider-color)}.active-load-summary span{display:block;font-size:9px;text-transform:uppercase;color:var(--secondary-text-color)}.active-load-summary strong{display:block;margin-top:3px;font-size:14px;font-variant-numeric:tabular-nums}@media(max-width:500px){.active-loads-backdrop{padding:10px}.active-loads{max-height:88vh;padding:14px}.active-load-summary{grid-template-columns:1fr 1fr}.active-load-summary div:last-child{grid-column:1/-1}}';}
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
