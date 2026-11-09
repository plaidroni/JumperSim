import * as THREE from "three";
import { AIR_DENSITY } from "./BodyPositions";

/**
 * Deployment sequence and ram-air canopy flight.
 *
 * Phases after pull: pilot chute out → bag out (lines unstow to line stretch) →
 * canopy out (inflation, then flight). Steady canopy flight comes from the wing
 * loading: the aerodynamic force must carry the exit weight, so
 *     V = sqrt( 2·m·g / (ρ·S·C_R) )      (total airspeed)
 *     vertical = V·sin γ,  horizontal = V·cos γ,  tan γ = 1 / glide ratio
 * which makes every speed scale with √(wing loading), as real canopies do.
 */

export type DeployPhase = "freefall" | "pilot-chute" | "bag" | "canopy";

export const LB_PER_KG = 2.20462;
export const SQFT_PER_M2 = 10.7639;
/** Rig, jumpsuit, helmet etc. added to body weight for exit weight. */
export const GEAR_KG = 11;
export const DEFAULT_PULL_FT = 4500;

export const CANOPY = {
  /** Glide ratio of a modern 9-cell in full flight (horizontal ÷ vertical). */
  glideRatio: 2.5,
  /** Resultant aerodynamic coefficient; ≈ 25 mph airspeed at 1.0 lb/ft². */
  resultantCoeff: 0.65,
  /** Planform aspect ratio (span ÷ chord) for sizing the 3D model. */
  aspectRatio: 2.7,
  /** Line length as a fraction of span (canopy height above the jumper). */
  lineLengthOfSpan: 0.72,
};

export const DEPLOY = {
  /** Pilot chute thrown, inflates and lifts the bag. */
  pilotChuteS: 1.0,
  /** Bag leaves the container and lines unstow until line stretch. */
  bagS: 1.2,
  /** Canopy inflation (snivel) from line stretch to fully open. */
  inflationS: 2.8,
  pilotChuteDragAreaM2: 0.45,
  bagDragAreaM2: 0.2,
  /** Time constant for the canopy settling into steady flight after opening. */
  surgeTauS: 1.2,
};

export const NAV = {
  /** Max turn rate under canopy. */
  turnRateDegS: 40,
  /** Below this height (m above the DZ) the canopy turns into the wind for landing. */
  finalHeightM: 1000 * 0.3048,
  /** Winds lighter than this (m/s) don't need facing on final. */
  minWindForFinalMs: 1.5,
};

export interface DeploymentTimes {
  pullTime: number;
  bagTime: number;
  lineStretchTime: number;
  openTime: number;
}

export function exitWeightKg(bodyKg: number, extraKg = 0): number {
  return bodyKg + extraKg + GEAR_KG;
}

/** Wing loading in lb/ft² (exit weight ÷ canopy area). */
export function wingLoading(exitKg: number, canopySqft: number): number {
  return (exitKg * LB_PER_KG) / Math.max(1, canopySqft);
}

export interface CanopyPerformance {
  wingLoading: number;
  airspeedMs: number;
  horizontalMs: number;
  verticalMs: number;
  glideRatio: number;
}

export function canopyPerformance(
  exitKg: number,
  canopySqft: number,
  rho = AIR_DENSITY,
): CanopyPerformance {
  const S = Math.max(1, canopySqft) / SQFT_PER_M2;
  const V = Math.sqrt((2 * exitKg * 9.81) / (rho * S * CANOPY.resultantCoeff));
  const gamma = Math.atan(1 / CANOPY.glideRatio);
  return {
    wingLoading: wingLoading(exitKg, canopySqft),
    airspeedMs: V,
    horizontalMs: V * Math.cos(gamma),
    verticalMs: V * Math.sin(gamma),
    glideRatio: CANOPY.glideRatio,
  };
}

/** Planform used for the 3D model (metres). */
export function canopyDimensions(canopySqft: number) {
  const S = Math.max(1, canopySqft) / SQFT_PER_M2;
  const span = Math.sqrt(CANOPY.aspectRatio * S);
  const chord = S / span;
  return { span, chord, thickness: chord * 0.16, lineLength: span * CANOPY.lineLengthOfSpan };
}

export function deploymentTimes(pullTime: number): DeploymentTimes {
  const bagTime = pullTime + DEPLOY.pilotChuteS;
  const lineStretchTime = bagTime + DEPLOY.bagS;
  return { pullTime, bagTime, lineStretchTime, openTime: lineStretchTime + DEPLOY.inflationS };
}

/** Phase at time t, with progress 0→1 through the current deployment phase. */
export function phaseAt(d: DeploymentTimes | null, t: number): { phase: DeployPhase; progress: number } {
  if (!d || t < d.pullTime) return { phase: "freefall", progress: 0 };
  if (t < d.bagTime) return { phase: "pilot-chute", progress: (t - d.pullTime) / DEPLOY.pilotChuteS };
  if (t < d.lineStretchTime) return { phase: "bag", progress: (t - d.bagTime) / DEPLOY.bagS };
  return { phase: "canopy", progress: Math.min(1, (t - d.lineStretchTime) / DEPLOY.inflationS) };
}

const Y_AXIS = new THREE.Vector3(0, 1, 0);
/** Belly-down model → upright under canopy (head +Z → up, belly −Y → forward). */
const UPRIGHT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);

/**
 * Yaw that points the jumper model's head (+Z) along a horizontal heading.
 * (Same convention as the formation "face the centre" rotation.)
 */
export function headingQuaternion(heading: THREE.Vector3, target = new THREE.Quaternion()) {
  return target.setFromAxisAngle(Y_AXIS, Math.atan2(heading.x, heading.z));
}

/** Jumper pose hanging under a canopy flying along `heading`. */
export function canopyPose(heading: THREE.Vector3, target = new THREE.Quaternion()) {
  return headingQuaternion(heading, target).multiply(UPRIGHT);
}

/** Horizontal heading the jumper faces for a pose (inverse of the two helpers above). */
export function poseHeading(pose: THREE.Quaternion, target = new THREE.Vector3()) {
  const e = new THREE.Euler().setFromQuaternion(pose, "YXZ");
  return target.set(Math.sin(e.y), 0, Math.cos(e.y));
}

/** Rotate `current` toward `desired` (both horizontal unit vectors) by at most maxRad. */
export function turnToward(current: THREE.Vector3, desired: THREE.Vector3, maxRad: number) {
  const a = Math.atan2(current.x, current.z);
  const b = Math.atan2(desired.x, desired.z);
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  const n = a + Math.max(-maxRad, Math.min(maxRad, d));
  return current.set(Math.sin(n), 0, Math.cos(n));
}
