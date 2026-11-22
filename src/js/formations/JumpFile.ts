// Skydive Designer .jump files → a parsed jump in metres (specs/formation-jumps.md §4).
// Pure: no DOM, no three.js, unit-tested against public/formations/*.jump.

/** 1 .jump unit ≈ 1 cm (§4.4). */
export const JUMP_UNITS_TO_M = 0.01;

export type PlaneOrder = "firstOut" | "fromPilot";

export interface ParsedSlot {
  /** Metres from the point's centroid, page frame: +x right, +y up the page. */
  x: number;
  y: number;
  /** Heading, degrees clockwise from page-up. */
  headingDeg: number;
  stance: string;
}

export interface ParsedPoint {
  label: string;
  inter: boolean;
  slots: ParsedSlot[];
}

export interface ParsedJumper {
  /** 0-based slot (the jumper's index in the file). */
  slot: number;
  name: string | null;
  /** Colour for display (very dark colours lifted). */
  color: string;
  /** Colour as written in the file. */
  fileColor: string;
  /** File plane and exit order within it (0 = first out, after the plane-order rule). */
  plane: { planeId: string; exitOrder: number } | null;
}

export interface ParsedPlane {
  id: string;
  name: string;
  slotCount: number;
  floaters: number | null;
  color: string;
}

export interface ParsedJump {
  title: string;
  sourceName: string;
  docVersion: number;
  tunnelFt: number;
  jumpers: ParsedJumper[];
  points: ParsedPoint[];
  planes: ParsedPlane[];
  warnings: string[];
}

export class JumpFileError extends Error {}

const KNOWN_STANCES = new Set(["belly", "bellyNarrowArms", "bellyWideArms"]);
const DEFAULT_COLORS = ["#E6194B", "#3CB44B", "#FFE119", "#4363D8", "#F58231", "#911EB4", "#46F0F0", "#F032E6"];

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const HEX = /^#?([0-9a-f]{6})$/i;

/** `#rrggbb`, or null when not a colour. */
export function normalizeHex(c: unknown): string | null {
  if (typeof c !== "string") return null;
  const m = HEX.exec(c.trim());
  return m ? `#${m[1].toUpperCase()}` : null;
}

