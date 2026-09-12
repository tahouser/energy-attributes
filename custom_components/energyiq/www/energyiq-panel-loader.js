/* EnergyIQ panel loader/fix layer.
 * Keep the Training workspace DOM stable during live refreshes.
 * The base panel's updateLiveData() rebuilds #training-area, which destroys
 * the method selector every polling cycle. This layer lets the table and
 * summary refresh normally while leaving the Training workspace intact.
 */
(() => {
  const MAIN = "/energyiq-static/energyiq-panel.js?v=31360";
  const TAG = "energyiq-panel-v325";
  const patch = () => {
    const Ctor = customElements.get(TAG);
    if (!Ctor || Ctor.prototype.__energyiqTrainingFix) return;
    Ctor.prototype.__energyiqTrainingFix = true;

    const originalLoad = Ctor.prototype.load;
    const originalStart = Ctor.prototype.startWorkspaceTraining;
    const originalClose = Ctor.prototype.closeTrainingWorkspace;
    const originalRefresh = Ctor.prototype.refresh;
    const originalOpen = Ctor.prototype.openTrainingWorkspace;
    const originalUpdate = Ctor.prototype.updateLiveData;
    const originalRenderDetail = Ctor.prototype.renderTrainingDetail;
    const originalBind = Ctor.prototype.bindTrainingWorkspace;

    const stopLiveRefresh = function () {
      if (this.refreshTimer) clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    };

    const startLiveRefresh = function () {
      stopLiveRefresh.call(this);
      this.refreshTimer = setInterval(() => this.refresh(), 2000);
    };

    // Do not leave the base polling timer running while the workspace is
    // being configured. This is intentionally separate from updateLiveData:
    // refreshes started after training begins are still allowed to update the
    // table and summary.
    Ctor.prototype.load = async function (...args) {
      const result = await originalLoad.apply(this, args);
      if (this.trainingWorkspaceOpen || this.workspace) stopLiveRefresh.call(this);
      return result;
    };

    // Training starts the normal live polling. The updateLiveData patch below
    // prevents that polling from replacing the Training workspace DOM.
    Ctor.prototype.startWorkspaceTraining = async function (...args) {
      const result = await originalStart.apply(this, args);
      startLiveRefresh.call(this);
      return result;
    };

    Ctor.prototype.refresh = async function (...args) {
      const result = await originalRefresh.apply(this, args);
      const active = this.activeTrainingId ? this.getDevice(this.activeTrainingId) : null;
      const status = active?.training?.status;
      if (this.trainingWorkspaceOpen && (status === "complete" || status === "error")) {
        stopLiveRefresh.call(this);
      }
      return result;
    };

    // Structural fix: run the original live-data update with the workspace
    // logically closed, so its table/summary updates still happen, but the
    // existing #training-area is never replaced. The actual DOM node holding
    // the method selector therefore survives every polling cycle.
    Ctor.prototype.updateLiveData = function (...args) {
      if (!this.trainingWorkspaceOpen) return originalUpdate.apply(this, args);

      const wasOpen = this.trainingWorkspaceOpen;
      const previousBind = this.bindTrainingWorkspace;
      this.trainingWorkspaceOpen = false;
      this.bindTrainingWorkspace = () => {};
      try {
        return originalUpdate.apply(this, args);
      } finally {
        this.trainingWorkspaceOpen = wasOpen;
        this.bindTrainingWorkspace = previousBind;
      }
    };

    Ctor.prototype.closeTrainingWorkspace = function (...args) {
      const result = originalClose.apply(this, args);
      startLiveRefresh.call(this);
      return result;
    };

    Ctor.prototype.openTrainingWorkspace = function (...args) {
      this._energyiqWorkspaceMethod = null;
      stopLiveRefresh.call(this);
      return originalOpen.apply(this, args);
    };

    // Remember the user's method selection for any explicit workspace redraw.
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
