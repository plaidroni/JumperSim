import * as THREE from "three";
import type { WeatherSnapshot } from "../../apidata/OpenMateo";

/**
 * Wind profile shared by the physics (SimEntities) and the wind tower visual, so the
 * arrows always show exactly the wind the jumpers are pushed by.
 *
 * Conventions
 * - Heights are metres above the DZ ground (the sim's y = 0).
 * - World axes match the compass: +X = east, -Z = north.
 * - Vectors point the way the air MOVES (downwind). Weather APIs report the direction
 *   wind comes FROM, so a "from 270°" (westerly) wind points east (+X).
 */

export interface WindLevel {
  /** Source label, e.g. "850hPa". */
  label: string;
  /** Height above DZ ground (m). */
  heightM: number;
  /** Downwind velocity in world space (m/s). */
  vector: THREE.Vector3;
  speedKt: number;
  /** Meteorological direction the wind comes from (deg, clockwise from north). */
  fromDeg: number;
}

export interface WindShear {
  lower: WindLevel;
  upper: WindLevel;
  /** Magnitude of the vector change per 1000 ft (kt / 1000 ft). */
  ktPer1000ft: number;
}

/** Shear at or above this is flagged as strong (kt of vector change per 1000 ft). */
export const STRONG_SHEAR_KT_PER_1000FT = 15;

const MPH_TO_MS = 0.44704;
export const MS_TO_KT = 1.943844;
const FT_PER_M = 3.28084;

/** International Standard Atmosphere height (m MSL) of a pressure level (hPa). */
export function isaHeightM(pressureHpa: number): number {
  return 44330.8 * (1 - Math.pow(pressureHpa / 1013.25, 0.190263));
}

/** Downwind world vector (m/s) for a wind of `speedMs` coming FROM `fromDeg`. */
export function windFromToVector(speedMs: number, fromDeg: number): THREE.Vector3 {
  const t = THREE.MathUtils.degToRad(fromDeg);
  // downwind east = -s·sinθ, downwind north = -s·cosθ; world z = -north
  return new THREE.Vector3(-speedMs * Math.sin(t), 0, speedMs * Math.cos(t));
}

/**
 * Build the wind profile from an Open-Meteo snapshot: one level per pressure level
 * that is above the ground, sorted bottom to top. Pressure-level heights use the
 * standard atmosphere and are made relative to the forecast's ground elevation.
 */
export function buildWindProfile(snapshot?: WeatherSnapshot | null): WindLevel[] {
  if (!snapshot) return [];
  const groundMsl = Number.isFinite(snapshot.elevationM) ? snapshot.elevationM! : 0;
  const levels: WindLevel[] = [];

  for (const [key, speedStr] of Object.entries(snapshot.windSpeeds ?? {})) {
    const m = /^(\d+)hPa$/.exec(key.replace(":", ""));
    if (!m) continue; // e.g. "10m" has no matching direction in the snapshot
    const dirStr = snapshot.windDirections?.[key];
    const speedMph = parseFloat(String(speedStr));
    const fromDeg = parseFloat(String(dirStr));
    if (!Number.isFinite(speedMph) || !Number.isFinite(fromDeg)) continue;

    const heightM = isaHeightM(Number(m[1])) - groundMsl;
    if (heightM < 10) continue; // level is below (or at) the ground here

    const speedMs = speedMph * MPH_TO_MS;
    levels.push({
      label: key,
      heightM,
      vector: windFromToVector(speedMs, fromDeg),
      speedKt: speedMs * MS_TO_KT,
      fromDeg,
    });
  }
  return levels.sort((a, b) => a.heightM - b.heightM);
}

/**
 * Wind (m/s, world space) at a height above the DZ, interpolating the u/v components
 * linearly between levels and holding the nearest level outside the range.
 */
export function windAtHeight(
  levels: WindLevel[],
  heightM: number,
  target = new THREE.Vector3(),
): THREE.Vector3 {
  if (levels.length === 0) return target.set(0, 0, 0);
  if (heightM <= levels[0].heightM) return target.copy(levels[0].vector);
  const top = levels[levels.length - 1];
  if (heightM >= top.heightM) return target.copy(top.vector);
  for (let i = 0; i < levels.length - 1; i++) {
    const a = levels[i];
    const b = levels[i + 1];
    if (heightM <= b.heightM) {
      const t = (heightM - a.heightM) / (b.heightM - a.heightM);
      return target.copy(a.vector).lerp(b.vector, t);
    }
  }
  return target.copy(top.vector);
}

/** Vector wind shear between each pair of adjacent levels. */
export function windShears(levels: WindLevel[]): WindShear[] {
  const out: WindShear[] = [];
  for (let i = 0; i < levels.length - 1; i++) {
    const lower = levels[i];
    const upper = levels[i + 1];
    const dKt = upper.vector.distanceTo(lower.vector) * MS_TO_KT;
    const dThousandFt = ((upper.heightM - lower.heightM) * FT_PER_M) / 1000;
    out.push({ lower, upper, ktPer1000ft: dThousandFt > 0 ? dKt / dThousandFt : 0 });
  }
  return out;
}

/** Wind direction (from, degrees) of a downwind world vector. */
export function vectorToFromDeg(v: THREE.Vector3): number {
  // downwind east = x, downwind north = -z; "from" is the opposite bearing
  const toDeg = THREE.MathUtils.radToDeg(Math.atan2(v.x, -v.z));
  return (toDeg + 180 + 360) % 360;
}

/** The profile for the snapshot the sim currently uses. */
export function currentWindProfile(): WindLevel[] {
  return buildWindProfile((window as any).weatherSnapshotLog?.[0]);
}
