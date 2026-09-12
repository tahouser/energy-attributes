/* EnergyIQ panel loader/fix layer.
 * Loads the main panel and preserves the training-method selector during the
 * two-second live refresh cycle. New training defaults to Quick ON/OFF.
 */
(() => {
  const MAIN = "/energyiq-static/energyiq-panel.js?v=31360";
  const TAG = "energyiq-panel-v325";

  const patch = () => {
    const Ctor = customElements.get(TAG);
    if (!Ctor || Ctor.prototype.__energyiqTrainingFix) return;
    Ctor.prototype.__energyiqTrainingFix = true;

    const originalUpdate = Ctor.prototype.updateLiveData;
    Ctor.prototype.updateLiveData = function (...args) {
      const trainingArea = this.querySelector("#training-area");
      const methodSelect = trainingArea?.querySelector("#training-method");
      const preserveTrainingArea = !!(trainingArea && methodSelect && document.activeElement === methodSelect);
      if (!preserveTrainingArea) return originalUpdate.apply(this, args);

      const parent = trainingArea.parentNode;
      const marker = document.createComment("energyiq-training-area");
      parent.replaceChild(marker, trainingArea);
      try {
        return originalUpdate.apply(this, args);
      } finally {
        marker.replaceWith(trainingArea);
        this.bindTrainingWorkspace?.();
      }
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

    const originalBind = Ctor.prototype.bindTrainingWorkspace;
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
