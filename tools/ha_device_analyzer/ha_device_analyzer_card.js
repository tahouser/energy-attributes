const CONTROL_DOMAINS = new Set(["light","switch","fan","climate","humidifier","media_player","vacuum","water_heater","cover","valve","number"]);
const AGG = {total:18,aggregate:18,whole:18,home:14,house:14,system:12,consumption:12,usage:8,active_power:12,power_flow:12,demand:6};
const PHASE = {phase_a:-28,phase_b:-28,phase_c:-28,phase_1:-28,phase_2:-28,phase_3:-28,l1:-28,l2:-28,l3:-28,channel_1:-24,channel_2:-24,channel_3:-24,energy_meter_0:-24,energy_meter_1:-24,energy_meter_2:-24};
const METER = ["meter","energy_meter","3em","p1","dsmr","powerfox","homewizard","iammeter","eastron","sdm630","discovergy","inexogy"];
const EXPORT_WORDS = ["export","returned","return","production","solar","generation"];
const IMPORT_WORDS = ["import","consumption","usage"];

const norm = v => String(v ?? "").toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"");
const textOf = e => [e.entity_id,e.name,e.friendly_name].map(norm).join(" ");
const sourceEntities = e => {
  const a = e.current_state?.attributes || {};
  let x = a.entity_id || a.source_entity_ids || a.source_entities || [];
  if (typeof x === "string") x = [x];
  return Array.isArray(x) ? x.filter(v => typeof v === "string" && v.includes(".")) : [];
};
const sameMeterFamily = (sources, byId) => {
  const rows = sources.map(id => byId.get(id)).filter(Boolean);
  if (rows.length < 2) return false;
  const ids = new Set(rows.map(e => e.device_id).filter(Boolean));
  const platforms = new Set(rows.map(e => e.platform).filter(Boolean));
  const sourceIds = sources.map(norm);
  if (ids.size >= 2 && platforms.size === 1 && sourceIds.length && sourceIds.every(n => METER.some(t => n.includes(t)))) return true;
  return ids.size === 1 && ids.size > 0;
};

function scorePower(e, byId) {
  if (e.measurement_class !== "power") return null;
  if (e.platform === "energyiq") return {score:-999,role:"excluded",reasons:["EnergyIQ-created entity; not an initial-install source"]};
  const t = textOf(e), a = e.current_state?.attributes || {};
  let score = 35, reasons = ["power measurement"];
  if (a.device_class === "power") { score += 8; reasons.push("device_class=power"); }
  if (a.state_class === "measurement") { score += 5; reasons.push("state_class=measurement"); }
  Object.entries(AGG).forEach(([k,v]) => { if (t.includes(k)) { score += v; reasons.push("aggregate term: "+k); }});
  Object.entries(PHASE).forEach(([k,v]) => { if (t.includes(k)) { score += v; reasons.push("phase/channel term: "+k); }});
  const sources = sourceEntities(e);
  if (sources.length >= 2) {
    score += 12; reasons.push("derived from "+sources.length+" source entities");
    if (sameMeterFamily(sources,byId)) { score += 22; reasons.push("source entities form a common meter family"); }
  }
  if (!e.device_id && !sources.length) { score -= 8; reasons.push("no device relationship or source list"); }
  return {score,role:score >= 70 ? "whole_home_power_candidate" : "power_candidate_review",reasons,source_entities:sources};
}

function meterLikeEnergy(e) {
  const t = textOf(e);
  if (["whole_home","whole_house","house_energy","home_energy","grid_import","grid_consumption"].some(x => t.includes(x))) return true;
  if (e.device_id && METER.some(x => t.includes(x))) return true;
  return !e.device_id && ["template","integration","utility_meter"].includes(e.platform) && ["house","home","whole","grid"].some(x => t.includes(x));
}

function scoreEnergy(e) {
  if (e.measurement_class !== "energy") return null;
  if (e.platform === "energyiq") return {score:-999,role:"excluded",reasons:["EnergyIQ-created entity; not an initial-install source"]};
  const t = textOf(e), a = e.current_state?.attributes || {};
  let score = 25, reasons = ["energy measurement"];
  if (a.device_class === "energy") { score += 8; reasons.push("device_class=energy"); }
  if (["total","total_increasing"].includes(a.state_class)) { score += 8; reasons.push("state_class="+a.state_class); }
  IMPORT_WORDS.forEach(x => { if (t.includes(x)) { score += 10; reasons.push("consumption term: "+x); }});
  EXPORT_WORDS.forEach(x => { if (t.includes(x)) { score -= 24; reasons.push("generation/export term: "+x); }});
  Object.entries(AGG).forEach(([k,v]) => { if (t.includes(k)) { score += Math.min(v,12); reasons.push("aggregate term: "+k); }});
  const meterLike = meterLikeEnergy(e);
  if (meterLike) { score += 20; reasons.push("whole-home/meter semantic"); }
  else if (e.device_id) { score -= 25; reasons.push("device-bound energy meter is more likely a device load"); }
  return {score,role:score >= 50 && meterLike ? "whole_home_energy_candidate" : "energy_candidate_review",reasons};
}

