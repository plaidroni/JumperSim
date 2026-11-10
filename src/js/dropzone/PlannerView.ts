import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { SimJumper, SimPlane } from "../classes/SimEntities";
import {
  DANGER_KINDS,
  DEFAULT_CEILING_FT,
  DEFAULT_LEG_ALTS,
  getDropzonePlan,
  newId,
  onPlanChanged,
  planReferencePoint,
  DEFAULT_SPREAD_M,
  redo,
  snapshotPlan,
  undo,
  updatePlan,
  type DangerKind,
  type FreefallLeg,
} from "./DropzonePlan";
import {
  dirOfHeading,
  distToPolyline,
  enToXZ,
  FT,
  headingDegOf,
  pointInPolygon,
  xzToEN,
  type EN,
  type XZ,
} from "./geometry";
import { jumprunFrameOf, meanWind, worldToJumprun, jumprunToWorld } from "./patternMath";
import { exitPoints, planeJumprun } from "./Jumprun";
import { DEFAULT_LAYERS, PlanOverlays, type OverlayLayers } from "./PlanOverlays";
import { onRecalculated } from "../core/data/SimulationVariables";
import { currentWindProfile, MS_TO_KT, vectorToFromDeg } from "../wind/WindProfile";
import { getGroundHeight } from "../terrain/GroundHeight";
import { initializeDropzonePanel } from "../panels/DropzonePanel";

/**
 * Dropzone Planner: a north-up orthographic view of the same scene, with tools to set
 * the jumprun and draw landing zones, danger zones, the canopy pattern and freefall
 * patterns. See specs/dropzone-planner.md.
 */

export type PlannerTool = "select" | "jumprun" | "lz" | "danger" | "canopy" | "tracking" | "wingsuit";
export type SelKind = "lz" | "danger" | "canopy" | "freefall" | "jumprun";
export interface Selection {
  kind: SelKind;
  id: string;
}

export interface Planner {
  readonly active: boolean;
  readonly camera: THREE.OrthographicCamera;
  enter(tool?: PlannerTool): void;
  exit(): void;
  toggle(): void;
  update(simTime: number): void;
  setTool(tool: PlannerTool): void;
  select(sel: Selection | null, frame?: boolean): void;
  readonly selection: Selection | null;
  readonly tool: PlannerTool;
  readonly overlays: PlanOverlays;
  frameItem(sel: Selection): void;
  frameWorld(pts: XZ[]): void;
  setDangerKind(kind: DangerKind): void;
  readonly dangerKind: DangerKind;
  onChange(cb: () => void): () => void;
  plane(): SimPlane;
  jumpers(): SimJumper[];
}

interface Deps {
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  perspective: THREE.PerspectiveCamera;
  controls: OrbitControls;
  viewport: HTMLElement;
  plane: () => SimPlane;
  jumpers: () => SimJumper[];
}

interface Handle {
  p: XZ;
  kind: "vertex" | "mid" | "target" | "jr-start" | "jr-end" | "point";
  index: number;
}

const LAYERS_KEY = "jumpersim.planner.layers";
const SAT_KEY = "jumpersim.planner.satellite";
const SHOW3D_KEY = "jumpersim.planner.show3d";
const MIN_W = 100;
const MAX_W = 20000;
const TOOL_HINTS: Record<PlannerTool, string> = {
  select: "Click an item to select it · drag handles to edit · drag empty map to pan · Delete removes",
  jumprun: "Drag the green start to move · drag the arrowhead to rotate (Shift: 5° steps, Alt: about the middle) · drag the line to slide · ←/→ rotate · R reverses",
  lz: "Click to add corners · click the first corner, double-click or press Enter to close",
  danger: "",
  canopy: "Click 4 points: downwind start (1,000 ft) → turn to base (500 ft) → turn to final (250 ft) → touchdown",
  tracking: "Click waypoints from the jumprun out · Enter or double-click to finish (last point = deploy area)",
  wingsuit: "Click waypoints from the jumprun out · Enter or double-click to finish (last point = deploy area)",
};

function load<T>(key: string, def: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...(def as any), ...JSON.parse(raw) } : def;
  } catch {
    return def;
  }
}
function loadBool(key: string, def: boolean) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? def : raw === "1";
  } catch {
    return def;
  }
}

