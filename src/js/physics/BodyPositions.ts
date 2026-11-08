/**
 * Freefall body positions and their aerodynamics.
 *
 * The physics uses drag F = ½·ρ·Cd·A·v² with ρ = 1.225 kg/m³ and Cd = 1, so each
 * position is described by its effective cross-body (drag) area A. Areas are first
 * guesses, tuned so an 80 kg jumper reaches a typical fall rate for that position:
 *   A = 2·m·g / (ρ·v²)
 * Heavier jumpers fall faster, lighter ones slower, as in real life.
 */

export type BodyPosition = "belly" | "sitfly" | "headdown" | "wingsuit";

export interface BodyPositionSpec {
  label: string;
  /** Effective drag area (m²) in this position. */
  dragAreaM2: number;
  /** Horizontal ÷ vertical speed while flying the position (0 = straight down). */
  glideRatio: number;
  /** Whether the jumper can switch to a track at breakoff. */
  canTrack: boolean;
  /** Fall rate (mph) for an 80 kg jumper, the value the area was tuned to. */
  refFallRateMph: number;
}

export const BODY_POSITIONS: Record<BodyPosition, BodyPositionSpec> = {
  belly: { label: "Belly", dragAreaM2: 0.445, glideRatio: 0, canTrack: true, refFallRateMph: 120 },
  sitfly: { label: "Sit fly", dragAreaM2: 0.267, glideRatio: 0, canTrack: true, refFallRateMph: 155 },
  headdown: { label: "Head down", dragAreaM2: 0.222, glideRatio: 0, canTrack: true, refFallRateMph: 170 },
  // vertical drag area only; the suit's lift is modelled by the glide ratio
  wingsuit: { label: "Wingsuit", dragAreaM2: 2.12, glideRatio: 2.5, canTrack: false, refFallRateMph: 55 },
};

/** Flat track at breakoff: body extended for more area and forward drive. */
export const TRACK_SPEC = {
  dragAreaM2: 0.71, // ~1.6× belly, ≈ 95 mph fall rate at 80 kg
  glideRatio: 1.0, // ≈ as fast across as down
  refFallRateMph: 95,
};

/** Altitude (ft above the DZ) where jumpers with tracking on break off and track. */
export const TRACK_START_FT = 4500;

/** Seconds to blend into a new horizontal speed (exit throw → track / wingsuit flight). */
export const GLIDE_TAU_S = 2.0;

export const AIR_DENSITY = 1.225;
export const DRAG_COEFFICIENT = 1.0;

export const BODY_POSITION_ORDER: BodyPosition[] = ["belly", "sitfly", "headdown", "wingsuit"];

/** Map older / free-form style names onto a supported body position. */
export function normalizeBodyPosition(style: unknown): BodyPosition {
  switch (String(style ?? "").toLowerCase()) {
    case "sitfly":
    case "sit":
    case "freefly": // previous generic freefly style
      return "sitfly";
    case "headdown":
    case "head-down":
    case "hd":
      return "headdown";
    case "wingsuit":
      return "wingsuit";
    default:
      return "belly"; // includes the old "tracking" style (now a toggle)
  }
}

/** Steady-state fall rate (m/s) for a drag area and mass. */
export function terminalFallRateMs(dragAreaM2: number, massKg: number): number {
  return Math.sqrt((2 * massKg * 9.81) / (AIR_DENSITY * DRAG_COEFFICIENT * dragAreaM2));
}

export const MS_TO_MPH = 2.236936;
