// Slot-seeking: how a diver flies from exit to their slot (specs/formation-jumps.md §9).
// Constants are first guesses (§9.7); the state machine runs inside SequenceSolver.ts.

import { AIR_DENSITY, BODY_POSITIONS, DRAG_COEFFICIENT } from "./BodyPositions";

export const SEEK = {
  /** No control right after exit (s). */
  EXIT_STABLE_S: 2,
  /** The exit piece eases into point 1 (s). */
  EXIT_PIECE_DOCK_S: 3,
  /** Lag on drag-area changes (s). */
  BODY_TAU_S: 0.3,
  /** How fast the fall rate is steered to the wanted one (s). */
  FALL_TAU_S: 0.5,
  /** Belly fall-rate range as a share of the belly drag area. */
  BELLY_MIN: 0.8,
  BELLY_MAX: 1.25,
  /** Diving drag area (m²): ≈ 160 mph at 80 kg. */
  DIVE_AREA_M2: 0.25,
  /** Max relative vertical closing (m/s) and the braking used to plan it (m/s²). */
  V_V_MAX: 20,
  A_FLARE: 2.5,
  /** Max relative horizontal speed (m/s). */
  V_H_DIVE: 20,
  V_H_BELLY: 4,
  /** Horizontal acceleration and planned braking (m/s²). */
  A_H_MAX: 1.5,
  A_H_BRAKE: 1.0,
  OUTER_MARGIN_M: 5,
  SETUP_DIST_M: 2,
  SETUP_HIGH_M: 0.5,
  DOCK_SPEED_MS: 0.7,
  DOCK_TOL_M: 0.3,
  DOCK_TOL_V: 0.3,
  GRIP_DIST_M: 2.0,
  PARENT_WAIT_S: 3,
  TRANSITION_SPEED_MS: 1.5,
  TRANSITION_DOCK_S: 0.5,
  LOW_TOL_M: 2,
  NO_LOW_MARGIN_M: 10,
  LOW_STANDOFF_M: 20,
  SETUP_DOCK_S: 4,
  /** Far / high enough to dive. */
  DIVE_HIGH_M: 5,
  DIVE_FAR_M: 25,
} as const;

export type SeekState = "exit" | "dive" | "approach" | "setup" | "dock" | "docked" | "transition" | "holdoff";

export const SEEK_STATE_LABEL: Record<SeekState, string> = {
  exit: "Exit",
  dive: "Diving to slot",
  approach: "Approaching slot",
  setup: "Setting up",
  dock: "Docking",
  docked: "Docked",
  transition: "Transition",
  holdoff: "Holding off",
};

const G = 9.81;
const K = 0.5 * DRAG_COEFFICIENT * AIR_DENSITY;
export const MS_TO_MPH = 2.236936;

/** Terminal fall rate (m/s) for a drag area and mass. */
export function terminalMs(areaM2: number, massKg: number): number {
  return Math.sqrt((2 * massKg * G) / (DRAG_COEFFICIENT * AIR_DENSITY * Math.max(1e-4, areaM2)));
}

/** Drag area that falls at `fallMs` (positive, down). */
export function areaFor(fallMs: number, massKg: number): number {
  return (2 * massKg * G) / (DRAG_COEFFICIENT * AIR_DENSITY * Math.max(0.5, fallMs) ** 2);
}

/** A jumper's belly area range, widened by their suit (§9.5). */
export function bellyRange(suit: string | undefined) {
  const a = BODY_POSITIONS.belly.dragAreaM2;
  const min = a * SEEK.BELLY_MIN * (suit === "skintight" ? 0.9 : 1);
  const max = a * SEEK.BELLY_MAX * (suit === "baggy" ? 1.15 : 1);
  const neutral = a * (suit === "baggy" ? 1.07 : suit === "skintight" ? 0.95 : 1);
  return { min, max, neutral };
}

/** Vertical acceleration (m/s², up positive) for a fall speed vy (negative down) and area. */
export function verticalAccel(vy: number, areaM2: number, massKg: number) {
  return -G + (K * areaM2 * vy * vy * (vy < 0 ? 1 : -1)) / massKg;
}

/**
 * Fall-rate warning (§9.5): null when the jumper can fall at the formation's rate on
 * their belly; else how much weight would fix it.
 */
export function fallRateMismatch(formationMs: number, massKg: number, suit: string | undefined) {
  const r = bellyRange(suit);
  const fastest = terminalMs(r.min, massKg);
  const slowest = terminalMs(r.max, massKg);
  if (formationMs > fastest + 0.2) {
    const need = massKg * (formationMs / fastest) ** 2 - massKg;
    return { kind: "light" as const, kg: Math.ceil(need), text: `too light to keep up with the base: needs +${Math.ceil(need)} kg` };
  }
  if (formationMs < slowest - 0.2) {
    const need = massKg - massKg * (formationMs / slowest) ** 2;
    return { kind: "heavy" as const, kg: Math.ceil(need), text: `falls too fast to stay level: needs a baggier suit or −${Math.ceil(need)} kg` };
  }
  return null;
}
