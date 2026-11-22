import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { SimJumper, SimPlane } from "../src/js/classes/SimEntities";
import { Fleet, layoutOffset } from "../src/js/fleet/Fleet";
import { scheduleExits } from "../src/js/fleet/ExitSchedule";
import { AIRCRAFT, floatersFor, initialExitCount, matchAircraftName } from "../src/js/fleet/Aircraft";
import { FormationSequence } from "../src/js/formations/FormationSequence";

const FT = 0.3048;
const newPlane = () => new SimPlane(new THREE.Vector3(0, 13000 * FT, 0), 90, new THREE.Vector3(1, 0, 0));

function formationOf(n: number) {
  return new FormationSequence({
    title: "test",
    points: [{ label: "1", inter: false, slots: Array.from({ length: n }, (_, i) => ({ x: i, y: 0, headingDeg: 0, stance: "belly" })) }],
    members: Array.from({ length: n }, () => null),
  });
}

describe("aircraft", () => {
  it("has the given capacities", () => {
    expect(AIRCRAFT["twin-otter"].capacity).toBe(21);
    expect(AIRCRAFT.skyvan.capacity).toBe(22);
    expect(AIRCRAFT["cessna-172"].capacity).toBe(4);
    expect(AIRCRAFT["dc-9"].capacity).toBeNull();
  });

  it("matches .jump plane names", () => {
    expect(matchAircraftName("Otter base")).toBe("twin-otter");
    expect(matchAircraftName("Sky Van 2")).toBe("skyvan");
    expect(matchAircraftName("Caravan trail")).toBeNull();
  });

  it("sizes the initial exit from floaters + door", () => {
    const otter = AIRCRAFT["twin-otter"];
    const cessna = AIRCRAFT["cessna-172"];
    expect(initialExitCount(otter, 32)).toBe(9);
    expect(initialExitCount(otter, 32, 4)).toBe(8);
    expect(initialExitCount(cessna, 4)).toBe(4);
    // a 3-way from an Otter all fit in the door; from a Cessna one floats
    expect(floatersFor(otter, 3)).toBe(0);
    expect(floatersFor(cessna, 3)).toBe(1);
    expect(floatersFor(AIRCRAFT.skyvan, 6, 4)).toBe(0); // nothing outside a ramp
  });
});

describe("fleet layout", () => {
  it("places a V: right then left, each row back, out and up", () => {
    expect(layoutOffset("v", 1)).toEqual({ backM: 30, rightM: 40, upM: 30 });
    expect(layoutOffset("v", 2)).toEqual({ backM: 30, rightM: -40, upM: 30 });
    expect(layoutOffset("v", 3)).toEqual({ backM: 60, rightM: 80, upM: 60 });
  });

  it("flies trail planes at the offset in the lead's frame", () => {
    const lead = newPlane();
    const fleet = new Fleet(lead);
    const trail = fleet.addPlane("twin-otter");
    fleet.syncFromLead();
    // jumprun +X: forward = +X, right = +Z
    expect(trail.initialPosition.x).toBeCloseTo(-30);
    expect(trail.initialPosition.z).toBeCloseTo(40);
    expect(trail.initialPosition.y - lead.initialPosition.y).toBeCloseTo(30);
    expect(trail.direction.x).toBeCloseTo(1);
  });
});

describe("exit schedule", () => {
  it("launches the initial exit on go, then one door interval apart, on every plane", () => {
    const lead = newPlane();
    const fleet = new Fleet(lead);
    const trail = fleet.addPlane("twin-otter");
    lead.floaterSpots = AIRCRAFT["twin-otter"].floaterSpots;
    trail.floaterSpots = AIRCRAFT["twin-otter"].floaterSpots;
    const f = formationOf(24);
    const jumpers = Array.from({ length: 24 }, (_, i) => {
      const j = new SimJumper(i, i < 12 ? lead : trail, 0, 7, 190);
      j.index = i;
      j.exitOrder = i % 12;
      f.addMember(j);
      return j;
    });
    scheduleExits({ planes: fleet.planes, jumpers, formations: [f], exitIntervalS: 10 });
    const onLead = jumpers.filter((j) => j.plane === lead);
    // 5 floaters + 4 in the door leave together, then 0.25 s apart
    expect(onLead.slice(0, 9).every((j) => j.jumpTime === 0)).toBe(true);
    expect(onLead[9].jumpTime).toBeCloseTo(0.25);
    expect(onLead[11].jumpTime).toBeCloseTo(0.75);
    expect(onLead.filter((j) => j.isFloater)).toHaveLength(5);
    expect(onLead[0].exitSpot).not.toBeNull();
    // the trail plane goes on the same call
    expect(jumpers.filter((j) => j.plane === trail)[0].jumpTime).toBe(0);
  });

  it("puts other jumpers after the formation, an exit interval apart", () => {
    const lead = newPlane();
    const fleet = new Fleet(lead);
    const f = formationOf(3);
    const jumpers = Array.from({ length: 5 }, (_, i) => {
      const j = new SimJumper(i, lead, 0, 7, 190);
      j.index = i;
      j.exitOrder = i;
      if (i < 3) f.addMember(j);
      return j;
    });
    scheduleExits({ planes: fleet.planes, jumpers, formations: [f], exitIntervalS: 10 });
    expect(jumpers.map((j) => j.jumpTime)).toEqual([0, 0, 0, 10, 20]);
  });
});
