// Formation bar in Plane Settings (specs/formation-jumps.md §10.4): pick the formation,
// import a .jump, set the time per point / working time / repeat, see the score.

import { requestRecalculation } from "../core/data/SimulationVariables";
import { FormationSequence, SequenceSettings, sanitizeSequenceSettings } from "../formations/FormationSequence";
import { getImportMode, getPlaneOrder, pickAndImportJump, resplitFormation, setImportMode, setPlaneOrder } from "../formations/ImportJump";

const WORKING_PRESETS: { label: string; value: number | "auto" }[] = [
  { label: "Auto (to breakoff)", value: "auto" },
  { label: "35 s (4-way FS)", value: 35 },
  { label: "50 s (8-way FS)", value: 50 },
];

export interface FormationBarHost {
  formations: FormationSequence[];
  selectedIndex: number;
  setSelected(i: number): void;
  render(): void;
}

function changed(f: FormationSequence, patch: Partial<SequenceSettings>) {
  f.settings = sanitizeSequenceSettings({ ...f.settings, ...patch });
  window.dispatchEvent(new Event("environment-changed"));
  requestRecalculation();
}

const fmtS = (s: number) => `${s.toFixed(1)} s`;

export function buildFormationBar(host: FormationBarHost): HTMLElement {
  const bar = document.createElement("div");
  bar.className = "ps-toolbar ps-formation-bar";

  const field = (label: string, el: HTMLElement, unit?: string, title?: string) => {
    const w = document.createElement("label");
    w.className = "ps-field";
    if (title) w.title = title;
    const l = document.createElement("span");
    l.className = "ps-label";
    l.textContent = label;
    w.append(l, el);
    if (unit) {
      const u = document.createElement("span");
      u.className = "ps-unit";
      u.textContent = unit;
      w.appendChild(u);
    }
    return w;
  };

  // formation picker
  const sel = document.createElement("select");
  sel.className = "ps-select";
  if (!host.formations.length) {
    const o = document.createElement("option");
    o.textContent = "No formations";
    sel.appendChild(o);
    sel.disabled = true;
  } else
    host.formations.forEach((f, i) => {
      const o = document.createElement("option");
      o.value = String(i);
      o.textContent = f.title;
      o.selected = i === host.selectedIndex;
      sel.appendChild(o);
    });
  sel.addEventListener("change", () => host.setSelected(Number(sel.value) || 0));
  bar.appendChild(field("Formation", sel));

  const f = host.formations[host.selectedIndex];
  if (f) {
    const info = document.createElement("span");
    info.className = "ps-unit";
    info.textContent = `${f.points.length} pt${f.points.length > 1 ? "s" : ""} · ${f.slotCount} slots`;
    bar.appendChild(info);
  }

  const imp = document.createElement("button");
  imp.type = "button";
  imp.className = "ps-button";
  imp.textContent = "Import .jump";
  imp.title = "Import a formation from a Skydive Designer .jump file (or drop one here)";
  imp.addEventListener("click", () => pickAndImportJump());
  bar.appendChild(imp);

  if (!f) return bar;

  // time per point
  const tpp = document.createElement("input");
  tpp.type = "number";
  tpp.className = "ps-input ps-input-narrow";
  tpp.min = "0.5";
  tpp.step = "0.5";
  tpp.value = String(f.settings.timePerPointS);
  tpp.addEventListener("change", () => {
    const v = Number(tpp.value);
    if (Number.isFinite(v)) changed(f, { timePerPointS: v });
  });
  bar.appendChild(field("Time per point", tpp, "s", "How long each point is held before the next one (until breakoff)"));

  // working time
  const wt = document.createElement("select");
  wt.className = "ps-select";
  const r = f.result;
  WORKING_PRESETS.forEach((p) => {
    const o = document.createElement("option");
    o.value = String(p.value);
    o.textContent = p.value === "auto" && r ? `Auto · ${Math.round(r.breakoffTime - r.tGo)} s` : p.label;
    wt.appendChild(o);
  });
  const custom = document.createElement("option");
  custom.value = "custom";
  custom.textContent = typeof f.settings.workingTimeS === "number" && ![35, 50].includes(f.settings.workingTimeS) ? `${f.settings.workingTimeS} s` : "Custom…";
  wt.appendChild(custom);
  wt.value = f.settings.workingTimeS === "auto" ? "auto" : [35, 50].includes(f.settings.workingTimeS) ? String(f.settings.workingTimeS) : "custom";
  wt.addEventListener("change", () => {
    if (wt.value === "custom") {
      const v = Number(window.prompt("Working time (s)", String(typeof f.settings.workingTimeS === "number" ? f.settings.workingTimeS : 50)));
      if (Number.isFinite(v) && v > 0) changed(f, { workingTimeS: v });
      else host.render();
      return;
    }
    changed(f, { workingTimeS: wt.value === "auto" ? "auto" : Number(wt.value) });
  });
  bar.appendChild(field("Working time", wt, undefined, "Scoring window from the first exit"));

  const rep = document.createElement("input");
  rep.type = "checkbox";
  rep.checked = f.settings.repeat;
  rep.addEventListener("change", () => changed(f, { repeat: rep.checked }));
  bar.appendChild(field("Repeat", rep, undefined, "Cycle the points again until working time / breakoff"));

  // score readout
  const score = document.createElement("button");
  score.type = "button";
  score.className = "ps-score";
  if (r) {
    const firstRound = r.windows.filter((w) => w.round === 1);
    const parts = firstRound.slice(0, 6).map((w) => {
      const label = `P${w.point + 1}`;
      if (w.keyedAt !== null) return `${label} ✓${w.point === 0 ? ` ${fmtS(w.keyedAt - r.tGo)}` : ""}`;
      return `${label} ✕${w.missingSlots.length ? ` slot ${w.missingSlots[0]}` : ""}`;
    });
    score.textContent = `Score ${r.score} · ${parts.join("  ")}`;
    score.classList.toggle("is-bad", r.windows[0]?.keyedAt === null);
  } else score.textContent = "Score –";
  score.title = "Points completed within the working time. Click for every point.";
  score.addEventListener("click", () => openPointTable(f, score));
  bar.appendChild(score);

  const gear = document.createElement("button");
  gear.type = "button";
  gear.className = "ps-btn ps-gear";
  gear.textContent = "⚙";
  gear.title = "Formation settings";
  gear.addEventListener("click", () => openSettings(host, f, gear));
  bar.appendChild(gear);
  return bar;
}

