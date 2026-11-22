import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import { SimJumper, SimPlane, precalculateJumpers } from "../src/js/classes/SimEntities";
import { emptyPlan, setDropzonePlan } from "../src/js/dropzone/DropzonePlan";
import { AIRCRAFT, AircraftId } from "../src/js/fleet/Aircraft";
import { scheduleExits } from "../src/js/fleet/ExitSchedule";
import { Fleet } from "../src/js/fleet/Fleet";
import { FormationSequence } from "../src/js/formations/FormationSequence";
import { parseJumpFile } from "../src/js/formations/JumpFile";
import { splitLoad } from "../src/js/formations/LoadSplit";
import { sampleAdjust } from "../src/js/physics/SequenceSolver";

const FT = 0.3048;
const DURATION = 400;
const dir = join(__dirname, "..", "public", "formations");

function setup(file: string, opts: { exitFt?: number; preferred?: AircraftId; settings?: any; tweak?: (js: SimJumper[]) => void } = {}) {
  const parsed = parseJumpFile(readFileSync(join(dir, file), "utf8"), file);
  const split = splitLoad(parsed, { preferred: opts.preferred ?? "twin-otter" });
  const lead = new SimPlane(new THREE.Vector3(0, (opts.exitFt ?? 13000) * FT, 0), 90, new THREE.Vector3(1, 0, 0));
  const fleet = new Fleet(lead);
  (globalThis as any).fleet = fleet;
  const planes = split.planes.map((pp, k) => {
    const p = k === 0 ? lead : fleet.createPlane(pp.aircraft, pp.label);
    p.aircraftId = pp.aircraft;
    p.floaters = pp.floaters;
    p.doorOffset = { ...AIRCRAFT[pp.aircraft].door };
    p.floaterSpots = AIRCRAFT[pp.aircraft].floaterSpots;
    return p;
  });
  fleet.setPlanes(planes);
  fleet.syncFromLead();
  planes.forEach((p) => p.precalculate(DURATION));
  const jumpers = parsed.jumpers.map((_, i) => {
    const j = new SimJumper(i, lead, 0, 7, 190);
    j.weight = 80;
    j.extraWeight = 0;
    j.setBodyPosition("belly");
    return j;
  });
  split.placements.forEach((pl) => {
    const j = jumpers[pl.slot];
    j.plane = planes[pl.plane];
    j.exitOrder = pl.exitOrder;
    j.initialExit = pl.initialExit;
    j.wantsFloat = pl.floater;
    j.inExitPiece = pl.exitPiece;
  });
  const seq = FormationSequence.fromParsed(parsed, jumpers, opts.settings);
  let k = 0;
  planes.forEach((p) => jumpers.filter((j) => j.plane === p).sort((a, b) => a.exitOrder - b.exitOrder).forEach((j) => (j.index = k++)));
  opts.tweak?.(jumpers);
  fleet.formations = [seq];
  (globalThis as any).simJumpers = jumpers;
  scheduleExits({ planes, jumpers, formations: [seq], exitIntervalS: 10 });
  precalculateJumpers(jumpers, DURATION);
  return { seq, jumpers, planes, fleet };
}

beforeEach(() => {
  delete (globalThis as any).weatherSnapshotLog; // calm air
  setDropzonePlan(emptyPlan("Test DZ"));
});

describe("sequence solver", () => {
  it("cycles a 3-way through every point, scoring keyed points", () => {
    const { seq, jumpers } = setup("3way6a.jump", { settings: { timePerPointS: 6 } });
    const r = seq.result!;
    expect(r).not.toBeNull();
    const pts = new Set(r.windows.map((w) => w.point));
    expect(pts.size).toBe(7);
    expect(r.windows.some((w) => w.round === 2)).toBe(true); // repeats
    expect(r.score).toBeGreaterThan(5);
    expect(r.score).toBe(r.windows.filter((w) => w.scored).length);
    // every member flies the solved track until breakoff
    jumpers.forEach((j) => expect(j.seqTrack).not.toBeNull());
  });

  it("holds each slot at its .jump position relative to the others", () => {
    const { seq, jumpers } = setup("3way6a.jump", { settings: { timePerPointS: 6 } });
    const w = seq.result!.windows.find((x) => x.keyedAt !== null && x.point === 2)!;
    const t = w.keyedAt! + 0.5;
    const pos = jumpers.map((j) => j.track.getInterpolatedSample(t)!.position);
    const slots = seq.points[2].slots;
    const d01 = Math.hypot(slots[0].x - slots[1].x, slots[0].y - slots[1].y);
    expect(pos[0].distanceTo(pos[1])).toBeCloseTo(d01, 1);
  });

  it("builds the 32-way from two Otters before breakoff, never low under the formation", () => {
    const { seq, jumpers } = setup("night_jump_32way.jump");
    const r = seq.result!;
    const p1 = r.windows[0];
    expect(p1.keyedAt).not.toBeNull();
    expect(p1.keyedAt!).toBeLessThan(r.breakoffTime);
    // low-guard: nobody more than LOW_TOL below the centre within R + margin
    const R = seq.radius(0);
    let worst = 0;
    for (let t = r.tGo + 3; t < r.breakoffTime; t += 0.5) {
      const ys = jumpers.map((j) => j.track.getInterpolatedSample(t)!.position);
      const cx = ys.reduce((a, p) => a + p.x, 0) / ys.length;
      const cz = ys.reduce((a, p) => a + p.z, 0) / ys.length;
      const docked = jumpers.filter((j) => j.seqTrack!.states.some((s) => s.state === "docked" && s.t <= t));
      if (!docked.length) continue;
      const cy = docked.reduce((a, j) => a + j.track.getInterpolatedSample(t)!.position.y, 0) / docked.length;
      ys.forEach((p) => {
        if (Math.hypot(p.x - cx, p.z - cz) < R + 5) worst = Math.max(worst, cy - p.y);
      });
    }
    expect(worst).toBeLessThan(4);
  });

  it("shows a down (faster) arrow while diving from the trail plane", () => {
    const { jumpers, planes } = setup("night_jump_32way.jump");
    const diver = jumpers.filter((j) => j.plane === planes[1] && !j.initialExit).pop()!;
    const dive = diver.seqTrack!.states.find((s) => s.state === "dive")!;
    const a = sampleAdjust(diver.seqTrack!, dive.t + 2)!;
    expect(a.mph).toBeGreaterThan(10);
  });

  it("holds a too-heavy diver off, outside and low, and reports the slot", () => {
    let heavy: SimJumper | null = null;
    const { seq } = setup("night_jump_32way.jump", {
      tweak: (js) => {
        heavy = js.filter((j) => !j.inExitPiece).sort((a, b) => b.exitOrder - a.exitOrder)[0];
        heavy.extraWeight = 30;
      },
    });
    const tr = heavy!.seqTrack!;
    expect(tr.fallWarning).toMatch(/falls too fast/);
    expect(tr.states.some((s) => s.state === "holdoff")).toBe(true);
    const slot = seq.slotOf(heavy!) + 1;
    expect(seq.result!.windows[0].missingSlots).toContain(slot);
    // the heavy jumper's adjustment arrow hits the limit
    const lastAdj = tr.adjust.atLimit[tr.adjust.atLimit.length - 1];
    expect(lastAdj).toBe(1);
  });

  it("reports misses from a low exit", () => {
    const { seq } = setup("night_jump_32way.jump", { exitFt: 6500 });
    const missed = seq.result!.members.filter((m) => m.missed);
    expect(missed.length).toBeGreaterThan(0);
    expect(seq.result!.windows[0].keyedAt).toBeNull();
  });
});
