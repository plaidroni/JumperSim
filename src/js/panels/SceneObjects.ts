import * as THREE from "three";
import type { SimJumper, SimPlane } from "../classes/SimEntities";
import { onRecalculated } from "../core/data/SimulationVariables";
import { BODY_POSITIONS, normalizeBodyPosition } from "../physics/BodyPositions";
import {
  M_TO_FT,
  MS_TO_MPH,
  hasJumperExited,
  headingDeg,
  jumperName,
  jumperStatus,
  simTime,
} from "./jumperStatus";

/**
 * Scene Objects tab: the plane and every jumper with live status. Selecting one shows
 * its details and offers Zoom in / Follow / Edit in Plane Settings. Selection stays
 * in sync with clicks in the 3D view. Spec: specs/editor-layout.md §8.
 */

interface Sources {
  plane: () => SimPlane;
  jumpers: () => SimJumper[];
}

const PLANE_PREFIX = "plane:";
const DETAIL_INTERVAL_MS = 100;
const AIRCRAFT_NAMES: Record<string, string> = { "twin-otter": "Twin Otter", skyvan: "Skyvan", "cessna-172": "Cessna-172", "dc-9": "DC-9" };
const isPlaneKey = (k: string | null) => !!k && k.startsWith(PLANE_PREFIX);

