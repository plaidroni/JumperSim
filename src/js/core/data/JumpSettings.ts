// Jump-level settings: name, exit altitude and plane speed (specs/formation-jumps.md §7).
// Saved per browser; every change recalculates the sim.

import { requestRecalculation } from "./SimulationVariables";

export interface JumpSettings {
  name: string;
  /** Exit altitude of the lead plane, ft above the dropzone. */
  exitAltitudeFt: number;
  /** Jumprun speed for every plane, knots. */
  planeSpeedKt: number;
}

export const DEFAULT_JUMP_NAME = "Untitled JumpSim";
export const EXIT_ALT_MIN_FT = 3000;
export const EXIT_ALT_MAX_FT = 18000;
export const PLANE_SPEED_MIN_KT = 50;
export const PLANE_SPEED_MAX_KT = 150;
export const FT_TO_M = 0.3048;

export const DEFAULT_JUMP_SETTINGS: JumpSettings = {
  name: DEFAULT_JUMP_NAME,
  exitAltitudeFt: 13000,
  planeSpeedKt: 90,
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const STORAGE_KEY = "jumpersim.jump.v1";
const listeners = new Set<(s: JumpSettings) => void>();
let settings: JumpSettings = load();


/** Coerce anything into valid settings (used for storage and for .jsim files). */
export function sanitizeJumpSettings(raw: any): JumpSettings {
  const d = DEFAULT_JUMP_SETTINGS;
  const num = (v: any, def: number) => (typeof v === "number" && Number.isFinite(v) ? v : def);
  const name = typeof raw?.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, 100) : d.name;
  return {
    name,
    exitAltitudeFt: Math.round(clamp(num(raw?.exitAltitudeFt, d.exitAltitudeFt), EXIT_ALT_MIN_FT, EXIT_ALT_MAX_FT)),
    planeSpeedKt: Math.round(clamp(num(raw?.planeSpeedKt, d.planeSpeedKt), PLANE_SPEED_MIN_KT, PLANE_SPEED_MAX_KT)),
  };
}

function load(): JumpSettings {
  try {
    if (typeof localStorage === "undefined") return { ...DEFAULT_JUMP_SETTINGS };
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? sanitizeJumpSettings(JSON.parse(raw)) : { ...DEFAULT_JUMP_SETTINGS };
  } catch {
    return { ...DEFAULT_JUMP_SETTINGS };
  }
}

export function getJumpSettings(): JumpSettings {
  return settings;
}

export function exitAltitudeM(): number {
  return settings.exitAltitudeFt * FT_TO_M;
}

/** Change settings: validates, saves, tells listeners and recalculates. */
export function setJumpSettings(patch: Partial<JumpSettings>, opts: { recalc?: boolean } = {}) {
  const next = sanitizeJumpSettings({ ...settings, ...patch });
  const changed = JSON.stringify(next) !== JSON.stringify(settings);
  settings = next;
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* storage blocked */
  }
  if (!changed) return;
  listeners.forEach((fn) => {
    try {
      fn(settings);
    } catch (e) {
      console.error("jump settings listener failed", e);
    }
  });
  if (opts.recalc !== false) requestRecalculation();
}

export function onJumpSettingsChanged(fn: (s: JumpSettings) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Put the exit altitude and speed onto a plane (the lead; trail planes add their offset). */
export function applyJumpSettingsToPlane(plane: {
  initialPosition: { y: number };
  position: { y: number };
  setSpeedKnots?: (kt: number) => void;
}, upM = 0) {
  const y = exitAltitudeM() + upM;
  plane.initialPosition.y = y;
  plane.position.y = y;
  plane.setSpeedKnots?.(settings.planeSpeedKt);
}
