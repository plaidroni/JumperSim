import * as THREE from "three";

/**
 * Formation types that linked groups can fly. Each type gives every member a slot:
 * a horizontal offset (metres) from the formation's centre. Add new types here
 * (e.g. line, star, wedge, or "use the .jump file's slots") and they show up in the
 * Plane Settings picker automatically.
 */

export type FormationShapeId = "round" | "none";

export interface FormationShape {
  id: FormationShapeId;
  label: string;
  /** Status text while flying it, e.g. "In round". */
  statusLabel: string;
  description: string;
  /**
   * Slot offsets for `n` members, or null when the group doesn't form up.
   * `forward` is the horizontal jumprun direction (unit vector), so slot 0 can be
   * placed consistently relative to the aircraft.
   */
  slots(n: number, forward: THREE.Vector3): THREE.Vector3[] | null;
}

/** Centre-to-centre spacing around a round (arm's-length grips). */
export const ROUND_SPACING_M = 1.7;
/** Smallest ring radius, so a 2- or 3-way still has room. */
export const ROUND_MIN_RADIUS_M = 1.0;
/** Seconds after exit for the group to close into its slots. */
export const FORMATION_DOCK_S = 8;

export const FORMATION_SHAPES: Record<FormationShapeId, FormationShape> = {
  round: {
    id: "round",
    label: "Round",
    statusLabel: "In round",
    description: "Members hold a ring, facing the centre, until breakoff, then track straight out.",
    slots(n, forward) {
      if (n < 2) return null;
      const radius = Math.max(ROUND_MIN_RADIUS_M, (n * ROUND_SPACING_M) / (2 * Math.PI));
      // slot 0 sits on the jumprun side; the rest go round clockwise from above
      const base = Math.atan2(forward.x, forward.z);
      return Array.from({ length: n }, (_, k) => {
        const a = base + (2 * Math.PI * k) / n;
        return new THREE.Vector3(Math.sin(a) * radius, 0, Math.cos(a) * radius);
      });
    },
  },
  none: {
    id: "none",
    label: "None (exit together)",
    statusLabel: "",
    description: "Linked jumpers exit together but fly on their own.",
    slots: () => null,
  },
};

export const FORMATION_SHAPE_ORDER: FormationShapeId[] = ["round", "none"];
export const DEFAULT_FORMATION_SHAPE: FormationShapeId = "round";

export function getFormationShape(id: unknown): FormationShape {
  return FORMATION_SHAPES[(id as FormationShapeId)] ?? FORMATION_SHAPES[DEFAULT_FORMATION_SHAPE];
}
