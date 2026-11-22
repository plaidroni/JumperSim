import { describe, expect, it } from "vitest";
import { JsimEnvironment, JsimError, jsimFileName, parseJsim, safeText, serializeJsim } from "../src/js/core/data/JsimFile";
import { DEFAULT_SEQUENCE_SETTINGS } from "../src/js/formations/FormationSequence";

function sample(): JsimEnvironment {
  return {
    format: "jumpersim",
    version: 1,
    savedAt: "2026-11-21T22:14:03.000Z",
    appVersion: "1.0.1",
    jump: { name: "Night 32-way", exitAltitudeFt: 13000, planeSpeedKt: 90 },
    dropzone: { name: "Example DZ", latitude: 33.7, longitude: -117.2, elevationFt: 1400, country: "United States" },
    plan: { version: 1, dropzone: "Example DZ", jumprun: null, landingZones: [], dangerZones: [], canopyPattern: null, freefallPatterns: [] },
    load: {
      exitIntervalS: 10,
      linkedFormation: "round",
      roundSettings: { slotRadiusM: "auto", breakoffFt: 4500, breakoffDistanceM: "auto" },
      flockSettings: { layout: "arrowhead", spacingM: 15, stackM: 0, breakoffFt: 5500 },
      minDeploySeparationM: 150,
      fleet: {
        layout: "v",
        spacing: { backM: 30, rightM: 40, upM: 30 },
        planes: [
          { id: "p1", label: "Otter base", aircraft: "twin-otter", floaters: 5, goOffsetS: 0 },
          { id: "p2", label: "Caravan trail", aircraft: "twin-otter", floaters: 4, goOffsetS: 0 },
        ],
      },
      jumpers: [
        { id: "j1", plane: "p1", exitOrder: 0, initialExit: true, wantsFloat: true, inExitPiece: true, name: "A", color: "#F44336", position: "belly", tracking: true, weightKg: 80, extraWeightKg: 0, suit: "normal", canopySqft: 190, pullFt: 4500, linked: true, formationSlot: 1, laneIndex: null, freefallPatternId: null },
        { id: "j2", plane: "p2", exitOrder: 0, initialExit: true, wantsFloat: false, inExitPiece: false, name: null, color: null, position: "belly", tracking: true, weightKg: 75, extraWeightKg: 2, suit: "baggy", canopySqft: 170, pullFt: 4000, linked: true, formationSlot: 2, laneIndex: null, freefallPatternId: null },
      ],
      formations: [
        {
          id: "f1",
          title: "Night 32-way",
          source: { file: "night_jump_32way.jump", docVersion: 2 },
          settings: { ...DEFAULT_SEQUENCE_SETTINGS, timePerPointS: 8 },
          points: [{ label: "1", inter: false, slots: [{ x: -1, y: 0, headingDeg: 90, stance: "belly" }, { x: 1, y: 0, headingDeg: 270, stance: "belly" }] }],
          members: ["j1", "j2"],
        },
      ],
    },
    weather: { mode: "live", override: null, state: null },
    view: { time: 42.5, speed: 2, camera: { position: [1, 2, 3], target: [4, 5, 6] } },
  };
}

describe(".jsim files", () => {
  it("round-trips: save → load → save is identical", () => {
    const text = serializeJsim(sample());
    const once = parseJsim(text);
    expect(once.warnings).toEqual([]);
    expect(serializeJsim(once.env)).toBe(text);
  });

  it("refuses other files and newer versions", () => {
    expect(() => parseJsim("nope")).toThrow(JsimError);
    expect(() => parseJsim(JSON.stringify({ format: "other", version: 1 }))).toThrow(/Not a JumperSim/);
    expect(() => parseJsim(JSON.stringify({ ...sample(), version: 99 }))).toThrow(/newer JumperSim/);
  });

  it("strips markup and clamps numbers from hostile files", () => {
    const env: any = sample();
    env.jump.name = '<img src=x onerror="alert(1)">Jump';
    env.load.jumpers[0].name = "<script>alert(1)</script>Bob";
    env.load.roundSettings.slotRadiusM = '<img src=x onerror="alert(1)">';
    env.load.roundSettings.breakoffFt = 1e9;
    env.jump.exitAltitudeFt = 99999;
    env.load.jumpers[0].color = "red;background:url(x)";
    env.load.fleet.planes[0].aircraft = "<b>747</b>";
    const { env: out, warnings } = parseJsim(JSON.stringify(env));
    const all = JSON.stringify(out);
    expect(all).not.toMatch(/[<>]/);
    expect(out.load.roundSettings.slotRadiusM).toBe("auto");
    expect(out.load.roundSettings.breakoffFt).toBe(15000);
    expect(out.jump.exitAltitudeFt).toBe(18000);
    expect(out.load.jumpers[0].color).toBeNull();
    expect(out.load.fleet.planes[0].aircraft).toBe("twin-otter");
    expect(warnings.join(" ")).toMatch(/Unknown aircraft/);
  });

  it("fixes broken references", () => {
    const env: any = sample();
    env.load.jumpers[1].plane = "gone";
    env.load.formations[0].members = ["j1", "nobody"];
    const { env: out, warnings } = parseJsim(JSON.stringify(env));
    expect(out.load.jumpers[1].plane).toBe("p1");
    expect(out.load.formations[0].members).toEqual(["j1", null]);
    expect(warnings.length).toBe(2);
  });

  it("enforces limits", () => {
    const env: any = sample();
    env.load.fleet.planes = Array.from({ length: 11 }, (_, i) => ({ id: `p${i}`, label: "x", aircraft: "skyvan", floaters: null, goOffsetS: 0 }));
    expect(() => parseJsim(JSON.stringify(env))).toThrow(/Too many planes/);
  });

  it("names files safely", () => {
    expect(jsimFileName("Night 32-way: <final>")).toBe("Night 32-way final.jsim");
    expect(jsimFileName("")).toBe("JumperSim.jsim");
    expect(safeText('a"b<c>&d')).toBe("abcd");
  });
});
