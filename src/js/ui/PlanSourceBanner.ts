// "Plan from <file>" banner in the Dropzone tab and over the planner while a .jsim
// file is open (specs/formation-jumps.md §12.5).

import { getDropzonePlan, getPlanSource, onPlanSourceChanged } from "../dropzone/DropzonePlan";

function makeBanner(): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "plan-source-banner";
  el.hidden = true;
  el.setAttribute("role", "status");
  const text = document.createElement("span");
  text.className = "plan-source-text";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "plan-source-use";
  btn.textContent = "Use as dropzone plan";
  btn.title = "Copy this plan into the dropzone's own saved plan";
  btn.addEventListener("click", () => (window as any).fileMenu?.useFilePlanForDropzone?.());
  el.append(text, btn);
  return el;
}

export function initializePlanSourceBanner() {
  const tabBanner = makeBanner();
  const dzTab = document.getElementById("dropzone-panel");
  dzTab?.insertBefore(tabBanner, dzTab.firstChild);
  const plannerBanner = makeBanner();
  plannerBanner.classList.add("is-floating");
  document.getElementById("viewport")?.appendChild(plannerBanner);

  const update = () => {
    const src = getPlanSource();
    const file = src === "dropzone" ? null : src.file;
    const dz = getDropzonePlan().dropzone || "the dropzone";
    const msg = file ? `Plan from ${file}. Changes are saved with the file, not to ${dz}'s plan.` : "";
    for (const b of [tabBanner, plannerBanner]) {
      (b.querySelector(".plan-source-text") as HTMLElement).textContent = msg;
    }
    tabBanner.hidden = !file;
    plannerBanner.hidden = !file || !(window as any).planner?.active;
  };
  onPlanSourceChanged(update);
  // the planner opens and closes without an event: check twice a second
  window.setInterval(update, 500);
  update();
}
