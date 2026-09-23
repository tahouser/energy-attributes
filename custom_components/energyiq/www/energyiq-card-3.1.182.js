/* EnergyIQ dashboard card — 3.1.182 */
const TAG = "energyiq-card";
if (!customElements.get(TAG)) {
  class EnergyIQCard extends HTMLElement {
    constructor() { super(); this._hass=null; this._cfg={}; this._data=null; this._entryId=null; this._view=0; this._timer=null; this._busy=false; this._ro=null; this._click=this._handleClick.bind(this); this._costPeriod="day"; this._costHistory=null; this._costHistoryAt=0; this._costLearned=null; this._costSwipeStartX=0; this._costSwipeStartY=0; this._costSwipeActive=false; }
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
    _statisticsValueAt(rows,timeMs){
      let value=null;
      for(const row of (rows||[])){
        const raw=row.start??row.end;
        const t=typeof raw==="number"?(raw<1e12?raw*1000:raw):Date.parse(raw||"");
        if(!Number.isFinite(t)||t>timeMs)break;
        const n=Number(row.sum);
        if(Number.isFinite(n))value=n;
      }
      return value;
    }
    _statisticsPeriodCost(rows,startMs,endMs){
      const a=this._statisticsValueAt(rows,startMs),b=this._statisticsValueAt(rows,endMs);
      if(a==null||b==null)return null;
      return Math.max(0,b-a);
    }
    _buildLearned(period,now,statRows,historyStates){
      const currentStart=this._periodStart(period,0,now),currentEnd=this._periodEnd(period,currentStart);
      const elapsed=Math.max(0,Math.min(now.getTime(),currentEnd.getTime())-currentStart.getTime());
      const sampleEnd=currentStart.getTime()+elapsed;
      const currentHistory=this._periodCost(historyStates,currentStart,currentEnd,new Date(sampleEnd));
      const currentStats=this._statisticsPeriodCost(statRows,currentStart.getTime(),sampleEnd);
      const current=currentStats!=null?currentStats:currentHistory;
      const samples=[];
      for(let i=1;i<=30;i++){
        const s=this._periodStart(period,-i,now),e=this._periodEnd(period,s),se=s.getTime()+elapsed;
        let v=this._statisticsPeriodCost(statRows,s.getTime(),se);
        if(v==null)v=this._periodCost(historyStates,s,e,new Date(se));
        if(v!=null&&Number.isFinite(v)&&v>=0)samples.push(v);
      }
      const average=samples.length?samples.reduce((a,b)=>a+b,0)/samples.length:null;
      const ratio=average>0&&current!=null?current/average:null;
      const color=ratio==null?"neutral":ratio>1.10?"red":ratio>=0.90?"yellow":"green";
      return {current,average,max:Math.max(current||0,...samples,0),ratio,color,samples:samples.length};
    }
    async _loadCostHistory(){
      if(!this._hass||!this._data)return;
      this._costError=null;
      try{
        const period=this._costPeriod,now=new Date(),oldest=this._periodStart(period,-30,now);
        const peakId=this._costEntity(this._cfg.peak_cost_entity,["sensor.dte_peak_energy_cost"],["dte","peak","cost"]);
        const offId=this._costEntity(this._cfg.off_peak_cost_entity,["sensor.dte_off_peak_energy_cost"],["dte","off","peak","cost"]);
        if(!peakId&&!offId)throw new Error("EnergyIQ could not find the Peak and Off-Peak cost sensors.");
        const ids=[peakId,offId].filter(Boolean);
        const [stats,history]=await Promise.all([
          this._ws({type:"recorder/statistics_during_period",start_time:oldest.toISOString(),end_time:now.toISOString(),statistic_ids:ids,period:"hour",types:["sum"]}).catch(()=>({})),
          this._ws({type:"history/history_during_period",start_time:oldest.toISOString(),end_time:now.toISOString(),entity_ids:ids,include_start_time_state:true,significant_changes_only:false,minimal_response:true,no_attributes:true}).catch(()=>({}))
        ]);
        const peakStates=peakId?(history?.[peakId]||[]):[],offStates=offId?(history?.[offId]||[]):[];
        const peakStats=peakId?(stats?.[peakId]||[]):[],offStats=offId?(stats?.[offId]||[]):[];
        const peak=this._buildLearned(period,now,peakStats,peakStates),off=this._buildLearned(period,now,offStats,offStates);
        if(peak.current==null&&off.current==null)throw new Error("Cost sensors returned no usable values for the selected period.");
        this._costHistory={peak:peak.current,off:off.current,total:(peak.current||0)+(off.current||0)};
        this._costLearned={peak,off};this._costHistoryAt=Date.now();
      }catch(e){
        console.error("EnergyIQ cost history",e);this._costHistory=null;this._costLearned=null;this._costError=e?.message||String(e);this._costHistoryAt=Date.now();
      }
      this._render();
    }
    _cost(total,peak,off){
      const h=this._costHistory, learned=this._costLearned;
      if(this._costError)return '<div class="cost-error">'+this._esc(this._costError)+'</div>';
      if(!h||!learned)return '<div class="cost-loading">Loading cost history…</div>';
      const labels={day:"DAY",week:"WEEK",month:"MONTH"},periodLabel=labels[this._costPeriod]||"DAY";
      const money=v=>"$"+Number(v||0).toFixed(2);
      const bar=(label,item)=>{
        const value=Number(item?.current)||0;
        const now=new Date(),start=this._periodStart(this._costPeriod,0,now),end=this._periodEnd(this._costPeriod,start);
        const duration=Math.max(1,end.getTime()-start.getTime());
        const elapsed=Math.max(0,Math.min(now.getTime(),end.getTime())-start.getTime());
        const width=Math.max(0,Math.min(100,elapsed/duration*100));
        return '<div class="cost-bar-row"><div class="cost-bar-head"><span>'+label+'</span><strong>'+money(value)+'</strong></div><div class="cost-bar-track"><div class="cost-bar-fill '+(item?.color||"neutral")+'" style="width:'+width.toFixed(1)+'%"></div></div></div>';
      };
      return '<div class="cost-swipe" role="group" aria-label="Cost period '+periodLabel+'. Swipe left or right to change period."><div class="cost-bars">'+bar("Peak",learned.peak)+bar("Off-Peak",learned.off)+'</div><div class="cost-period-nav"><button type="button" data-cost-period="prev" aria-label="Previous cost period">‹</button><strong>'+periodLabel+'</strong><button type="button" data-cost-period="next" aria-label="Next cost period">›</button></div></div>';
    }
    _css(){return ':host{display:block;width:100%;min-width:0;max-width:100%;height:auto;box-sizing:border-box;container-type:inline-size;container-name:energyiq-card}.pad{padding:clamp(10px,2.2cqw,16px) clamp(10px,2.4cqw,16px) clamp(8px,1.7cqw,10px);color:var(--primary-text-color);min-width:0;width:100%;height:auto;box-sizing:border-box;overflow:hidden;display:flex;flex-direction:column}ha-card{display:flex;flex-direction:column;width:100%;height:auto;max-width:100%;box-sizing:border-box;overflow:hidden}.head{display:flex;justify-content:space-between;align-items:flex-start;gap:clamp(6px,1.5cqw,10px);flex:0 0 auto}.card-title-wrap{display:flex;align-items:center;gap:clamp(6px,1.5cqw,9px);min-width:0}.energyiq-brand-icon{--mdc-icon-size:28px;color:#e7ecef}.card-icon{width:clamp(28px,5.5cqw,34px);height:clamp(28px,5.5cqw,34px);flex:none;display:grid;place-items:center;border-radius:clamp(8px,1.7cqw,10px);background:rgba(28,205,255,.12);border:1px solid rgba(28,205,255,.28);overflow:hidden}.card-icon svg{width:88%;height:88%;display:block}.head-actions{display:flex;align-items:center;gap:clamp(3px,1cqw,6px);flex:none}.eyebrow{font-size:clamp(.62rem,1.9cqw,.72rem);letter-spacing:.12em;font-weight:700;color:var(--secondary-text-color)}.title{font-size:clamp(.98rem,3.2cqw,1.2rem);font-weight:700;line-height:1.15}.cost-view .title{font-size:clamp(1.18rem,4.2cqw,1.58rem);font-weight:800}.sub{font-size:clamp(.68rem,2cqw,.78rem);color:var(--secondary-text-color);line-height:1.2}.head-actions button{width:clamp(30px,5.8cqw,36px);height:clamp(30px,5.8cqw,36px);padding:0}button{width:clamp(34px,6.5cqw,40px);height:clamp(34px,6.5cqw,40px);border:0;border-radius:50%;background:var(--primary-color,#03a9f4);color:#fff;font-size:clamp(1.15rem,3.5cqw,1.5rem);cursor:pointer}.active-shortcut{background:rgba(20,242,184,.14);color:#35e7b0;border:1px solid rgba(20,242,184,.35)}.open-shortcut{background:rgba(28,205,255,.12);color:#36c8ff;border:1px solid rgba(28,205,255,.28)}.body{min-height:0;flex:1;display:flex;align-items:center;min-width:0;width:100%;overflow:hidden}.dots{display:flex;justify-content:center;gap:6px;flex:0 0 auto;padding-top:4px}.dots i{width:6px;height:6px;border-radius:50%;background:var(--divider-color)}.dots i.on{background:var(--primary-color)}.chart{width:100%;min-width:0;overflow:hidden}.summary{display:flex;gap:7px;align-items:baseline;margin:4px}.summary b,.big{font-size:clamp(1.65rem,5.5cqw,2.1rem);line-height:1.05}.summary span,.sub{color:var(--secondary-text-color);font-size:clamp(.68rem,2cqw,.76rem)}svg{display:block;width:100%;max-width:100%;height:min(175px,30cqw);min-height:105px;overflow:hidden}.axis{stroke:var(--divider-color)}.line{fill:none;stroke:var(--primary-color);stroke-width:3;stroke-linecap:round}.dotline{fill:var(--primary-color);stroke:var(--ha-card-background,#1c1c1c);stroke-width:2}.v{fill:var(--primary-text-color);font-size:clamp(9px,1.8cqw,11px);font-weight:700}.x{fill:var(--secondary-text-color);font-size:clamp(8px,1.8cqw,11px)}.c0{fill:#2196f3}.c1{fill:#42a5f5}.c2{fill:#26a69a}.c3{fill:#ffb300}.c4{fill:#ef5350}.myst,.cost{width:100%;padding:0;box-sizing:border-box;min-width:0}.cost-swipe{width:100%;min-width:0;touch-action:pan-y}.cost-bars{display:flex;flex-direction:column;gap:18px;width:100%;padding:6px 0 12px}.cost-bar-row{width:100%}.cost-bar-head{display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin-bottom:7px}.cost-bar-head span{font-size:clamp(1rem,3cqw,1.18rem);font-weight:800;letter-spacing:.02em}.cost-bar-head strong{font-size:clamp(1.1rem,3.8cqw,1.45rem);font-weight:800;font-variant-numeric:tabular-nums}.cost-bar-track{width:100%;height:24px;border-radius:8px;overflow:hidden;background:var(--secondary-background-color);border:1px solid var(--divider-color);box-sizing:border-box}.cost-bar-fill{height:100%;border-radius:7px;transition:width .35s ease}.cost-bar-fill.green{background:#43d85b}.cost-bar-fill.yellow{background:#f2c21f}.cost-bar-fill.red{background:#e8453c}.cost-bar-fill.neutral{background:#70757a}.cost-period-nav{display:flex;align-items:center;justify-content:center;gap:10px;margin:4px 0 0}.cost-period-nav strong{font-size:clamp(1rem,3.2cqw,1.25rem);letter-spacing:.08em;font-weight:800}.cost-period-nav button{width:30px;height:30px;font-size:1.35rem;line-height:1;background:transparent;color:var(--primary-text-color);border:1px solid var(--divider-color);cursor:pointer;display:grid;place-items:center}.cost-period-nav button:hover{background:var(--secondary-background-color);border-color:var(--primary-color)}.cost-head-total{display:flex;flex-direction:column;align-items:flex-end;justify-content:flex-start;min-width:68px;margin-left:auto;margin-right:clamp(4px,1.5cqw,10px);padding-top:0}.cost-head-total span{font-size:clamp(.52rem,1.5cqw,.62rem);letter-spacing:.07em;color:var(--secondary-text-color);white-space:nowrap}.cost-head-total strong{font-size:clamp(1rem,3cqw,1.28rem);line-height:1.05;font-variant-numeric:tabular-nums;white-space:nowrap}.cost-loading,.cost-error{width:100%;text-align:center;color:var(--secondary-text-color);padding:22px 10px}.cost-error{color:var(--error-color)}@container energyiq-card (max-width:420px){.cost-period-nav{gap:7px;margin-top:8px;margin-bottom:0}.cost-bars{gap:8px}.cost-track{height:21px}.cost-bar-main{grid-template-columns:minmax(0,1fr) 68px;gap:6px}.cost-total{font-size:.9rem}.cost-view .title{font-size:1.3rem}}@container energyiq-card (max-width:420px){.pad{padding:9px 10px 7px}.head-actions button{width:29px;height:29px}.active-shortcut{font-size:0}.active-shortcut::before{content:"⚡";font-size:1rem}.title{font-size:1rem}.sub{font-size:.67rem}.summary{margin:2px}.summary b,.big{font-size:1.7rem}svg{height:120px;min-height:100px}.legend{gap:5px}.break{gap:6px}}@container energyiq-card (max-height:240px){.pad{padding-top:8px;padding-bottom:6px}.body{overflow:hidden}.sub{display:none}.dots{padding-top:2px}.track{margin-top:8px}.break{margin-top:7px}}@container energyiq-card (min-width:700px){.body{padding-left:4px;padding-right:4px}.summary{margin-left:0}.chart svg{height:min(185px,28cqw)}}.empty{width:100%;text-align:center;color:var(--secondary-text-color);font-size:clamp(.78rem,2.3cqw,.9rem);padding:10px}.err{margin-top:10px;color:var(--error-color)}.active-loads-backdrop{position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.58);display:flex;align-items:center;justify-content:center;padding:16px}.active-loads{width:min(430px,100%);max-height:82vh;overflow:auto;background:var(--card-background-color);border:1px solid var(--divider-color);border-radius:14px;box-shadow:var(--ha-card-box-shadow);padding:16px;box-sizing:border-box}.active-loads-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.active-loads-title{font-size:1.25rem;font-weight:800}.active-loads-head button{width:38px;height:38px;padding:0}.active-load-list{margin-top:12px}.active-load-row{display:flex;justify-content:space-between;gap:12px;padding:9px 2px;border-bottom:1px solid var(--divider-color)}.active-load-row span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.active-load-row strong{white-space:nowrap;font-variant-numeric:tabular-nums}.active-load-empty{text-align:center;padding:22px;color:var(--secondary-text-color)}.active-load-summary{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-top:12px}.active-load-summary div{padding:9px;border-radius:9px;background:var(--secondary-background-color);border:1px solid var(--divider-color)}.active-load-summary span{display:block;font-size:9px;text-transform:uppercase;color:var(--secondary-text-color)}.active-load-summary strong{display:block;margin-top:3px;font-size:14px;font-variant-numeric:tabular-nums}@media(max-width:500px){.active-loads-backdrop{padding:10px}.active-loads{max-height:88vh;padding:14px}.active-load-summary{grid-template-columns:1fr 1fr}.active-load-summary div:last-child{grid-column:1/-1}}';}
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
