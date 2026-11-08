import * as THREE from "three";
import type { SimJumper, SimPlane } from "../classes/SimEntities";
import { getGroundHeight } from "../terrain/GroundHeight";
import { WindLevel, windAtHeight } from "../wind/WindProfile";
import {
  AIR_DENSITY,
  BODY_POSITIONS,
  DRAG_COEFFICIENT,
  normalizeBodyPosition,
} from "./BodyPositions";
import { FormationShape, getFormationShape } from "./FormationShapes";

/**
 * Linked jumpers who exit together fly as one formation until breakoff. The group
 * follows a single shared freefall path (average mass and drag of its members, so
 * everyone matches fall rate), and each member holds a slot offset from its centre.
 */

export interface FormationPlan {
  key: string;
  shape: FormationShape;
  members: SimJumper[];
  slots: THREE.Vector3[];
  startTime: number;
}

export interface GroupPath {
  t0: number;
  step: number;
  positions: THREE.Vector3[];
  velocities: THREE.Vector3[];
  /** Sim time the group reaches breakoff (or the ground / end of window). */
  endTime: number;
}

const SAME_EXIT_S = 0.05;

function allJumpers(plane: SimPlane): SimJumper[] {
  const w = window as any;
  if (Array.isArray(w.simJumpers) && w.simJumpers.length) return w.simJumpers;
  return plane.jumpers || [];
}

/** Which formation a jumper belongs to: its imported formation, else the shared linked group. */
function groupKey(j: SimJumper, plane: SimPlane): string {
  const formations: any[] = plane.formations || [];
  const i = formations.findIndex((f) => f?.getAllJumpers?.().includes(j));
  return i >= 0 ? `formation:${i}` : "linked";
}

/** The formation this jumper flies in, with its slot, or null if it flies solo. */
export function formationPlanFor(
  j: SimJumper,
  plane: SimPlane,
): { plan: FormationPlan; slotIndex: number } | null {
  if (!j.linked) return null;
  if (normalizeBodyPosition(j.flyingStyle) === "wingsuit") return null;
  const key = groupKey(j, plane);
  const members = allJumpers(plane)
    .filter(
      (m) =>
        m.linked &&
        normalizeBodyPosition(m.flyingStyle) !== "wingsuit" &&
        Math.abs(m.jumpTime - j.jumpTime) < SAME_EXIT_S &&
        groupKey(m, plane) === key,
    )
    .sort((a, b) => a.index - b.index);
  const shape = getFormationShape((plane as any).linkedFormation);
  const forward = new THREE.Vector3(plane.direction.x, 0, plane.direction.z);
  if (forward.lengthSq() < 1e-9) forward.set(0, 0, -1);
  forward.normalize();
  const slots = shape.slots(members.length, forward);
  const slotIndex = members.indexOf(j);
  if (!slots || slotIndex < 0) return null;
  return {
    plan: { key, shape, members, slots, startTime: Math.min(...members.map((m) => m.jumpTime)) },
    slotIndex,
  };
}

// The path is the same for every member, so compute it once per recalculation.
const pathCache = new Map<string, GroupPath>();

/**
 * Shared freefall path of the formation's centre, from exit until it reaches
 * `breakoffY` (m above the DZ), the ground, or the end of the window.
 */
export function formationPath(
  plan: FormationPlan,
  plane: SimPlane,
  wind: WindLevel[],
  step: number,
  duration: number,
  breakoffY: number,
): GroupPath {
  const exit = plane.track.getInterpolatedSample(plan.startTime);
  const startPos = exit ? exit.position.clone() : plane.position.clone();
  const startVel = exit ? exit.velocity.clone() : plane.vector.clone();

  const mass =
    plan.members.reduce((s, m) => s + (m.weight || 0) + (m.extraWeight || 0), 0) / plan.members.length;
  const area =
    plan.members.reduce((s, m) => s + BODY_POSITIONS[normalizeBodyPosition(m.flyingStyle)].dragAreaM2, 0) /
    plan.members.length;

  const key = JSON.stringify([
    plan.key,
    plan.startTime,
    mass.toFixed(3),
    area.toFixed(4),
    startPos.toArray().map((v) => v.toFixed(3)),
    startVel.toArray().map((v) => v.toFixed(3)),
    step,
    duration,
    breakoffY,
    wind.map((l) => [l.heightM.toFixed(1), l.vector.x.toFixed(3), l.vector.z.toFixed(3)]),
  ]);
  const cached = pathCache.get(key);
  if (cached) return cached;
  if (pathCache.size > 32) pathCache.clear();

  const k = 0.5 * DRAG_COEFFICIENT * AIR_DENSITY * area;
  const pos = startPos.clone();
  const vel = startVel.clone();
  const positions: THREE.Vector3[] = [pos.clone()];
  const velocities: THREE.Vector3[] = [vel.clone()];
  const w = new THREE.Vector3();
  let t = plan.startTime;
  const tEnd = duration; // precalc window, in sim time from 0
  while (t < tEnd) {
    windAtHeight(wind, pos.y, w);
    const rel = vel.clone().sub(w);
    const speed = rel.length();
    const drag = speed > 0 ? rel.multiplyScalar((-k * speed) / mass) : rel.set(0, 0, 0);
    vel.add(drag.add(new THREE.Vector3(0, -9.81, 0)).multiplyScalar(step));
    pos.add(vel.clone().multiplyScalar(step));
    t += step;
    positions.push(pos.clone());
    velocities.push(vel.clone());
    if (pos.y <= breakoffY || pos.y <= getGroundHeight(pos.x, pos.z)) break;
  }
  const path: GroupPath = { t0: plan.startTime, step, positions, velocities, endTime: t };
  pathCache.set(key, path);
  return path;
}

/** Group path sample at sim time t (clamped to the path). */
export function samplePath(path: GroupPath, t: number) {
  const i = Math.max(0, Math.min(path.positions.length - 1, Math.round((t - path.t0) / path.step)));
  return { position: path.positions[i], velocity: path.velocities[i] };
}

/** 0 → 1 with zero slope at both ends. */
export function smoothstep(x: number) {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
}
