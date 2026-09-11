/*
 * EnergyIQ — single frontend application.
 *
 * The backend is the source of truth. This file owns presentation and user
 * interaction only; it does not maintain a second copy of EnergyIQ state.
 */
(() => {
  const TAG = "energyiq-panel-v309";
  const VERSION = "3.1.5";

  if (customElements.get(TAG)) return;

  class EnergyIQPanel extends HTMLElement {