function classifyDevice(d, byId) {
  const es = (d.entities || []).map(id => byId.get(id)).filter(Boolean);
  const power = es.filter(e => e.measurement_class === "power" && e.platform !== "energyiq");
  const energy = es.filter(e => e.measurement_class === "energy" && e.platform !== "energyiq");
  const controls = [...new Set(es.map(e => e.domain).filter(x => CONTROL_DOMAINS.has(x)))].sort();
  const meterWords = [d.name,d.name_by_user,d.manufacturer,d.model,d.model_id].map(norm).join(" ");
  const systemMeter = power.some(e => scorePower(e,byId)?.role === "whole_home_power_candidate");
  let method = systemMeter ? "system_meter" : (METER.some(x => meterWords.includes(x)) ? "review" : (power.length ? "auto_train" : (controls.length ? "quick" : "manual")));
  return {device_id:d.device_id,name:d.name,manufacturer:d.manufacturer,model:d.model,area:d.area,measurement:{power:power.map(e=>e.entity_id),energy:energy.map(e=>e.entity_id)},control_domains:controls,training_method:method};
}

function discriminate(devices,entities) {
  const byId = new Map(entities.map(e => [e.entity_id,e]));
  const power = entities.filter(e => e.measurement_class === "power").map(e => ({entity_id:e.entity_id,...scorePower(e,byId)})).filter(x => x.role !== "excluded").sort((a,b) => b.score-a.score);
  const energy = entities.filter(e => e.measurement_class === "energy").map(e => ({entity_id:e.entity_id,...scoreEnergy(e)})).filter(x => x.role !== "excluded").sort((a,b) => b.score-a.score);
  const secondary = {grid_import:[],grid_export:[],generation:[],storage:[]};
  entities.filter(e => ["power","energy"].includes(e.measurement_class)).forEach(e => {
    const t = textOf(e);
    if (t.includes("import")) secondary.grid_import.push(e.entity_id);
    if (["export","returned","return"].some(x => t.includes(x))) secondary.grid_export.push(e.entity_id);
    if (["solar","production","generation"].some(x => t.includes(x))) secondary.generation.push(e.entity_id);
    if (["battery","storage","charge","discharge"].some(x => t.includes(x))) secondary.storage.push(e.entity_id);
  });
  const deviceAssessments = devices.map(d => classifyDevice(d,byId));
  const methods = {};
  deviceAssessments.forEach(x => methods[x.training_method] = (methods[x.training_method] || 0) + 1);
  return {
    schema:"ha-device-intelligence-v2",
    discriminator:"deterministic-evidence-v1",
    whole_home:{
      power_candidates:power,
      energy_candidates:energy,
      selected_power:power[0]?.role === "whole_home_power_candidate" ? power[0].entity_id : null,
      selected_energy:energy[0]?.role === "whole_home_energy_candidate" ? energy[0].entity_id : null
    },
    secondary_energy_sources:secondary,
    device_assessments:deviceAssessments,
    training_method_counts:methods,
    user_decision_required:true,
    raw_evidence_preserved:true
  };
}

