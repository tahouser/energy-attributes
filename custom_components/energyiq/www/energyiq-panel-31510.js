/* EnergyIQ v3.1.36 dropdown root-cause test loader. */
(async () => {
  const response = await fetch("/energyiq-static/energyiq-panel-31360-base.js", { cache: "no-store" });
  if (!response.ok) throw new Error(`Unable to load EnergyIQ test frontend (${response.status})`);
  let source = await response.text();
  const oldBlock = `      const training = this.querySelector("#training-area");\n      if (training && this.trainingWorkspaceOpen) training.innerHTML = this.renderTrainingWorkspace();\n      this.bindTrainingWorkspace();`;
  if (!source.includes(oldBlock)) throw new Error("EnergyIQ v3.1.36 test patch target not found");
  source = source.replace(oldBlock, "      // TEST: preserve the training workspace DOM during live polling.");
  const script = document.createElement("script");
  script.textContent = source;
  document.head.appendChild(script);
})();
