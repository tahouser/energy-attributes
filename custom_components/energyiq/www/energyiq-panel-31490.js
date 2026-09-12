/* EnergyIQ v3.1.49 frontend entrypoint.
 * This deliberately registers a NEW custom-element tag. The previous loader
 * reused the old energyiq-panel-v346 class that was already registered in the
 * browser, so changing the source/query string could not replace it.
 */
import "/energyiq-static/energyiq-panel.js?v=31480";

const BaseEnergyIQPanel = customElements.get("energyiq-panel-v346");
if (!BaseEnergyIQPanel) {
  throw new Error("EnergyIQ base panel failed to load.");
}

class EnergyIQPanelV349 extends BaseEnergyIQPanel {
  workspaceMethod(device) {
    return this._workspaceMethod || device?.training?.method || "quick";
  }

  selectedWorkspaceMethod() {
    return this.workspaceMethod(this.activeTrainingDevice());
  }

  renderTrainingDetail(device) {
    const method = this.workspaceMethod(device);
    return `<div class="training-grid"><div class="training-main"><div class="method-picker"><span class="method-label">Training method</span><div class="method-options" role="radiogroup" aria-label="Training method"><label class="method-option ${method === "quick" ? "selected" : ""}"><input type="radio" name="training-method" value="quick" ${method === "quick" ? "checked" : ""}><span>Quick ON/OFF</span></label><label class="method-option ${method === "full_cycle" ? "selected" : ""}"><input type="radio" name="training-method" value="full_cycle" ${method === "full_cycle" ? "checked" : ""}><span>Full Cycle</span></label><label class="method-option ${method === "manual" ? "selected" : ""}"><input type="radio" name="training-method" value="manual" ${method === "manual" ? "checked" : ""}><span>Manual</span></label></div></div><div id="training-live-body">${this.renderTrainingLiveBody(device, method)}</div></div><aside class="training-info"><span class="eyebrow">Selected device</span><h3>${this.escape(device.name || device.device_id)}</h3><p>${this.escape(device.area || "No area assigned")}</p><dl><dt>Source</dt><dd>${String(device.source || "").toLowerCase() === "manual" ? "Manual" : "Home Assistant"}</dd><dt>Method</dt><dd>${this.escape(device.training?.method || method)}</dd><dt>Status</dt><dd>${device.training?.status === "complete" ? "Trained" : device.training?.status === "active" ? "In progress" : "Not trained"}</dd></dl></aside></div>`;
  }

  bindTrainingWorkspace() {
    if (super.bindTrainingWorkspace) super.bindTrainingWorkspace();
    this.querySelectorAll("input[name='training-method']").forEach(input => {
      if (input.dataset.energyiqV349Bound) return;
      input.dataset.energyiqV349Bound = "1";
      input.addEventListener("change", event => {
        this._workspaceMethod = event.currentTarget.value;
        this.querySelectorAll(".method-option").forEach(option => {
          option.classList.toggle("selected", option.querySelector("input")?.checked);
        });
        if (this.updateTrainingWorkspaceLiveData) this.updateTrainingWorkspaceLiveData();
      });
    });
  }

  styles() {
    const base = super.styles ? super.styles() : "";
    return `${base}.method-options{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.method-option{position:relative;display:flex;align-items:center;justify-content:center;border:1px solid var(--divider-color);border-radius:9px;padding:11px;cursor:pointer;background:var(--card-background-color);font-weight:700}.method-option:hover{background:var(--secondary-background-color)}.method-option.selected{border-color:var(--primary-color);box-shadow:0 0 0 2px var(--primary-color) inset}.method-option input{position:absolute;opacity:0;pointer-events:none}@media(max-width:700px){.method-options{grid-template-columns:1fr}}`;
  }
}

customElements.define("energyiq-panel-v349", EnergyIQPanelV349);