class HADeviceAnalyzerCard extends HTMLElement {
  setConfig(c){this.config=c||{};this.attachShadow({mode:"open"});this.render()}
  set hass(h){this._hass=h}
  render(){
    if(!this.shadowRoot)return;
    this.shadowRoot.innerHTML='<ha-card><div class="title">HA Device Intelligence Analyzer V2</div><div id="status">Read-only inventory + deterministic discriminator. No EnergyIQ dependency.</div><button id="scan">Run Inventory &amp; Intelligence Scan</button><pre id="summary"></pre></ha-card>';
    const b=this.shadowRoot.querySelector("#scan"); if(b)b.onclick=()=>this.scan();
  }
  async scan(){
    const st=this.shadowRoot.querySelector("#status"),out=this.shadowRoot.querySelector("#summary");
    if(!this._hass){st.textContent="Home Assistant connection is not available yet.";return}
    st.textContent="Reading registries and current states…";
    try{
      const r=await Promise.all([
        this._hass.callWS({type:"config/device_registry/list"}),
        this._hass.callWS({type:"config/entity_registry/list"}),
        this._hass.callWS({type:"config/area_registry/list"}),
        this._hass.callWS({type:"get_states"})
      ]);
      const devices=r[0].devices||r[0],entities=r[1].entities||r[1],areas=r[2].areas||r[2],states=r[3];
      const sb=new Map(states.map(x=>[x.entity_id,x])),ab=new Map(areas.map(x=>[x.area_id||x.id,x]));
      const units={W:"power",kW:"power",MW:"power",Wh:"energy",kWh:"energy",MWh:"energy",A:"current",mA:"current",V:"voltage",mV:"voltage",VA:"apparent_power",kVA:"apparent_power",var:"reactive_power",kvar:"reactive_power",varh:"reactive_energy",kvarh:"reactive_energy"};
      const classes=new Set(["power","energy","current","voltage","apparent_power","reactive_power","power_factor","reactive_energy"]);
      const cls=(s)=>{const a=s?.attributes||{};return classes.has(a.device_class)?a.device_class:(units[a.unit_of_measurement]||null)};
      const ers=entities.map(e=>{
        const s=sb.get(e.entity_id)||null,a=s?.attributes||{};
        return {
          entity_id:e.entity_id,domain:e.entity_id.split(".")[0],registry:{...e},
          current_state:s?{state:s.state,attributes:{...a},last_changed:s.last_changed||null,last_updated:s.last_updated||null,context:s.context?{...s.context}:null}:null,
          platform:e.platform||null,unique_id:e.unique_id||null,device_id:e.device_id||null,area_id:e.area_id||null,
          area:ab.get(e.area_id)?.name||null,name:e.name||e.original_name||null,entity_category:e.entity_category||null,
          disabled_by:e.disabled_by||null,hidden_by:e.hidden_by||null,measurement_class:cls(s),state:s?.state||null,
          available:!!s&&!["unknown","unavailable"].includes(s.state),
          attributes:{device_class:a.device_class||null,state_class:a.state_class||null,unit_of_measurement:a.unit_of_measurement||null,last_reset:a.last_reset||null,suggested_display_precision:a.suggested_display_precision??null,display_precision:a.display_precision??null}
        };
      });
      const byDev=new Map();
      ers.forEach(e=>{if(e.device_id){if(!byDev.has(e.device_id))byDev.set(e.device_id,[]);byDev.get(e.device_id).push(e.entity_id)}});
      const db=new Map(devices.map(d=>[d.id,d]));
      const dr=devices.map(d=>{
        const p=db.get(d.parent_device_id),aid=d.area_id||p?.area_id||null,linked=byDev.get(d.id)||[];
        return {
          device_id:d.id,registry:{...d},name:d.name||null,name_by_user:d.name_by_user||null,manufacturer:d.manufacturer||null,model:d.model||null,model_id:d.model_id||null,
          area_id:aid,area:ab.get(aid)?.name||null,config_entry_id:d.config_entry_id||null,config_subentry_id:d.config_subentry_id||null,
          parent_device_id:d.parent_device_id||null,via_device_id:d.via_device_id||null,child_device:d.parent_device_id!=null,
          entities:linked,measurement_candidates:linked.map(id=>ers.find(e=>e.entity_id===id)).filter(e=>e?.measurement_class).map(e=>({entity_id:e.entity_id,class:e.measurement_class,unit:e.attributes.unit_of_measurement,device_class:e.attributes.device_class,state_class:e.attributes.state_class}))
        };
      });
      const assessment=discriminate(dr,ers);
      const report={
        schema:"ha-device-intelligence-v2",generated_at:new Date().toISOString(),home_assistant_url:location.origin,
        scope:{read_only:true,energyiq_dependency:false,history_hours:0,discriminator_applied:true,raw_registry_evidence:true,raw_current_state_evidence:true,user_decision_required:true},
        summary:{devices:dr.length,entities:ers.length,areas:areas.length,states_returned:states.length,entities_without_current_state:ers.filter(e=>!e.current_state).length,measurement_entities:ers.filter(e=>e.measurement_class).length,power_entities:ers.filter(e=>e.measurement_class==="power").length,energy_entities:ers.filter(e=>e.measurement_class==="energy").length,current_entities:ers.filter(e=>e.measurement_class==="current").length,voltage_entities:ers.filter(e=>e.measurement_class==="voltage").length,apparent_power_entities:ers.filter(e=>e.measurement_class==="apparent_power").length,reactive_power_entities:ers.filter(e=>e.measurement_class==="reactive_power").length,reactive_energy_entities:ers.filter(e=>e.measurement_class==="reactive_energy").length,selected_whole_home_power:assessment.whole_home.selected_power,selected_whole_home_energy:assessment.whole_home.selected_energy,training_method_counts:assessment.training_method_counts},
        assessment,areas:areas.map(a=>({...a})),devices:dr,entities:ers
      };
      out.textContent=JSON.stringify({summary:report.summary,whole_home:report.assessment.whole_home,training_method_counts:report.assessment.training_method_counts},null,2);
      st.textContent="Scan complete. Downloading V2 JSON report…";
      const blob=new Blob([JSON.stringify(report,null,2)],{type:"application/json"}),url=URL.createObjectURL(blob),a=document.createElement("a");
      a.href=url;a.download="ha-device-analyzer-v2.json";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      st.textContent="Scan complete. V2 intelligence report downloaded.";
    }catch(e){st.textContent="Scan failed: "+(e?.message||String(e));console.error(e)}
  }
}
customElements.define("ha-device-analyzer-card",HADeviceAnalyzerCard);