function popover(anchor: HTMLElement): HTMLDivElement {
  document.querySelector(".ps-popover")?.remove();
  const pop = document.createElement("div");
  pop.className = "ps-popover";
  document.body.appendChild(pop);
  requestAnimationFrame(() => {
    const r = anchor.getBoundingClientRect();
    pop.style.left = `${Math.max(8, Math.min(window.innerWidth - pop.offsetWidth - 8, r.left))}px`;
    pop.style.top = `${Math.max(8, r.top - pop.offsetHeight - 6)}px`;
  });
  const close = (e: MouseEvent) => {
    if (!pop.contains(e.target as Node) && e.target !== anchor) {
      pop.remove();
      document.removeEventListener("mousedown", close, true);
    }
  };
  setTimeout(() => document.addEventListener("mousedown", close, true), 0);
  return pop;
}

function openPointTable(f: FormationSequence, anchor: HTMLElement) {
  const pop = popover(anchor);
  pop.classList.add("ps-points");
  const r = f.result;
  const h = document.createElement("h4");
  h.textContent = `${f.title}: score ${r?.score ?? "–"}`;
  pop.appendChild(h);
  if (!r) return;
  const table = document.createElement("table");
  table.className = "ps-table";
  table.innerHTML = "<thead><tr><th>Point</th><th>Round</th><th>Window</th><th>Keyed</th><th>Missing</th></tr></thead>";
  const body = document.createElement("tbody");
  r.windows.forEach((w) => {
    const tr = document.createElement("tr");
    const p = f.points[w.point];
    const cells = [
      `${p?.label ?? w.point + 1}${p?.inter ? " (inter)" : ""}`,
      String(w.round),
      `${(w.start - r.tGo).toFixed(1)}–${(w.end - r.tGo).toFixed(1)} s`,
      w.keyedAt !== null ? `${(w.keyedAt - r.tGo).toFixed(1)} s${w.scored ? " ✓" : ""}` : "✕",
      w.missingSlots
        .slice(0, 6)
        .map((s) => {
          const m = r.members.find((x) => x.slot === s - 1);
          return `${s}${m?.missed ? ` (${m.missed.detail})` : ""}`;
        })
        .join(", ") + (w.missingSlots.length > 6 ? ` +${w.missingSlots.length - 6}` : ""),
    ];
    cells.forEach((c) => {
      const td = document.createElement("td");
      td.textContent = c;
      tr.appendChild(td);
    });
    body.appendChild(tr);
  });
  table.appendChild(body);
  pop.appendChild(table);
  const foot = document.createElement("p");
  foot.className = "plane-load-muted";
  foot.textContent = `Working time ends ${(r.workingTimeEnd - r.tGo).toFixed(1)} s after exit; breakoff at ${(r.breakoffTime - r.tGo).toFixed(1)} s.`;
  pop.appendChild(foot);
}

