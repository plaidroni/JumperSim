import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseJumpFile, ParsedJump } from "../src/js/formations/JumpFile";
import { balanced, proportional, splitLoad } from "../src/js/formations/LoadSplit";

const dir = join(__dirname, "..", "public", "formations");
const load = (name: string) => parseJumpFile(readFileSync(join(dir, name), "utf8"), name);

/** A synthetic n-way ring with no planes. */
function ring(n: number): ParsedJump {
  const slots = Array.from({ length: n }, (_, i) => {
    const a = (2 * Math.PI * i) / n;
    const r = Math.max(1.5, n * 0.3);
    return { x: Math.sin(a) * r, y: Math.cos(a) * r, headingDeg: 0, stance: "belly" };
  });
  return {
    title: `${n}-way`,
    sourceName: "ring.jump",
    docVersion: 2,
    tunnelFt: 0,
    points: [{ label: "1", inter: false, slots }],
    planes: [],
    warnings: [],
    jumpers: slots.map((_, i) => ({ slot: i, name: null, color: "#FFFFFF", fileColor: "#FFFFFF", plane: null })),
  };
}

const counts = (p: ParsedJump, preferred: any) => splitLoad(p, { preferred }).planes.map((x) => x.count);

describe("load split", () => {
  it("balances counts and spreads proportionally", () => {
    expect(balanced(43, 3)).toEqual([15, 14, 14]);
    expect(proportional(32, [18, 14])).toEqual([18, 14]);
    expect(proportional(10, [1, 1, 1])).toEqual([4, 3, 3]);
  });

  it("matches the §6.5 table for synthetic loads", () => {
    expect(counts(ring(21), "twin-otter")).toEqual([21]);
    expect(counts(ring(22), "twin-otter")).toEqual([11, 11]);
    expect(counts(ring(22), "skyvan")).toEqual([22]);
    expect(counts(ring(43), "twin-otter")).toEqual([15, 14, 14]);
    expect(counts(ring(45), "skyvan")).toEqual([15, 15, 15]);
    expect(counts(ring(4), "cessna-172")).toEqual([4]);
    expect(counts(ring(10), "cessna-172")).toEqual([4, 3, 3]);
  });

  it("refuses more than 10 planes", () => {
    expect(() => splitLoad(ring(240), { preferred: "twin-otter" })).toThrow(/max 10/);
  });

  it("flies a small 3-way in one plane, all in the exit piece, nobody floating from an Otter", () => {
    const s = splitLoad(load("3way6a.jump"), { preferred: "twin-otter" });
    expect(s.planes).toHaveLength(1);
    expect(s.placements.every((p) => p.exitPiece && p.initialExit && !p.floater)).toBe(true);
    const c = splitLoad(load("3way6a.jump"), { preferred: "cessna-172" });
    expect(c.placements.filter((p) => p.floater)).toHaveLength(1);
  });

  it("uses the file's plane order and floaters for BW (all assigned)", () => {
    const p = load("BWkemp3_jump6.jump");
    const s = splitLoad(p, { preferred: "twin-otter" });
    expect(s.source).toBe("file");
    expect(s.planes.map((x) => [x.label, x.aircraft, x.count, x.floaters])).toEqual([["Caravan", "twin-otter", 8, 4]]);
    s.placements.forEach((pl) => expect(pl.exitOrder).toBe(p.jumpers[pl.slot].plane!.exitOrder));
    expect(s.placements.filter((x) => x.exitPiece)).toHaveLength(8); // 4 floaters + 4 in the door
    expect(s.placements.filter((x) => x.floater)).toHaveLength(4);
  });

  it("splits the 32-way 18 + 14 by the file's seats, base nearest the centre in the lead", () => {
    const p = load("night_jump_32way.jump");
    const s = splitLoad(p, { preferred: "twin-otter" });
    expect(s.source).toBe("file-counts");
    expect(s.planes.map((x) => [x.label, x.aircraft, x.count])).toEqual([
      ["Otter base", "twin-otter", 18],
      ["Caravan trail", "twin-otter", 14],
    ]);
    const piece = s.placements.filter((x) => x.exitPiece);
    expect(piece).toHaveLength(9); // 5 floaters + 4 in the door
    const d = (slot: number) => Math.hypot(p.points[0].slots[slot].x, p.points[0].slots[slot].y);
    const maxPiece = Math.max(...piece.map((x) => d(x.slot)));
    const others = s.placements.filter((x) => !x.exitPiece).map((x) => d(x.slot));
    expect(maxPiece).toBeLessThanOrEqual(Math.min(...others) + 1e-9);
    // every plane's exit orders are 0…n-1
    for (const k of [0, 1]) {
      const orders = s.placements.filter((x) => x.plane === k).map((x) => x.exitOrder).sort((a, b) => a - b);
      expect(orders).toEqual(orders.map((_, i) => i));
    }
    // the trail plane (back-right) gets slots on the right-hand side of the formation
    const trail = s.placements.filter((x) => x.plane === 1).map((x) => p.points[0].slots[x.slot].x);
    expect(trail.reduce((a, b) => a + b, 0) / trail.length).toBeGreaterThan(0);
  });

  it("ignores file planes that don't fit their aircraft", () => {
    const p = load("night_jump_32way.jump");
    p.planes = [{ ...p.planes[0], name: "Cessna", slotCount: 32 }];
    const s = splitLoad(p, { preferred: "twin-otter" });
    expect(s.source).toBe("auto");
    expect(s.notes.join(" ")).toMatch(/don't fit/);
    expect(s.planes.map((x) => x.count)).toEqual([16, 16]);
  });
});
