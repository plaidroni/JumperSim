// Aircraft catalogue (specs/formation-jumps.md §5.1). Moved out of PlaneSelect.ts.
// Door intervals, floater spots and in-door counts are first guesses.

export type AircraftId = "twin-otter" | "skyvan" | "cessna-172" | "dc-9";

/** Metres in the aircraft frame: right of centreline, above the centre, behind the centre. */
export interface FrameOffset {
  right: number;
  up: number;
  back: number;
}

export interface AircraftSpec {
  id: AircraftId;
  name: string;
  shortName: string;
  file: string;
  /** Model units → metres (the DC-9 is in ~2 cm units). */
  unitsToMetres: number;
  /** Where jumpers leave. */
  door: FrameOffset;
  /** Where floaters hang outside the fuselage before "go". */
  floaterSpots: FrameOffset[];
  color: number;
  rotation: [number, number, number];
  /** Jumper seats; null = not known yet (no limit, never picked by auto-split). */
  capacity: number | null;
  /** Seconds between jumpers leaving one at a time. */
  doorIntervalS: number;
  maxFloaters: number;
  /** Jumpers who leave from the door (or ramp) on the initial exit. */
  inDoor: number;
  wingspanM: number;
  lengthM: number;
  /** Lower-case pieces of a .jump plane name that mean this aircraft. */
  nameMatches: string[];
}

export const AIRCRAFT: Record<AircraftId, AircraftSpec> = {
  "twin-otter": {
    id: "twin-otter",
    name: "Twin Otter",
    shortName: "Otter",
    file: "fabs/twin_otter_fix.glb",
    unitsToMetres: 1, // 15.6 m long (real 15.8 m)
    door: { right: -0.9, up: -0.4, back: 2.5 }, // rear left door
    // along the outside bar, forward of the door
    floaterSpots: [0, 1, 2, 3, 4].map((k) => ({ right: -1.4, up: -0.4, back: 2.0 - k * 0.6 })),
    color: 0xff0066,
    rotation: [0, 0, 0],
    capacity: 21,
    doorIntervalS: 0.25,
    maxFloaters: 5,
    inDoor: 4,
    wingspanM: 19.8,
    lengthM: 15.8,
    nameMatches: ["otter", "dhc-6", "dhc6"],
  },
  skyvan: {
    id: "skyvan",
    name: "Skyvan",
    shortName: "Skyvan",
    file: "fabs/skyvan_fix.glb",
    unitsToMetres: 1, // 12.2 m long, 19.8 m span
    door: { right: 0, up: -0.8, back: 4.5 }, // rear ramp
    floaterSpots: [],
    color: 0x0066ff,
    rotation: [0, 0, 0],
    capacity: 22,
    doorIntervalS: 0.2,
    maxFloaters: 0,
    inDoor: 6,
    wingspanM: 19.8,
    lengthM: 12.2,
    nameMatches: ["skyvan", "sky van"],
  },
  "cessna-172": {
    id: "cessna-172",
    name: "Cessna-172",
    shortName: "Cessna",
    file: "fabs/cessna_fix.glb",
    unitsToMetres: 1, // 8.2 m long, 10.9 m span
    door: { right: 0.8, up: -0.3, back: 0.4 }, // right-hand door, strut exit
    // on the strut and the step
    floaterSpots: [
      { right: 1.6, up: -0.2, back: 0.2 },
      { right: 2.3, up: 0.1, back: 0.3 },
      { right: 1.1, up: -0.9, back: 0.4 },
    ],
    color: 0x00ff00,
    rotation: [0, 0, 0],
    capacity: 4,
    doorIntervalS: 1.0,
    maxFloaters: 3,
    inDoor: 2,
    wingspanM: 11.0,
    lengthM: 8.3,
    nameMatches: ["cessna", "172", "182"],
  },
  "dc-9": {
    id: "dc-9",
    name: "DC-9",
    shortName: "DC-9",
    file: "fabs/dc9.gltf",
    unitsToMetres: 0.0203, // 1,567 units long = 31.8 m
    door: { right: 0, up: -1.5, back: 14 }, // aft airstair
    floaterSpots: [],
    color: 0xff6600,
    rotation: [0, 0, 0],
    capacity: null,
    doorIntervalS: 0.25,
    maxFloaters: 0,
    inDoor: 2,
    wingspanM: 28.5,
    lengthM: 31.8,
    nameMatches: ["dc-9", "dc9"],
  },
};

export const AIRCRAFT_ORDER: AircraftId[] = ["twin-otter", "skyvan", "cessna-172", "dc-9"];
export const DEFAULT_AIRCRAFT: AircraftId = "twin-otter";

export function isAircraftId(v: unknown): v is AircraftId {
  return typeof v === "string" && v in AIRCRAFT;
}

export function aircraft(id: unknown): AircraftSpec {
  return AIRCRAFT[isAircraftId(id) ? id : DEFAULT_AIRCRAFT];
}

/** The aircraft a .jump plane name refers to, or null (e.g. "Caravan" has no model). */
export function matchAircraftName(name: string): AircraftId | null {
  const n = name.toLowerCase();
  for (const id of AIRCRAFT_ORDER) if (AIRCRAFT[id].nameMatches.some((m) => n.includes(m))) return id;
  return null;
}

/** How many leave on "go": floaters plus the door, capped by the load (§5.1). */
export function initialExitCount(spec: AircraftSpec, onBoard: number, floaters?: number | null): number {
  const f = Math.min(spec.maxFloaters, floaters ?? spec.maxFloaters);
  return Math.max(1, Math.min(onBoard, f + spec.inDoor));
}

/** How many of an initial exit hang outside: the file's value, else only those who don't fit in the door. */
export function floatersFor(spec: AircraftSpec, initialExit: number, floaters?: number | null): number {
  if (typeof floaters === "number") return Math.min(spec.maxFloaters, floaters, initialExit);
  return Math.min(spec.maxFloaters, Math.max(0, initialExit - spec.inDoor));
}
