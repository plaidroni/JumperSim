import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { JumpFileError, displayColor, parseJumpFile } from "../src/js/formations/JumpFile";

const dir = join(__dirname, "..", "public", "formations");
const load = (name: string, opts?: Parameters<typeof parseJumpFile>[2]) =>
  parseJumpFile(readFileSync(join(dir, name), "utf8"), name, opts);

const span = (pts: { x: number; y: number }[]) => {
  let m = 0;
  pts.forEach((a) => pts.forEach((b) => (m = Math.max(m, Math.hypot(a.x - b.x, a.y - b.y)))));
  return m;
};

describe(".jump parser", () => {
  it("reads the 3-way: title, 7 points, headings facing the centre", () => {
    const p = load("3way6a.jump");
    expect(p.title).toBe("3 Way Jump 6A");
    expect(p.points).toHaveLength(7);
    expect(p.jumpers).toHaveLength(3);
    expect(p.planes).toHaveLength(0);
    // page frame, y up: each slot's heading points at the centroid (within 3°)
    for (const s of p.points[0].slots) {
      const toCentre = (Math.atan2(-s.x, -s.y) * 180) / Math.PI;
      const diff = Math.abs((((s.headingDeg - toCentre) % 360) + 540) % 360 - 180);
      expect(diff).toBeLessThan(3);
    }
  });

  it("uses about 1 cm per unit: the 32-way is 12–13 m across", () => {
    const p = load("night_jump_32way.jump");
    expect(span(p.points[0].slots)).toBeGreaterThan(12);
    expect(span(p.points[0].slots)).toBeLessThan(13);
    expect(p.planes.map((x) => [x.name, x.slotCount, x.floaters])).toEqual([
      ["Otter base", 18, 5],
      ["Caravan trail", 14, 4],
    ]);
    expect(p.jumpers.every((j) => j.plane === null)).toBe(true);
    expect(p.title).toBe("night_jump_32way");
  });

  it("reads names and plane order, first out by default", () => {
    const p = load("BWkemp3_jump6.jump");
    expect(p.jumpers.every((j) => j.name)).toBe(true);
    const order = p.jumpers.map((j) => j.plane!.exitOrder);
    expect([...order].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(order[0]).toBe(2); // the first jumper sits at index 2
  });

  it("reverses the order with 'from the pilot'", () => {
    const first = load("jff2.jump");
    const pilot = load("jff2.jump", { planeOrder: "fromPilot" });
    const n = first.jumpers.length;
    first.jumpers.forEach((j, i) => expect(pilot.jumpers[i].plane!.exitOrder).toBe(n - 1 - j.plane!.exitOrder));
  });

  it("lifts black jumpers so they show on the dark scene", () => {
    const p = load("jff2.jump");
    const black = p.jumpers.find((j) => j.fileColor === "#000000")!;
    expect(black.color).not.toBe("#000000");
    expect(displayColor("#FF9300")).toBe("#FF9300");
  });

  it("shifts seats when index 0 is missing (the pilot's seat)", () => {
    const raw = JSON.parse(readFileSync(join(dir, "BWkemp3_jump6.jump"), "utf8"));
    raw.jumpers.forEach((j: any) => (j.planeSlot.index += 1));
    const p = parseJumpFile(JSON.stringify(raw), "x.jump");
    expect(Math.min(...p.jumpers.map((j) => j.plane!.exitOrder))).toBe(0);
    expect(p.warnings.join(" ")).toMatch(/pilot/);
  });

  it("rejects broken files with a clear message", () => {
    const raw = JSON.parse(readFileSync(join(dir, "3way6a.jump"), "utf8"));
    raw.points[2].slots.pop();
    expect(() => parseJumpFile(JSON.stringify(raw), "x.jump")).toThrow("Point 3 has 2 slots, expected 3.");
    expect(() => parseJumpFile("{}", "x.jump")).toThrow(JumpFileError);
    expect(() => parseJumpFile("nope", "x.jump")).toThrow(/not JSON/);
  });
});
