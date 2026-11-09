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
import {
  DEFAULT_ROUND_SETTINGS,
  FormationShape,
  RoundSettings,
  getFormationShape,
} from "./FormationShapes";
import {
  DEFAULT_FLOCK_SETTINGS,
  FlockSettings,
  FlockSlot,
  flockSlot,
} from "./FlockShapes";

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

export function allJumpers(plane: SimPlane): SimJumper[] {
  const w = window as any;
  if (Array.isArray(w.simJumpers) && w.simJumpers.length) return w.simJumpers;
  return plane.jumpers || [];
}

/** Which formation a jumper belongs to: its imported formation, else the shared linked group. */
export function groupKey(j: SimJumper, plane: SimPlane): string {
  const formations: any[] = plane.formations || [];
  const i = formations.findIndex((f) => f?.getAllJumpers?.().includes(j));
  return i >= 0 ? `formation:${i}` : "linked";
}

/** Body positions that build rounds (wingsuits fly flocks, trackers fly lanes). */
export function buildsRounds(j: SimJumper): boolean {
  const p = normalizeBodyPosition(j.flyingStyle);
  return p === "belly" || p === "sitfly" || p === "headdown";
}

export function isWingsuiter(j: SimJumper): boolean {
  return normalizeBodyPosition(j.flyingStyle) === "wingsuit";
}

/**
 * Order group members by slot: anyone with a valid `formationSlot` (1-based) takes it,
 * the rest fill the free slots in exit order (plane index).
 */
export function orderBySlot(members: SimJumper[]): SimJumper[] {
  const byIndex = [...members].sort((a, b) => a.index - b.index);
  const n = byIndex.length;
  const out: (SimJumper | null)[] = new Array(n).fill(null);
  const rest: SimJumper[] = [];
  for (const m of byIndex) {
    const s = Number((m as any).formationSlot);
    if (Number.isInteger(s) && s >= 1 && s <= n && !out[s - 1]) out[s - 1] = m;
    else rest.push(m);
  }
  for (let i = 0; i < n; i++) if (!out[i]) out[i] = rest.shift()!;
  return out as SimJumper[];
}

export function roundSettingsOf(plane: SimPlane): RoundSettings {
  return { ...DEFAULT_ROUND_SETTINGS, ...((plane as any).roundSettings || {}) };
}

export function flockSettingsOf(plane: SimPlane): FlockSettings {
  return { ...DEFAULT_FLOCK_SETTINGS, ...((plane as any).flockSettings || {}) };
}

/** Linked round builders who exit with `j` in the same group. */
export function roundMembers(j: SimJumper, plane: SimPlane): SimJumper[] {
  const key = groupKey(j, plane);
  return orderBySlot(
    allJumpers(plane).filter(
      (m) =>
        m.linked &&
        buildsRounds(m) &&
        Math.abs(m.jumpTime - j.jumpTime) < SAME_EXIT_S &&
        groupKey(m, plane) === key,
    ),
  );
}

/** The formation this jumper flies in, with its slot, or null if it flies solo. */
export function formationPlanFor(
  j: SimJumper,
  plane: SimPlane,
): { plan: FormationPlan; slotIndex: number } | null {
  if (!j.linked || !buildsRounds(j)) return null;
  const key = groupKey(j, plane);
  const members = roundMembers(j, plane);
  const shape = getFormationShape((plane as any).linkedFormation);
  const forward = new THREE.Vector3(plane.direction.x, 0, plane.direction.z);
  if (forward.lengthSq() < 1e-9) forward.set(0, 0, -1);
  forward.normalize();
  const slots = shape.slots(members.length, forward, { radiusM: roundSettingsOf(plane).slotRadiusM });
  const slotIndex = members.indexOf(j);
  if (!slots || slotIndex < 0) return null;
  return {
    plan: { key, shape, members, slots, startTime: Math.min(...members.map((m) => m.jumpTime)) },
    slotIndex,
  };
}

/** Linked wingsuiters in `j`'s group, base (slot 1) first. */
export function flockMembers(j: SimJumper, plane: SimPlane): SimJumper[] {
  const key = groupKey(j, plane);
  return orderBySlot(allJumpers(plane).filter((m) => m.linked && isWingsuiter(m) && groupKey(m, plane) === key));
}

export interface FlockPlan {
  members: SimJumper[];
  slotIndex: number;
  base: SimJumper;
  slot: FlockSlot;
  settings: FlockSettings;
}

/** The flock this wingsuiter flies in, or null when flying solo. */
export function flockPlanFor(j: SimJumper, plane: SimPlane): FlockPlan | null {
  if (!j.linked || !isWingsuiter(j)) return null;
  const members = flockMembers(j, plane);
  if (members.length < 2) return null;
  const slotIndex = members.indexOf(j);
  if (slotIndex < 0) return null;
  const settings = flockSettingsOf(plane);
  return { members, slotIndex, base: members[0], slot: flockSlot(settings, slotIndex), settings };
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
