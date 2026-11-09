import type { Planner, Selection } from "../dropzone/PlannerView";
import {
  DANGER_KINDS,
  exportPlanJSON,
  getDropzonePlan,
  importPlanJSON,
  primaryLandingZone,
  resetPlanToDefault,
  updatePlan,
  emptyPlan,
  type DangerKind,
  type FreefallPattern,
} from "../dropzone/DropzonePlan";
import { enToXZ, FT, polygonCentroid, xzToEN } from "../dropzone/geometry";
import { exitPoints, offsetFromTarget, planeJumprun, rotateJumprunAbout } from "../dropzone/Jumprun";
import {
  flyCanopyPattern,
  intoWindHeading,
  jumprunFrameOf,
  jumprunToWorld,
  meanWind,
  upperWind,
  worldToJumprun,
} from "../dropzone/patternMath";
import { resolveZones, segmentViolations } from "../physics/Hazards";
import { getSeparationWarnings } from "../physics/Separation";
import { currentWindProfile, MS_TO_KT } from "../wind/WindProfile";
import { jumperName } from "./jumperStatus";
import { onRecalculated } from "../core/data/SimulationVariables";

/**
 * Dropzone dock tab: plan items, the selected item's properties, the jumprun card,
 * warnings (pattern legs over danger zones, spot check, separation) and plan actions.
 */

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const fmtFt = (ft: number) => `${Math.round(ft).toLocaleString()} ft`;

interface Warning {
  text: string;
  sel?: Selection;
  frame?: { x: number; z: number }[];
}