export function initializeSceneObjects(src: Sources) {
  const tab = document.getElementById("objects-panel");
  const body = tab?.querySelector(".panel-body") as HTMLElement | null;
  if (!tab || !body) return;

  body.innerHTML = `
    <div class="so-list" role="listbox" aria-label="Scene objects"></div>
    <div class="so-details" aria-live="polite"></div>`;
  const listEl = body.querySelector(".so-list") as HTMLElement;
  const detailsEl = body.querySelector(".so-details") as HTMLElement;

  let selected: string | null = null;
  let signature = "";
  let lastDetail = 0;

  const isShown = () => tab.offsetParent !== null && !tab.hidden;
  const sortedJumpers = () => [...src.jumpers()].sort((a, b) => a.index - b.index);
  const planes = (): SimPlane[] => (window as any).fleet?.planes ?? [src.plane()];
  const planeKey = (p: SimPlane) => PLANE_PREFIX + p.id;
  const planeFor = (key: string | null): SimPlane | null =>
    isPlaneKey(key) ? planes().find((p) => planeKey(p) === key) ?? null : null;
  const planeName = (p: SimPlane) => (planes().length > 1 ? p.label || "Plane" : "Plane");
  const planeHex = (p: SimPlane) => (p.planeColor ? `#${p.planeColor.toString(16).padStart(6, "0")}` : "#ffd700");

  function meshColor(j: SimJumper): string {
    const mat = (j.getMesh() as any)?.material;
    const c: THREE.Color | undefined = Array.isArray(mat) ? mat[0]?.color : mat?.color;
    return c ? `#${c.getHexString()}` : "#888";
  }

  function objectFor(key: string): THREE.Object3D | null {
    const p = planeFor(key);
    if (p) return p.getMesh();
    return src.jumpers().find((j) => j.id === key)?.getMesh() ?? null;
  }

  // ---------------------------------------------------------------- list

  function buildList() {
    const jumpers = sortedJumpers();
    signature = listSignature(jumpers);
    listEl.replaceChildren();
    const ps = planes();
    const multi = ps.length > 1;
    ps.forEach((p, k) => {
      const aboard = jumpers.filter((j) => j.plane === p || (k === 0 && !ps.includes(j.plane as SimPlane)));
      const sub = `${AIRCRAFT_NAMES[p.aircraftId] ?? aircraftName()}${multi ? ` · ${k === 0 ? "Lead · " : ""}${aboard.length} aboard` : ""}`;
      listEl.appendChild(makeRow(planeKey(p), planeHex(p), "✈", planeName(p), sub));
      aboard.forEach((j) => {
        const pos = BODY_POSITIONS[normalizeBodyPosition(j.flyingStyle)].label;
        const row = makeRow(j.id, meshColor(j), multi ? `${k + 1}·${j.exitOrder + 1}` : String(j.index + 1), jumperName(j), pos);
        if (multi) row.classList.add("so-row--child");
        listEl.appendChild(row);
      });
    });
    if (selected && !listEl.querySelector(`[data-key="${cssEscape(selected)}"]`)) selected = null;
    updateRows();
    renderDetails();
  }

  function makeRow(key: string, color: string, num: string, name: string, sub: string) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "so-row";
    row.dataset.key = key;
    row.setAttribute("role", "option");
    row.setAttribute("aria-selected", String(key === selected));
    row.innerHTML = `
      <span class="so-swatch" style="background:${color}"></span>
      <span class="so-num">${escapeHtml(num)}</span>
      <span class="so-name">${escapeHtml(name)}<small>${escapeHtml(sub)}</small></span>
      <span class="so-status"></span>`;
    row.addEventListener("click", () => select(key));
    row.addEventListener("dblclick", () => zoomIn(key));
    row.addEventListener("keydown", (e) => {
      const rows = [...listEl.querySelectorAll<HTMLElement>(".so-row")];
      const i = rows.indexOf(row);
      const next = e.key === "ArrowDown" ? rows[i + 1] : e.key === "ArrowUp" ? rows[i - 1] : null;
      if (next) {
        e.preventDefault();
        next.focus();
        select(next.dataset.key!);
      }
    });
    return row;
  }

  function updateRows() {
    const plane = src.plane();
    const t = simTime();
    const byId = new Map(src.jumpers().map((j) => [j.id, j]));
    listEl.querySelectorAll<HTMLElement>(".so-row").forEach((row) => {
      const key = row.dataset.key!;
      const cell = row.querySelector(".so-status") as HTMLElement;
      let text: string;
      const rowPlane = planeFor(key);
      if (rowPlane) {
        const s = rowPlane.track.getInterpolatedSample(t);
        text = s ? `In air · ${fmtFt(s.position.y)}` : "In air";
      } else {
        const j = byId.get(key);
        text = j ? jumperStatus(j, plane, t) : "";
        const sw = row.querySelector(".so-swatch") as HTMLElement;
        if (j && sw) sw.style.background = meshColor(j);
      }
      if (cell.textContent !== text) cell.textContent = text;
      row.setAttribute("aria-selected", String(key === selected));
    });
  }

  // ---------------------------------------------------------------- selection

  function select(key: string | null, fromScene = false) {
    selected = key;
    listEl.querySelectorAll<HTMLElement>(".so-row").forEach((r) =>
      r.setAttribute("aria-selected", String(r.dataset.key === key)),
    );
    (window as any).setSelectedObject?.(key ? objectFor(key) : null);
    if (fromScene && key) {
      listEl.querySelector<HTMLElement>(`[data-key="${cssEscape(key)}"]`)?.scrollIntoView({ block: "nearest" });
    }
    renderDetails();
  }

  function zoomIn(key: string) {
    select(key);
    const obj = objectFor(key);
    if (!obj) return;
    let offset: THREE.Vector3;
    let name: string;
    const kp = planeFor(key);
    if (kp) {
      const d = kp.direction.clone().setY(0).normalize();
      offset = d.multiplyScalar(-80).add(new THREE.Vector3(0, 25, 0));
      name = planes().length > 1 ? kp.label : "the plane";
    } else {
      const j = src.jumpers().find((x) => x.id === key)!;
      const s = j.track.getInterpolatedSample(simTime());
      const v = s ? s.velocity.clone().setY(0) : new THREE.Vector3();
      const back = v.lengthSq() > 1 ? v.normalize().multiplyScalar(-25) : new THREE.Vector3(18, 0, 18);
      offset = back.add(new THREE.Vector3(0, 10, 0));
      name = jumperName(j);
    }
    (window as any).cameraFocus?.(obj, { zoom: true, offset, name });
  }

  function follow(key: string) {
    const obj = objectFor(key);
    const fp = planeFor(key);
    const name = fp ? (planes().length > 1 ? fp.label : "the plane") : jumperName(src.jumpers().find((x) => x.id === key)!);
    (window as any).cameraFocus?.(obj, { name });
  }

  // ---------------------------------------------------------------- details

  function computeDetails(): { title: string; color: string; rows: Array<[string, string]> } | null {
    if (!selected) return null;
    const plane = src.plane();
    const t = simTime();
    let title: string;
    let rows: Array<[string, string]>;
    let color = "#ffd700";

    const sp = planeFor(selected);
    if (sp) {
      const s = sp.track.getInterpolatedSample(t);
      const aboard = src.jumpers().filter((j) => j.plane === sp);
      const onBoard = aboard.filter((j) => !hasJumperExited(j, sp, t)).length;
      color = planeHex(sp);
      title = `${planeName(sp)} · ${AIRCRAFT_NAMES[sp.aircraftId] ?? aircraftName()}`;
      rows = [
        ["Speed", `${Math.round(sp.speed / 0.51444)} kt`],
        ["Heading", `${String(headingDeg(sp.direction.x, sp.direction.z)).padStart(3, "0")}°`],
        ["Altitude", s ? fmtFt(s.position.y) : "–"],
        ["On board", `${onBoard} of ${aboard.length}`],
      ];
      if (planes().length > 1)
        rows.push([
          "Position",
          sp === planes()[0]
            ? "Lead"
            : `${Math.round(sp.offset.backM)} m back · ${Math.round(Math.abs(sp.offset.rightM))} m ${sp.offset.rightM >= 0 ? "right" : "left"} · +${Math.round(sp.offset.upM * M_TO_FT)} ft`,
        ]);
    } else {
      const j = src.jumpers().find((x) => x.id === selected);
      if (!j) return null;
      color = meshColor(j);
      const s = j.track.getInterpolatedSample(t);
      const pos = BODY_POSITIONS[normalizeBodyPosition(j.flyingStyle)];
      const canTrack = pos.canTrack;
      title = `${jumperName(j)} · ${pos.label}${canTrack ? ` · Track ${j.tracking ? "on" : "off"}` : ""}`;
      const exited = hasJumperExited(j, plane, t);
      const landed = j.landTime !== null && t >= j.landTime;
      const falling = exited && !landed && s;
      const ground = s ? Math.hypot(s.velocity.x, s.velocity.z) : 0;
      rows = [
        ["Status", jumperStatus(j, plane, t)],
        ...(planes().length > 1
          ? ([["Plane", `${(j.plane as SimPlane)?.label ?? "–"} · exit ${j.exitOrder + 1}${j.isFloater ? " (floater)" : ""}`]] as Array<[string, string]>)
          : []),
        ["Altitude", s ? fmtFt(s.position.y) : "–"],
        ["Fall rate", falling ? `${Math.round(Math.max(0, -s!.velocity.y) * MS_TO_MPH)} mph` : "–"],
        [
          "Ground spd",
          falling && ground > 0.5
            ? `${Math.round(ground * MS_TO_MPH)} mph · heading ${String(headingDeg(s!.velocity.x, s!.velocity.z)).padStart(3, "0")}°`
            : "–",
        ],
        ["Weight", `${Math.round(j.weight)} kg (+${Math.round(j.extraWeight || 0)})`],
        [
          "Canopy",
          `${Math.round(j.canopySize)} sq ft` +
            (j.canopyPerf
              ? ` · WL ${j.canopyPerf.wingLoading.toFixed(2)} · ${Math.round(j.canopyPerf.horizontalMs * MS_TO_MPH)}/${Math.round(j.canopyPerf.verticalMs * MS_TO_MPH)} mph`
              : ""),
        ],
        [
          "Exit",
          `${j.jumpTime.toFixed(1)} s` +
            (j.trackStartTime !== null ? ` · Tracks ${j.trackStartTime.toFixed(1)} s` : "") +
            (j.deployment ? ` · Pulls ${j.deployment.pullTime.toFixed(1)} s` : "") +
            (j.landTime !== null ? ` · Lands ${j.landTime.toFixed(1)} s` : ""),
        ],
        [
          "Slot",
          j.roundSlot
            ? `Round · Slot ${j.roundSlot}${j.breakoffDistanceM ? ` · tracks to ${Math.round(j.breakoffDistanceM)} m` : ""}`
            : j.flockSlotLabel
              ? `Wingsuit flock · ${j.flockSlotLabel}`
              : j.freefallRoute
                ? `${j.freefallRoute.name} · Lane ${j.freefallRoute.lane > 0 ? "+" : ""}${j.freefallRoute.lane}`
                : "–",
        ],
        [
          "Landing",
          !j.landingOutcome
            ? "–"
            : j.landingOutcome.kind === "hazard"
              ? `⚠ ${j.landingOutcome.name}`
              : j.landingOutcome.kind === "lz"
                ? `${j.landingOutcome.name}${j.canopyAlternate ? " (alternate)" : ""}`
                : "Out",
        ],
        [
          "At pull",
          j.pullSeparation ? `Nearest jumper ${Math.round(j.pullSeparation.distanceM)} m` : "–",
        ],
        [
          "Danger zones",
          j.hazardEvents?.length
            ? j.hazardEvents.map((e) => `${e.name} ${e.start.toFixed(0)}–${e.end.toFixed(0)} s (${Math.round(e.minHeightFt)} ft)`).join(", ")
            : "None",
        ],
        [
          "Opening",
          j.deployment && j.openAltitudeM !== null
            ? `${fmtFt(j.openAltitudeM)} open · ${j.openingPeakG.toFixed(1)} g peak`
            : "–",
        ],
        ["Nearest", nearest(j, t)],
      ];
    }

    return { title, color, rows };
  }

  function renderDetails() {
    lastDetail = performance.now();
    const d = computeDetails();
    if (!d) {
      if (selected) selected = null;
      detailsEl.innerHTML = `<p class="dock-empty">Select the plane or a jumper to see details.</p>`;
      return;
    }
    const { title, color, rows } = d;
    detailsEl.innerHTML = `
      <h4><span class="so-swatch" style="background:${color}"></span><span class="so-title">${escapeHtml(title)}</span></h4>
      <dl>${rows.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join("")}</dl>
      <div class="so-actions">
        <button type="button" class="primary" data-act="zoom">Zoom in</button>
        <button type="button" data-act="follow">Follow</button>
        ${isPlaneKey(selected) ? "" : `<button type="button" data-act="edit">Edit in Plane Settings</button>`}
      </div>`;
    const key = selected;
    detailsEl.querySelector('[data-act="zoom"]')?.addEventListener("click", () => zoomIn(key));
    detailsEl.querySelector('[data-act="follow"]')?.addEventListener("click", () => follow(key));
    detailsEl.querySelector('[data-act="edit"]')?.addEventListener("click", () => {
      (window as any).dock?.focus("plane");
      const pl = (src.plane() as any).planeLoad;
      requestAnimationFrame(() => pl?.highlightJumper?.(key));
    });
  }

  /** Live values only: rewrite the text cells, keeping the buttons in place. */
  function refreshDetails() {
    lastDetail = performance.now();
    if (!selected) return;
    const d = computeDetails();
    if (!d) return renderDetails();
    const dds = detailsEl.querySelectorAll("dd");
    if (dds.length !== d.rows.length) return renderDetails();
    d.rows.forEach(([, v], i) => {
      if (dds[i].textContent !== v) dds[i].textContent = v;
    });
    const titleEl = detailsEl.querySelector(".so-title");
    if (titleEl && titleEl.textContent !== d.title) titleEl.textContent = d.title;
    const sw = detailsEl.querySelector("h4 .so-swatch") as HTMLElement | null;
    if (sw) sw.style.background = d.color;
  }

  function nearest(j: SimJumper, t: number): string {
    const me = j.track.getInterpolatedSample(t);
    if (!me) return "–";
    let best: { name: string; d: number } | null = null;
    for (const o of src.jumpers()) {
      if (o === j) continue;
      const s = o.track.getInterpolatedSample(t);
      if (!s) continue;
      const d = s.position.distanceTo(me.position);
      if (!best || d < best.d) best = { name: jumperName(o), d };
    }
    return best ? `${best.name} · ${Math.round(best.d * M_TO_FT).toLocaleString()} ft` : "–";
  }

  function aircraftName(): string {
    const sel = document.getElementById("plane-select") as HTMLSelectElement | null;
    const opt = sel?.selectedOptions?.[0];
    return opt && opt.value ? opt.textContent || "Aircraft" : "Aircraft";
  }

  // ---------------------------------------------------------------- wiring

  window.addEventListener("scene-object-picked", (e: any) => {
    const d = e.detail as { type: "plane" | "jumper"; id: string };
    select(d.type === "plane" ? PLANE_PREFIX + d.id : d.id, true);
  });
  onRecalculated(() => buildList());
  window.addEventListener("tab-shown", (e: any) => {
    if (e.detail?.tab === "objects") buildList();
  });

  // live updates while visible (cheap: a few rows of text)
  const tick = () => {
    if (isShown()) {
      const jumpers = sortedJumpers();
      const sig = listSignature(jumpers);
      if (sig !== signature) buildList();
      else updateRows();
      if (performance.now() - lastDetail > DETAIL_INTERVAL_MS) refreshDetails();
    }
    requestAnimationFrame(tick);
  };
  function listSignature(jumpers: SimJumper[]) {
    const ps = planes();
    return (
      ps.map((p) => `${p.id}:${p.label}:${p.aircraftId}`).join(",") +
      "#" +
      jumpers.map((j) => `${j.id}:${j.index}:${j.flyingStyle}:${(j.plane as any)?.id}`).join("|")
    );
  }

  buildList();
  requestAnimationFrame(tick);
}

function fmtFt(m: number) {
  return `${Math.round(m * M_TO_FT).toLocaleString()} ft`;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function cssEscape(s: string) {
  return (window as any).CSS?.escape ? CSS.escape(s) : s.replace(/"/g, '\\"');
}
