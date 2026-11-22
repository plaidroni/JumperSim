// How many planes a formation needs, and who rides in which (specs/formation-jumps.md §6).
// Pure: unit-tested with the example files and the §6.5 table.

import { AIRCRAFT, AircraftId, aircraft, floatersFor, initialExitCount, matchAircraftName } from "../fleet/Aircraft";
import { layoutOffset, FleetLayoutId, MAX_PLANES, PlaneOffset } from "../fleet/Fleet";
import type { ParsedJump } from "./JumpFile";

export interface PlannedPlane {
  aircraft: AircraftId;
  label: string;
  /** Floaters from the file; null = only those who don't fit in the door. */
  floaters: number | null;
  count: number;
  /** File plane id when the plane comes from the file. */
  fileId?: string;
}

export interface SlotPlacement {
  slot: number;
  plane: number;
  exitOrder: number;
  /** Leaves on "go" (floaters + door). */
  initialExit: boolean;
  /** Hangs outside before "go". */
  floater: boolean;
  /** Lead plane's gripped exit piece. */
  exitPiece: boolean;
}

export interface SplitResult {
  planes: PlannedPlane[];
  placements: SlotPlacement[];
  source: "file" | "file-counts" | "auto";
  notes: string[];
}

export class SplitError extends Error {}

export interface SplitOptions {
  preferred: AircraftId;
  exitPieceSize?: number | "auto";
  layout?: FleetLayoutId;
}

/** Counts that add up to `total`, in proportion to `weights` (largest remainder). */
export function proportional(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const raw = weights.map((w) => (total * w) / sum);
  const out = raw.map(Math.floor);
  let left = total - out.reduce((a, b) => a + b, 0);
  raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i)
    .forEach(({ i }) => {
      if (left > 0) {
        out[i]++;
        left--;
      }
    });
  return out;
}

/** Balanced counts for `n` jumpers in `p` planes; the lead (first) takes the extras. */
export function balanced(n: number, p: number): number[] {
  const base = Math.floor(n / p);
  return Array.from({ length: p }, (_, i) => base + (i < n % p ? 1 : 0));
}

/** Planes needed for n jumpers in an aircraft (one when its capacity is unknown). */
export function planesNeeded(n: number, id: AircraftId): number {
  const cap = AIRCRAFT[id].capacity;
  return cap ? Math.max(1, Math.ceil(n / cap)) : 1;
}

/** Decide the planes (§6.1–6.2). */
export function planPlanes(parsed: ParsedJump, preferred: AircraftId): { planes: PlannedPlane[]; source: SplitResult["source"]; notes: string[] } {
  const n = parsed.jumpers.length;
  const notes: string[] = [];
  if (parsed.planes.length) {
    const assigned = parsed.jumpers.filter((j) => j.plane);
    const all = assigned.length === n;
    const none = assigned.length === 0;
    if (all || none) {
      const counts = all
        ? parsed.planes.map((p) => parsed.jumpers.filter((j) => j.plane!.planeId === p.id).length)
        : proportional(n, parsed.planes.map((p) => p.slotCount || 1));
      const planes = parsed.planes
        .map((p, i) => ({
          aircraft: matchAircraftName(p.name) ?? preferred,
          label: p.name,
          floaters: p.floaters,
          count: counts[i],
          fileId: p.id,
        }))
        .filter((p) => p.count > 0);
      const tooBig = planes.find((p) => (AIRCRAFT[p.aircraft].capacity ?? Infinity) < p.count);
      if (!tooBig && planes.length) {
        planes
          .filter((p) => !matchAircraftName(p.label))
          .forEach((p) => notes.push(`"${p.label}" flown as a ${AIRCRAFT[p.aircraft].name}`));
        return { planes, source: all ? "file" : "file-counts", notes };
      }
      if (tooBig)
        notes.push(`The file's planes don't fit: "${tooBig.label}" has ${tooBig.count} for a ${AIRCRAFT[tooBig.aircraft].capacity}-seat ${AIRCRAFT[tooBig.aircraft].name}; split automatically`);
    } else {
      notes.push("Only some jumpers have a plane in the file; split automatically");
    }
  }
  const p = planesNeeded(n, preferred);
  if (p > MAX_PLANES)
    throw new SplitError(`A ${n}-way needs ${p} ${AIRCRAFT[preferred].name}s (max ${MAX_PLANES}).`);
  const counts = balanced(n, p);
  return {
    planes: counts.map((count, i) => ({ aircraft: preferred, label: i === 0 ? "Lead" : `Plane ${i + 1}`, floaters: null, count })),
    source: "auto",
    notes,
  };
}

const bearingDeg = (x: number, y: number) => ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360;
const angDist = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

