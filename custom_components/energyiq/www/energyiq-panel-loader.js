/* EnergyIQ panel loader/fix layer.
 * Keep live polling OFF until training actually starts.
 * This prevents the pre-training method selector from being destroyed by refreshes.
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

    // The base loader starts the 2-second timer after the initial workspace
    // load. Cancel it so the training UI can be configured without DOM churn.
    Ctor.prototype.load = async function (...args) {
      const result = await originalLoad.apply(this, args);
      if (this.trainingWorkspaceOpen || this.workspace) stopLiveRefresh.call(this);
      return result;
    };

    // Start fast polling only after the user actually starts the training run.
    Ctor.prototype.startWorkspaceTraining = async function (...args) {
      const result = await originalStart.apply(this, args);
      startLiveRefresh.call(this);
      return result;
    };

    // Once the active training reaches a terminal state, stop the fast poll.
    Ctor.prototype.refresh = async function (...args) {
      const result = await originalRefresh.apply(this, args);
      const active = this.activeTrainingId ? this.getDevice(this.activeTrainingId) : null;
      const status = active?.training?.status;
      if (this.trainingWorkspaceOpen && (status === "complete" || status === "error")) {
        stopLiveRefresh.call(this);
      }
      return result;
    };

    // Closing the workspace returns the panel to its normal 2-second live view.
    Ctor.prototype.closeTrainingWorkspace = function (...args) {
      const result = originalClose.apply(this, args);
      startLiveRefresh.call(this);
      return result;
    };

    // Opening a workspace must never restart fast polling.
    Ctor.prototype.openTrainingWorkspace = function (...args) {
      this._energyiqWorkspaceMethod = null;
      stopLiveRefresh.call(this);
      return originalOpen.apply(this, args);
    };

    // New training defaults to Quick ON/OFF without altering backend behavior.
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
