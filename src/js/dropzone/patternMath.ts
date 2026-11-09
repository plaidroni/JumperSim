import * as THREE from "three";
import type { CanopyPattern, FreefallPattern, Jumprun, LegEnd } from "./DropzonePlan";
import {
  dirOfHeading,
  enToXZ,
  FT,
  headingDegOf,
  offsetPolyline,
  type EN,
  type XZ,
} from "./geometry";
import { windAtHeight, type WindLevel } from "../wind/WindProfile";

const KT = 0.514444;

// ------------------------------------------------------------------ jumprun frame

export interface JumprunFrame {
  origin: XZ;
  dir: XZ;
  left: XZ;
  headingDeg: number;
}

/** Frame of the plane's current jumprun (start point + direction). */
export function jumprunFrameOf(plane: {
  position: THREE.Vector3;
  initialPosition?: THREE.Vector3;
  direction: THREE.Vector3;
}): JumprunFrame {
  const l = Math.hypot(plane.direction.x, plane.direction.z) || 1;
  const dir = { x: plane.direction.x / l, z: plane.direction.z / l };
  // the plane's track starts at initialPosition (position is display state)
  const o = plane.initialPosition ?? plane.position;
  return {
    origin: { x: o.x, z: o.z },
    dir,
    left: { x: dir.z, z: -dir.x },
    headingDeg: headingDegOf(dir.x, dir.z),
  };
}

export function jumprunFrameFromPlan(j: Jumprun): JumprunFrame {
  const dir = dirOfHeading(j.headingDeg);
  return { origin: enToXZ(j.start), dir, left: { x: dir.z, z: -dir.x }, headingDeg: j.headingDeg };
}

/** Jumprun-relative {e: along, n: left} → world XZ. */
export function jumprunToWorld(p: EN, f: JumprunFrame): XZ {
  return {
    x: f.origin.x + f.dir.x * p.e + f.left.x * p.n,
    z: f.origin.z + f.dir.z * p.e + f.left.z * p.n,
  };
}

export function worldToJumprun(x: number, z: number, f: JumprunFrame): EN {
  const dx = x - f.origin.x;
  const dz = z - f.origin.z;
  return { e: dx * f.dir.x + dz * f.dir.z, n: dx * f.left.x + dz * f.left.z };
}

/** Mean wind (m/s, world XZ) between two heights (m above the DZ). */
export function meanWind(profile: WindLevel[], fromM: number, toM: number, samples = 12): XZ {
  const w = new THREE.Vector3();
  let x = 0;
  let z = 0;
  for (let i = 0; i <= samples; i++) {
    windAtHeight(profile, fromM + ((toM - fromM) * i) / samples, w);
    x += w.x;
    z += w.z;
  }
  return { x: x / (samples + 1), z: z / (samples + 1) };
}

/** Heading (deg true) that points into a wind vector (wind given as the direction air moves). */
export function intoWindHeading(w: XZ): number {
  return headingDegOf(-w.x, -w.z);
}

/** Upper winds for "Into upper winds": the top 3,000 ft below exit altitude. */
export function upperWind(profile: WindLevel[], exitAltM: number): XZ {
  return meanWind(profile, Math.max(0, exitAltM - 3000 * FT), exitAltM);
}

// ------------------------------------------------------------------ canopy pattern

export interface FlownPattern {
  /** Downwind start, base turn, final turn, landing target. */
  points: [XZ, XZ, XZ, XZ];
  /** Altitudes (m AGL) at those points. */
  altsM: [number, number, number, number];
  mirrored: boolean;
  hand: "left" | "right";
  finalHeadingDeg: number;
  /** Why it is flown this way, for the planner label. */
  reason: "wind" | "calm" | "fixed" | "no-wind-data";
}

/** Reflect across the line through T at right angles to the final direction f. */
function mirrorPoint(p: XZ, t: XZ, f: XZ): XZ {
  const along = (p.x - t.x) * f.x + (p.z - t.z) * f.z;
  return { x: p.x - 2 * along * f.x, z: p.z - 2 * along * f.z };
}

