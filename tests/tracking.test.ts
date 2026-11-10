import { beforeEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import { SimJumper, SimPlane, precalculateJumpers } from "../src/js/classes/SimEntities";
import { emptyPlan, setDropzonePlan } from "../src/js/dropzone/DropzonePlan";
import { TRACK_LEAD_FT, TRACK_START_FT } from "../src/js/physics/BodyPositions";

/**
 * Breakoff tracking: a jumper with the Track toggle on (belly, sit fly, head down)
 * breaks off at TRACK_START_FT — or TRACK_LEAD_FT above their pull if they pull
 * higher — and tracks away horizontally before throwing the pilot chute. Linked
 * groups fly a round until breakoff, then every member tracks straight out from the
 * centre. All runs are in calm air with an empty dropzone plan.
 */

const FT = 0.3048;
const EXIT_FT = 13000;

interface JumperSpec {
  style?: string;
  tracking?: boolean;
  linked?: boolean;
  pullFt?: number;
  jumpTime?: number;
}

function runLoad(specs: JumperSpec[], configure?: (plane: SimPlane) => void) {
  const plane = new SimPlane(new THREE.Vector3(0, EXIT_FT * FT, 0), 90, new THREE.Vector3(1, 0, 0));
  configure?.(plane);
  plane.precalculate(900);
  const jumpers = specs.map((s, i) => {
    const j = new SimJumper(i, plane, 10, 7, 190);
    j.weight = 80;
    j.extraWeight = 0;
    j.flyingStyle = (s.style ?? "belly") as any;
    j.tracking = s.tracking ?? true;
    j.linked = s.linked ?? false;
    if (s.pullFt !== undefined) j.pullAltitudeFt = s.pullFt;
    j.calculateSurfaceArea();
    j.jumpTime = s.jumpTime ?? i * 10;
    return j;
  });
  (globalThis as any).simJumpers = jumpers;
  (plane as any).jumpers = jumpers;
  precalculateJumpers(jumpers, 900);
  return { plane, jumpers };
}

const at = (j: SimJumper, t: number) => {
  const s = j.track.getInterpolatedSample(t);
  if (!s) throw new Error(`no sample at ${t}`);
  return s;
};
const altFt = (j: SimJumper, t: number) => at(j, t).position.y / FT;
const horizontal = (a: THREE.Vector3, b: THREE.Vector3) => Math.hypot(b.x - a.x, b.z - a.z);

/** Ground distance covered between breakoff and pull. */
function trackDistance(j: SimJumper) {
  return horizontal(at(j, j.trackStartTime!).position, at(j, j.deployment!.pullTime).position);
}

beforeEach(() => {
  delete (globalThis as any).weatherSnapshotLog; // calm air
  setDropzonePlan(emptyPlan("Test DZ"));
});

describe("breakoff tracking (solo)", () => {
  it("breaks off at 4,500 ft and tracks away before pulling", () => {
    const { jumpers } = runLoad([{}]);
    const j = jumpers[0];
    expect(j.trackStartTime).not.toBeNull();
    expect(j.deployment).not.toBeNull();
    expect(altFt(j, j.trackStartTime!)).toBeCloseTo(TRACK_START_FT, -2); // within ±50 ft
    expect(j.trackStartTime!).toBeLessThan(j.deployment!.pullTime);

    // flat track: real horizontal speed and distance, not a straight fall
    const v = at(j, j.trackStartTime! + 3).velocity;
    expect(Math.hypot(v.x, v.z)).toBeGreaterThan(20);
    expect(trackDistance(j)).toBeGreaterThan(100);
  });

  it("tracks at right angles to the jumprun", () => {
    const { jumpers } = runLoad([{}]);
    const j = jumpers[0];
    const a = at(j, j.trackStartTime! + 1).position;
    const b = at(j, j.deployment!.pullTime).position;
    const dir = new THREE.Vector3(b.x - a.x, 0, b.z - a.z).normalize();
    const jumprun = new THREE.Vector3(1, 0, 0);
    expect(Math.abs(dir.dot(jumprun))).toBeLessThan(0.2);
  });

  it("does not track with the Track toggle off", () => {
    const { jumpers } = runLoad([{ tracking: false }]);
    const j = jumpers[0];
    expect(j.trackStartTime).toBeNull();
    // in calm air a belly flyer falls almost straight down from 4,500 ft to the pull
    const t45 = timeAtAltitude(j, TRACK_START_FT);
    expect(horizontal(at(j, t45).position, at(j, j.deployment!.pullTime).position)).toBeLessThan(20);
  });

  it("still tracks when the pull altitude equals the breakoff altitude", () => {
    // the reported bug: pulling at 4,500 ft meant the jumper pulled without tracking
    const { jumpers } = runLoad([{ pullFt: 4500 }]);
    const j = jumpers[0];
    expect(j.trackStartTime).not.toBeNull();
    expect(altFt(j, j.trackStartTime!)).toBeCloseTo(4500 + TRACK_LEAD_FT, -2);
    expect(j.trackStartTime!).toBeLessThan(j.deployment!.pullTime);
    expect(trackDistance(j)).toBeGreaterThan(100);
  });

  it("leaves 1,000 ft of track for any pull above 3,500 ft", () => {
    for (const pullFt of [3000, 3500, 4000, 5000, 6000]) {
      const { jumpers } = runLoad([{ pullFt }]);
      const j = jumpers[0];
      const startFt = altFt(j, j.trackStartTime!);
      const pullAltFt = altFt(j, j.deployment!.pullTime);
      expect(startFt - pullAltFt, `pull ${pullFt} ft`).toBeGreaterThan(TRACK_LEAD_FT - 50);
      expect(trackDistance(j), `pull ${pullFt} ft`).toBeGreaterThan(100);
    }
  });

  it("sit flyers and head-downers track too", () => {
    const { jumpers } = runLoad([{ style: "sitfly" }, { style: "headdown" }]);
    for (const j of jumpers) {
      expect(j.trackStartTime, j.flyingStyle).not.toBeNull();
      expect(trackDistance(j), j.flyingStyle).toBeGreaterThan(100);
    }
  });
});

describe("breakoff tracking (round)", () => {
  const round = (extra: JumperSpec = {}) =>
    [0, 1, 2, 3].map((i) => ({ linked: true, jumpTime: 0, ...(i === 3 ? extra : {}) }));

  it("holds the round until breakoff, then every member tracks", () => {
    const { jumpers } = runLoad(round());
    for (const j of jumpers) {
      expect(j.formationEndTime).not.toBeNull();
      expect(j.trackStartTime).not.toBeNull();
      expect(altFt(j, j.trackStartTime!)).toBeCloseTo(TRACK_START_FT, -2);
      expect(trackDistance(j)).toBeGreaterThan(100);
    }
  });

  it("tracks straight out from the centre of the round", () => {
    const { jumpers } = runLoad(round());
    const tb = jumpers[0].trackStartTime!;
    const centre = jumpers
      .map((j) => at(j, tb).position)
      .reduce((s, p) => s.add(p), new THREE.Vector3())
      .divideScalar(jumpers.length);
    for (const j of jumpers) {
      const start = at(j, tb).position;
      const end = at(j, j.deployment!.pullTime).position;
      const radial = new THREE.Vector3(start.x - centre.x, 0, start.z - centre.z).normalize();
      const moved = new THREE.Vector3(end.x - start.x, 0, end.z - start.z).normalize();
      expect(moved.dot(radial)).toBeGreaterThan(0.95);
    }
  });

  it("spreads the round out to at least 140 m between jumpers at pull", () => {
    const { jumpers } = runLoad(round());
    const t = jumpers[0].deployment!.pullTime;
    for (let a = 0; a < jumpers.length; a++)
      for (let b = a + 1; b < jumpers.length; b++)
        expect(horizontal(at(jumpers[a], t).position, at(jumpers[b], t).position)).toBeGreaterThan(140);
  });

  it("breaks the whole round off 1,000 ft above its highest pull", () => {
    const { jumpers } = runLoad(round({ pullFt: 5000 }));
    for (const j of jumpers) {
      expect(altFt(j, j.trackStartTime!)).toBeCloseTo(5000 + TRACK_LEAD_FT, -2);
      expect(j.trackStartTime!).toBeLessThan(j.deployment!.pullTime);
    }
  });

  it("uses the round's breakoff altitude setting", () => {
    const { jumpers } = runLoad(round(), (plane) => {
      (plane as any).roundSettings = { breakoffFt: 6000 };
    });
    for (const j of jumpers) {
      expect(altFt(j, j.formationEndTime!)).toBeCloseTo(6000, -2);
      expect(altFt(j, j.trackStartTime!)).toBeCloseTo(6000, -2);
    }
  });
});

/** First sample time at or below an altitude (ft). */
function timeAtAltitude(j: SimJumper, ft: number): number {
  for (const s of j.track.samples) if (s.time >= j.jumpTime && s.position.y / FT <= ft) return s.time;
  throw new Error(`never reached ${ft} ft`);
}
