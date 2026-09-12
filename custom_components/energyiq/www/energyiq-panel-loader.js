/* EnergyIQ panel loader/fix layer.
 * The main panel now owns Training workspace DOM stability. This loader
 * remains as a compatibility layer for the live-refresh lifecycle.
 *
 * v3.1.46 deliberately registers a new custom-element tag. Home Assistant
 * keeps custom elements registered for the lifetime of the browser page, so
 * reusing the old tag can silently keep the previous class definition.
 */
(() => {
  const MAIN = "/energyiq-static/energyiq-panel.js?v=31450";
  const SOURCE_TAG = "energyiq-panel-v325";
  const TAG = "energyiq-panel-v346";
  const patch = () => {
    const SourceCtor = customElements.get(SOURCE_TAG);
    if (!SourceCtor) return;
    let Ctor = customElements.get(TAG);
    if (!Ctor) {
      Ctor = class EnergyIQPanelV346 extends SourceCtor {};
      customElements.define(TAG, Ctor);
    }
    if (Ctor.prototype.__energyiqTrainingFix) return;
    Ctor.prototype.__energyiqTrainingFix = true;

    const originalLoad = Ctor.prototype.load;
    const originalStart = Ctor.prototype.startWorkspaceTraining;
    const originalClose = Ctor.prototype.closeTrainingWorkspace;
    const originalRefresh = Ctor.prototype.refresh;
    const originalOpen = Ctor.prototype.openTrainingWorkspace;

    const stopLiveRefresh = function () {
      if (this.refreshTimer) clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    };

    const startLiveRefresh = function () {
      stopLiveRefresh.call(this);
      this.refreshTimer = setInterval(() => this.refresh(), 2000);
    };

    Ctor.prototype.load = async function (...args) {
      const result = await originalLoad.apply(this, args);
      if (this.trainingWorkspaceOpen || this.workspace) stopLiveRefresh.call(this);
      return result;
    };

    Ctor.prototype.startWorkspaceTraining = async function (...args) {
      const result = await originalStart.apply(this, args);
      startLiveRefresh.call(this);
      return result;
    };

    Ctor.prototype.refresh = async function (...args) {
      const result = await originalRefresh.apply(this, args);
      const active = this.activeTrainingId ? this.getDevice(this.activeTrainingId) : null;
      const status = active?.training?.status;
      if (this.trainingWorkspaceOpen && (status === "complete" || status === "error")) stopLiveRefresh.call(this);
      return result;
    };

    Ctor.prototype.closeTrainingWorkspace = function (...args) {
      const result = originalClose.apply(this, args);
      startLiveRefresh.call(this);
      return result;
    };

    Ctor.prototype.openTrainingWorkspace = function (...args) {
      stopLiveRefresh.call(this);
      return originalOpen.apply(this, args);
    };
  };

  const script = document.createElement("script");
  script.src = MAIN;
  script.onload = patch;
  script.onerror = () => console.error("EnergyIQ main panel failed to load");
  document.head.appendChild(script);
})();