export function patternHand(pts: XZ[]): "left" | "right" {
  // turn from downwind (P0→P1) to base (P1→P2); world z points south, so a negative
  // cross product is a left turn seen from above
  const d1 = { x: pts[1].x - pts[0].x, z: pts[1].z - pts[0].z };
  const d2 = { x: pts[2].x - pts[1].x, z: pts[2].z - pts[1].z };
  return d1.x * d2.z - d1.z * d2.x < 0 ? "left" : "right";
}

/**
 * The pattern as flown today: the drawn one, or its mirror image when that puts final
 * more into the landing wind (DZ-style flip). `wind` is the landing wind (m/s, XZ),
 * or null when there is no weather.
 */
export function flyCanopyPattern(pattern: CanopyPattern, target: XZ, wind: XZ | null): FlownPattern {
  const drawn = pattern.points.map(enToXZ) as XZ[];
  const p2 = drawn[2];
  const fl = Math.hypot(target.x - p2.x, target.z - p2.z) || 1;
  const f = { x: (target.x - p2.x) / fl, z: (target.z - p2.z) / fl };
  const alts = pattern.legAltitudesFt.map((a) => a * FT);

  let mirrored = false;
  let reason: FlownPattern["reason"] = "wind";
  const speed = wind ? Math.hypot(wind.x, wind.z) : 0;
  if (pattern.orientation === "fixed") reason = "fixed";
  else if (!wind) reason = "no-wind-data";
  else if (speed < pattern.calmThresholdKt * KT) reason = "calm";
  else {
    // into-wind is −wind; flip when the drawn final points downwind
    mirrored = f.x * -wind.x + f.z * -wind.z < -1e-9;
  }
  const pts = mirrored ? drawn.map((p) => mirrorPoint(p, target, f)) : drawn;
  const fin = mirrored ? { x: -f.x, z: -f.z } : f;
  return {
    points: [pts[0], pts[1], pts[2], { ...target }],
    altsM: [alts[0], alts[1], alts[2], 0],
    mirrored,
    hand: patternHand(pts),
    finalHeadingDeg: headingDegOf(fin.x, fin.z),
    reason,
  };
}

// ------------------------------------------------------------------ freefall patterns

export interface ResolvedLeg {
  point: XZ;
  steer: "point" | "heading";
  /** World direction for heading legs. */
  headingDir: XZ | null;
  end: LegEnd;
}

export interface ResolvedFreefallPattern {
  pattern: FreefallPattern;
  /** Where leg 1 is drawn from (jumprun start for display / lane offsets). */
  origin: XZ;
  legs: ResolvedLeg[];
}

export function resolveFreefallPattern(p: FreefallPattern, frame: JumprunFrame): ResolvedFreefallPattern {
  const toWorld = (e: EN) => (p.anchor === "jumprun" ? jumprunToWorld(e, frame) : enToXZ(e));
  const rot = p.anchor === "jumprun" ? frame.headingDeg : 0;
  return {
    pattern: p,
    origin: { ...frame.origin },
    legs: p.legs.map((l) => ({
      point: toWorld(l.point),
      steer: l.steer,
      headingDir: l.steer === "heading" ? dirOfHeading((l.headingDeg ?? 0) + rot) : null,
      end: l.end,
    })),
  };
}

/** The same pattern offset sideways by `offsetM` (positive = right of travel). */
export function laneOfPattern(r: ResolvedFreefallPattern, offsetM: number): ResolvedFreefallPattern {
  if (!offsetM) return r;
  const line = offsetPolyline([r.origin, ...r.legs.map((l) => l.point)], offsetM);
  return {
    pattern: r.pattern,
    origin: line[0],
    legs: r.legs.map((l, i) => ({ ...l, point: line[i + 1] })),
  };
}

/** Lane number for the k-th (0-based) solo flyer: 0, +1, −1, +2, −2 … */
export function laneForOrder(k: number): number {
  if (k === 0) return 0;
  const m = Math.ceil(k / 2);
  return k % 2 === 1 ? m : -m;
}
