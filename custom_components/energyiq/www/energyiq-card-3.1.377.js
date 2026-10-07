/* EnergyIQ dashboard card — 3.1.376 */
const TAG = "energyiq-card";
if (!customElements.get(TAG)) {
  class EnergyIQCard extends HTMLElement {
    constructor() { super(); this._hass=null; this._cfg={}; this._data=null; this._entryId=null; this._view=0; this._timer=null; this._busy=false; this._ro=null; this._click=this._handleClick.bind(this); this._costPeriod="day"; this._costHistory=null; this._costHistoryAt=0; this._costLearned=null; this._costSwipeStartX=0; this._costSwipeStartY=0; this._costSwipeActive=false; this._consumptionPeriod="day"; this._mysteryHistory=[]; }
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
    getGridOptions(){return {columns:"full",rows:"auto",min_columns:3};}
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
    async _refresh(){try{this._data=await this._ws({type:"energy_attribution/workspace",entry_id:this._entryId});
const home=this._num(this._data.whole_home_power),trained=Math.max(0,this._num(this._data.trained_live_power_w)||0);
if(home!=null){this._mysteryHistory.push(Math.max(0,home-trained));if(this._mysteryHistory.length>90)this._mysteryHistory.shift();}
if(this._view===2&&Date.now()-this._costHistoryAt>30000)await this._loadCostHistory();this._render();}catch(e){console.error("EnergyIQ card",e);}}
    _num(v){v=Number(v);return Number.isFinite(v)?v:null;}
    _periodBounds(period){
      const now=new Date(), start=new Date(now);
      if(period==="hour"){start.setMinutes(0,0,0);}
      else if(period==="month"){start.setDate(1);start.setHours(0,0,0,0);}
      else if(period==="week"){start.setHours(0,0,0,0);start.setDate(start.getDate()-start.getDay());}
      else {start.setHours(0,0,0,0);}
      return {start,end:now};
    }
    _costLearningSpec(period){
      return {count:30};
    }
    _shiftPeriodStart(start,period,amount){
      const d=new Date(start);
      if(period==="week")d.setDate(d.getDate()-7*amount);
      else if(period==="month")d.setMonth(d.getMonth()-amount);
      else d.setDate(d.getDate()-amount);
      return d;
    }
    _periodEnd(start,period){
      const d=new Date(start);
      if(period==="week")d.setDate(d.getDate()+7);
      else if(period==="month")d.setMonth(d.getMonth()+1);
      else d.setDate(d.getDate()+1);
      return d;
    }
    _historyNumberAt(states,time,preferAfter){
      let best=null,bestDelta=Infinity;
      for(const item of states||[]){
        const rawTime=item.lc??item.lu??item.last_changed??item.last_updated;
        let t=typeof rawTime==="number"?rawTime:(Date.parse(rawTime||""));
        if(Number.isFinite(t)&&t<1e12)t*=1000;
        const v=Number(item.s??item.state);
        if(!Number.isFinite(t)||!Number.isFinite(v))continue;
        const delta=t-time;
        if(preferAfter ? delta>=0 : delta<=0){
          const distance=Math.abs(delta);
          if(distance<bestDelta){best=item;bestDelta=distance;}
        }
      }
      return best?Number(best.s??best.state):null;
    }
    _historicalMovingDeltas(states,period,currentStart,currentEnd,count){
      // Compare each prior period at the same elapsed point as the current period.
      const values=[];
      const elapsed=Math.max(0,currentEnd.getTime()-currentStart.getTime());
      for(let i=1;i<=count;i++){
        const pStart=this._shiftPeriodStart(currentStart,period,i);
        const pAt=new Date(pStart.getTime()+elapsed);
        const before=this._historyNumberAt(states,pStart.getTime(),false);
        const at=this._historyNumberAt(states,pAt.getTime(),true)??this._historyNumberAt(states,pAt.getTime(),false);
        if(Number.isFinite(before)&&Number.isFinite(at)&&at>=before)values.push(at-before);
      }
      return values;
    }
    _periodStart(period,offset=0,from=new Date()){
      const d=new Date(from); d.setHours(0,0,0,0);
      if(period==="week"){d.setDate(d.getDate()-d.getDay()+offset*7);}
      else if(period==="month"){d.setDate(1);d.setMonth(d.getMonth()+offset);}
      else {d.setDate(d.getDate()+offset);}
      return d;
    }
    _periodEnd(period,start){const d=new Date(start);if(period==="week")d.setDate(d.getDate()+7);else if(period==="month")d.setMonth(d.getMonth()+1);else d.setDate(d.getDate()+1);return d;}
    _costEntity(preferred,exact,patterns){
      if(preferred&&this._hass?.states?.[preferred])return preferred;
      for(const id of exact||[])if(this._hass?.states?.[id])return id;
      const scored=[];
      for(const [id,obj] of Object.entries(this._hass?.states||{})){
        if(!id.startsWith("sensor."))continue;
        const text=(id+" "+String(obj?.attributes?.friendly_name||"")).toLowerCase();
        let score=0;
        for(const p of patterns||[])if(text.includes(p))score++;
        if(score===(patterns||[]).length&&score>0)scored.push(id);
      }
      return scored.sort()[0]||null;
    }
    _historyEntries(states){
      return (states||[]).map(item=>{
        const raw=item.lu??item.last_updated??item.last_changed;
        let t=typeof raw==="number"?raw:Date.parse(raw||"");
        if(Number.isFinite(t)&&t<1e12)t*=1000;
        const v=Number(item.s??item.state);
        return {t,v};
      }).filter(x=>Number.isFinite(x.t)&&Number.isFinite(x.v)).sort((a,b)=>a.t-b.t);
    }
    _periodAccumulatedCost(states,startMs,endMs){
      const entries=this._historyEntries(states);
      if(!entries.length)return null;
      let previous=null,total=0,started=false;
      for(const e of entries){
        if(e.t<startMs){
          previous=e.v;
          continue;
        }
        if(e.t>endMs)break;
        if(!started){
          if(previous==null)total=Math.max(0,e.v);
          started=true;
          previous=e.v;
          continue;
        }
        if(e.v>=previous)total+=e.v-previous;
        else total+=Math.max(0,e.v);
        previous=e.v;
      }
      return started?Math.max(0,total):null;
    }
    _periodCost(states,start,end,sampleEnd=end){
      return this._periodAccumulatedCost(states,start.getTime(),Math.min(end.getTime(),sampleEnd.getTime()));
    }
    _learnCost(states,period,now,periodCount=30){
      const currentStart=this._periodStart(period,0,now);
      const currentEnd=this._periodEnd(period,currentStart);
      const elapsed=Math.max(0,Math.min(now.getTime(),currentEnd.getTime())-currentStart.getTime());
      const sampleEnd=new Date(currentStart.getTime()+elapsed);
      const current=this._periodCost(states,currentStart,currentEnd,sampleEnd);
      const samples=[];
      for(let i=1;i<=periodCount;i++){
        const s=this._periodStart(period,-i,now);
        const e=this._periodEnd(period,s);
        const se=new Date(s.getTime()+elapsed);
        const v=this._periodCost(states,s,e,se);
        if(v!=null&&Number.isFinite(v)&&v>=0)samples.push(v);
      }
      const average=samples.length?samples.reduce((a,b)=>a+b,0)/samples.length:null;
      const max=Math.max(current||0,...samples,0);
      const ratio=average>0&&current!=null?current/average:null;
      const color=ratio==null?"neutral":ratio>1.10?"red":ratio>=0.90?"yellow":"green";
      return {current,average,max,ratio,color,samples:samples.length};
    }
    _statChangeValue(result){
      const n=Number(result?.change);
      return Number.isFinite(n)?Math.max(0,n):null;
    }
    async _statChangeForPeriod(statisticId,start,end){
      if(!statisticId||!start||!end)return null;
      try{
        const result=await this._ws({
          type:"recorder/statistic_during_period",
          statistic_id:statisticId,
          fixed_period:{start_time:start.toISOString(),end_time:end.toISOString()},
          types:["change"]
        });
        return this._statChangeValue(result);
      }catch(e){
        console.debug("EnergyIQ cost period statistic unavailable",statisticId,e);
        return null;
      }
    }
    _statisticsRowTime(row,key){
      const raw=row?.[key];
      const t=typeof raw==="number"?(raw<1e12?raw*1000:raw):Date.parse(raw||"");
      return Number.isFinite(t)?t:null;
    }
    _historicalStatisticChange(rows,startMs,endMs){
      let total=0,seen=false;
      for(const row of (rows||[])){
        const rs=this._statisticsRowTime(row,"start"),re=this._statisticsRowTime(row,"end");
        if(rs==null||re==null)continue;
        if(re<=startMs)continue;
        if(rs>=endMs)break;
        // Only use complete statistics intervals. The current period is queried
        // separately with statistic_during_period so partial hours stay exact.
        if(rs>=startMs&&re<=endMs){
          const n=Number(row.change);
          if(Number.isFinite(n)){total+=Math.max(0,n);seen=true;}
        }
      }
      return seen?Math.max(0,total):null;
    }
    _historicalSamples(rows,period,now,count=30){
      const currentStart=this._periodStart(period,0,now);
      const elapsed=Math.max(0,Math.min(now.getTime(),this._periodEnd(period,currentStart).getTime())-currentStart.getTime());
      const values=[];
      for(let i=1;i<=count;i++){
        const s=this._periodStart(period,-i,now);
        const e=this._periodEnd(period,s);
        const sampleEnd=new Date(s.getTime()+elapsed);
        const v=this._historicalStatisticChange(rows,s.getTime(),Math.min(sampleEnd.getTime(),e.getTime()));
        if(v!=null&&Number.isFinite(v)&&v>=0)values.push(v);
      }
      return values;
    }
    _historyEntries(states){
      return (states||[]).map(item=>{
        const raw=item.lu??item.last_updated??item.last_changed;
        let t=typeof raw==="number"?raw:Date.parse(raw||"");
        if(Number.isFinite(t)&&t<1e12)t*=1000;
        const v=Number(item.s??item.state);
        return {t,v};
      }).filter(x=>Number.isFinite(x.t)&&Number.isFinite(x.v)).sort((a,b)=>a.t-b.t);
    }
    _periodAccumulatedCost(states,startMs,endMs){
      const entries=this._historyEntries(states);
      if(!entries.length)return null;
      let previous=null,total=0,started=false;
      for(const e of entries){
        if(e.t<startMs){previous=e.v;continue;}
        if(e.t>endMs)break;
        if(!started){
          if(previous==null)total=Math.max(0,e.v);
          started=true;previous=e.v;continue;
        }
        if(e.v>=previous)total+=e.v-previous;
        else total+=Math.max(0,e.v);
        previous=e.v;
      }
      return started?Math.max(0,total):null;
    }
    _periodCost(states,start,end,sampleEnd=end){
      return this._periodAccumulatedCost(states,start.getTime(),Math.min(end.getTime(),sampleEnd.getTime()));
    }
    _buildLearned(period,now,current,statRows,historyStates,colorFallback=null){
      const currentStart=this._periodStart(period,0,now),currentEnd=this._periodEnd(period,currentStart);
      const elapsed=Math.max(0,Math.min(now.getTime(),currentEnd.getTime())-currentStart.getTime());
      const sampleEnd=new Date(currentStart.getTime()+elapsed);
      let currentValue=current;
      if(currentValue==null)currentValue=this._periodCost(historyStates,currentStart,currentEnd,sampleEnd);
      let samples=this._historicalSamples(statRows,period,now,30);
      if(samples.length===0){
        const elapsedSamples=[];
        for(let i=1;i<=30;i++){
          const s=this._periodStart(period,-i,now),e=this._periodEnd(period,s),se=new Date(s.getTime()+elapsed);
          const v=this._periodCost(historyStates,s,e,se);
          if(v!=null&&Number.isFinite(v)&&v>=0)elapsedSamples.push(v);
        }
        samples=elapsedSamples;
      }
      let colorCurrent=currentValue,colorSamples=samples;
      if((colorSamples.length===0||colorCurrent==null)&&colorFallback){
        colorCurrent=colorFallback.current;
        colorSamples=colorFallback.samples||[];
      }
      const average=samples.length?samples.reduce((a,b)=>a+b,0)/samples.length:null;
      const colorAverage=colorSamples.length?colorSamples.reduce((a,b)=>a+b,0)/colorSamples.length:null;
      const ratio=colorAverage>0&&colorCurrent!=null?colorCurrent/colorAverage:null;
      const color=ratio==null?"neutral":ratio>1.10?"red":ratio>=0.90?"yellow":"green";
      return {current:currentValue,average,max:Math.max(currentValue||0,...samples,0),ratio,color,samples:samples.length};
    }
    async _loadCostHistory(){
      if(!this._hass||!this._data)return;
      this._costError=null;
      try{
        const period=this._costPeriod,now=new Date();
        const currentStart=this._periodStart(period,0,now);
        const currentEnd=now;
        const peakId="input_number.energyiq_peak_cost_history";
        const offId="input_number.energyiq_off_peak_cost_history";

        if(period==="day"){
          const result=await this._ws({
            type:"history/history_during_period",
            start_time:currentStart.toISOString(),
            end_time:currentEnd.toISOString(),
            entity_ids:[peakId,offId],
            include_start_time_state:true,
            significant_changes_only:false,
            minimal_response:true,
            no_attributes:true
          });

          const peakStates=result?.[peakId]||[];
          const offStates=result?.[offId]||[];
          const peakSeries=this._fiveMinuteCostSeries(peakStates,currentStart,currentEnd);
          const offSeries=this._fiveMinuteCostSeries(offStates,currentStart,currentEnd);
          const peakCurrent=peakSeries.total;
          const offCurrent=offSeries.total;

          if(!peakSeries.seen&&!offSeries.seen){
            throw new Error("EnergyIQ cost history helpers contain no usable 5-minute data for today.");
          }

          this._costHistory={
            peak:peakCurrent,
            off:offCurrent,
            total:peakCurrent+offCurrent
          };
          this._costLearned={
            peak:{current:peakCurrent,average:null,max:peakCurrent,ratio:null,color:"neutral",samples:0},
            off:{current:offCurrent,average:null,max:offCurrent,ratio:null,color:"neutral",samples:0}
          };
          this._costChart=this._costChartBuckets(
            {peak:peakSeries.points,off:offSeries.points},
            peakId,offId,period,currentStart,this._periodEnd(period,currentStart),
            peakStates,offStates
          );
          this._costHistoryAt=Date.now();
          this._render();
          return;
        }

        // WEEK/MONTH remain on the existing 3.1.376 implementation until
        // DAY is verified against the helper history.
        const historyCount=period==="month"?12:12;
        const historyStart=this._periodStart(period,-historyCount,now);
        const result=await this._ws({
          type:"history/history_during_period",
          start_time:historyStart.toISOString(),
          end_time:currentEnd.toISOString(),
          entity_ids:[peakId,offId],
          include_start_time_state:true,
          significant_changes_only:false,
          minimal_response:true,
          no_attributes:true
        });
        const peakStates=result?.[peakId]||[];
        const offStates=result?.[offId]||[];
        const peakCurrent=this._periodCost(peakStates,currentStart,currentEnd);
        const offCurrent=this._periodCost(offStates,currentStart,currentEnd);
        if(peakCurrent==null&&offCurrent==null){
          throw new Error("EnergyIQ cost history helpers contain no usable data for the selected period.");
        }
        const peak=this._buildLearned(period,now,peakCurrent,[],peakStates);
        const off=this._buildLearned(period,now,offCurrent,[],offStates);
        this._costHistory={peak:peak.current,off:off.current,total:(peak.current||0)+(off.current||0)};
        this._costLearned={peak,off};
        this._costChart=this._costChartBuckets(
          {peak:peakStates,off:offStates},
          peakId,offId,period,currentStart,this._periodEnd(period,currentStart),
          peakStates,offStates
        );
        this._costHistoryAt=Date.now();
      }catch(e){
        console.error("EnergyIQ cost history",e);
        this._costHistory=null;
        this._costLearned=null;
        this._costChart=null;
        this._costError=e?.message||String(e);
        this._costHistoryAt=Date.now();
      }
      this._render();
    }
    _state(id){return this._num(this._hass&&this._hass.states&&this._hass.states[id]&&this._hass.states[id].state);}
    _brandIcon(){return '<ha-icon class="energyiq-brand-icon" icon="mdi:home-lightning-bolt-outline"></ha-icon>';}
    _next(e){if(!e.target.closest||!e.target.closest("[data-next]"))return;e.stopPropagation();this._view=(this._view+1)%3;if(this._view===2&&Date.now()-this._costHistoryAt>30000)this._loadCostHistory();this._render();}
    _handleClick(e){
      const next=e.target.closest("[data-next]");
      const active=e.target.closest("[data-active-loads]");
      const open=e.target.closest("[data-open-energyiq]");
      const cp=e.target.closest("[data-consumption-period]");
      const costPeriod=e.target.closest("[data-cost-period]");
      const train=e.target.closest("[data-train-now]");
      if(cp){e.stopPropagation();this._consumptionPeriod=cp.dataset.consumptionPeriod;this._render();return;}
      if(costPeriod){e.stopPropagation();const p=costPeriod.dataset.costPeriod;if(p==="day"||p==="week"||p==="month"){this._costPeriod=p;this._costHistoryAt=0;this._loadCostHistory();}return;}
      if(train){e.stopPropagation();this._openEnergyIQ();return;}
      if(next){e.stopPropagation();this._view=(this._view+1)%3;this._render();if(this._view===2)this._loadCostHistory();return;}
      if(active){e.stopPropagation();this._showActiveLoads();return;}
      if(open){e.stopPropagation();this._openEnergyIQ();return;}
    }
    _openEnergyIQ(){if(this._hass&&typeof this._hass.navigate==="function"){this._hass.navigate("/energyiq");return;}window.history.pushState({}, "", "/energyiq");window.dispatchEvent(new Event("location-changed"));}
    _closeActiveLoads(){const modal=this.querySelector(".active-loads-backdrop");if(modal)modal.remove();}
    _showActiveLoads(){this._closeActiveLoads();const d=this._data||{},home=this._num(d.whole_home_power),trained=Math.max(0,this._num(d.trained_live_power_w)||0),mystery=home==null?null:Math.max(0,home-trained);const active=(d.devices||[]).filter(x=>x.classification==="monitor").map(x=>Object.assign({},x,{w:Math.max(0,Number(x.current_power)||0)})).filter(x=>x.w>0).sort((a,b)=>b.w-a.w);const known=active.reduce((s,x)=>s+x.w,0);const rows=active.length?active.map(x=>`<div class="active-load-row"><span>${this._esc(x.name||x.device_id)}</span><strong>${x.w.toFixed(0)} W</strong></div>`).join(""):`<div class="active-load-empty">No active attributed loads right now.</div>`;const fmt=v=>Number.isFinite(v)?`${v.toFixed(0)} W`:"—";this.insertAdjacentHTML("beforeend",`<div class="active-loads-backdrop" role="presentation"><div class="active-loads" role="dialog" aria-modal="true" aria-label="Active EnergyIQ loads"><div class="active-loads-head"><div><div class="eyebrow">ENERGYIQ</div><div class="active-loads-title">Active Loads</div><div class="sub">${active.length} currently consuming</div></div><button data-close-active aria-label="Close">×</button></div><div class="active-load-list">${rows}</div><div class="active-load-summary"><div><span>Known</span><strong>${fmt(known)}</strong></div><div><span>Unattributed</span><strong>${fmt(mystery)}</strong></div><div><span>House total</span><strong>${fmt(home)}</strong></div></div></div></div>`);}

    _esc(v){return String(v).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c];});}
    _loading(){this.innerHTML='<ha-card><div class="pad"><b>EnergyIQ</b> <span>Loading...</span></div></ha-card>';}
    _error(m){this.innerHTML='<ha-card><div class="pad"><b>EnergyIQ</b><div class="err">'+this._esc(m)+'</div></div></ha-card>';}
    _render(){
      var d=this._data||{},home=this._num(d.whole_home_power),trained=Math.max(0,this._num(d.trained_live_power_w)||0),known=home==null?null:Math.min(home,trained),mystery=home==null?null:Math.max(0,home-trained);
      var devices=(d.devices||[]).filter(function(x){return x.classification==="monitor";}).map(function(x){return Object.assign({},x,{w:Math.max(0,Number(x.current_power)||0)});}).filter(function(x){return x.w>0;}).sort(function(a,b){return b.w-a.w;});
      var total=this._state(this._cfg.cost_entity||"sensor.dte_variable_energy_cost"),peak=this._state(this._cfg.peak_cost_entity||"sensor.dte_peak_energy_cost"),off=this._state(this._cfg.off_peak_cost_entity||"sensor.dte_off_peak_energy_cost");
      var titles=["CONSUMPTION","MYSTERY WATTS","COST"],subs=["Current attributed power","Known vs. unexplained power",""],body=this._view===0?this._consumptionChart(d.consumption_accounting,this._consumptionPeriod,d.consumption_thresholds,d.consumption_peak_schedule):this._view===1?this._mystery(home,known,mystery):this._cost(total,peak,off);
      const costTotal=this._costHistory&&this._costHistory.total!=null?this._costHistory.total:total;
      const costMoney=Number.isFinite(Number(costTotal))?"$"+Number(costTotal).toFixed(2):"—";
      const costLabel=this._costPeriod==="week"?"TOTAL THIS WEEK":this._costPeriod==="month"?"TOTAL THIS MONTH":"TOTAL TODAY";
      const headExtra=this._view===2?'<div class="cost-head-total"><span>'+costLabel+'</span><strong>'+costMoney+'</strong></div>':"";
      this.innerHTML='<style>'+this._css()+'</style><ha-card><div class="pad"><div class="head '+(this._view===2?"cost-view":"")+'"><div class="card-title-wrap"><div class="card-icon">'+this._brandIcon()+'</div><div><div class="eyebrow">ENERGYIQ</div><div class="title">'+titles[this._view]+'</div><div class="sub">'+subs[this._view]+'</div></div></div>'+headExtra+'<div class="head-actions"><button class="active-shortcut" data-active-loads aria-label="Show active loads">⚡</button><button class="open-shortcut" data-open-energyiq aria-label="Open EnergyIQ">↗</button><button data-next aria-label="Next view">→</button></div></div><div class="body">'+body+'</div></div></ha-card>';
    }
    _consumptionChart(accounting,period,thresholds,schedule){
      const intervals=(accounting&&Array.isArray(accounting.intervals)?accounting.intervals:[]);
      const now=new Date(), start=new Date(now);
      if(period==="week"){start.setHours(0,0,0,0);start.setDate(start.getDate()-start.getDay());}
      else if(period==="month"){start.setDate(1);start.setHours(0,0,0,0);}
      else {start.setHours(0,0,0,0);}
      const end=period==="day"?new Date(start.getTime()+86400000):period==="week"?new Date(start.getTime()+7*86400000):new Date(start.getFullYear(),start.getMonth()+1,1);
      const bucketMs=period==="day"?5*60000:period==="week"?3600000:6*3600000;
      const bucketCount=Math.ceil((end-start)/bucketMs);
      const buckets=Array.from({length:bucketCount},(_,i)=>({kwh:0,when:new Date(start.getTime()+i*bucketMs),rate:null}));
      intervals.forEach(it=>{
        const a=new Date(it.start),b=new Date(it.end),rate=it.rate==="peak"?"peak":"off_peak";
        if(!Number.isFinite(a.getTime())||!Number.isFinite(b.getTime())||b<=start||a>=end)return;
        let cur=new Date(Math.max(a.getTime(),start.getTime())), finish=new Date(Math.min(b.getTime(),end.getTime()));
        const total=b-a,kwh=Number(it.kwh)||0;
        while(cur<finish){
          const idx=Math.floor((cur-start)/bucketMs);
          if(idx<0||idx>=buckets.length)break;
          const bucketEnd=new Date(Math.min(finish,start.getTime()+(idx+1)*bucketMs));
          const overlap=Math.max(0,bucketEnd-cur);
          const frac=total>0?overlap/total:0;
          buckets[idx].kwh+=kwh*frac;
          buckets[idx].rate=rate;
          cur=bucketEnd;
        }
      });
      const rows=buckets.filter(x=>x.kwh>0||x.rate!==null);
      const labels={day:"DAY",week:"WEEK",month:"MONTH"},periodLabel=labels[period]||"DAY";
      const totals=this._data&&this._data.consumption_period_totals&&this._data.consumption_period_totals[period]||{peak:0,off_peak:0};
      const total=Number(totals.peak||0)+Number(totals.off_peak||0);
      if(!rows.length)return '<div class="consumption-wrap"><div class="consumption-period-nav"><button data-consumption-period="day" class="'+(period==="day"?"selected":"")+'">DAY</button><button data-consumption-period="week" class="'+(period==="week"?"selected":"")+'">WEEK</button><button data-consumption-period="month" class="'+(period==="month"?"selected":"")+'">MONTH</button></div><div class="consumption-empty">No consumption history available yet.</div></div>';
      const W=760,H=185,L=36,R=16,T=20,B=28,ch=H-T-B;
      const max=Math.max(0.01,...rows.map(x=>x.kwh));
      const barGap=period==="day"?0.5:period==="week"?1:1.5;
      const barWidth=Math.max(1,((W-L-R)/bucketCount)-barGap);
      const baseline=T+ch;let svg='<svg viewBox="0 0 '+W+' '+H+'"><line x1="'+L+'" y1="'+baseline+'" x2="'+(W-R)+'" y2="'+baseline+'" class="axis"/>';
      if(period==="day"){
        const tariffSchedule=schedule||{};
        const toHour=value=>{const parts=String(value||"00:00:00").split(":").map(Number);return (parts[0]||0)+((parts[1]||0)/60)+((parts[2]||0)/3600);};
        const startHour=toHour(tariffSchedule.start),endHour=toHour(tariffSchedule.end);
        const localDay=(start.getDay());
        const peakDays=Array.isArray(tariffSchedule.days)?tariffSchedule.days.map(Number):[1,2,3,4,5];
        const haDay=(localDay+0);
        if(peakDays.includes(haDay)){
          [startHour,endHour].forEach(h=>{
            if(h>=0&&h<=24){
              const x=L+(h/24)*(W-L-R);
              svg+='<line x1="'+x+'" y1="'+T+'" x2="'+x+'" y2="'+baseline+'" class="tariff-break"/>';
            }
          });
          let labelHour=startHour<endHour?(startHour+endHour)/2:startHour+(24-endHour+startHour)/2;
          if(labelHour>24)labelHour-=24;
          const peakLabelX=L+(Math.min(24,labelHour)/24)*(W-L-R);
          svg+='<text x="'+peakLabelX+'" y="10" text-anchor="middle" class="tariff-label">PEAK</text>';
        }
      }
      if(period==="week"||period==="month"){const dayCount=period==="week"?7:new Date(start.getFullYear(),start.getMonth()+1,0).getDate();for(let d=1;d<dayCount;d++){const x=L+(d/dayCount)*(W-L-R);svg+='<line x1="'+x.toFixed(2)+'" y1="'+baseline+'" x2="'+x.toFixed(2)+'" y2="'+(baseline+10)+'" class="period-tick"/>';}}
      rows.forEach(row=>{
        const idx=Math.max(0,Math.min(bucketCount-1,Math.floor((row.when-start)/bucketMs)));
        const x=L+(idx/bucketCount)*(W-L-R)+barGap/2;
        const height=(row.kwh/max)*ch;
        const y=T+ch-height;
        const color=this._consumptionColor(row,thresholds);
        svg+='<rect x="'+x.toFixed(2)+'" y="'+y.toFixed(2)+'" width="'+barWidth.toFixed(2)+'" height="'+height.toFixed(2)+'" rx="1" class="bar '+color+'"/>';
      });
      svg+='</svg>';
      return '<div class="consumption-wrap"><div class="consumption-period-nav"><button data-consumption-period="day" class="'+(period==="day"?"selected":"")+'">DAY</button><button data-consumption-period="week" class="'+(period==="week"?"selected":"")+'">WEEK</button><button data-consumption-period="month" class="'+(period==="month"?"selected":"")+'">MONTH</button></div><div class="consumption-summary"><strong>'+total.toFixed(1)+' kWh</strong><span>'+periodLabel+'</span></div>'+svg+'</div>';
    }
    _consumptionColor(row,thresholds){
      const cfg=thresholds&&typeof thresholds==="object"?thresholds:{};
      if(Number.isFinite(Number(cfg.yellow))&&Number.isFinite(Number(cfg.red))){
        const yellow=Number(cfg.yellow),red=Number(cfg.red),value=Number(row.kwh)||0;
        return value>=red?"red":value>=yellow?"yellow":"green";
      }
      const profile=(cfg&&cfg[row.rate])||[];
      if(!profile.length)return "green";
      const hour=row.when.getHours()+row.when.getMinutes()/60;
      let p=profile[0],n=profile[profile.length-1];
      for(let i=1;i<profile.length;i++){const h=Number(String(profile[i].time).slice(0,2))+Number(String(profile[i].time).slice(3,5))/60;if(hour<h){n=profile[i];break;}p=profile[i];}
      const h0=Number(String(p.time).slice(0,2))+Number(String(p.time).slice(3,5))/60,h1=Number(String(n.time).slice(0,2))+Number(String(n.time).slice(3,5))/60;
      const t=h1>h0?Math.max(0,Math.min(1,(hour-h0)/(h1-h0))):0;
      const yellow=Number(p.yellow||0)+(Number(n.yellow||0)-Number(p.yellow||0))*t,red=Number(p.red||0)+(Number(n.red||0)-Number(p.red||0))*t,value=Number(row.kwh)||0;
      return value>=red?"red":value>=yellow?"yellow":"green";
    }
    _mystery(home,known,mystery){
      if(home==null)return '<div class="empty">Whole-home power is unavailable.</div>';
      const vals=this._mysteryHistory||[], W=760,H=120,L=8,R=8,T=8,B=8,max=Math.max(100,...vals),min=Math.min(0,...vals),range=Math.max(1,max-min);
      let svg='<svg viewBox="0 0 '+W+' '+H+'" class="mystery-graph">';
      if(vals.length>1){
        for(let i=1;i<vals.length;i++){
          const x1=L+(i-1)/(vals.length-1)*(W-L-R),x2=L+i/(vals.length-1)*(W-L-R),y1=T+(H-T-B)-(vals[i-1]-min)/range*(H-T-B),y2=T+(H-T-B)-(vals[i]-min)/range*(H-T-B);
          svg+='<line x1="'+x1+'" y1="'+y1+'" x2="'+x2+'" y2="'+y2+'" class="myst-line"/>';
        }
      }
      svg+='</svg>';
      return '<div class="myst"><div class="myst-wattage"><div class="big">'+Math.round(mystery)+' <span>W</span></div><span>Unexplained right now</span></div>'+svg+'<button class="train-now" data-open-energyiq type="button">TRAIN NOW</button></div>';
    }
    _fiveMinuteCostSeries(states,start,end){
      const entries=this._historyEntries(states);
      const startMs=start.getTime(),endMs=end.getTime(),intervalMs=5*60000;
      const points=[];
      let previous=null,seen=false,total=0;

      for(const e of entries){
        if(e.t<startMs){
          previous=e.v;
          continue;
        }
        if(e.t>endMs)break;
        if(previous==null){
          previous=e.v;
          continue;
        }

        let delta=e.v-previous;
        if(delta<0){
          // The helper is an accumulated snapshot. A downward jump is a
          // reset, not negative cost. Establish the new baseline here.
          previous=e.v;
          continue;
        }

        if(Number.isFinite(delta)&&delta>=0){
          const intervalStart=e.t-intervalMs;
          if(intervalStart>=startMs&&intervalStart<endMs){
            points.push({t:intervalStart,v:delta});
            total+=delta;
            seen=true;
          }
        }
        previous=e.v;
      }

      return {points,total,seen};
    }

    _costChartBuckets(history,peakId,offId,period,start,end,peakStates,offStates){
      const bucketMs=period==="day"?5*60000:period==="week"?3600000:6*3600000;
      const bucketCount=Math.max(1,Math.ceil((end.getTime()-start.getTime())/bucketMs));
      const buckets=Array.from({length:bucketCount},(_,i)=>({
        when:new Date(start.getTime()+i*bucketMs),peak:0,off:0
      }));

      const addPoints=(points,key)=>{
        for(const p of points||[]){
          const idx=Math.floor((p.t-start.getTime())/bucketMs);
          if(idx>=0&&idx<buckets.length)buckets[idx][key]+=Math.max(0,Number(p.v)||0);
        }
      };

      if(period==="day"){
        addPoints(history?.[peakId]||[],"peak");
        addPoints(history?.[offId]||[],"off");
      }else{
        // Preserve the existing WEEK/MONTH path until DAY is verified.
        const addHistory=(states,key)=>{
          const entries=this._historyEntries(states);
          let previous=null;
          for(const e of entries){
            if(e.t<=start.getTime()){previous=e.v;continue;}
            if(e.t>end.getTime())break;
            if(previous==null){previous=e.v;continue;}
            const delta=e.v-previous;
            if(delta>=0){
              const idx=Math.floor((e.t-start.getTime())/bucketMs);
              if(idx>=0&&idx<buckets.length)buckets[idx][key]+=delta;
            }
            previous=e.v;
          }
        };
        addHistory(peakStates,"peak");
        addHistory(offStates,"off");
      }
      return {buckets,bucketMs};
    }
    _cost(total,peak,off){
      const h=this._costHistory,learned=this._costLearned,chart=this._costChart;
      if(this._costError)return '<div class="cost-error">'+this._esc(this._costError)+'</div>';
      if(!h||!learned||!chart)return '<div class="cost-loading">Loading cost history…</div>';
      const period=this._costPeriod,labels={day:"DAY",week:"WEEK",month:"MONTH"},periodLabel=labels[period]||"DAY";
      const money=v=>"$"+Number(v||0).toFixed(2);
      const totalValue=Number(h.total)||0,peakValue=Number(h.peak)||0,offValue=Number(h.off)||0;
      const buckets=chart.buckets||[],bucketMs=chart.bucketMs||60000;
      const max=Math.max(0.0001,...buckets.map(x=>(x.peak||0)+(x.off||0)));
      const W=760,H=185,L=36,R=16,T=20,B=28,ch=H-T-B;
      const count=Math.max(1,buckets.length),gap=period==="day"?0.5:period==="week"?1:1.5;
      const width=Math.max(1,((W-L-R)/count)-gap);
      let svg='<svg viewBox="0 0 '+W+' '+H+'"><line x1="'+L+'" y1="'+(T+ch)+'" x2="'+(W-R)+'" y2="'+(T+ch)+'" class="axis"/>';
      if(period==="day"){
        const schedule=this._data?.consumption_peak_schedule||this._data?.peak_schedule||null;
        const parseHour=(text)=>{
          const m=String(text||"").match(/(\d{1,2}):(\d{2})/);
          return m?Number(m[1])+Number(m[2])/60:null;
        };
        const sh=parseHour(schedule?.start),eh=parseHour(schedule?.end);
        if(Number.isFinite(sh)&&Number.isFinite(eh)){
          [sh,eh].forEach(hh=>{
            const x=L+(hh/24)*(W-L-R);
            svg+='<line x1="'+x.toFixed(2)+'" y1="'+T+'" x2="'+x.toFixed(2)+'" y2="'+(T+ch)+'" class="tariff-break"/>';
          });
          const mid=eh>=sh?(sh+eh)/2:((sh+eh+24)/2)%24;
          const px=L+(mid/24)*(W-L-R);
          svg+='<text x="'+px.toFixed(2)+'" y="10" text-anchor="middle" class="tariff-label">PEAK</text>';
        }
      }
      if(period==="week"||period==="month"){
        const days=period==="week"?7:new Date(new Date().getFullYear(),new Date().getMonth()+1,0).getDate();
        for(let d=1;d<days;d++){
          const x=L+(d/days)*(W-L-R);
          svg+='<line x1="'+x.toFixed(2)+'" y1="'+(T+ch)+'" x2="'+x.toFixed(2)+'" y2="'+(T+ch+10)+'" class="period-tick"/>';
        }
      }
      const now=new Date();
      const liveStart=new Date(now);
      if(period==="week"){
        liveStart.setHours(0,0,0,0);
        liveStart.setDate(liveStart.getDate()-liveStart.getDay());
      }else if(period==="month"){
        liveStart.setDate(1);
        liveStart.setHours(0,0,0,0);
      }else{
        liveStart.setHours(0,0,0,0);
      }
      const elapsedMs=Math.max(0,now.getTime()-liveStart.getTime());
      const elapsedCount=Math.min(count,Math.ceil(elapsedMs/bucketMs));
      buckets.forEach((b,i)=>{
        if(i>=elapsedCount)return;
        const sum=(b.peak||0)+(b.off||0);
        if(sum<=0)return;
        const x=L+(i/count)*(W-L-R)+gap/2;
        const totalH=(sum/max)*ch;
        const offH=((b.off||0)/sum)*totalH;
        const peakH=totalH-offH;
        const y=T+ch-totalH;
        if(peakH>0)svg+='<rect x="'+x.toFixed(2)+'" y="'+y.toFixed(2)+'" width="'+width.toFixed(2)+'" height="'+peakH.toFixed(2)+'" rx="1" class="cost-bar-peak"/>';
        if(offH>0)svg+='<rect x="'+x.toFixed(2)+'" y="'+(y+peakH).toFixed(2)+'" width="'+width.toFixed(2)+'" height="'+offH.toFixed(2)+'" rx="1" class="cost-bar-off"/>';
      });
      svg+='</svg>';
      return '<div class="cost-wrap"><div class="cost-period-nav"><button type="button" data-cost-period="day" class="'+(period==="day"?"selected":"")+'">DAY</button><button type="button" data-cost-period="week" class="'+(period==="week"?"selected":"")+'">WEEK</button><button type="button" data-cost-period="month" class="'+(period==="month"?"selected":"")+'">MONTH</button></div><div class="cost-summary"><strong>'+money(totalValue)+'</strong><span>'+periodLabel+'</span></div><div class="cost-detail"><span>PEAK <b>'+money(peakValue)+'</b></span><span>OFF-PEAK <b>'+money(offValue)+'</b></span></div>'+svg+'</div>';
    }
    _css(){return ':host{display:block;width:100%;min-width:0;max-width:100%;height:auto;box-sizing:border-box;container-type:inline-size;container-name:energyiq-card}.pad{padding:clamp(10px,2.2cqw,16px) clamp(10px,2.4cqw,16px) clamp(8px,1.7cqw,10px);color:var(--primary-text-color);min-width:0;width:100%;height:auto;box-sizing:border-box;overflow:hidden;display:flex;flex-direction:column}ha-card{display:flex;flex-direction:column;width:100%;height:auto;max-width:100%;box-sizing:border-box;overflow:hidden}.head{display:flex;justify-content:space-between;align-items:flex-start;gap:clamp(6px,1.5cqw,10px);flex:0 0 auto}.card-title-wrap{display:flex;align-items:center;gap:clamp(6px,1.5cqw,9px);min-width:0}.energyiq-brand-icon{--mdc-icon-size:28px;color:#e7ecef}.card-icon{width:clamp(28px,5.5cqw,34px);height:clamp(28px,5.5cqw,34px);flex:none;display:grid;place-items:center;border-radius:clamp(8px,1.7cqw,10px);background:rgba(28,205,255,.12);border:1px solid rgba(28,205,255,.28);overflow:hidden}.card-icon svg{width:88%;height:88%;display:block}.head-actions{display:flex;align-items:center;gap:clamp(3px,1cqw,6px);flex:none}.eyebrow{font-size:clamp(.62rem,1.9cqw,.72rem);letter-spacing:.12em;font-weight:700;color:var(--secondary-text-color)}.title{font-size:clamp(.98rem,3.2cqw,1.2rem);font-weight:700;line-height:1.15}.cost-view .title{font-size:clamp(1.18rem,4.2cqw,1.58rem);font-weight:800}.sub{font-size:clamp(.68rem,2cqw,.78rem);color:var(--secondary-text-color);line-height:1.2}.head-actions button{width:clamp(30px,5.8cqw,36px);height:clamp(30px,5.8cqw,36px);padding:0}button{width:clamp(34px,6.5cqw,40px);height:clamp(34px,6.5cqw,40px);border:0;border-radius:50%;background:var(--primary-color,#03a9f4);color:#fff;font-size:clamp(1.15rem,3.5cqw,1.5rem);cursor:pointer}.active-shortcut{background:rgba(20,242,184,.14);color:#35e7b0;border:1px solid rgba(20,242,184,.35)}.open-shortcut{background:rgba(28,205,255,.12);color:#36c8ff;border:1px solid rgba(28,205,255,.28)}.body{min-height:0;flex:0 0 auto;display:flex;align-items:center;min-width:0;width:100%;overflow:hidden}.dots{display:flex;justify-content:center;gap:6px;flex:0 0 auto;padding-top:4px}.dots i{width:6px;height:6px;border-radius:50%;background:var(--divider-color)}.dots i.on{background:var(--primary-color)}.chart,.consumption-wrap{width:100%;min-width:0;overflow:hidden}.consumption-period-nav{display:flex;justify-content:center;gap:6px;margin:0 0 3px}.consumption-period-nav button{width:auto;height:30px;padding:0 13px;border-radius:15px;background:transparent;color:var(--secondary-text-color);border:1px solid var(--divider-color);font-size:.72rem;font-weight:800}.consumption-period-nav button.selected{background:var(--primary-color);color:#fff;border-color:var(--primary-color)}.consumption-summary{display:flex;justify-content:center;align-items:baseline;gap:8px;margin:0 0 1px}.consumption-summary strong{font-size:1.35rem}.consumption-summary span{font-size:.7rem;color:var(--secondary-text-color)}.consumption-wrap svg{height:155px;min-height:125px}.tariff-break{stroke:var(--secondary-text-color);stroke-width:2;opacity:.75}.period-tick{stroke:var(--secondary-text-color);stroke-width:2;opacity:.9}.tariff-label{fill:var(--secondary-text-color);font-size:24px;font-weight:800;letter-spacing:.02em}.bar{stroke:none}.bar.green{fill:#43d85b}.bar.yellow{fill:#f2c21f}.bar.red{fill:#e8453c}.bar.neutral{fill:var(--primary-color)}.summary{display:flex;gap:7px;align-items:baseline;margin:4px}.summary b,.big{font-size:clamp(1.65rem,5.5cqw,2.1rem);line-height:1.05}.summary span,.sub{color:var(--secondary-text-color);font-size:clamp(.68rem,2cqw,.76rem)}svg{display:block;width:100%;max-width:100%;height:min(175px,30cqw);min-height:105px;overflow:hidden}.axis{stroke:var(--divider-color)}.line{fill:none;stroke:var(--primary-color);stroke-width:3;stroke-linecap:round}.dotline{fill:var(--primary-color);stroke:var(--ha-card-background,#1c1c1c);stroke-width:2}.v{fill:var(--primary-text-color);font-size:clamp(9px,1.8cqw,11px);font-weight:700}.x{fill:var(--secondary-text-color);font-size:clamp(8px,1.8cqw,11px)}.c0{fill:#2196f3}.c1{fill:#42a5f5}.c2{fill:#26a69a}.c3{fill:#ffb300}.c4{fill:#ef5350}.myst,.cost{width:100%;padding:0;box-sizing:border-box;min-width:0}.myst{display:flex;flex-direction:column;justify-content:flex-start;padding-top:4px}.myst-wattage{display:flex;align-items:baseline;gap:clamp(8px,2.2cqw,16px)}.myst-wattage .big{font-size:clamp(2.15rem,6.8cqw,3rem);line-height:1}.myst-wattage>span{font-size:clamp(.8rem,2.4cqw,1rem);color:var(--secondary-text-color)}.train-now{margin-top:18px;width:min(255px,55%);height:42px;border-radius:8px;background:#03a9f4;color:#fff;border:0;font-size:clamp(.95rem,2.6cqw,1.05rem);font-weight:800;letter-spacing:.08em;display:flex;align-items:center;justify-content:center}.myst-bar-row{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:clamp(8px,2cqw,14px);margin-top:20px}.myst-bar-row>span,.myst-bar-row>strong{font-size:clamp(.9rem,2.8cqw,1.15rem);font-weight:800;white-space:nowrap}.myst-bar-row>strong{font-variant-numeric:tabular-nums}.mystery-graph{width:100%;height:110px;min-height:90px;margin:10px 0 6px;border-top:1px solid var(--divider-color);border-bottom:1px solid var(--divider-color)}.myst-line{stroke:#e8453c;stroke-width:3;stroke-linecap:round;fill:none}.myst-track{height:46px;min-width:0;border-radius:12px;overflow:hidden;background:var(--secondary-background-color);border:2px solid var(--divider-color);box-sizing:border-box}.myst-fill{height:100%;background:#e8453c;border-radius:9px}.cost-wrap{width:100%;min-width:0;overflow:hidden}.cost-period-nav{display:flex;justify-content:center;gap:6px;margin:0 0 3px}.cost-period-nav button{width:auto;height:30px;padding:0 13px;border-radius:15px;background:transparent;color:var(--secondary-text-color);border:1px solid var(--divider-color);font-size:.72rem;font-weight:800}.cost-period-nav button.selected{background:var(--primary-color);color:#fff;border-color:var(--primary-color)}.cost-summary{display:flex;justify-content:center;align-items:baseline;gap:8px;margin:0 0 1px}.cost-summary strong{font-size:1.35rem}.cost-summary span{font-size:.7rem;color:var(--secondary-text-color)}.cost-detail{display:flex;justify-content:center;gap:18px;margin:0 0 3px;color:var(--secondary-text-color);font-size:.68rem;font-weight:800;letter-spacing:.03em}.cost-detail b{color:var(--primary-text-color);font-size:.78rem;margin-left:3px}.cost-wrap svg{height:155px;min-height:125px}.cost-bar-peak{fill:#43d85b;stroke:none}.cost-bar-off{fill:#03a9f4;stroke:none}.tariff-break{stroke:var(--secondary-text-color);stroke-width:2;opacity:.75}.period-tick{stroke:var(--secondary-text-color);stroke-width:2;opacity:.9}.tariff-label{fill:var(--secondary-text-color);font-size:24px;font-weight:800;letter-spacing:.02em}.cost-head-total{display:flex;flex-direction:column;align-items:flex-end;justify-content:flex-start;min-width:68px;margin-left:auto;margin-right:clamp(4px,1.5cqw,10px);padding-top:0}.cost-head-total span{font-size:clamp(.52rem,1.5cqw,.62rem);letter-spacing:.07em;color:var(--secondary-text-color);white-space:nowrap}.cost-head-total strong{font-size:clamp(1rem,3cqw,1.28rem);line-height:1.05;font-variant-numeric:tabular-nums;white-space:nowrap}.cost-loading,.cost-error{width:100%;text-align:center;color:var(--secondary-text-color);padding:22px 10px}.cost-error{color:var(--error-color)}@container energyiq-card (max-width:420px){.cost-period-nav{gap:7px;margin-top:8px;margin-bottom:0}.cost-bars{gap:8px}.cost-track{height:21px}.cost-bar-main{grid-template-columns:minmax(0,1fr) 68px;gap:6px}.cost-total{font-size:.9rem}.cost-view .title{font-size:1.3rem}}@container energyiq-card (max-width:420px){.pad{padding:9px 10px 7px}.head-actions button{width:29px;height:29px}.active-shortcut{font-size:0}.active-shortcut::before{content:"⚡";font-size:1rem}.title{font-size:1rem}.sub{font-size:.67rem}.summary{margin:2px}.summary b,.big{font-size:1.7rem}svg{height:120px;min-height:100px}.legend{gap:5px}.break{gap:6px}}@container energyiq-card (max-height:240px){.pad{padding-top:8px;padding-bottom:6px}.body{overflow:hidden}.sub{display:none}.dots{padding-top:2px}.track{margin-top:8px}.break{margin-top:7px}}@container energyiq-card (min-width:700px){.body{padding-left:4px;padding-right:4px}.summary{margin-left:0}.chart svg{height:min(185px,28cqw)}}.empty{width:100%;text-align:center;color:var(--secondary-text-color);font-size:clamp(.78rem,2.3cqw,.9rem);padding:10px}.err{margin-top:10px;color:var(--error-color)}.active-loads-backdrop{position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.58);display:flex;align-items:center;justify-content:center;padding:16px}.active-loads{width:min(430px,100%);max-height:82vh;overflow:auto;background:var(--card-background-color);border:1px solid var(--divider-color);border-radius:14px;box-shadow:var(--ha-card-box-shadow);padding:16px;box-sizing:border-box}.active-loads-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.active-loads-title{font-size:1.25rem;font-weight:800}.active-loads-head button{width:38px;height:38px;padding:0}.active-load-list{margin-top:12px}.active-load-row{display:flex;justify-content:space-between;gap:12px;padding:9px 2px;border-bottom:1px solid var(--divider-color)}.active-load-row span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.active-load-row strong{white-space:nowrap;font-variant-numeric:tabular-nums}.active-load-empty{text-align:center;padding:22px;color:var(--secondary-text-color)}.active-load-summary{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-top:12px}.active-load-summary div{padding:9px;border-radius:9px;background:var(--secondary-background-color);border:1px solid var(--divider-color)}.active-load-summary span{display:block;font-size:9px;text-transform:uppercase;color:var(--secondary-text-color)}.active-load-summary strong{display:block;margin-top:3px;font-size:14px;font-variant-numeric:tabular-nums}@media(max-width:500px){.active-loads-backdrop{padding:10px}.active-loads{max-height:88vh;padding:14px}.active-load-summary{grid-template-columns:1fr 1fr}.active-load-summary div:last-child{grid-column:1/-1}}';}
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
