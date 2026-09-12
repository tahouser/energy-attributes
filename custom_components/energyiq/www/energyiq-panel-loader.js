/* EnergyIQ panel loader/fix layer.
 * Keeps the training-method selector stable during the two-second live refresh.
 * New training defaults to Quick ON/OFF.
 */
(() => {
  const MAIN = "/energyiq-static/energyiq-panel.js?v=31360";
  const TAG = "energyiq-panel-v325";

  const patch = () => {
    const Ctor = customElements.get(TAG);
    if (!Ctor || Ctor.prototype.__energyiqTrainingFix) return;
    Ctor.prototype.__energyiqTrainingFix = true;

    const originalUpdate = Ctor.prototype.updateLiveData;
    const originalBind = Ctor.prototype.bindTrainingWorkspace;

    Ctor.prototype.updateLiveData = function (...args) {
      const trainingArea = this.querySelector("#training-area");
      const methodSelect = trainingArea?.querySelector("#training-method");

      // Before training starts the selector must remain a real, persistent DOM
      // control. Do not let the periodic refresh replace it or re-bind it.
      if (trainingArea && methodSelect && !methodSelect.disabled) {
        const previousOpen = this.trainingWorkspaceOpen;
        const previousBind = this.bindTrainingWorkspace;
        this.trainingWorkspaceOpen = false;
        this.bindTrainingWorkspace = () => {};
        try {
          return originalUpdate.apply(this, args);
        } finally {
          this.trainingWorkspaceOpen = previousOpen;
          this.bindTrainingWorkspace = previousBind;
        }
      }

      return originalUpdate.apply(this, args);
    };

    const originalOpen = Ctor.prototype.openTrainingWorkspace;
    Ctor.prototype.openTrainingWorkspace = function (...args) {
      this._energyiqWorkspaceMethod = null;
      return originalOpen.apply(this, args);
    };

    const originalRenderDetail = Ctor.prototype.renderTrainingDetail;
    Ctor.prototype.renderTrainingDetail = function (device) {
      if (device) {
        const training = device.training || {};
        const method = this._energyiqWorkspaceMethod || training.method || "quick";
        if (!training.method) {
          device = { ...device, training: { ...training, method } };
        }
      }
      return originalRenderDetail.call(this, device);
    };

    Ctor.prototype.bindTrainingWorkspace = function (...args) {
      const result = originalBind.apply(this, args);
      const select = this.querySelector("#training-method");
      if (select && !select.dataset.energyiqMethodFix) {
        select.dataset.energyiqMethodFix = "1";
        select.addEventListener("change", () => {
          this._energyiqWorkspaceMethod = select.value || "quick";
        });
      }
      return result;
    };
  };

  const script = document.createElement("script");
  script.src = MAIN;
  script.onload = patch;
  script.onerror = () => console.error("EnergyIQ main panel failed to load");
  document.head.appendChild(script);
})();