/** Lift very dark colours (luminance < 0.15) to 35% so they show on the dark scene. */
export function displayColor(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  if (lum >= 0.15) return hex;
  const lift = (v: number) => Math.round(v + (255 - v) * 0.35);
  return `#${[lift(r), lift(g), lift(b)].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

function baseName(fileName: string) {
  return fileName.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "") || "Formation";
}

export function parseJumpFile(text: string, fileName: string, opts: { planeOrder?: PlaneOrder } = {}): ParsedJump {
  let raw: any;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new JumpFileError("Not a Skydive Designer .jump file (not JSON).");
  }
  if (!raw || typeof raw !== "object") throw new JumpFileError("Not a Skydive Designer .jump file.");
  if (raw.docVersion !== 2)
    throw new JumpFileError(`Not a Skydive Designer .jump file (docVersion ${raw.docVersion ?? "missing"}).`);
  if (!Array.isArray(raw.points) || raw.points.length === 0) throw new JumpFileError("The file has no points.");

  const warnings: string[] = [];
  const counts = raw.points.map((p: any) => (Array.isArray(p?.slots) ? p.slots.length : -1));
  if (counts.some((c: number) => c <= 0)) {
    const i = counts.findIndex((c: number) => c <= 0);
    throw new JumpFileError(`Point ${i + 1} has no slots.`);
  }
  const n = counts[0];
  counts.forEach((c: number, i: number) => {
    if (c !== n) throw new JumpFileError(`Point ${i + 1} has ${c} slots, expected ${n}.`);
  });

  // points → metres, centred per point, y flipped to "up the page"
  const unknownStances = new Set<string>();
  const pageTitles = new Map<number, string>();
  (raw.exportInfo?.pages ?? []).forEach((pg: any) => {
    if (isNum(pg?.point) && typeof pg?.title === "string" && pg.title.trim()) pageTitles.set(pg.point, pg.title.trim().slice(0, 40));
  });
  let interCount = 0;
  const points: ParsedPoint[] = raw.points.map((p: any, k: number) => {
    const slots = p.slots as any[];
    slots.forEach((s, i) => {
      if (!Array.isArray(s?.origin) || !isNum(s.origin[0]) || !isNum(s.origin[1]))
        throw new JumpFileError(`Point ${k + 1}, slot ${i + 1} has no position.`);
    });
    const cx = slots.reduce((a, s) => a + s.origin[0], 0) / slots.length;
    const cy = slots.reduce((a, s) => a + s.origin[1], 0) / slots.length;
    const inter = p.inter === true;
    if (inter) interCount++;
    return {
      label: pageTitles.get(k) ?? String(k + 1),
      inter,
      slots: slots.map((s) => {
        const stance = typeof s.stance === "string" ? s.stance : "belly";
        if (!KNOWN_STANCES.has(stance)) unknownStances.add(stance);
        return {
          x: (s.origin[0] - cx) * JUMP_UNITS_TO_M,
          y: -(s.origin[1] - cy) * JUMP_UNITS_TO_M,
          headingDeg: isNum(s.angleDeg) ? ((s.angleDeg % 360) + 360) % 360 : 0,
          stance,
        };
      }),
    };
  });
  if (unknownStances.size)
    warnings.push(`Unknown stance${unknownStances.size > 1 ? "s" : ""} ${[...unknownStances].join(", ")} flown belly-to-earth.`);
  if (interCount) warnings.push(`${interCount} intermediate point${interCount > 1 ? "s are" : " is"} flown but not scored.`);

  // planes
  const planes: ParsedPlane[] = (Array.isArray(raw.planes) ? raw.planes : [])
    .filter((p: any) => p && typeof p.id === "string")
    .map((p: any, i: number) => ({
      id: p.id,
      name: typeof p.name === "string" && p.name.trim() ? p.name.trim().slice(0, 40) : `Plane ${i + 1}`,
      slotCount: isNum(p.slotCount) && p.slotCount > 0 ? Math.round(p.slotCount) : 0,
      floaters: isNum(p.floaters) && p.floaters >= 0 ? Math.round(p.floaters) : null,
      color: normalizeHex(p.autoColour) ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length],
    }));
  const planeIds = new Set(planes.map((p) => p.id));

  // jumpers
  const rawJumpers: any[] = Array.isArray(raw.jumpers) ? raw.jumpers : [];
  if (rawJumpers.length < n) warnings.push(`${n - rawJumpers.length} slot${n - rawJumpers.length > 1 ? "s have" : " has"} no jumper in the file; added.`);
  if (rawJumpers.length > n) warnings.push(`${rawJumpers.length - n} extra jumper${rawJumpers.length - n > 1 ? "s" : ""} without a slot ignored.`);
  const jumpers: ParsedJumper[] = Array.from({ length: n }, (_, i) => {
    const r = rawJumpers[i] ?? {};
    const fileColor = normalizeHex(r.color) ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length];
    const name = typeof r.person?.name === "string" && r.person.name.trim() ? r.person.name.trim().slice(0, 100) : null;
    const ps = r.planeSlot;
    const plane =
      ps && typeof ps.planeId === "string" && planeIds.has(ps.planeId) && isNum(ps.index)
        ? { planeId: ps.planeId, exitOrder: Math.round(ps.index) }
        : null;
    return { slot: i, name, color: displayColor(fileColor), fileColor, plane };
  });

  // exit order per file plane: pilot-seat check, then the plane-order rule (§4.3)
  const order = opts.planeOrder ?? "firstOut";
  for (const p of planes) {
    const mine = jumpers.filter((j) => j.plane?.planeId === p.id);
    if (!mine.length) continue;
    const idx = mine.map((j) => j.plane!.exitOrder);
    if (!idx.includes(0) && Math.min(...idx) === 1) {
      mine.forEach((j) => (j.plane!.exitOrder -= 1));
      warnings.push(`${p.name}: seat 0 is the pilot; seats shifted down by one.`);
    }
    if (new Set(idx).size !== idx.length) warnings.push(`${p.name}: two jumpers share a plane position; ordered by file order.`);
    // dense 0…k−1 ranks, ties by file order
    const sorted = [...mine].sort((a, b) => a.plane!.exitOrder - b.plane!.exitOrder || a.slot - b.slot);
    if (order === "fromPilot") sorted.reverse();
    sorted.forEach((j, k) => (j.plane!.exitOrder = k));
  }

  const tunnelFt = isNum(raw.tunnelFt) ? raw.tunnelFt : 0;
  if (tunnelFt > 0) warnings.push(`Designed for a ${tunnelFt} ft wind tunnel; flown as a skydive.`);

  const title =
    (typeof raw.title === "string" && raw.title.trim()) ||
    (typeof raw.exportInfo?.title === "string" && raw.exportInfo.title.trim()) ||
    baseName(fileName);

  return {
    title: String(title).slice(0, 100),
    sourceName: fileName.replace(/^.*[\\/]/, ""),
    docVersion: 2,
    tunnelFt,
    jumpers,
    points,
    planes,
    warnings,
  };
}