/** Who rides in which plane and in what order (§6.3), from point 1 of the formation. */
export function placeSlots(
  parsed: ParsedJump,
  planes: PlannedPlane[],
  opts: { exitPieceSize?: number | "auto"; offsets?: PlaneOffset[] } = {},
): SlotPlacement[] {
  const slots = parsed.points[0].slots;
  const n = slots.length;
  const dist = slots.map((s) => Math.hypot(s.x, s.y));
  const placements: SlotPlacement[] = [];
  const offsets = opts.offsets ?? planes.map((_, k) => layoutOffset("v", k));

  // 1. exit piece: the lead's initial exit, nearest the centre
  const lead = planes[0];
  const leadSpec = aircraft(lead.aircraft);
  const fileFloaters = lead.floaters ?? leadSpec.maxFloaters;
  const auto = initialExitCount(leadSpec, lead.count, fileFloaters);
  const pieceSize = Math.max(1, Math.min(lead.count, n, opts.exitPieceSize === "auto" || opts.exitPieceSize === undefined ? auto : opts.exitPieceSize));
  const byDist = [...slots.keys()].sort((a, b) => dist[a] - dist[b] || a - b);
  const piece = byDist.slice(0, pieceSize);
  const inPiece = new Set(piece);

  // 2. sectors: contiguous arcs, each facing its plane's position
  const rest = [...slots.keys()].filter((i) => !inPiece.has(i)).sort((a, b) => bearingDeg(slots[a].x, slots[a].y) - bearingDeg(slots[b].x, slots[b].y) || a - b);
  const seats = planes.map((p, k) => (k === 0 ? p.count - pieceSize : p.count));
  const home = offsets.map((o, k) => (k === 0 ? 0 : bearingDeg(o.rightM, -o.backM)));
  const order = planes.map((_, k) => k).filter((k) => seats[k] > 0).sort((a, b) => home[a] - home[b] || a - b);
  const groups: number[][] = planes.map(() => []);
  if (rest.length && order.length) {
    // try every starting point on the ring; keep the one where slots sit closest
    // (in bearing) to the plane that carries them
    const bearings = rest.map((i) => bearingDeg(slots[i].x, slots[i].y));
    let start = 0;
    let best = Infinity;
    for (let s = 0; s < rest.length; s++) {
      let cost = 0;
      let at = 0;
      for (const k of order) {
        for (let m = 0; m < seats[k]; m++) cost += angDist(bearings[(s + at + m) % rest.length], home[k]);
        at += seats[k];
      }
      if (cost < best - 1e-9) {
        best = cost;
        start = s;
      }
    }
    const ring = [...rest.slice(start), ...rest.slice(0, start)];
    let at = 0;
    for (const k of order) {
      groups[k] = ring.slice(at, at + seats[k]);
      at += seats[k];
    }
  }

  // 3. exit order: initial exit first, then divers nearest the centre first
  planes.forEach((p, k) => {
    const spec = aircraft(p.aircraft);
    const divers = groups[k].sort((a, b) => dist[a] - dist[b] || a - b);
    let initial: number[];
    if (k === 0) initial = [...piece];
    else initial = divers.splice(0, initialExitCount(spec, divers.length, p.floaters));
    const floatCount = floatersFor(spec, initial.length, p.floaters);
    // floaters are on the outside of the piece: furthest from the centre
    const floaters = new Set([...initial].sort((a, b) => dist[b] - dist[a] || a - b).slice(0, floatCount));
    const ordered = [...initial.filter((i) => floaters.has(i)), ...initial.filter((i) => !floaters.has(i)), ...divers];
    const initialSet = new Set(initial);
    ordered.forEach((slot, e) =>
      placements.push({ slot, plane: k, exitOrder: e, initialExit: initialSet.has(slot), floater: floaters.has(slot), exitPiece: k === 0 && inPiece.has(slot) }),
    );
  });
  return placements.sort((a, b) => a.slot - b.slot);
}

/** Placements straight from the file's planeSlot assignments. */
function placeFromFile(parsed: ParsedJump, planes: PlannedPlane[], exitPieceSize: number | "auto" | undefined): SlotPlacement[] {
  const dist = parsed.points[0].slots.map((s) => Math.hypot(s.x, s.y));
  const out: SlotPlacement[] = [];
  planes.forEach((p, k) => {
    const spec = aircraft(p.aircraft);
    const mine = parsed.jumpers.filter((j) => j.plane?.planeId === p.fileId).sort((a, b) => a.plane!.exitOrder - b.plane!.exitOrder);
    let initial = initialExitCount(spec, mine.length, p.floaters ?? spec.maxFloaters);
    if (k === 0 && typeof exitPieceSize === "number") initial = Math.max(1, Math.min(mine.length, exitPieceSize));
    const floatCount = floatersFor(spec, initial, p.floaters);
    mine.forEach((j, e) =>
      out.push({ slot: j.slot, plane: k, exitOrder: e, initialExit: e < initial, floater: e < floatCount, exitPiece: k === 0 && e < initial }),
    );
  });
  void dist;
  return out.sort((a, b) => a.slot - b.slot);
}

/** Planes and placements for a parsed .jump file. */
export function splitLoad(parsed: ParsedJump, opts: SplitOptions): SplitResult {
  const { planes, source, notes } = planPlanes(parsed, opts.preferred);
  const offsets = planes.map((_, k) => layoutOffset(opts.layout ?? "v", k));
  const placements =
    source === "file" ? placeFromFile(parsed, planes, opts.exitPieceSize) : placeSlots(parsed, planes, { exitPieceSize: opts.exitPieceSize, offsets });
  return { planes, placements, source, notes };
}

/** Re-split onto existing planes: counts in proportion to each plane's capacity (§10.4 Re-split). */
export function resplitOnto(
  parsed: Pick<ParsedJump, "points" | "jumpers" | "planes">,
  planes: { aircraft: AircraftId; label: string; floaters: number | null }[],
  opts: { exitPieceSize?: number | "auto"; offsets?: PlaneOffset[] } = {},
): SlotPlacement[] {
  const n = parsed.points[0].slots.length;
  const caps = planes.map((p) => AIRCRAFT[p.aircraft].capacity ?? n);
  const counts = proportional(n, caps).map((c, i) => Math.min(c, caps[i]));
  // spill anything left over onto the planes with room, then the lead
  let left = n - counts.reduce((a, b) => a + b, 0);
  for (let i = 0; left > 0 && i < counts.length; i++) {
    const room = caps[i] - counts[i];
    const take = Math.min(room, left);
    counts[i] += take;
    left -= take;
  }
  counts[0] += left;
  const planned = planes.map((p, i) => ({ ...p, count: counts[i] }));
  return placeSlots(parsed as ParsedJump, planned, opts);
}
