const TAG = "energyiq-card";
if (!customElements.get(TAG)) {
  class EnergyIQCard extends HTMLElement {
    constructor() { super(); this._hass=null; this._cfg={}; this._data=null; this._entryId=null; this._view=0; this._timer=null; this._busy=false; this._click=this._next.bind(this); }
    setConfig(c){ this._cfg=c||{}; if(this.isConnected)this._start(); }
    set hass(h){ this._hass=h; if(!this._busy&&!this._data)this._start(); else if(this._data)this._render(); }
    connectedCallback(){ this.addEventListener("click",this._click); this._loading(); if(this._hass)this._start(); }
    disconnectedCallback(){ if(this._timer)clearInterval(this._timer); this.removeEventListener("click",this._click); }
    getCardSize(){return 7;}
    getGridOptions(){return {rows:6,columns:6,min_rows:6,max_rows:8};}
    async _ws(m){return this._hass.connection.sendMessagePromise(m);}
    async _start(){
      if(this._busy||!this._hass)return; this._busy=true;
      try{ let id=this._cfg.entry_id; if(!id){let r=await this._ws({type:"energy_attribution/list_entries"});id=r.entries&&r.entries[0]&&r.entries[0].entry_id;}
        if(!id)throw new Error("EnergyIQ is not configured."); this._entryId=id; await this._refresh(); if(this._timer)clearInterval(this._timer); this._timer=setInterval(()=>this._refresh(),2000);
      }catch(e){this._error(e.message||e);} finally{this._busy=false;}
    }
    async _refresh(){try{this._data=await this._ws({type:"energy_attribution/workspace",entry_id:this._entryId});this._render();}catch(e){console.error("EnergyIQ card",e);}}
    _num(v){v=Number(v);return Number.isFinite(v)?v:null;}
    _state(id){return this._num(this._hass&&this._hass.states&&this._hass.states[id]&&this._hass.states[id].state);}
    _next(e){if(!e.target.closest||!e.target.closest("[data-next]"))return;e.stopPropagation();this._view=(this._view+1)%3;this._render();}
    _esc(v){return String(v).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c];});}
    _loading(){this.innerHTML='<ha-card><div class="pad"><b>EnergyIQ</b> <span>Loading...</span></div></ha-card>';}
    _error(m){this.innerHTML='<ha-card><div class="pad"><b>EnergyIQ</b><div class="err">'+this._esc(m)+'</div></div></ha-card>';}
    _render(){
      var d=this._data||{}, home=this._num(d.whole_home_power), trained=Math.max(0,this._num(d.trained_live_power_w)||0), known=home==null?null:Math.min(home,trained), mystery=home==null?null:Math.max(0,home-trained);
      var devices=(d.devices||[]).filter(function(x){return x.classification==="monitor";}).map(function(x){return Object.assign({},x,{w:Math.max(0,Number(x.current_power)||0)});}).filter(function(x){return x.w>0;}).sort(function(a,b){return b.w-a.w;});
      var total=this._state(this._cfg.cost_entity||"sensor.dte_variable_energy_cost"), peak=this._state(this._cfg.peak_cost_entity||"sensor.dte_peak_energy_cost"), off=this._state(this._cfg.off_peak_cost_entity||"sensor.dte_off_peak_energy_cost");
      var titles=["CONSUMPTION","MYSTERY WATTS","COST"], subs=["Current attributed power","Known vs. unexplained power","This month"], body=this._view===0?this._pareto(devices):this._view===1?this._mystery(home,known,mystery):this._cost(total,peak,off);
      this.innerHTML='<style>'+this._css()+'</style><ha-card><div class="pad"><div class="head"><div><div class="eyebrow">ENERGYIQ</div><div class="title">'+titles[this._view]+'</div><div class="sub">'+subs[this._view]+'</div></div><button data-next aria-label="Next view">→</button></div><div class="body">'+body+'</div><div class="dots"><i class="'+(this._view===0?'on':'')+'"></i><i class="'+(this._view===1?'on':'')+'"></i><i class="'+(this._view===2?'on':'')+'"></i></div></div></ha-card>';
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
      if(total==null)return '<div class="empty">Add a cost sensor to show EnergyIQ cost.</div>'; var t=Math.max(0,total), scale=Math.max(100,Math.ceil(t/25)*25), fill=Math.min(100,t/scale*100);
      return '<div class="cost"><div class="big">$'+t.toFixed(2)+'</div><div class="sub">this month</div><div class="track"><div class="mask" style="width:'+(100-fill)+'%"></div></div><div class="scale"><span>$0</span><span>$'+scale+'</span></div><div class="break"><div><span>Peak</span><b>'+(peak==null?'—':'$'+peak.toFixed(2))+'</b></div><div><span>Off-Peak</span><b>'+(off==null?'—':'$'+off.toFixed(2))+'</b></div></div></div>';
    }
    _css(){return ':host{display:block;min-width:0;max-width:100%;box-sizing:border-box}.pad{padding:15px 16px 10px;color:var(--primary-text-color);min-width:0;box-sizing:border-box;overflow:hidden}.head{display:flex;justify-content:space-between;align-items:flex-start}.eyebrow{font-size:.72rem;letter-spacing:.12em;font-weight:700;color:var(--secondary-text-color)}.title{font-size:1.2rem;font-weight:700}.sub{font-size:.78rem;color:var(--secondary-text-color)}button{width:40px;height:40px;border:0;border-radius:50%;background:var(--primary-color,#03a9f4);color:#fff;font-size:1.5rem;cursor:pointer}.body{min-height:218px;display:flex;align-items:center;min-width:0;width:100%;overflow:hidden}.dots{display:flex;justify-content:center;gap:6px}.dots i{width:6px;height:6px;border-radius:50%;background:var(--divider-color)}.dots i.on{background:var(--primary-color)}.chart{width:100%;min-width:0;overflow:hidden}.summary{display:flex;gap:7px;align-items:baseline;margin:4px}.summary b,.big{font-size:2.1rem}.summary span,.sub{color:var(--secondary-text-color);font-size:.76rem}svg{display:block;width:100%;max-width:100%;height:205px;overflow:hidden}.axis{stroke:var(--divider-color)}.line{fill:none;stroke:var(--primary-color);stroke-width:3;stroke-linecap:round}.dotline{fill:var(--primary-color);stroke:var(--ha-card-background,#1c1c1c);stroke-width:2}.v{fill:var(--primary-text-color);font-size:11px;font-weight:700}.x{fill:var(--secondary-text-color);font-size:11px}.c0{fill:#2196f3}.c1{fill:#42a5f5}.c2{fill:#26a69a}.c3{fill:#ffb300}.c4{fill:#ef5350}.myst,.cost{width:100%;padding:8px 4px}.big{font-weight:700;line-height:1}.big span{font-size:1rem;color:var(--secondary-text-color)}.status{display:flex;justify-content:space-between;margin-top:8px;font-size:.8rem;color:var(--secondary-text-color)}.stack{display:flex;height:32px;border-radius:9px;overflow:hidden;background:var(--divider-color);margin-top:9px}.known{background:#42a5f5}.unknown{background:#ef5350}.legend{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-top:10px;font-size:.78rem}.legend span{display:flex;align-items:center;gap:6px}.legend i{width:9px;height:9px;border-radius:50%}.kd{background:#42a5f5}.ud{background:#ef5350}.total{display:flex;justify-content:space-between;border-top:1px solid var(--divider-color);padding-top:9px;margin-top:12px;font-size:.8rem;color:var(--secondary-text-color)}.total b{color:var(--primary-text-color)}.track{height:31px;border-radius:9px;overflow:hidden;margin-top:20px;background:linear-gradient(90deg,#43a047,#fdd835 45%,#fb8c00 70%,#e53935)}.mask{height:100%;background:rgba(20,20,20,.58);margin-left:auto}.scale{display:flex;justify-content:space-between;color:var(--secondary-text-color);font-size:.7rem;margin-top:4px}.break{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:15px}.break div{display:flex;justify-content:space-between;border-top:1px solid var(--divider-color);padding-top:8px;font-size:.82rem}.break span{color:var(--secondary-text-color)}.empty{width:100%;text-align:center;color:var(--secondary-text-color);font-size:.9rem}.err{margin-top:10px;color:var(--error-color)}@media(max-width:500px){.pad{padding:13px}.body{min-height:210px}svg{height:195px}.x,.v{font-size:10px}}';}
  }
  customElements.define(TAG,EnergyIQCard); window.customCards=window.customCards||[]; window.customCards.push({type:TAG,name:"EnergyIQ",description:"EnergyIQ consumption, Mystery Watts, and cost in one card.",preview:false,documentationURL:"https://github.com/tahouser/energy-attributes"});
}
