import * as THREE from "three";
import type { SimJumper, SimPlane } from "../classes/SimEntities";
import { getDropzonePlan, planReferencePoint, type Jumprun } from "./DropzonePlan";
import { dirOfHeading, enToXZ, headingDegOf, xzToEN, type XZ } from "./geometry";
import { intoWindHeading, upperWind } from "./patternMath";
import type { WindLevel } from "../wind/WindProfile";

/**
 * The jumprun is the plane's ground track during exits: a start point (green light)
 * and a heading. The plan's jumprun drives the plane; without one the plane keeps the
 * direction it was aligned to (dropzones.json default or the old two-click align).
 */

const CALM_UPPER_MS = 1.5;

/** The plane's current jumprun. */
export function planeJumprun(plane: SimPlane): Jumprun {
  const p = plane.initialPosition;
  return {
    start: xzToEN(p.x, p.z),
    headingDeg: headingDegOf(plane.direction.x, plane.direction.z),
    mode: "fixed",
  };
}

/** The landing pattern's touchdown (or the LZ / DZ when there's no pattern yet). */
function lzTarget(): XZ {
  return enToXZ(planReferencePoint(getDropzonePlan()));
}

/**
 * The jumprun as it will be flown: in "into upper winds" mode the heading follows the
 * winds aloft, rotating about the point on the line nearest the LZ target so the
 * jumprun keeps passing the spot.
 */
export function effectiveJumprun(j: Jumprun, profile: WindLevel[], exitAltM: number): Jumprun {
  if (j.mode !== "intoUpperWind" || !profile.length) return j;
  const w = upperWind(profile, exitAltM);
  if (Math.hypot(w.x, w.z) < CALM_UPPER_MS) return j;
  return rotateJumprunAbout(j, intoWindHeading(w), lzTarget());
}

/** Same jumprun at a new heading, turned about the point on it nearest `pivot`. */
export function rotateJumprunAbout(j: Jumprun, headingDeg: number, pivot: XZ): Jumprun {
  const s = enToXZ(j.start);
  const d = dirOfHeading(j.headingDeg);
  const along = (pivot.x - s.x) * d.x + (pivot.z - s.z) * d.z;
  const p = { x: s.x + d.x * along, z: s.z + d.z * along };
  const nd = dirOfHeading(headingDeg);
  return { ...j, headingDeg: ((headingDeg % 360) + 360) % 360, start: xzToEN(p.x - nd.x * along, p.z - nd.z * along) };
}

/** Point the plane down a jumprun (start point + heading). Exit altitude is unchanged. */
export function applyJumprun(j: Jumprun, plane: SimPlane, profile: WindLevel[] = []) {
  const flown = effectiveJumprun(j, profile, plane.initialPosition.y);
  const s = enToXZ(flown.start);
  const d = dirOfHeading(flown.headingDeg);
  plane.initialPosition.set(s.x, plane.initialPosition.y, s.z);
  plane.position.set(s.x, plane.initialPosition.y, s.z);
  plane.changeDirection(new THREE.Vector3(d.x, 0, d.z));
}

/** Each jumper's exit point (from the plane's calculated track). */
export function exitPoints(plane: SimPlane, jumpers: SimJumper[]) {
  return [...jumpers]
    .sort((a, b) => a.jumpTime - b.jumpTime || a.index - b.index)
    .map((j, order) => {
      const s = plane.track.getInterpolatedSample(j.jumpTime);
      const p = s ? s.position : plane.initialPosition;
      return { jumper: j, order: order + 1, x: p.x, z: p.z, t: j.jumpTime };
    });
}

/** Perpendicular offset (m, + = LZ target is left of the line) from the LZ target. */
export function offsetFromTarget(j: Jumprun): number {
  const s = enToXZ(j.start);
  const d = dirOfHeading(j.headingDeg);
  const t = lzTarget();
  return (t.x - s.x) * d.z - (t.z - s.z) * d.x;
}