function openSettings(host: FormationBarHost, f: FormationSequence, anchor: HTMLElement) {
  const pop = popover(anchor);
  const s = f.settings;
  const row = (label: string, input: HTMLElement, title?: string) => {
    const l = document.createElement("label");
    l.textContent = label;
    if (title) l.title = title;
    l.appendChild(input);
    pop.appendChild(l);
  };
  const h = document.createElement("h4");
  h.textContent = "Sequence";
  pop.appendChild(h);

  const adv = document.createElement("select");
  [["timed", "Timed (each point lasts its time)"], ["early", "Early (move on once complete)"]].forEach(([v, t]) => {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = t;
    o.selected = s.advance === v;
    adv.appendChild(o);
  });
  adv.addEventListener("change", () => changed(f, { advance: adv.value as any }));
  row("Advance", adv);

  const num = (value: number | "auto", step: string, apply: (v: number | "auto") => void, allowAuto: boolean) => {
    const i = document.createElement("input");
    i.type = "text";
    i.value = String(value);
    i.placeholder = allowAuto ? "auto" : "";
    i.dataset.step = step;
    i.addEventListener("change", () => {
      const raw = i.value.trim().toLowerCase();
      if (allowAuto && (raw === "" || raw === "auto")) apply("auto");
      else {
        const v = Number(raw);
        if (Number.isFinite(v)) apply(v);
      }
    });
    return i;
  };
  row("First point (s)", num(s.firstPointS, "1", (v) => changed(f, { firstPointS: v }), true), "Auto: until point 1 is built");
  row("Min hold (s)", num(s.minHoldS, "0.5", (v) => changed(f, { minHoldS: v as number }), false), "A point must stay complete this long to count");
  row("Orientation (°)", num(s.orientationDeg, "5", (v) => changed(f, { orientationDeg: v as number }), false), "Page-up relative to jumprun, clockwise");
  row("Exit piece size", num(s.exitPieceSize, "1", (v) => changed(f, { exitPieceSize: v }), true), "Auto: the lead's floaters + door");
  row("Breakoff (ft)", num(s.breakoffFt, "100", (v) => changed(f, { breakoffFt: v as number }), false));

  const h2 = document.createElement("h4");
  h2.textContent = "Import";
  pop.appendChild(h2);
  const mode = document.createElement("select");
  [["replace", "Replace load"], ["add", "Add to load"]].forEach(([v, t]) => {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = t;
    o.selected = getImportMode() === v;
    mode.appendChild(o);
  });
  mode.addEventListener("change", () => setImportMode(mode.value as any));
  row("On import", mode);
  const order = document.createElement("select");
  [["firstOut", "First out (index 0 leaves first)"], ["fromPilot", "From the pilot (reversed)"]].forEach(([v, t]) => {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = t;
    o.selected = getPlaneOrder() === v;
    order.appendChild(o);
  });
  order.addEventListener("change", () => setPlaneOrder(order.value as any));
  row("Plane order in file", order, "How the .jump file numbers seats; applies to the next import");

  const planes = (window as any).fleet?.planes?.length ?? 1;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "ps-button";
  btn.textContent = `Re-split ${f.getAllJumpers().length} jumpers across ${planes} plane${planes > 1 ? "s" : ""}`;
  btn.addEventListener("click", () => {
    pop.remove();
    resplitFormation(f);
    host.render();
  });
  pop.appendChild(btn);
}
