/* EnergyIQ version-isolated frontend loader. */
const path = "./energyiq-panel.js?v=315";
try {
  await import(path);
  const TAG = "energyiq-panel-v315";
  if (!customElements.get(TAG)) throw new Error("EnergyIQ panel element was not registered.");
} catch (error) {
  console.error("EnergyIQ frontend loader failed", error);
  throw error;
}