export function initializeDropzonePanel(planner: Planner) {
  const bodyEl = document.getElementById("dropzone-panel-body");
  if (!bodyEl) return;
  const body: HTMLElement = bodyEl;
  let pending = false;

  const render = () => {
    const ae = document.activeElement as HTMLElement | null;
    if (ae && body.contains(ae) && /INPUT|SELECT|TEXTAREA/.test(ae.tagName)) {
      pending = true;
      return;
    }
    pending = false;
    body.innerHTML = html();
    wire();
  };
  body.addEventListener("focusout", () => setTimeout(() => pending && render(), 0));
  planner.onChange(render);
  onRecalculated(render);
  window.addEventListener("tab-shown", (e: any) => e.detail?.tab === "dropzone" && render());

  // ---------------------------------------------------------------- warnings
  function warnings(): Warning[] {
    const plan = getDropzonePlan();
    const out: Warning[] = [];
    const lz = primaryLandingZone(plan);
    if ((plan.canopyPattern || plan.dangerZones.length) && !lz) out.push({ text: "No primary landing zone" });
    if (!currentWindProfile().length && plan.canopyPattern) out.push({ text: "No wind data: pattern shown as drawn" });
    const zones = resolveZones(plan);
    if (plan.canopyPattern && lz && zones.length) {
      const T = lz.target ? enToXZ(lz.target) : polygonCentroid(lz.polygon.map(enToXZ));
      const alts = [...plan.canopyPattern.legAltitudesFt.map((a) => a * FT), 0];
      const names = ["Downwind", "Base", "Final"];
      const check = (pts: { x: number; z: number }[], label: string) => {
        for (let k = 0; k < 3; k++) {
          for (const rz of segmentViolations(zones, pts[k], pts[k + 1], alts[k], alts[k + 1]))
            out.push({
              text: `${names[k]}${label} crosses ${rz.zone.name} below ${fmtFt(rz.zone.ceilingFt)}`,
              sel: { kind: "danger", id: rz.zone.id },
            });
        }
      };
      const drawn = [...plan.canopyPattern.points.map(enToXZ), T];
      const mirrored = flyCanopyPattern({ ...plan.canopyPattern, orientation: "flip" }, T, (() => {
        // a wind that forces the mirror: blowing along the drawn final
        const f = { x: T.x - drawn[2].x, z: T.z - drawn[2].z };
        return { x: f.x * 10, z: f.z * 10 };
      })()).points;
      check(drawn, "");
      check(mirrored, " (mirrored)");
    }
    // spot check: exits that can't make the main LZ
    const jumpers = planner.jumpers();
    if (lz) {
      const exits = exitPoints(planner.plane(), jumpers);
      const bad = exits.filter((e) => e.jumper.landingOutcome && e.jumper.landingOutcome.kind !== "lz" || e.jumper.canopyAlternate).map((e) => e.order);
      if (bad.length) {
        const runs: string[] = [];
        let a = bad[0];
        let b = bad[0];
        for (const n of [...bad.slice(1), Infinity]) {
          if (n === b + 1) b = n;
          else {
            runs.push(a === b ? `${a}` : `${a}–${b}`);
            a = b = n;
          }
        }
        out.push({ text: `Exit${bad.length > 1 ? "s" : ""} ${runs.join(", ")} can't make ${lz.name}`, sel: { kind: "jumprun", id: "jumprun" } });
      }
    }
    for (const j of jumpers) {
      if (j.landingOutcome?.kind === "hazard") out.push({ text: `${jumperName(j)} lands in ${j.landingOutcome.name}` });
      else if (j.hazardEvents?.length) out.push({ text: `${jumperName(j)} is over ${j.hazardEvents[0].name} below its ceiling` });
      if (j.deployOutsideArea) out.push({ text: `${jumperName(j)} pulls outside the deploy area` });
    }
    for (const w of getSeparationWarnings()) out.push({ text: w.text });
    return out;
  }

  // ---------------------------------------------------------------- html
  function itemList(): string {
    const plan = getDropzonePlan();
    const sel = planner.selection;
    const row = (s: Selection, label: string, extra = "") =>
      `<div class="dzp-item${sel && sel.kind === s.kind && sel.id === s.id ? " selected" : ""}" data-sel="${s.kind}:${s.id}">${label}<span>${extra}</span></div>`;
    let h = `<div class="dzp-group">Jumprun</div>`;
    h += row({ kind: "jumprun", id: "jumprun" }, "Jumprun", `${Math.round((plan.jumprun ?? planeJumprun(planner.plane())).headingDeg)}°`);
    h += `<div class="dzp-group">Landing zones</div>`;
    h += plan.landingZones.map((z) => row({ kind: "lz", id: z.id }, `${z.primary ? "★ " : ""}${esc(z.name)}`)).join("") || `<div class="dzp-empty">None · press L in the planner</div>`;
    h += `<div class="dzp-group">Danger zones</div>`;
    h +=
      plan.dangerZones.map((z) => row({ kind: "danger", id: z.id }, esc(z.name), `${DANGER_KINDS[z.kind].label} · ${z.ceilingFt} ft`)).join("") ||
      `<div class="dzp-empty">None · press D in the planner</div>`;
    h += `<div class="dzp-group">Canopy pattern</div>`;
    h += plan.canopyPattern
      ? row({ kind: "canopy", id: "canopy" }, "Landing pattern", plan.canopyPattern.orientation === "flip" ? "Flip" : "Fixed")
      : `<div class="dzp-empty">None · press C in the planner</div>`;
    h += `<div class="dzp-group">Freefall patterns</div>`;
    h +=
      plan.freefallPatterns
        .map((f) => row({ kind: "freefall", id: f.id }, `${f.isDefault ? "★ " : ""}${esc(f.name)}`, `${f.kind === "wingsuit" ? "Wingsuit" : "Tracking"} · ${f.legs.length} legs`))
        .join("") || `<div class="dzp-empty">None · press T or W in the planner</div>`;
    return h;
  }

  function jumprunCard(): string {
    const plan = getDropzonePlan();
    const jr = plan.jumprun ?? planeJumprun(planner.plane());
    const plane = planner.plane();
    const exits = exitPoints(plane, planner.jumpers());
    const prof = currentWindProfile();
    const w = prof.length ? upperWind(prof, plane.initialPosition.y) : null;
    const gs = (() => {
      const s = plane.track.getInterpolatedSample(exits[0]?.t ?? 0);
      return s ? Math.hypot(s.velocity.x, s.velocity.z) : plane.speed;
    })();
    const times = [...new Set(exits.map((e) => e.t))].sort((a, b) => a - b);
    const gap = Number((plane as any).planeLoad?.jumpIntervalSeconds) || (times.length > 1 ? times[1] - times[0] : 0);
    const off = offsetFromTarget(jr);
    const lz = primaryLandingZone(plan);
    return `
      <div class="dzp-card">
        <div class="dzp-row"><label>Heading</label><input type="number" step="1" data-jr="heading" value="${Math.round(jr.headingDeg)}"><span>° true</span></div>
        <div class="dzp-row"><label>Mode</label><select data-jr="mode">
          <option value="fixed"${jr.mode === "fixed" ? " selected" : ""}>Fixed</option>
          <option value="intoUpperWind"${jr.mode === "intoUpperWind" ? " selected" : ""}>Into upper winds</option></select></div>
        ${lz ? `<div class="dzp-row" title="Distance from the ${esc(lz.name)} target to the jumprun line"><label>Offset</label><input type="number" step="10" data-jr="offset" value="${Math.round(Math.abs(off))}"><select data-jr="side"><option value="right"${off >= 0 ? " selected" : ""}>m right of LZ</option><option value="left"${off < 0 ? " selected" : ""}>m left of LZ</option></select></div>` : ""}
        <div class="dzp-row dzp-buttons">
          <button data-jr-act="wind"${w ? "" : " disabled"} title="Set the heading into the winds at exit altitude">Into wind now</button>
          <button data-jr-act="reverse">Reverse</button>
          <button data-jr-act="reset" title="Back to the dropzone's default jumprun">Reset</button>
          <button data-jr-act="edit">Edit in planner</button>
        </div>
        <div class="dzp-note">${Math.round(gs * MS_TO_KT)} kt on jumprun${gap ? ` · ${gap.toFixed(0)} s apart ≈ ${Math.round(gs * gap)} m between exits` : ""}${w ? ` · uppers from ${Math.round((intoWindHeading(w) + 0) % 360)}° at ${Math.round(Math.hypot(w.x, w.z) * MS_TO_KT)} kt` : ""}</div>
      </div>`;
  }

  function props(): string {
    const sel = planner.selection;
    const plan = getDropzonePlan();
    if (!sel) return `<div class="dzp-note">Select an item in the list or in the planner to edit it.</div>`;
    if (sel.kind === "jumprun") return jumprunCard();
    if (sel.kind === "lz") {
      const z = plan.landingZones.find((x) => x.id === sel.id);
      if (!z) return "";
      return `<div class="dzp-card">
        <div class="dzp-row"><label>Name</label><input type="text" data-f="name" value="${esc(z.name)}"></div>
        <div class="dzp-row"><label>Primary</label><input type="checkbox" data-f="primary"${z.primary ? " checked" : ""}><span>holds the landing target and pattern</span></div>
        <div class="dzp-row"><label>Spread</label><input type="number" step="5" min="0" data-f="spreadM" value="${z.spreadM}"><span>m around the target</span></div>
        <div class="dzp-row dzp-buttons"><button data-act="delete" class="danger">Delete</button></div></div>`;
    }
    if (sel.kind === "danger") {
      const z = plan.dangerZones.find((x) => x.id === sel.id);
      if (!z) return "";
      return `<div class="dzp-card">
        <div class="dzp-row"><label>Name</label><input type="text" data-f="name" value="${esc(z.name)}"></div>
        <div class="dzp-row"><label>Type</label><select data-f="kind">${Object.entries(DANGER_KINDS).map(([k, v]) => `<option value="${k}"${k === z.kind ? " selected" : ""}>${v.label}</option>`).join("")}</select></div>
        <div class="dzp-row" title="Jumpers under canopy stay out of the zone below this height"><label>Ceiling</label><input type="number" step="50" min="0" data-f="ceilingFt" value="${z.ceilingFt}"><span>ft AGL</span></div>
        ${z.shape.type === "line" ? `<div class="dzp-row"><label>Width</label><input type="number" step="5" min="2" data-f="widthM" value="${z.shape.widthM}"><span>m</span></div>` : ""}
        <div class="dzp-row"><label>Notes</label><input type="text" data-f="notes" value="${esc(z.notes ?? "")}"></div>
        <div class="dzp-row dzp-buttons"><button data-act="delete" class="danger">Delete</button></div></div>`;
    }
    if (sel.kind === "canopy" && plan.canopyPattern) {
      const c = plan.canopyPattern;
      const fl = planner.overlays.flown;
      const why =
        !fl
          ? ""
          : fl.reason === "wind"
            ? `Flown ${fl.mirrored ? "mirrored" : "as drawn"} · ${fl.hand}-hand · final ${Math.round(fl.finalHeadingDeg)}°`
            : fl.reason === "calm"
              ? "Calm: flown as drawn"
              : fl.reason === "fixed"
                ? "Fixed: flown as drawn"
                : "No wind data: flown as drawn";
      const prof = currentWindProfile();
      const lw = prof.length ? meanWind(prof, 0, 250 * FT) : null;
      return `<div class="dzp-card">
        <div class="dzp-row"><label>Downwind</label><input type="number" step="50" data-alt="0" value="${c.legAltitudesFt[0]}"><span>ft</span></div>
        <div class="dzp-row"><label>Base</label><input type="number" step="50" data-alt="1" value="${c.legAltitudesFt[1]}"><span>ft</span></div>
        <div class="dzp-row"><label>Final</label><input type="number" step="50" data-alt="2" value="${c.legAltitudesFt[2]}"><span>ft</span></div>
        <div class="dzp-row"><label>Orientation</label><select data-f="orientation">
          <option value="flip"${c.orientation === "flip" ? " selected" : ""}>Flip (mirror into the wind)</option>
          <option value="fixed"${c.orientation === "fixed" ? " selected" : ""}>Fixed (as drawn)</option></select></div>
        <div class="dzp-row"><label>Calm below</label><input type="number" step="1" min="0" data-f="calmThresholdKt" value="${c.calmThresholdKt}"><span>kt</span></div>
        <div class="dzp-note">${why}${lw ? ` · landing wind ${Math.round(Math.hypot(lw.x, lw.z) * MS_TO_KT)} kt` : ""}</div>
        <div class="dzp-row dzp-buttons"><button data-act="delete" class="danger">Delete</button></div></div>`;
    }
    if (sel.kind === "freefall") {
      const f = plan.freefallPatterns.find((x) => x.id === sel.id);
      if (!f) return "";
      return `<div class="dzp-card">
        <div class="dzp-row"><label>Name</label><input type="text" data-f="name" value="${esc(f.name)}"></div>
        <div class="dzp-row"><label>Default</label><input type="checkbox" data-f="isDefault"${f.isDefault ? " checked" : ""}><span>for ${f.kind === "wingsuit" ? "wingsuiters" : "tracking jumpers"}</span></div>
        <div class="dzp-row"><label>Anchor</label><select data-f="anchor">
          <option value="jumprun"${f.anchor === "jumprun" ? " selected" : ""}>Moves with the jumprun</option>
          <option value="map"${f.anchor === "map" ? " selected" : ""}>Fixed on the map</option></select></div>
        <div class="dzp-row"><label>Lane spacing</label><input type="number" step="10" min="0" data-f="laneSpacingM" value="${f.laneSpacingM}"><span>m</span></div>
        <div class="dzp-row"><label>Deploy area</label><input type="number" step="10" min="10" data-f="deployRadiusM" value="${f.deployRadiusM}"><span>m radius</span></div>
        <table class="dzp-legs"><thead><tr><th>Leg</th><th>Steer</th><th>Ends</th><th></th><th></th></tr></thead><tbody>
        ${f.legs
          .map(
            (l, i) => `<tr>
          <td>${i + 1}</td>
          <td><select data-leg="${i}" data-lf="steer"><option value="point"${l.steer === "point" ? " selected" : ""}>To point</option><option value="heading"${l.steer === "heading" ? " selected" : ""}>Heading</option></select>${
            l.steer === "heading"
              ? `<input type="number" step="5" data-leg="${i}" data-lf="headingDeg" value="${l.headingDeg ?? 0}" title="${f.anchor === "jumprun" ? "Degrees from the jumprun direction" : "Degrees true"}">`
              : ""
          }</td>
          <td><select data-leg="${i}" data-lf="by"><option value="altitude"${l.end.by === "altitude" ? " selected" : ""}>Altitude</option><option value="arrival"${l.end.by === "arrival" ? " selected" : ""}>Arrival</option><option value="time"${l.end.by === "time" ? " selected" : ""}>Time</option></select></td>
          <td>${l.end.by === "altitude" ? `<input type="number" step="100" data-leg="${i}" data-lf="ft" value="${l.end.ft}"><span>ft</span>` : l.end.by === "time" ? `<input type="number" step="1" data-leg="${i}" data-lf="s" value="${l.end.s}"><span>s</span>` : ""}</td>
          <td>${f.legs.length > 1 ? `<button data-leg-del="${i}" title="Remove leg">✕</button>` : ""}</td></tr>`,
          )
          .join("")}</tbody></table>
        <div class="dzp-row dzp-buttons"><button data-act="delete" class="danger">Delete pattern</button></div></div>`;
    }
    return "";
  }

  function html(): string {
    const w = warnings();
    return `
      <div class="dzp-actions">
        <button data-act="planner" class="primary">${planner.active ? "Exit planner" : "Open planner"}</button>
        <button data-act="export" title="Save the plan as a file">Export</button>
        <button data-act="import" title="Load a plan file">Import</button>
        <button data-act="reset" title="Back to the dropzone's default plan">Reset</button>
        <button data-act="clear" title="Remove everything from the plan">Clear</button>
      </div>
      ${w.length ? `<div class="dzp-warnings">${w.map((x, i) => `<div class="dzp-warning" data-warn="${i}">⚠ ${esc(x.text)}</div>`).join("")}</div>` : ""}
      <div class="dzp-props">${props()}</div>
      <div class="dzp-list">${itemList()}</div>`;
  }

  // ---------------------------------------------------------------- wiring
  function wire() {
    const plan = getDropzonePlan();
    const ws = warnings();
    body.querySelectorAll<HTMLElement>("[data-warn]").forEach((el) =>
      el.addEventListener("click", () => {
        const wv = ws[Number(el.dataset.warn)];
        if (wv?.sel) {
          if (!planner.active) planner.enter();
          planner.select(wv.sel, true);
        }
      }),
    );
    body.querySelectorAll<HTMLElement>("[data-sel]").forEach((el) =>
      el.addEventListener("click", () => {
        const [kind, ...rest] = el.dataset.sel!.split(":");
        if (!planner.active) planner.enter(kind === "jumprun" ? "jumprun" : "select");
        else if (kind !== "jumprun" && planner.tool !== "select") planner.setTool("select");
        planner.select({ kind: kind as any, id: rest.join(":") }, true);
      }),
    );
    const act = (name: string, fn: () => void) =>
      body.querySelector<HTMLButtonElement>(`[data-act="${name}"]`)?.addEventListener("click", fn);
    act("planner", () => planner.toggle());
    act("export", () => {
      const blob = new Blob([exportPlanJSON()], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${(plan.dropzone || "dropzone").replace(/[^\w-]+/g, "-")}.dzplan.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });
    act("import", () => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".json,application/json";
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        try {
          const warning = importPlanJSON(await file.text());
          (window as any).notificationManager?.[warning ? "warning" : "success"]?.(warning ?? "Plan imported");
        } catch (err: any) {
          (window as any).notificationManager?.error?.(err?.message ?? "Couldn't read that plan");
        }
      };
      input.click();
    });
    act("reset", () => {
      const dz = (window as any).selectedDropzone;
      if (dz) resetPlanToDefault(dz);
      (window as any).resetJumprunToDefault?.();
    });
    act("clear", () => {
      if (!confirmClear()) return;
      updatePlan((p) => Object.assign(p, emptyPlan(p.dropzone), { dropzone: p.dropzone }));
      (window as any).resetJumprunToDefault?.();
    });
    act("delete", () => {
      const sel = planner.selection;
      if (!sel) return;
      updatePlan((p) => {
        if (sel.kind === "lz") {
          const was = p.landingZones.find((z) => z.id === sel.id)?.primary;
          p.landingZones = p.landingZones.filter((z) => z.id !== sel.id);
          if (was && p.landingZones[0]) p.landingZones[0].primary = true;
        }
        if (sel.kind === "danger") p.dangerZones = p.dangerZones.filter((z) => z.id !== sel.id);
        if (sel.kind === "canopy") p.canopyPattern = null;
        if (sel.kind === "freefall") {
          const f = p.freefallPatterns.find((z) => z.id === sel.id);
          p.freefallPatterns = p.freefallPatterns.filter((z) => z.id !== sel.id);
          if (f?.isDefault) {
            const n = p.freefallPatterns.find((z) => z.kind === f.kind);
            if (n) n.isDefault = true;
          }
        }
      });
      planner.select(null);
    });

    // item fields
    const sel = planner.selection;
    body.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-f]").forEach((el) =>
      el.addEventListener("change", () => {
        if (!sel) return;
        const key = el.dataset.f!;
        const val = el instanceof HTMLInputElement && el.type === "checkbox" ? el.checked : el.type === "number" ? Number(el.value) : el.value;
        if (typeof val === "number" && !Number.isFinite(val)) return;
        updatePlan((p) => {
          if (sel.kind === "lz") {
            const z = p.landingZones.find((x) => x.id === sel.id);
            if (!z) return;
            if (key === "primary") {
              if (val) p.landingZones.forEach((x) => (x.primary = x.id === z.id));
            } else (z as any)[key] = val;
          } else if (sel.kind === "danger") {
            const z = p.dangerZones.find((x) => x.id === sel.id);
            if (!z) return;
            if (key === "widthM" && z.shape.type === "line") z.shape.widthM = Math.max(2, val as number);
            else if (key === "kind") {
              z.kind = val as DangerKind;
            } else (z as any)[key] = key === "ceilingFt" ? Math.max(0, val as number) : val;
          } else if (sel.kind === "canopy" && p.canopyPattern) {
            (p.canopyPattern as any)[key] = val;
          } else if (sel.kind === "freefall") {
            const f = p.freefallPatterns.find((x) => x.id === sel.id);
            if (!f) return;
            if (key === "isDefault") {
              if (val) p.freefallPatterns.forEach((x) => x.kind === f.kind && (x.isDefault = x.id === f.id));
            } else if (key === "anchor") {
              convertAnchor(f, val as "jumprun" | "map");
            } else (f as any)[key] = val;
          }
        });
      }),
    );
    body.querySelectorAll<HTMLInputElement>("[data-alt]").forEach((el) =>
      el.addEventListener("change", () => {
        const k = Number(el.dataset.alt);
        const v = Number(el.value);
        if (!Number.isFinite(v) || v < 0) return;
        updatePlan((p) => {
          if (!p.canopyPattern) return;
          const a = [...p.canopyPattern.legAltitudesFt] as [number, number, number];
          a[k] = v;
          // keep them in decreasing order
          for (let i = 1; i < 3; i++) a[i] = Math.min(a[i], a[i - 1] - 50);
          p.canopyPattern.legAltitudesFt = a.map((x) => Math.max(50, x)) as [number, number, number];
        });
      }),
    );
    body.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-leg]").forEach((el) =>
      el.addEventListener("change", () => {
        if (sel?.kind !== "freefall") return;
        const i = Number(el.dataset.leg);
        const field = el.dataset.lf!;
        updatePlan((p) => {
          const f = p.freefallPatterns.find((x) => x.id === sel.id);
          const leg = f?.legs[i];
          if (!leg) return;
          if (field === "steer") leg.steer = el.value as any;
          else if (field === "headingDeg") leg.headingDeg = Number(el.value);
          else if (field === "by") {
            const by = el.value;
            leg.end = by === "altitude" ? { by: "altitude", ft: 5000 } : by === "time" ? { by: "time", s: 15 } : { by: "arrival" };
          } else if (field === "ft" && leg.end.by === "altitude") leg.end.ft = Number(el.value);
          else if (field === "s" && leg.end.by === "time") leg.end.s = Number(el.value);
        });
      }),
    );
    body.querySelectorAll<HTMLButtonElement>("[data-leg-del]").forEach((b) =>
      b.addEventListener("click", () => {
        if (sel?.kind !== "freefall") return;
        const i = Number(b.dataset.legDel);
        updatePlan((p) => p.freefallPatterns.find((x) => x.id === sel.id)?.legs.splice(i, 1));
      }),
    );

    // jumprun
    const jr = () => ({ ...(getDropzonePlan().jumprun ?? planeJumprun(planner.plane())) });
    body.querySelector<HTMLInputElement>('[data-jr="heading"]')?.addEventListener("change", (e) => {
      const v = Number((e.target as HTMLInputElement).value);
      if (!Number.isFinite(v)) return;
      updatePlan((p) => (p.jumprun = { ...jr(), headingDeg: ((v % 360) + 360) % 360, mode: "fixed" }));
    });
    body.querySelector<HTMLSelectElement>('[data-jr="mode"]')?.addEventListener("change", (e) => {
      updatePlan((p) => (p.jumprun = { ...jr(), mode: (e.target as HTMLSelectElement).value as any }));
    });
    const offsetChange = () => {
      const v = Number(body.querySelector<HTMLInputElement>('[data-jr="offset"]')?.value);
      const side = body.querySelector<HTMLSelectElement>('[data-jr="side"]')?.value;
      if (!Number.isFinite(v)) return;
      const want = side === "left" ? -Math.abs(v) : Math.abs(v);
      updatePlan((p) => {
        const cur = jr();
        const delta = offsetFromTarget(cur) - want; // slide the line sideways (toward its left)
        const s = enToXZ(cur.start);
        const h = (cur.headingDeg * Math.PI) / 180;
        const left = { x: -Math.cos(h), z: -Math.sin(h) };
        p.jumprun = { ...cur, start: xzToEN(s.x + left.x * delta, s.z + left.z * delta) };
      });
    };
    body.querySelector('[data-jr="offset"]')?.addEventListener("change", offsetChange);
    body.querySelector('[data-jr="side"]')?.addEventListener("change", offsetChange);
    const jrAct = (name: string, fn: () => void) =>
      body.querySelector<HTMLButtonElement>(`[data-jr-act="${name}"]`)?.addEventListener("click", fn);
    jrAct("wind", () => {
      const prof = currentWindProfile();
      if (!prof.length) return;
      const w = upperWind(prof, planner.plane().initialPosition.y);
      const lz = primaryLandingZone(getDropzonePlan());
      const pivot = lz ? (lz.target ? enToXZ(lz.target) : polygonCentroid(lz.polygon.map(enToXZ))) : { x: 0, z: 0 };
      updatePlan((p) => (p.jumprun = { ...rotateJumprunAbout(jr(), intoWindHeading(w), pivot), mode: "fixed" }));
    });
    jrAct("reverse", () => {
      const cur = jr();
      const exits = exitPoints(planner.plane(), planner.jumpers());
      const s = enToXZ(cur.start);
      const h = (cur.headingDeg * Math.PI) / 180;
      const d = { x: Math.sin(h), z: -Math.cos(h) };
      const last = exits[exits.length - 1];
      const len = last ? Math.max(400, (last.x - s.x) * d.x + (last.z - s.z) * d.z + 300) : 1200;
      updatePlan((p) => (p.jumprun = { ...cur, mode: "fixed", start: xzToEN(s.x + d.x * len, s.z + d.z * len), headingDeg: (cur.headingDeg + 180) % 360 }));
    });
    jrAct("reset", () => {
      updatePlan((p) => (p.jumprun = null));
      (window as any).resetJumprunToDefault?.();
    });
    jrAct("edit", () => {
      planner.enter("jumprun");
      planner.select({ kind: "jumprun", id: "jumprun" }, true);
    });
  }

  function confirmClear() {
    try {
      return window.confirm("Remove every zone and pattern from this dropzone's plan?");
    } catch {
      return true;
    }
  }

  /** Switch a freefall pattern's anchor without moving it on the map. */
  function convertAnchor(f: FreefallPattern, anchor: "jumprun" | "map") {
    if (f.anchor === anchor) return;
    const plane = planner.plane();
    const frame = jumprunFrameOf(plane);
    f.legs = f.legs.map((l) => {
      if (anchor === "map") {
        const w = jumprunToWorld(l.point, frame);
        return { ...l, point: xzToEN(w.x, w.z), headingDeg: l.steer === "heading" ? ((l.headingDeg ?? 0) + frame.headingDeg) % 360 : l.headingDeg };
      }
      const w = enToXZ(l.point);
      return { ...l, point: worldToJumprun(w.x, w.z, frame), headingDeg: l.steer === "heading" ? ((l.headingDeg ?? 0) - frame.headingDeg + 360) % 360 : l.headingDeg };
    });
    f.anchor = anchor;
  }

  render();
}
