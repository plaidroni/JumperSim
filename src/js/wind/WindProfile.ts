import * as THREE from "three";
import { isaHeightM, type WeatherState } from "../weather/WeatherState";

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

export const MS_TO_KT = 1.943844;
const FT_PER_M = 3.28084;

/** Label and height of the surface level (Open-Meteo's 10 m wind). */
export const SURFACE_LABEL = "10m";
export const SURFACE_HEIGHT_M = 10;

/** Pressure levels in the jump's wind profile (the upper levels are for clouds). */
const JUMP_LEVELS_HPA = new Set([1000, 975, 950, 925, 900, 850, 800, 700, 600, 500]);

export { isaHeightM };

/** Downwind world vector (m/s) for a wind of `speedMs` coming FROM `fromDeg`. */
export function windFromToVector(speedMs: number, fromDeg: number): THREE.Vector3 {
  const t = THREE.MathUtils.degToRad(fromDeg);
  // downwind east = -s·sinθ, downwind north = -s·cosθ; world z = -north
  return new THREE.Vector3(-speedMs * Math.sin(t), 0, speedMs * Math.cos(t));
}

function makeLevel(label: string, heightM: number, speedMs: number, fromDeg: number): WindLevel {
  return {
    label,
    heightM,
    vector: windFromToVector(speedMs, fromDeg),
    speedKt: speedMs * MS_TO_KT,
    fromDeg,
  };
}

/**
 * Build the jump's wind profile from a weather state, sorted bottom to top:
 * - the 10 m surface wind at 10 m above the ground,
 * - every jump pressure level (1000–500 hPa) above the ground, at its geopotential
 *   height (the standard-atmosphere height if the model has none) relative to the
 *   forecast's ground elevation.
 * With `allLevels`, the upper levels (400–200 hPa) are included too (clouds use them).
 */
export function buildWindProfile(
  state?: WeatherState | null,
  opts: { allLevels?: boolean } = {},
): WindLevel[] {
  if (!state) return [];
  const levels: WindLevel[] = [];
  const s = state.surface;
  if (Number.isFinite(s.windMs) && Number.isFinite(s.windFromDeg)) {
    levels.push(makeLevel(SURFACE_LABEL, SURFACE_HEIGHT_M, s.windMs, s.windFromDeg));
  }
  for (const l of state.levels) {
    if (!opts.allLevels && !JUMP_LEVELS_HPA.has(l.hpa)) continue;
    if (!(l.aglM > SURFACE_HEIGHT_M)) continue;
    levels.push(makeLevel(`${l.hpa}hPa`, l.aglM, l.windMs, l.windFromDeg));
  }
  return levels.sort((a, b) => a.heightM - b.heightM);
}

/**
 * Largest change (m/s) in any jump wind level between two weather states.
 * Infinity when the levels differ (a level appeared or disappeared).
 */
export function maxWindChangeMs(a: WeatherState, b: WeatherState): number {
  const pa = buildWindProfile(a);
  const pb = buildWindProfile(b);
  if (pa.length !== pb.length) return Infinity;
  let max = 0;
  for (let i = 0; i < pa.length; i++) {
    if (pa[i].label !== pb[i].label) return Infinity;
    max = Math.max(max, pa[i].vector.distanceTo(pb[i].vector));
  }
  return max;
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

/**
 * Vector wind shear between each pair of adjacent levels. The surface (10 m) level is
 * left out: wind always picks up quickly in the first ~100 m above the ground, so it
 * would flag nearly every day as strong shear.
 */
export function windShears(levels: WindLevel[]): WindShear[] {
  const out: WindShear[] = [];
  for (let i = 0; i < levels.length - 1; i++) {
    const lower = levels[i];
    const upper = levels[i + 1];
    if (lower.label === SURFACE_LABEL || upper.label === SURFACE_LABEL) continue;
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

/** The weather whose winds the sim currently uses (see weather/WeatherService.ts). */
function windState(): WeatherState | null {
  return (globalThis as any).weatherService?.getWindState?.() ?? null;
}

/** The jump wind profile the sim currently uses. */
export function currentWindProfile(): WindLevel[] {
  return buildWindProfile(windState());
}

/** Wind (m/s, world space) at a height using every level, for drifting clouds. */
export function cloudWindAt(heightM: number, target = new THREE.Vector3()): THREE.Vector3 {
  return windAtHeight(buildWindProfile(windState(), { allLevels: true }), heightM, target);
}