export function initializePlanner(d: Deps): Planner {
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 60000);
  camera.up.set(0, 0, -1);
  const overlays = new PlanOverlays(d.scene);
  const handlesGroup = new THREE.Group();
  const previewGroup = new THREE.Group();
  d.scene.add(handlesGroup, previewGroup);

  let active = false;
  let tool: PlannerTool = "select";
  let selection: Selection | null = null;
  let dangerKind: DangerKind = "runway";
  let center: XZ = { x: 0, z: 0 };
  let viewW = 1500;
  let layers: OverlayLayers = load(LAYERS_KEY, DEFAULT_LAYERS);
  let satellite = loadBool(SAT_KEY, true);
  let show3D = loadBool(SHOW3D_KEY, true);
  let saved: { pos: THREE.Vector3; quat: THREE.Quaternion; target: THREE.Vector3; enabled: boolean; imagery?: string } | null = null;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((f) => f());

  // drawing state
  let drawing: XZ[] = [];
  let runwayWidth = 30;
  let cursor: XZ | null = null;
  let drag: null | {
    mode: "pan" | "handle" | "body" | "jr-body";
    startScreen: { x: number; y: number };
    startCenter: XZ;
    startWorld: XZ;
    handle?: Handle;
    snapshot: string;
    moved: boolean;
    base?: string; // JSON of the item at drag start
  } = null;
  let spaceDown = false;

  // ---------------------------------------------------------------- DOM
  const vp = d.viewport;
  vp.style.position = vp.style.position || "relative";
  const bar = document.createElement("div");
  bar.className = "planner-toolbar";
  bar.hidden = true;
  const hint = document.createElement("div");
  hint.className = "planner-hint";
  hint.hidden = true;
  const hud = document.createElement("div");
  hud.className = "planner-hud";
  hud.hidden = true;
  hud.innerHTML = `
    <div class="planner-scale"><div class="planner-scale-bar"></div><span></span></div>
    <div class="planner-readout"></div>
    <div class="planner-wind" title="Landing wind (0–250 ft)"><div class="planner-wind-arrow">➤</div><span></span></div>
    <div class="planner-north">N<br>▲</div>`;
  const planBtn = document.createElement("button");
  planBtn.className = "planner-open-btn";
  planBtn.textContent = "Plan";
  planBtn.title = "Dropzone Planner (P)";
  vp.append(bar, hint, hud, planBtn);
  planBtn.addEventListener("click", () => enter());

  const tools: { id: PlannerTool; label: string; key: string }[] = [
    { id: "select", label: "Select", key: "V" },
    { id: "jumprun", label: "Jumprun", key: "J" },
    { id: "lz", label: "Landing zone", key: "L" },
    { id: "danger", label: "Danger zone", key: "D" },
    { id: "canopy", label: "Canopy pattern", key: "C" },
    { id: "tracking", label: "Tracking", key: "T" },
    { id: "wingsuit", label: "Wingsuit", key: "W" },
  ];
  bar.innerHTML = `
    <div class="planner-group planner-tools">
      ${tools.map((t) => `<button data-tool="${t.id}" title="${t.label} (${t.key})">${t.label}<kbd>${t.key}</kbd></button>`).join("")}
    </div>
    <select class="planner-danger-kind" title="Danger zone type">
      ${Object.entries(DANGER_KINDS)
        .map(([k, v]) => `<option value="${k}">${v.label}</option>`)
        .join("")}
    </select>
    <div class="planner-group">
      <button data-zoom="1200" title="Landing area">LZ</button>
      <button data-zoom="3000" title="Canopy">Canopy</button>
      <button data-zoom="8000" title="Freefall">Freefall</button>
      <button data-zoom="fit" title="Fit everything">Fit</button>
    </div>
    <details class="planner-layers">
      <summary>Layers</summary>
      <label><input type="checkbox" data-layer="lz"> Landing zones</label>
      <label><input type="checkbox" data-layer="danger"> Danger zones</label>
      <label><input type="checkbox" data-layer="canopy"> Canopy pattern</label>
      <label><input type="checkbox" data-layer="freefall"> Freefall patterns</label>
      <label><input type="checkbox" data-layer="jumprun"> Jumprun</label>
      <label><input type="checkbox" data-layer="tracks"> Simulated hazards</label>
      <hr>
      <label><input type="checkbox" data-sat> Satellite in planner</label>
    </details>
    <div class="planner-spacer"></div>
    <button class="planner-undo" title="Undo (Ctrl+Z)">↶</button>
    <button class="planner-redo" title="Redo (Ctrl+Shift+Z)">↷</button>
    <button class="planner-exit" title="Exit planner (Esc)">Exit planner</button>`;
  const kindSel = bar.querySelector(".planner-danger-kind") as HTMLSelectElement;
  kindSel.value = dangerKind;
  kindSel.addEventListener("change", () => setDangerKind(kindSel.value as DangerKind));
  bar.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach((b) =>
    b.addEventListener("click", () => setTool(b.dataset.tool as PlannerTool)),
  );
  bar.querySelectorAll<HTMLButtonElement>("[data-zoom]").forEach((b) =>
    b.addEventListener("click", () => {
      if (b.dataset.zoom === "fit") fitPlan();
      else {
        viewW = Number(b.dataset.zoom);
        center = enToXZ(planReferencePoint(getDropzonePlan()));
      }
    }),
  );
  bar.querySelectorAll<HTMLInputElement>("[data-layer]").forEach((cb) => {
    const k = cb.dataset.layer as keyof OverlayLayers;
    cb.checked = layers[k];
    cb.addEventListener("change", () => {
      layers = { ...layers, [k]: cb.checked };
      try {
        localStorage.setItem(LAYERS_KEY, JSON.stringify(layers));
      } catch {}
      rebuild();
    });
  });
  const satCb = bar.querySelector("[data-sat]") as HTMLInputElement;
  satCb.checked = satellite;
  satCb.addEventListener("change", () => {
    satellite = satCb.checked;
    try {
      localStorage.setItem(SAT_KEY, satellite ? "1" : "0");
    } catch {}
    applyImagery();
  });
  (bar.querySelector(".planner-undo") as HTMLButtonElement).onclick = () => undo();
  (bar.querySelector(".planner-redo") as HTMLButtonElement).onclick = () => redo();
  (bar.querySelector(".planner-exit") as HTMLButtonElement).onclick = () => exit();

  // Location tab: show plan overlays in the 3D view
  const layerOpts = document.getElementById("map-layer-options");
  if (layerOpts && !document.getElementById("map-plan-toggle")) {
    const l = document.createElement("label");
    l.innerHTML = `<input type="checkbox" id="map-plan-toggle" /> Zones &amp; patterns`;
    layerOpts.appendChild(l);
    const cb = l.querySelector("input") as HTMLInputElement;
    cb.checked = show3D;
    cb.addEventListener("change", () => {
      show3D = cb.checked;
      try {
        localStorage.setItem(SHOW3D_KEY, show3D ? "1" : "0");
      } catch {}
      rebuild();
    });
  }
  document.getElementById("open-planner")?.addEventListener("click", () => enter());

  // Planning always happens in the top-down view: showing the Dropzone tab or working
  // in it enters the planner.
  window.addEventListener("tab-shown", (e: any) => {
    if (e.detail?.tab === "dropzone" && !active) enter();
  });
  document.getElementById("dropzone-panel-body")?.addEventListener(
    "pointerdown",
    (e) => {
      if (active) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('[data-act="planner"]')) return; // that button toggles on its own
      enter();
    },
    { capture: true },
  );

  // ---------------------------------------------------------------- camera
  const vw = () => Math.max(1, vp.clientWidth);
  const vh = () => Math.max(1, vp.clientHeight);
  const mpp = () => viewW / vw();

  function updateCamera() {
    const aspect = vw() / vh();
    const h = viewW / aspect;
    camera.left = -viewW / 2;
    camera.right = viewW / 2;
    camera.top = h / 2;
    camera.bottom = -h / 2;
    camera.zoom = 1;
    camera.position.set(center.x, 30000, center.z);
    camera.lookAt(center.x, 0, center.z);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }

  function screenToWorld(e: { clientX: number; clientY: number }): XZ {
    const r = d.renderer.domElement.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    const h = viewW / (vw() / vh());
    return { x: center.x + (px / r.width - 0.5) * viewW, z: center.z + (py / r.height - 0.5) * h };
  }

  function frameWorld(pts: XZ[]) {
    if (!pts.length) return;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    pts.forEach((p) => {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    });
    center = { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 };
    const aspect = vw() / vh();
    viewW = THREE.MathUtils.clamp(Math.max(maxX - minX, (maxZ - minZ) * aspect) * 1.35 + 200, MIN_W, MAX_W);
  }

  function allPlanPoints(): XZ[] {
    const plan = getDropzonePlan();
    const frame = jumprunFrameOf(d.plane());
    const pts: XZ[] = [frame.origin];
    plan.landingZones.forEach((z) => pts.push(...z.polygon.map(enToXZ)));
    plan.dangerZones.forEach((z) => pts.push(...z.shape.points.map(enToXZ)));
    plan.canopyPattern?.points.forEach((p) => pts.push(enToXZ(p)));
    plan.freefallPatterns.forEach((f) =>
      f.legs.forEach((l) => pts.push(f.anchor === "jumprun" ? jumprunToWorld(l.point, frame) : enToXZ(l.point))),
    );
    exitPoints(d.plane(), d.jumpers()).forEach((e) => pts.push({ x: e.x, z: e.z }));
    return pts;
  }

  function fitPlan() {
    frameWorld(allPlanPoints());
  }

  // ---------------------------------------------------------------- items & handles
  function itemPoints(sel: Selection): XZ[] {
    const plan = getDropzonePlan();
    const frame = jumprunFrameOf(d.plane());
    switch (sel.kind) {
      case "lz":
        return plan.landingZones.find((z) => z.id === sel.id)?.polygon.map(enToXZ) ?? [];
      case "danger":
        return plan.dangerZones.find((z) => z.id === sel.id)?.shape.points.map(enToXZ) ?? [];
      case "canopy":
        return plan.canopyPattern?.points.map(enToXZ) ?? [];
      case "freefall": {
        const f = plan.freefallPatterns.find((p) => p.id === sel.id);
        if (!f) return [];
        return f.legs.map((l) => (f.anchor === "jumprun" ? jumprunToWorld(l.point, frame) : enToXZ(l.point)));
      }
      case "jumprun": {
        const j = jumprunEnds();
        return [j.a, j.b];
      }
    }
  }

  function jumprunEnds() {
    const plan = getDropzonePlan();
    const jr = plan.jumprun ?? planeJumprun(d.plane());
    const a = enToXZ(jr.start);
    const dir = dirOfHeading(jr.headingDeg);
    const exits = exitPoints(d.plane(), d.jumpers());
    const last = exits[exits.length - 1];
    const frame = jumprunFrameOf(d.plane());
    const len = last
      ? Math.max(400, (last.x - frame.origin.x) * frame.dir.x + (last.z - frame.origin.z) * frame.dir.z + 300)
      : 1200;
    return { a, b: { x: a.x + dir.x * len, z: a.z + dir.z * len }, len, jr };
  }

  function handlesFor(sel: Selection | null): Handle[] {
    if (!sel) return [];
    const plan = getDropzonePlan();
    const hs: Handle[] = [];
    if (sel.kind === "jumprun") {
      const { a, b } = jumprunEnds();
      return [
        { p: a, kind: "jr-start", index: 0 },
        { p: b, kind: "jr-end", index: 1 },
      ];
    }
    const pts = itemPoints(sel);
    const closed = sel.kind === "lz" || (sel.kind === "danger" && plan.dangerZones.find((z) => z.id === sel.id)?.shape.type === "polygon");
    pts.forEach((p, i) => hs.push({ p, kind: sel.kind === "lz" || sel.kind === "danger" ? "vertex" : "point", index: i }));
    if (sel.kind === "lz" || sel.kind === "danger") {
      const n = closed ? pts.length : pts.length - 1;
      for (let i = 0; i < n; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        hs.push({ p: { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }, kind: "mid", index: i });
      }
    }
    return hs;
  }

  function hitHandle(w: XZ): Handle | null {
    const tol = 9 * mpp();
    let best: Handle | null = null;
    let bestD = tol;
    for (const h of handlesFor(selection)) {
      const dd = Math.hypot(h.p.x - w.x, h.p.z - w.z) * (h.kind === "mid" ? 1.2 : 1);
      if (dd < bestD) {
        bestD = dd;
        best = h;
      }
    }
    return best;
  }

  function hitItem(w: XZ): Selection | null {
    const plan = getDropzonePlan();
    const tol = 8 * mpp();
    const frame = jumprunFrameOf(d.plane());
    if (layers.jumprun) {
      const { a, b } = jumprunEnds();
      if (distToPolyline([a, b], w.x, w.z) < tol) return { kind: "jumprun", id: "jumprun" };
    }
    if (layers.freefall)
      for (const f of plan.freefallPatterns) {
        const pts = [frame.origin, ...f.legs.map((l) => (f.anchor === "jumprun" ? jumprunToWorld(l.point, frame) : enToXZ(l.point)))];
        if (distToPolyline(pts, w.x, w.z) < tol) return { kind: "freefall", id: f.id };
      }
    if (layers.canopy && plan.canopyPattern) {
      const pts = plan.canopyPattern.points.map(enToXZ);
      if (distToPolyline(pts, w.x, w.z) < tol) return { kind: "canopy", id: "canopy" };
    }
    if (layers.danger)
      for (const z of [...plan.dangerZones].reverse()) {
        const pts = z.shape.points.map(enToXZ);
        const hit =
          z.shape.type === "line"
            ? distToPolyline(pts, w.x, w.z) < Math.max(tol, z.shape.widthM / 2)
            : pointInPolygon(pts, w.x, w.z) || distToPolyline([...pts, pts[0]], w.x, w.z) < tol;
        if (hit) return { kind: "danger", id: z.id };
      }
    if (layers.lz)
      for (const z of [...plan.landingZones].reverse()) {
        const pts = z.polygon.map(enToXZ);
        if (pointInPolygon(pts, w.x, w.z) || distToPolyline([...pts, pts[0]], w.x, w.z) < tol) return { kind: "lz", id: z.id };
      }
    return null;
  }

  // handle sprites
  const handleTex = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 32;
    const g = c.getContext("2d")!;
    g.fillStyle = "#111";
    g.fillRect(4, 4, 24, 24);
    g.strokeStyle = "#f5c518";
    g.lineWidth = 5;
    g.strokeRect(4, 4, 24, 24);
    return new THREE.CanvasTexture(c);
  })();
  const midTex = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 32;
    const g = c.getContext("2d")!;
    g.fillStyle = "rgba(245,197,24,0.75)";
    g.beginPath();
    g.arc(16, 16, 9, 0, Math.PI * 2);
    g.fill();
    return new THREE.CanvasTexture(c);
  })();
  const startTex = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 32;
    const g = c.getContext("2d")!;
    g.fillStyle = "#3ccf6e";
    g.beginPath();
    g.arc(16, 16, 12, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "#fff";
    g.lineWidth = 3;
    g.stroke();
    return new THREE.CanvasTexture(c);
  })();

  function rebuildHandles() {
    handlesGroup.children.forEach((c: any) => c.material?.dispose?.());
    handlesGroup.clear();
    if (!active) return;
    for (const h of handlesFor(selection)) {
      const tex = h.kind === "mid" ? midTex : h.kind === "jr-start" ? startTex : handleTex;
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
      s.position.set(h.p.x, getGroundHeight(h.p.x, h.p.z) + 40, h.p.z);
      s.renderOrder = 40;
      s.userData.px = h.kind === "mid" ? 12 : h.kind === "jr-start" || h.kind === "jr-end" ? 18 : 14;
      handlesGroup.add(s);
    }
  }

  function rebuildPreview() {
    previewGroup.children.forEach((c: any) => (c.geometry?.dispose?.(), c.material?.dispose?.()));
    previewGroup.clear();
    if (!active || !drawing.length) return;
    const pts = [...drawing];
    if (cursor && !(tool === "danger" && DANGER_KINDS[dangerKind].shape === "rect" && drawing.length === 2)) pts.push(cursor);
    let outline = pts;
    if (tool === "danger" && DANGER_KINDS[dangerKind].shape === "rect" && drawing.length === 2) {
      outline = runwayCorners(drawing[0], drawing[1], cursor);
      outline = [...outline, outline[0]];
    }
    const color =
      tool === "lz" ? 0x3ccf6e : tool === "danger" ? DANGER_KINDS[dangerKind].color : tool === "wingsuit" ? 0xc77dff : tool === "tracking" ? 0x4fa3ff : 0xf5c518;
    const geo = new THREE.BufferGeometry().setFromPoints(outline.map((p) => new THREE.Vector3(p.x, 50, p.z)));
    const l = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, depthTest: false }));
    l.renderOrder = 45;
    previewGroup.add(l);
    if (tool === "tracking" || tool === "wingsuit") {
      // show the start from the jumprun
      const f = jumprunFrameOf(d.plane());
      const g2 = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(f.origin.x, 50, f.origin.z), new THREE.Vector3(drawing[0].x, 50, drawing[0].z)]);
      const l2 = new THREE.Line(g2, new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.4 }));
      l2.renderOrder = 45;
      previewGroup.add(l2);
    }
    for (const p of drawing) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: handleTex, depthTest: false }));
      s.position.set(p.x, 60, p.z);
      s.renderOrder = 46;
      s.userData.px = 10;
      previewGroup.add(s);
    }
  }

  function runwayCorners(a: XZ, b: XZ, c: XZ | null): XZ[] {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    const r = { x: -dz / len, z: dx / len };
    if (c) runwayWidth = Math.max(5, Math.abs((c.x - a.x) * r.x + (c.z - a.z) * r.z) * 2);
    const hw = runwayWidth / 2;
    return [
      { x: a.x + r.x * hw, z: a.z + r.z * hw },
      { x: b.x + r.x * hw, z: b.z + r.z * hw },
      { x: b.x - r.x * hw, z: b.z - r.z * hw },
      { x: a.x - r.x * hw, z: a.z - r.z * hw },
    ];
  }

  // ---------------------------------------------------------------- rebuild
  function rebuild() {
    overlays.rebuild({
      plan: getDropzonePlan(),
      plane: d.plane(),
      jumpers: d.jumpers(),
      wind: currentWindProfile(),
      planner: active,
      layers,
      show3D,
      selectedId: selection?.id ?? null,
    });
    rebuildHandles();
    rebuildPreview();
    updateHud();
  }
  onPlanChanged(() => {
    if (selection && !itemExists(selection)) selection = null;
    rebuild();
    emit();
  });
  onRecalculated(() => {
    rebuild();
    emit();
  });
  window.addEventListener("weather-updated", () => rebuild());

  function itemExists(sel: Selection): boolean {
    const plan = getDropzonePlan();
    if (sel.kind === "jumprun") return true;
    if (sel.kind === "canopy") return !!plan.canopyPattern;
    if (sel.kind === "lz") return plan.landingZones.some((z) => z.id === sel.id);
    if (sel.kind === "danger") return plan.dangerZones.some((z) => z.id === sel.id);
    return plan.freefallPatterns.some((z) => z.id === sel.id);
  }

  // ---------------------------------------------------------------- HUD
  function updateHud() {
    if (!active) return;
    const m = mpp();
    const target = 120 * m;
    const pow = Math.pow(10, Math.floor(Math.log10(target)));
    const nice = [1, 2, 5, 10].map((k) => k * pow).find((v) => v >= target * 0.6) ?? pow;
    const bar2 = hud.querySelector(".planner-scale-bar") as HTMLElement;
    bar2.style.width = `${nice / m}px`;
    (hud.querySelector(".planner-scale span") as HTMLElement).textContent = nice >= 1000 ? `${nice / 1000} km` : `${nice} m`;
    const prof = currentWindProfile();
    const windEl = hud.querySelector(".planner-wind") as HTMLElement;
    if (prof.length) {
      const w = meanWind(prof, 0, 250 * FT);
      const v = new THREE.Vector3(w.x, 0, w.z);
      const kt = v.length() * MS_TO_KT;
      const toDeg = headingDegOf(w.x, w.z);
      (windEl.querySelector(".planner-wind-arrow") as HTMLElement).style.transform = `rotate(${toDeg - 90}deg)`;
      (windEl.querySelector("span") as HTMLElement).textContent = `${Math.round(kt)} kt from ${Math.round(vectorToFromDeg(v))}°`;
      windEl.style.opacity = "1";
    } else {
      (windEl.querySelector("span") as HTMLElement).textContent = "No wind data";
      windEl.style.opacity = "0.6";
    }
    hint.textContent =
      tool === "danger"
        ? DANGER_KINDS[dangerKind].shape === "rect"
          ? "Runway: click one end of the centreline, then the other, then move out to set the width and click"
          : DANGER_KINDS[dangerKind].shape === "line"
            ? `${DANGER_KINDS[dangerKind].label}: click points along it · Enter or double-click to finish`
            : `${DANGER_KINDS[dangerKind].label}: click to add corners · click the first corner, double-click or Enter to close`
        : TOOL_HINTS[tool];
    bar.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach((b) => b.classList.toggle("active", b.dataset.tool === tool));
    kindSel.hidden = tool !== "danger";
  }

  function readout(w: XZ) {
    const el = hud.querySelector(".planner-readout") as HTMLElement;
    const plan = getDropzonePlan();
    const t = enToXZ(planReferencePoint(plan));
    const lz = plan.canopyPattern ? "touchdown" : plan.landingZones.length ? "LZ" : "DZ";
    const dist = Math.hypot(w.x - t.x, w.z - t.z);
    const brg = headingDegOf(w.x - t.x, w.z - t.z);
    const elev = getGroundHeight(w.x, w.z);
    el.textContent = `${dist >= 1000 ? (dist / 1000).toFixed(2) + " km" : Math.round(dist) + " m"} at ${Math.round(brg)}° from ${lz} · ground ${elev >= 0 ? "+" : ""}${Math.round(elev / FT)} ft`;
  }

  // ---------------------------------------------------------------- enter / exit
  function applyImagery() {
    const ms = (window as any).mapScene;
    if (!ms?.setImagery) return;
    const sel = document.getElementById("map-style-select") as HTMLSelectElement | null;
    const want = active && satellite ? "cesium" : saved?.imagery ?? ms.imagery;
    if (ms.imagery !== want) {
      ms.setImagery(want).then((ok: boolean) => {
        if (ok && sel) sel.value = want;
      });
    }
  }

  function enter(t: PlannerTool = tool) {
    if (!active) {
      const ms = (window as any).mapScene;
      saved = {
        pos: d.perspective.position.clone(),
        quat: d.perspective.quaternion.clone(),
        target: d.controls.target.clone(),
        enabled: d.controls.enabled,
        imagery: ms?.imagery,
      };
      d.controls.enabled = false;
      active = true;
      document.body.classList.add("planner-active");
      bar.hidden = hint.hidden = hud.hidden = false;
      planBtn.hidden = true;
      const plan = getDropzonePlan();
      if (plan.canopyPattern || plan.landingZones.length) {
        center = enToXZ(planReferencePoint(plan));
        viewW = 1800;
      } else fitPlan();
      updateCamera();
      ms?.setActiveCamera?.(camera);
      applyImagery();
    }
    setTool(t);
    rebuild();
    emit();
    (window as any).dock?.open?.("dropzone");
    // show the top-down view straight away, even before the render loop's next frame
    // (or before it has started while the map is still loading)
    updateCamera();
    update(0);
    try {
      d.renderer.render(d.scene, camera);
    } catch {
      /* first frame can fail before the scene is ready; the loop will draw it */
    }
  }

  function exit() {
    if (!active) return;
    active = false;
    drawing = [];
    drag = null;
    document.body.classList.remove("planner-active");
    bar.hidden = hint.hidden = hud.hidden = true;
    planBtn.hidden = false;
    const ms = (window as any).mapScene;
    ms?.setActiveCamera?.(d.perspective);
    if (saved) {
      d.perspective.position.copy(saved.pos);
      d.perspective.quaternion.copy(saved.quat);
      d.controls.target.copy(saved.target);
      d.controls.enabled = saved.enabled;
      d.controls.update();
    }
    applyImagery();
    saved = null;
    rebuild();
    emit();
  }

  function toggle() {
    active ? exit() : enter();
  }

  function setTool(t: PlannerTool) {
    tool = t;
    drawing = [];
    if (t === "jumprun") selection = { kind: "jumprun", id: "jumprun" };
    if (t === "canopy" && getDropzonePlan().canopyPattern) selection = { kind: "canopy", id: "canopy" };
    rebuild();
    emit();
  }

  function select(sel: Selection | null, frame = false) {
    selection = sel;
    if (sel && frame) frameItem(sel);
    rebuild();
    emit();
  }

  function frameItem(sel: Selection) {
    const pts = itemPoints(sel);
    if (sel.kind === "freefall") pts.push(jumprunFrameOf(d.plane()).origin);
    if (pts.length) frameWorld(pts);
  }

  function setDangerKind(k: DangerKind) {
    dangerKind = k;
    kindSel.value = k;
    drawing = [];
    rebuild();
  }

  // ---------------------------------------------------------------- creating items
  function finishDrawing() {
    const pts = drawing.map((p) => xzToEN(p.x, p.z));
    const plan = getDropzonePlan();
    if (tool === "lz" && pts.length >= 3) {
      const id = newId("lz");
      updatePlan((p) => {
        p.landingZones.push({ id, name: `LZ ${p.landingZones.length + 1}`, polygon: pts });
      });
      drawing = [];
      setTool("select");
      select({ kind: "lz", id });
      return;
    }
    if (tool === "danger") {
      const shape = DANGER_KINDS[dangerKind].shape;
      const id = newId("dz");
      const count = plan.dangerZones.filter((z) => z.kind === dangerKind).length;
      const name = `${DANGER_KINDS[dangerKind].label}${count ? " " + (count + 1) : ""}`;
      if (shape === "line" && pts.length >= 2) {
        updatePlan((p) =>
          p.dangerZones.push({
            id,
            name,
            kind: dangerKind,
            shape: { type: "line", points: pts, widthM: DANGER_KINDS[dangerKind].widthM ?? 30 },
            ceilingFt: DEFAULT_CEILING_FT,
          }),
        );
      } else if (shape !== "line" && pts.length >= 3) {
        updatePlan((p) =>
          p.dangerZones.push({ id, name, kind: dangerKind, shape: { type: "polygon", points: pts }, ceilingFt: DEFAULT_CEILING_FT }),
        );
      } else return;
      drawing = [];
      setTool("select");
      select({ kind: "danger", id });
      return;
    }
    if ((tool === "tracking" || tool === "wingsuit") && pts.length >= 1) {
      const kind = tool;
      const frame = jumprunFrameOf(d.plane());
      const exitFt = d.plane().initialPosition.y / FT;
      const pullFt = kind === "wingsuit" ? 4000 : 3500;
      const n = drawing.length;
      const legs: FreefallLeg[] = drawing.map((w, k) => ({
        point: worldToJumprun(w.x, w.z, frame),
        steer: "point",
        end: { by: "altitude", ft: Math.round((exitFt - ((exitFt - pullFt) * (k + 1)) / n) / 100) * 100 },
      }));
      legs[legs.length - 1].end = { by: "altitude", ft: pullFt };
      const id = newId(kind === "wingsuit" ? "ws" : "tr");
      updatePlan((p) => {
        const same = p.freefallPatterns.filter((f) => f.kind === kind);
        p.freefallPatterns.push({
          id,
          name: `${kind === "wingsuit" ? "Wingsuit" : "Tracking"} ${String.fromCharCode(65 + same.length)}`,
          kind,
          isDefault: same.length === 0,
          anchor: "jumprun",
          legs,
          deployRadiusM: 150,
          laneSpacingM: 150,
        });
      });
      drawing = [];
      setTool("select");
      select({ kind: "freefall", id });
    }
  }

  function addPoint(w: XZ, dbl = false) {
    if (tool === "canopy") {
      drawing.push(w);
      if (drawing.length === 4) {
        const pts = drawing.map((p) => xzToEN(p.x, p.z)) as [EN, EN, EN, EN];
        updatePlan((p) => {
          p.canopyPattern = {
            points: pts,
            spreadM: p.canopyPattern?.spreadM ?? DEFAULT_SPREAD_M,
            legAltitudesFt: p.canopyPattern?.legAltitudesFt ?? [...DEFAULT_LEG_ALTS],
            orientation: p.canopyPattern?.orientation ?? "flip",
            calmThresholdKt: p.canopyPattern?.calmThresholdKt ?? 3,
          };
        });
        drawing = [];
        setTool("select");
        select({ kind: "canopy", id: "canopy" });
      }
      rebuildPreview();
      return;
    }
    if (tool === "danger" && DANGER_KINDS[dangerKind].shape === "rect") {
      if (drawing.length < 2) drawing.push(w);
      else {
        const corners = runwayCorners(drawing[0], drawing[1], w);
        drawing = corners;
        finishDrawing();
      }
      rebuildPreview();
      return;
    }
    const closes =
      (tool === "lz" || (tool === "danger" && DANGER_KINDS[dangerKind].shape === "polygon")) &&
      drawing.length >= 3 &&
      Math.hypot(drawing[0].x - w.x, drawing[0].z - w.z) < 10 * mpp();
    if (closes || dbl) {
      if (dbl && drawing.length && Math.hypot(drawing[drawing.length - 1].x - w.x, drawing[drawing.length - 1].z - w.z) > 3 * mpp())
        drawing.push(w);
      finishDrawing();
    } else drawing.push(w);
    rebuildPreview();
  }

  // ---------------------------------------------------------------- editing
  function moveHandle(h: Handle, w: XZ, e: PointerEvent, base: string) {
    const en = xzToEN(w.x, w.z);
    const sel = selection!;
    if (h.kind === "jr-start" || h.kind === "jr-end") {
      const orig = JSON.parse(base) as { start: EN; headingDeg: number; mode: any };
      updatePlan(
        (p) => {
          const jr = { ...orig };
          if (h.kind === "jr-start") jr.start = en;
          else {
            const s = enToXZ(orig.start);
            const len = jumprunEnds().len;
            const pivot = e.altKey
              ? (() => {
                  const dd = dirOfHeading(orig.headingDeg);
                  return { x: s.x + (dd.x * len) / 2, z: s.z + (dd.z * len) / 2 };
                })()
              : s;
            let hd = headingDegOf(w.x - pivot.x, w.z - pivot.z);
            hd = snapHeading(hd, e.shiftKey);
            if (e.altKey) {
              const nd = dirOfHeading(hd);
              jr.start = xzToEN(pivot.x - (nd.x * len) / 2, pivot.z - (nd.z * len) / 2);
            }
            jr.headingDeg = hd;
            jr.mode = "fixed";
          }
          p.jumprun = jr;
        },
        { live: true },
      );
      return;
    }
    updatePlan(
      (p) => {
        if (sel.kind === "lz") {
          const z = p.landingZones.find((x) => x.id === sel.id)!;
          if (h.kind === "target") z.target = en;
          else if (h.kind === "vertex") z.polygon[h.index] = en;
        } else if (sel.kind === "danger") {
          const z = p.dangerZones.find((x) => x.id === sel.id)!;
          if (h.kind === "vertex") z.shape.points[h.index] = en;
        } else if (sel.kind === "canopy" && p.canopyPattern) {
          p.canopyPattern.points[h.index] = en;
        } else if (sel.kind === "freefall") {
          const f = p.freefallPatterns.find((x) => x.id === sel.id)!;
          f.legs[h.index].point = f.anchor === "jumprun" ? worldToJumprun(w.x, w.z, jumprunFrameOf(d.plane())) : en;
        }
      },
      { live: true },
    );
  }

  function snapHeading(hd: number, shift: boolean): number {
    if (shift) return Math.round(hd / 5) * 5 % 360;
    // snap to runway axes within 3°
    for (const z of getDropzonePlan().dangerZones) {
      if (z.kind !== "runway" || z.shape.points.length < 4) continue;
      const pts = z.shape.points.map(enToXZ);
      let best = { len: 0, h: 0 };
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        if (len > best.len) best = { len, h: headingDegOf(b.x - a.x, b.z - a.z) };
      }
      for (const axis of [best.h, (best.h + 180) % 360]) {
        let diff = Math.abs(((hd - axis + 540) % 360) - 180);
        if (diff < 3) return axis;
      }
    }
    return hd;
  }

  function translateItem(sel: Selection, dx: number, dz: number, base: string) {
    const orig = JSON.parse(base);
    const mv = (p: EN): EN => ({ e: p.e + dx, n: p.n - dz });
    updatePlan(
      (p) => {
        if (sel.kind === "lz") {
          const z = p.landingZones.find((x) => x.id === sel.id)!;
          z.polygon = orig.polygon.map(mv);
        } else if (sel.kind === "danger") {
          const z = p.dangerZones.find((x) => x.id === sel.id)!;
          z.shape.points = orig.shape.points.map(mv);
        } else if (sel.kind === "canopy" && p.canopyPattern) {
          p.canopyPattern.points = orig.points.map(mv);
        } else if (sel.kind === "freefall") {
          const f = p.freefallPatterns.find((x) => x.id === sel.id)!;
          const frame = jumprunFrameOf(d.plane());
          f.legs = orig.legs.map((l: FreefallLeg) => {
            if (f.anchor !== "jumprun") return { ...l, point: mv(l.point) };
            const w0 = jumprunToWorld(l.point, frame);
            return { ...l, point: worldToJumprun(w0.x + dx, w0.z + dz, frame) };
          });
        } else if (sel.kind === "jumprun") {
          p.jumprun = { ...orig, start: mv(orig.start) };
        }
      },
      { live: true },
    );
  }

  function itemJSON(sel: Selection): string {
    const plan = getDropzonePlan();
    switch (sel.kind) {
      case "lz":
        return JSON.stringify(plan.landingZones.find((z) => z.id === sel.id));
      case "danger":
        return JSON.stringify(plan.dangerZones.find((z) => z.id === sel.id));
      case "canopy":
        return JSON.stringify(plan.canopyPattern);
      case "freefall":
        return JSON.stringify(plan.freefallPatterns.find((z) => z.id === sel.id));
      case "jumprun":
        return JSON.stringify(plan.jumprun ?? planeJumprun(d.plane()));
    }
  }

  function insertVertex(h: Handle, w: XZ) {
    const sel = selection!;
    updatePlan((p) => {
      const en = xzToEN(w.x, w.z);
      if (sel.kind === "lz") p.landingZones.find((x) => x.id === sel.id)!.polygon.splice(h.index + 1, 0, en);
      if (sel.kind === "danger") p.dangerZones.find((x) => x.id === sel.id)!.shape.points.splice(h.index + 1, 0, en);
    });
  }

  function deleteSelection() {
    const sel = selection;
    if (!sel) return;
    updatePlan((p) => {
      if (sel.kind === "lz") p.landingZones = p.landingZones.filter((z) => z.id !== sel.id);
      if (sel.kind === "danger") p.dangerZones = p.dangerZones.filter((z) => z.id !== sel.id);
      if (sel.kind === "canopy") p.canopyPattern = null;
      if (sel.kind === "freefall") {
        const f = p.freefallPatterns.find((z) => z.id === sel.id);
        p.freefallPatterns = p.freefallPatterns.filter((z) => z.id !== sel.id);
        if (f?.isDefault) {
          const next = p.freefallPatterns.find((z) => z.kind === f.kind);
          if (next) next.isDefault = true;
        }
      }
      if (sel.kind === "jumprun") p.jumprun = null;
    });
    selection = null;
    rebuild();
    emit();
  }

  function deleteHoveredVertex(w: XZ): boolean {
    const h = hitHandle(w);
    if (!h || h.kind !== "vertex" || !selection) return false;
    const sel = selection;
    const plan = getDropzonePlan();
    const min = sel.kind === "danger" && plan.dangerZones.find((z) => z.id === sel.id)?.shape.type === "line" ? 2 : 3;
    const count = itemPoints(sel).length;
    if (count <= min) return false;
    updatePlan((p) => {
      if (sel.kind === "lz") p.landingZones.find((x) => x.id === sel.id)!.polygon.splice(h.index, 1);
      if (sel.kind === "danger") p.dangerZones.find((x) => x.id === sel.id)!.shape.points.splice(h.index, 1);
    });
    return true;
  }

  // ---------------------------------------------------------------- input
  const el = d.renderer.domElement;
  let lastClick = 0;

  el.addEventListener(
    "pointerdown",
    (e) => {
      if (!active) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      el.setPointerCapture(e.pointerId);
      const w = screenToWorld(e);
      const base = {
        startScreen: { x: e.clientX, y: e.clientY },
        startCenter: { ...center },
        startWorld: w,
        snapshot: snapshotPlan(),
        moved: false,
      };
      if (e.button === 1 || e.button === 2 || spaceDown) {
        drag = { mode: "pan", ...base };
        return;
      }
      if (e.button !== 0) return;
      const drawingTool = tool === "lz" || tool === "danger" || tool === "canopy" || tool === "tracking" || tool === "wingsuit";
      if (drawingTool) {
        const now = performance.now();
        const dbl = now - lastClick < 300;
        lastClick = now;
        addPoint(w, dbl);
        return;
      }
      // select / jumprun tools: handles first, then items, else pan
      const h = hitHandle(w);
      if (h) {
        if (h.kind === "mid") {
          insertVertex(h, w);
          const nh = handlesFor(selection).find((x) => x.kind === "vertex" && x.index === h.index + 1)!;
          drag = { mode: "handle", ...base, snapshot: snapshotPlan(), handle: nh, base: itemJSON(selection!) };
        } else drag = { mode: "handle", ...base, handle: h, base: itemJSON(selection!) };
        return;
      }
      const hit = tool === "jumprun" ? (hitItem(w)?.kind === "jumprun" ? { kind: "jumprun" as SelKind, id: "jumprun" } : null) : hitItem(w);
      if (hit) {
        if (!selection || selection.kind !== hit.kind || selection.id !== hit.id) select(hit);
        drag = { mode: "body", ...base, base: itemJSON(hit) };
        return;
      }
      if (tool === "select") select(null);
      drag = { mode: "pan", ...base };
    },
    { capture: true },
  );

  el.addEventListener(
    "pointermove",
    (e) => {
      if (!active) return;
      const w = screenToWorld(e);
      cursor = w;
      readout(w);
      if (!drag) {
        if (drawing.length) rebuildPreview();
        el.style.cursor = hitHandle(w) ? "grab" : tool === "select" || tool === "jumprun" ? (hitItem(w) ? "pointer" : "default") : "crosshair";
        return;
      }
      const dxPx = e.clientX - drag.startScreen.x;
      const dyPx = e.clientY - drag.startScreen.y;
      if (Math.hypot(dxPx, dyPx) > 3) drag.moved = true;
      if (!drag.moved) return;
      if (drag.mode === "pan") {
        const m = mpp();
        center = { x: drag.startCenter.x - dxPx * m, z: drag.startCenter.z - dyPx * m };
        return;
      }
      if (drag.mode === "handle" && drag.handle && drag.base) moveHandle(drag.handle, w, e, drag.base);
      if (drag.mode === "body" && selection && drag.base)
        translateItem(selection, w.x - drag.startWorld.x, w.z - drag.startWorld.z, drag.base);
    },
    { capture: true },
  );

  el.addEventListener(
    "pointerup",
    (e) => {
      if (!active) return;
      e.stopImmediatePropagation();
      const dg = drag;
      drag = null;
      if (dg && dg.moved && (dg.mode === "handle" || dg.mode === "body")) {
        // commit: one undo step for the whole drag, then save + recalculate
        updatePlan(() => {}, { snapshot: dg.snapshot });
      }
    },
    { capture: true },
  );

  el.addEventListener(
    "wheel",
    (e) => {
      if (!active) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const before = screenToWorld(e);
      viewW = THREE.MathUtils.clamp(viewW * Math.exp(e.deltaY * 0.0015), MIN_W, MAX_W);
      updateCamera();
      const after = screenToWorld(e);
      center = { x: center.x + before.x - after.x, z: center.z + before.z - after.z };
    },
    { capture: true, passive: false },
  );
  el.addEventListener("contextmenu", (e) => {
    if (active) e.preventDefault();
  });
  el.addEventListener("dblclick", (e) => {
    if (active) e.stopImmediatePropagation();
  }, { capture: true });

  const typing = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA" || t.isContentEditable);
  };

  window.addEventListener("keydown", (e) => {
    if (typing(e)) return;
    if (e.key === " ") spaceDown = true;
    if (!active) {
      if ((e.key === "p" || e.key === "P") && !e.ctrlKey && !e.metaKey && !e.altKey) enter();
      return;
    }
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === "z") {
      e.preventDefault();
      e.shiftKey ? redo() : undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && k === "y") {
      e.preventDefault();
      redo();
      return;
    }
    if (e.key === "Escape") {
      if (drawing.length) {
        drawing = [];
        rebuildPreview();
      } else if (tool !== "select") setTool("select");
      else exit();
      return;
    }
    if (e.key === "Enter" && drawing.length) {
      finishDrawing();
      rebuildPreview();
      return;
    }
    if (e.key === "Backspace" && drawing.length) {
      e.preventDefault();
      drawing.pop();
      rebuildPreview();
      return;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && selection) {
      e.preventDefault();
      if (cursor && deleteHoveredVertex(cursor)) return;
      deleteSelection();
      return;
    }
    if (selection?.kind === "jumprun" && (e.key === "ArrowLeft" || e.key === "ArrowRight" || k === "r")) {
      e.preventDefault();
      const { jr, len } = jumprunEnds();
      updatePlan((p) => {
        const cur = { ...(p.jumprun ?? jr), mode: "fixed" as const };
        if (k === "r") {
          const s = enToXZ(cur.start);
          const dd = dirOfHeading(cur.headingDeg);
          cur.start = xzToEN(s.x + dd.x * len, s.z + dd.z * len);
          cur.headingDeg = (cur.headingDeg + 180) % 360;
        } else {
          const step = (e.shiftKey ? 10 : 1) * (e.key === "ArrowLeft" ? -1 : 1);
          cur.headingDeg = (cur.headingDeg + step + 360) % 360;
        }
        p.jumprun = cur;
      });
      return;
    }
    const map: Record<string, PlannerTool> = { v: "select", j: "jumprun", l: "lz", d: "danger", c: "canopy", t: "tracking", w: "wingsuit" };
    if (map[k] && !e.ctrlKey && !e.metaKey) setTool(map[k]);
    if (k === "p") exit();
  });
  window.addEventListener("keyup", (e) => {
    if (e.key === " ") spaceDown = false;
  });

  // ---------------------------------------------------------------- per frame
  let hudW = -1;
  function update(_t: number) {
    const cam = active ? camera : d.perspective;
    if (active) {
      updateCamera();
      if (viewW !== hudW) {
        hudW = viewW;
        updateHud();
      }
    }
    overlays.updateScreenSizes(cam, vh());
    if (active) {
      const m = mpp();
      for (const g of [handlesGroup, previewGroup])
        g.children.forEach((c: any) => {
          if (c.isSprite) c.scale.set(c.userData.px * m, c.userData.px * m, 1);
        });
    }
  }

  const planner: Planner = {
    get active() {
      return active;
    },
    camera,
    enter,
    exit,
    toggle,
    update,
    setTool,
    select,
    get selection() {
      return selection;
    },
    get tool() {
      return tool;
    },
    overlays,
    frameItem,
    frameWorld,
    setDangerKind,
    get dangerKind() {
      return dangerKind;
    },
    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    plane: d.plane,
    jumpers: d.jumpers,
  };
  (window as any).dzPlanner = planner;
  (window as any).getDropzonePlan = getDropzonePlan;
  initializeDropzonePanel(planner);
  rebuild();
  return planner;
}
