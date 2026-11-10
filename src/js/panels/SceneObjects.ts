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

const PLANE_KEY = "plane";
const DETAIL_INTERVAL_MS = 100;

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

  function meshColor(j: SimJumper): string {
    const mat = (j.getMesh() as any)?.material;
    const c: THREE.Color | undefined = Array.isArray(mat) ? mat[0]?.color : mat?.color;
    return c ? `#${c.getHexString()}` : "#888";
  }

  function objectFor(key: string): THREE.Object3D | null {
    if (key === PLANE_KEY) return src.plane().getMesh();
    return src.jumpers().find((j) => j.id === key)?.getMesh() ?? null;
  }

  // ---------------------------------------------------------------- list

  function buildList() {
    const jumpers = sortedJumpers();
    signature = jumpers.map((j) => `${j.id}:${j.index}:${j.flyingStyle}`).join("|");
    listEl.replaceChildren();
    listEl.appendChild(makeRow(PLANE_KEY, "#ffd700", "✈", "Plane", aircraftName()));
    jumpers.forEach((j) => {
      const pos = BODY_POSITIONS[normalizeBodyPosition(j.flyingStyle)].label;
      listEl.appendChild(makeRow(j.id, meshColor(j), String(j.index + 1), jumperName(j), pos));
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
      if (key === PLANE_KEY) {
        const s = plane.track.getInterpolatedSample(t);
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
    if (key === PLANE_KEY) {
      const d = src.plane().direction.clone().setY(0).normalize();
      offset = d.multiplyScalar(-80).add(new THREE.Vector3(0, 25, 0));
      name = "the plane";
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
    const name = key === PLANE_KEY ? "the plane" : jumperName(src.jumpers().find((x) => x.id === key)!);
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

    if (selected === PLANE_KEY) {
      const s = plane.track.getInterpolatedSample(t);
      const onBoard = src.jumpers().filter((j) => !hasJumperExited(j, plane, t)).length;
      title = `Plane · ${aircraftName()}`;
      rows = [
        ["Speed", `${Math.round(plane.speed / 0.51444)} kt`],
        ["Heading", `${String(headingDeg(plane.direction.x, plane.direction.z)).padStart(3, "0")}°`],
        ["Altitude", s ? fmtFt(s.position.y) : "–"],
        ["On board", `${onBoard} of ${src.jumpers().length}`],
      ];
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
        ${selected === PLANE_KEY ? "" : `<button type="button" data-act="edit">Edit in Plane Settings</button>`}
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
    select(d.type === "plane" ? PLANE_KEY : d.id, true);
  });
  onRecalculated(() => buildList());
  window.addEventListener("tab-shown", (e: any) => {
    if (e.detail?.tab === "objects") buildList();
  });

  // live updates while visible (cheap: a few rows of text)
  const tick = () => {
    if (isShown()) {
      const jumpers = sortedJumpers();
      const sig = jumpers.map((j) => `${j.id}:${j.index}:${j.flyingStyle}`).join("|");
      if (sig !== signature) buildList();
      else updateRows();
      if (performance.now() - lastDetail > DETAIL_INTERVAL_MS) refreshDetails();
    }
    requestAnimationFrame(tick);
  };
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
