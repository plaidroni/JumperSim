// Adjustment arrows on formation jumpers (specs/formation-jumps.md §9.8): up / down for
// how much they're changing their fall rate, tilted by how they're sliding across
// relative to the formation. Reads the solver's series; no physics per frame.

import * as THREE from "three";
import type { SimJumper } from "../classes/SimEntities";
import { WORLD_SCALE, worldRoot } from "../core/WorldScale";
import { sampleAdjust } from "../physics/SequenceSolver";
import { registerOverlay } from "./Layers";

const KEY = "jumpersim.view.adjustArrows";
const COLORS = { faster: 0xff9f1c, slower: 0x4fc3f7, side: 0xe6e6e6, limit: 0xff4d4d };
const M_PER_MPH = 0.06;
const MIN_M = 0.4;
const MAX_M = 3;
const MIN_PX = 16;

const arrows = new Map<SimJumper, THREE.ArrowHelper>();
let group: THREE.Group | null = null;
let enabled = readEnabled();
const dir = new THREE.Vector3();
const camPos = new THREE.Vector3();
const jPos = new THREE.Vector3();

function readEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== "0";
  } catch {
    return true;
  }
}

export function adjustmentArrowsEnabled() {
  return enabled;
}

export function setAdjustmentArrows(on: boolean) {
  enabled = on;
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    /* storage blocked */
  }
  if (!on) clear();
}

function clear() {
  arrows.forEach((a) => {
    a.removeFromParent();
    a.dispose?.();
  });
  arrows.clear();
}

function ensureGroup() {
  if (group) return group;
  group = new THREE.Group();
  group.name = "Adjustment arrows";
  worldRoot.add(group);
  registerOverlay(group); // above clouds and haze
  return group;
}

/** Text for tooltips and Scene Objects, e.g. "+18 mph down (diving, 152 mph) · sliding 9 mph, heading 040°". */
export function adjustmentText(j: SimJumper, t: number): string | null {
  const tr = j.seqTrack;
  if (!tr || t < tr.t0 || t >= tr.endTime) return null;
  const a = sampleAdjust(tr, t);
  if (!a) return null;
  const s = j.track.getInterpolatedSample(t);
  const fall = s ? Math.round(Math.max(0, -s.velocity.y) * 2.236936) : null;
  const v = Math.round(a.mph);
  const side = Math.hypot(a.sideX, a.sideZ);
  const vert =
    Math.abs(v) < 2 ? "fall rate unchanged" : `${v > 0 ? "+" : "−"}${Math.abs(v)} mph ${v > 0 ? "down (diving" : "up (slowing"}${fall !== null ? `, ${fall} mph` : ""})`;
  const hdg = (Math.round((Math.atan2(a.sideX, -a.sideZ) * 180) / Math.PI) + 360) % 360;
  const across = side >= 2 ? ` · sliding ${Math.round(side)} mph, heading ${String(hdg).padStart(3, "0")}°` : "";
  return `${vert}${across}${a.atLimit ? " · at the limit" : ""}`;
}

/** Update every arrow for the current sim time. */
export function updateAdjustmentArrows(jumpers: SimJumper[], t: number, camera: THREE.Camera, viewportHeight: number) {
  if (!enabled) return;
  const g = ensureGroup();
  const live = new Set<SimJumper>();
  camera.getWorldPosition(camPos);
  const persp = camera as THREE.PerspectiveCamera;
  const tanHalf = persp.isPerspectiveCamera ? Math.tan(THREE.MathUtils.degToRad(persp.fov) / 2) : 0;
  for (const j of jumpers) {
    const tr = j.seqTrack;
    if (!tr) continue;
    const a = t >= tr.t0 && t < tr.endTime ? sampleAdjust(tr, t) : null;
    const mag = a ? Math.hypot(a.mph, a.sideX, a.sideZ) : 0;
    let arrow = arrows.get(j);
    if (!a || mag < 2) {
      if (arrow) arrow.visible = false;
      continue;
    }
    live.add(j);
    if (!arrow) {
      arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 1, COLORS.side);
      arrow.renderOrder = 60;
      arrows.set(j, arrow);
      g.add(arrow);
    }
    arrow.visible = true;
    // down when falling faster; sideways along the slide (world axes, mph)
    dir.set(a.sideX, -a.mph, a.sideZ).normalize();
    const mesh = j.getMesh();
    jPos.copy(mesh.position);
    let len = Math.min(MAX_M, Math.max(MIN_M, mag * M_PER_MPH));
    if (tanHalf > 0) {
      const dist = mesh.getWorldPosition(new THREE.Vector3()).distanceTo(camPos) / WORLD_SCALE;
      if (dist > 150) len = Math.max(len, (MIN_PX * 2 * dist * tanHalf) / Math.max(1, viewportHeight));
    }
    arrow.position.copy(jPos);
    arrow.setDirection(dir);
    arrow.setLength(len, len * 0.3, len * 0.18);
    const color = a.atLimit ? COLORS.limit : a.mph > 2 ? COLORS.faster : a.mph < -2 ? COLORS.slower : COLORS.side;
    arrow.setColor(color);
  }
  arrows.forEach((arrow, j) => {
    if (!live.has(j) && !jumpers.includes(j)) {
      arrow.removeFromParent();
      arrow.dispose?.();
      arrows.delete(j);
    }
  });
}

/** View → Adjustment arrows. */
export function initializeAdjustmentArrowsToggle() {
  const item = document.getElementById("view-adjust-arrows");
  const box = item?.querySelector("input") as HTMLInputElement | null;
  const sync = () => {
    if (box) box.checked = enabled;
    item?.setAttribute("aria-checked", String(enabled));
  };
  item?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (e.target === box) setAdjustmentArrows(box!.checked);
    else setAdjustmentArrows(!enabled);
    sync();
    (window as any).forceSceneUpdate?.();
  });
  sync();
}
