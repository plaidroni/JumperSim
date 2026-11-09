/**
 * Wingsuit flock layouts. Slot 1 (index 0) is the base, who flies the wingsuit
 * pattern; every other slot is an offset from the base in the base's heading frame:
 * `across` (metres, + = right of the base), `behind` (metres back along the base's
 * track) and `below` (metres lower). Add layouts here and they appear in the picker.
 */

export type FlockLayoutId = "arrowhead" | "echelon-right" | "echelon-left" | "line-abreast" | "trail";

export interface FlockSlot {
  across: number;
  behind: number;
  below: number;
  /** Row number behind the base (0 for the base), used for stacking and the fan-out. */
  row: number;
  /** −1 left, 0 centre, +1 right: which way the slot turns at flock breakoff. */
  side: -1 | 0 | 1;
}

export interface FlockLayout {
  id: FlockLayoutId;
  label: string;
  slot(k: number, spacing: number): FlockSlot; // k = 0 is the base
}

const alt = (k: number) => ({ row: Math.ceil(k / 2), side: (k % 2 === 1 ? 1 : -1) as 1 | -1 });

export const FLOCK_LAYOUTS: Record<FlockLayoutId, FlockLayout> = {
  arrowhead: {
    id: "arrowhead",
    label: "Arrowhead",
    slot(k, s) {
      if (k === 0) return { across: 0, behind: 0, below: 0, row: 0, side: 0 };
      const { row, side } = alt(k);
      return { across: side * row * s, behind: row * 0.8 * s, below: 0, row, side };
    },
  },
  "echelon-right": {
    id: "echelon-right",
    label: "Echelon right",
    slot: (k, s) => ({ across: k * s, behind: k * 0.8 * s, below: 0, row: k, side: k ? 1 : 0 }),
  },
  "echelon-left": {
    id: "echelon-left",
    label: "Echelon left",
    slot: (k, s) => ({ across: -k * s, behind: k * 0.8 * s, below: 0, row: k, side: k ? -1 : 0 }),
  },
  "line-abreast": {
    id: "line-abreast",
    label: "Line abreast",
    slot(k, s) {
      if (k === 0) return { across: 0, behind: 0, below: 0, row: 0, side: 0 };
      const { row, side } = alt(k);
      return { across: side * row * s, behind: 0, below: 0, row, side };
    },
  },
  trail: {
    id: "trail",
    label: "Trail",
    // trail slots alternate which way they turn at breakoff
    slot: (k, s) => ({ across: 0, behind: k * s, below: 0, row: k, side: k === 0 ? 0 : k % 2 === 1 ? 1 : -1 }),
  },
};

export const FLOCK_LAYOUT_ORDER: FlockLayoutId[] = ["arrowhead", "echelon-right", "echelon-left", "line-abreast", "trail"];

export interface FlockSettings {
  layout: FlockLayoutId;
  spacingM: number;
  stackM: number;
  breakoffFt: number;
}

export const DEFAULT_FLOCK_SETTINGS: FlockSettings = {
  layout: "arrowhead",
  spacingM: 15,
  stackM: 0,
  breakoffFt: 5500,
};

/** Seconds between wingsuit exits in a linked group. */
export const FLOCK_EXIT_GAP_S = 1;
/** Seconds after their own exit for a follower to close into their slot. */
export const FLOCK_DOCK_S = 20;
/** Fan-out turn per row at flock breakoff, capped at 90°. */
export const FLOCK_FAN_DEG_PER_ROW = 30;

export function flockSlot(settings: FlockSettings, k: number): FlockSlot {
  const layout = FLOCK_LAYOUTS[settings.layout] ?? FLOCK_LAYOUTS.arrowhead;
  const s = layout.slot(k, settings.spacingM);
  return { ...s, below: s.row * settings.stackM };
}

export function fanAngleDeg(slot: FlockSlot): number {
  return slot.side * Math.min(90, FLOCK_FAN_DEG_PER_ROW * slot.row);
}

/** Short slot label: "Base", "R1", "L2", "T3" (trail). */
export function flockSlotLabel(settings: FlockSettings, k: number): string {
  if (k === 0) return "Base";
  const s = flockSlot(settings, k);
  if (settings.layout === "trail") return `T${k}`;
  return `${s.side > 0 ? "R" : "L"}${s.row}`;
}
