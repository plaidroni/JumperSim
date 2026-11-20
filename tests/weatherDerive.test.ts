import { describe, expect, it } from "vitest";
import { coverLabel, deriveCloudLayers, lclAglM, oktas } from "../src/js/weather/CloudLayers";
import { jumpConditions, minimumsAt } from "../src/js/weather/Conditions";
import { deriveWeather } from "../src/js/weather/Derive";
import { precipIntensity, precipKind } from "../src/js/weather/Precipitation";
import type { WeatherLevel, WeatherState } from "../src/js/weather/WeatherState";

/**
 * Cloud layers, precipitation and jump conditions
 * (specs/weather-clouds-visibility.md §4.4, §4.5, §6.8). The New England and Voss
 * profiles were recorded from the live API on 2026-11-20.
 */

const FT = 0.3048;

type Lv = [hpa: number, mslM: number, rh: number, cc?: number];

function makeState(o: {
  elevationM: number;
  levels: Lv[];
  low?: number;
  mid?: number;
  high?: number;
  total?: number;
  code?: number;
  tempC?: number;
  dewPointC?: number;
  rh2m?: number;
  cape?: number;
  li?: number;
  blh?: number;
  vis?: number;
  rain?: number;
  showers?: number;
  snow?: number;
}): WeatherState {
  const levels: WeatherLevel[] = o.levels
    .filter(([, msl]) => msl - o.elevationM >= 10)
    .map(([hpa, mslM, rh, cc]) => ({
      hpa,
      mslM,
      aglM: mslM - o.elevationM,
      windMs: 10,
      windFromDeg: 270,
      tempC: 0,
      rhPct: rh,
      cloudPct: cc ?? 0,
    }));
  const rain = o.rain ?? 0;
  const showers = o.showers ?? 0;
  return deriveWeather({
    dz: { name: "test", lat: 0, lon: 0 },
    validTime: 0,
    fetchedAt: 0,
    timezone: "UTC",
    elevationM: o.elevationM,
    surface: {
      tempC: o.tempC ?? 15,
      dewPointC: o.dewPointC ?? 5,
      rhPct: o.rh2m ?? 50,
      windMs: 3,
      windFromDeg: 270,
      gustMs: 5,
      pressureMslHpa: 1013,
      surfacePressureHpa: 1000,
      isDay: true,
      weatherCode: o.code ?? 0,
      capeJkg: o.cape ?? 0,
      liftedIndex: o.li ?? 5,
      cinJkg: 0,
      boundaryLayerM: o.blh ?? 500,
      freezingLevelMslM: 3000,
    },
    clouds: {
      totalPct: o.total ?? Math.max(o.low ?? 0, o.mid ?? 0, o.high ?? 0),
      lowPct: o.low ?? 0,
      midPct: o.mid ?? 0,
      highPct: o.high ?? 0,
      layers: [],
      ceilingAglM: null,
    },
    precip: {
      mmPerH: rain + showers,
      rainMmPerH: rain,
      showersMmPerH: showers,
      snowCmPerH: o.snow ?? 0,
      probabilityPct: 0,
      kind: "none",
      intensity: 0,
    },
    visibilityM: o.vis ?? 30000,
    levels,
    trend15: { time: [], precipMmPerH: [], visibilityM: [], cloudPct: [], weatherCode: [] },
    trendHourly: {
      time: [],
      totalPct: [],
      lowPct: [],
      midPct: [],
      highPct: [],
      precipProbabilityPct: [],
      visibilityM: [],
      weatherCode: [],
    },
  });
}

// Skydive New England, 2026-11-20 03:15 UTC: mid 45%, high 41%, every level's cloud
// cover ≤ 3%; humidity peaks at 400 hPa and 250 hPa.
const NEW_ENGLAND: Lv[] = [
  [1000, 195, 33], [975, 404, 21], [950, 622, 17], [925, 845, 15], [900, 1074, 12],
  [850, 1549, 7], [800, 2049, 6], [700, 3135, 8], [600, 4363, 8], [500, 5769, 27],
  [400, 7409, 72, 3], [300, 9400, 52], [250, 10606, 58], [200, 12026, 33],
];
// Skydive Voss, same time: low 20%, ECMWF-style levels (no 975/950/900/800 hPa).
const VOSS: Lv[] = [
  [1000, -21, 95, 33], [925, 598, 94, 41], [850, 1260, 70], [700, 2755, 43],
  [600, 3903, 11], [500, 5214, 60], [400, 6754, 87, 33], [300, 8644, 60], [250, 9817, 18], [200, 11253, 5],
];
const DRY: Lv[] = NEW_ENGLAND.map(([h, z]) => [h, z, 30]);

describe("cloud layers", () => {
  it("draws nothing on a clear day (Perris, 2026-11-20)", () => {
    const s = makeState({ elevationM: 431, levels: DRY });
    expect(s.clouds.layers).toEqual([]);
    expect(s.clouds.ceilingAglM).toBeNull();
  });

  it("places mid and high cloud at the humidity peaks (Skydive New England)", () => {
    const s = makeState({ elevationM: 97, levels: NEW_ENGLAND, mid: 45, high: 41, total: 44, tempC: 4.5, dewPointC: -4.8 });
    const [mid, high] = s.clouds.layers;
    expect(s.clouds.layers).toHaveLength(2);
    expect(mid.band).toBe("mid");
    expect(mid.type).toBe("altocumulus");
    expect(mid.baseAglM + 97).toBeGreaterThan(6500);
    expect(mid.topAglM + 97).toBeLessThanOrEqual(8000);
    expect(mid.baseAglM + 97).toBeLessThan(7409); // contains the 400 hPa peak
    expect(high.band).toBe("high");
    expect(high.type).toBe("cirrus");
    expect(high.baseAglM + 97).toBeGreaterThanOrEqual(8000);
    expect(high.topAglM - high.baseAglM).toBeLessThanOrEqual(3000);
    expect(high.baseAglM + 97).toBeLessThan(10606);
    expect(high.topAglM + 97).toBeGreaterThan(10606);
    expect(s.clouds.ceilingAglM).toBeNull(); // SCT/SCT
  });

  it("puts a low layer's open base at the condensation level (Skydive Voss)", () => {
    const s = makeState({ elevationM: 104, levels: VOSS, low: 20, total: 2, tempC: -8.9, dewPointC: -11.9 });
    const [low] = s.clouds.layers;
    expect(low.band).toBe("low");
    expect(low.type).toBe("stratocumulus");
    expect(low.baseAglM).toBeCloseTo(lclAglM(-8.9, -11.9)); // 375 m
    // top where humidity drops below 84% between 925 hPa (94%) and 850 hPa (70%)
    expect(low.topAglM + 104).toBeCloseTo(598 + (1260 - 598) * (10 / 24), 0);
  });

  it("makes low overcast near the ground stratus and sets the ceiling", () => {
    const levels: Lv[] = [[1000, 110, 98, 80], [975, 330, 97, 70], [950, 540, 93], [925, 760, 80], [850, 1480, 50], [700, 3100, 40]];
    const s = makeState({ elevationM: 20, levels, low: 95, tempC: 10, dewPointC: 9.4, code: 3 });
    const [low] = s.clouds.layers;
    expect(low.type).toBe("stratus");
    expect(low.baseAglM).toBeLessThan(600);
    expect(s.clouds.ceilingAglM).toBe(low.baseAglM);
  });

  it("builds convective cloud from the condensation level up to the moist air", () => {
    const levels: Lv[] = [[925, 760, 60], [850, 1480, 75], [700, 3100, 80], [600, 4300, 72], [500, 5700, 40]];
    const s = makeState({ elevationM: 20, levels, low: 40, tempC: 26, dewPointC: 14, cape: 900, li: -3, code: 81, showers: 6 });
    const [low] = s.clouds.layers;
    expect(low.type).toBe("cumulus");
    expect(low.baseAglM).toBeCloseTo(1500); // 125 m × 12 °C
    expect(low.topAglM + 20).toBeCloseTo(4300);
    expect(low.precipitating).toBe(true);
    const storm = makeState({ elevationM: 20, levels, low: 60, tempC: 26, dewPointC: 14, cape: 2000, code: 95, showers: 20 });
    expect(storm.clouds.layers[0].type).toBe("cumulonimbus");
  });

  it("merges touching low and mid layers into nimbostratus in steady rain", () => {
    const levels: Lv[] = [[925, 760, 95], [850, 1480, 96], [700, 3100, 95], [600, 4300, 94], [500, 5700, 60]];
    const s = makeState({ elevationM: 20, levels, low: 100, mid: 90, code: 63, rain: 5, tempC: 12, dewPointC: 11 });
    expect(s.clouds.layers).toHaveLength(1);
    expect(s.clouds.layers[0].type).toBe("nimbostratus");
    expect(s.clouds.layers[0].precipitating).toBe(true);
    expect(s.precip.kind).toBe("rain");
  });

  it("adds a fog layer for fog codes", () => {
    const s = makeState({ elevationM: 20, levels: DRY, code: 45, vis: 300, blh: 150, rh2m: 100 });
    expect(s.clouds.layers[0]).toMatchObject({ band: "fog", type: "fog", coverPct: 100, baseAglM: 0, topAglM: 150 });
    expect(s.clouds.ceilingAglM).toBeNull(); // fog isn't a ceiling layer
  });

  it("drifts each layer downwind", () => {
    const s = makeState({ elevationM: 97, levels: NEW_ENGLAND, mid: 45 });
    // 10 m/s from 270° blows toward +X (east)
    expect(s.clouds.layers[0].drift.x).toBeCloseTo(10);
    expect(s.clouds.layers[0].drift.z).toBeCloseTo(0);
  });

  it("labels cover in oktas", () => {
    expect([10, 40, 60, 90, 100].map(coverLabel)).toEqual(["FEW", "SCT", "BKN", "BKN", "OVC"]);
    expect(oktas(37.5)).toBe(3);
  });
});

describe("precipitation", () => {
  it("takes the kind from the weather code, then the amounts", () => {
    const none = { mmPerH: 0, showersMmPerH: 0, snowCmPerH: 0 };
    expect(precipKind(53, none)).toBe("drizzle");
    expect(precipKind(63, none)).toBe("rain");
    expect(precipKind(81, none)).toBe("showers");
    expect(precipKind(73, none)).toBe("snow");
    expect(precipKind(95, none)).toBe("thunderstorm");
    expect(precipKind(3, { ...none, mmPerH: 1 })).toBe("rain");
    expect(precipKind(0, none)).toBe("none");
  });

  it("maps rates to intensity", () => {
    expect(precipIntensity("rain", 2.5, 0)).toBeCloseTo(0.4);
    expect(precipIntensity("rain", 7.6, 0)).toBeCloseTo(0.75);
    expect(precipIntensity("rain", 50, 0)).toBe(1);
    expect(precipIntensity("drizzle", 5, 0)).toBe(0.3);
    expect(precipIntensity("none", 5, 0)).toBe(0);
  });
});

describe("jump conditions (14 CFR 105.17)", () => {
  const exit = (ftMsl: number, elev: number) => ftMsl * FT - elev;

  it("uses the altitude bands", () => {
    expect(minimumsAt(1000 * FT, 0).visSm).toBe(3);
    expect(minimumsAt(9500 * FT, 0).visSm).toBe(3);
    expect(minimumsAt(10000 * FT, 0)).toMatchObject({ visSm: 5, belowFt: 1000, horizontal: "1 sm" });
    // ≥ 10,000 ft MSL but ≤ 1,200 ft AGL: still 3 sm
    expect(minimumsAt(1000 * FT, 3200).visSm).toBe(3);
  });

  it("checks visibility at the exit altitude", () => {
    const s = makeState({ elevationM: 0, levels: DRY, vis: 4 * 1609.344 });
    const high = jumpConditions(s, exit(13000, 0), true).items[0];
    expect(high.status).toBe("fail");
    expect(high.text).toContain("5 sm needed");
    expect(jumpConditions(s, exit(9500, 0), true).items[0].status).toBe("ok");
  });

  it("flags cloud below and near the exit", () => {
    const levels: Lv[] = [[1000, 110, 98, 80], [975, 330, 97, 70], [950, 540, 93], [925, 760, 80], [850, 1480, 50], [700, 3100, 40]];
    const ovc = makeState({ elevationM: 20, levels, low: 95, tempC: 10, dewPointC: 9.4, code: 3 });
    const items = jumpConditions(ovc, 4000, true).items;
    expect(items.some((i) => i.status === "fail" && i.text.includes("no way through"))).toBe(true);
    const sct = makeState({ elevationM: 20, levels, low: 40, tempC: 10, dewPointC: 9.4 });
    expect(jumpConditions(sct, 4000, true).items.some((i) => i.status === "warn" && i.text.includes("2,000 ft"))).toBe(true);
    const clear = makeState({ elevationM: 20, levels: DRY });
    expect(jumpConditions(clear, 4000, true).items.at(-1)).toMatchObject({ status: "ok" });
  });

  it("gives values only outside the US", () => {
    const s = makeState({ elevationM: 0, levels: DRY, vis: 2000 });
    const r = jumpConditions(s, 4000, false);
    expect(r.rule).toBe("none");
    expect(r.items.every((i) => i.status === "info")).toBe(true);
  });
});

describe("dev overrides and display settings", () => {
  it("applies a preset on top of the fetched weather and re-derives", async () => {
    const { applyOverride, resolveOverride, WEATHER_PRESETS } = await import("../src/js/weather/Overrides");
    const base = makeState({ elevationM: 97, levels: NEW_ENGLAND, mid: 45, high: 41 });
    const fog = applyOverride(base, WEATHER_PRESETS.fog, "fog");
    expect(fog.override).toBe("fog");
    expect(fog.clouds.layers[0].band).toBe("fog");
    expect(fog.visibilityM).toBe(300);
    expect(fog.levels).toEqual(base.levels); // winds untouched
    expect(base.override).toBeUndefined(); // the fetched state isn't changed
    const rain = applyOverride(base, WEATHER_PRESETS["overcast-rain"], "overcast-rain");
    expect(rain.precip).toMatchObject({ kind: "rain", mmPerH: 5 });
    expect(rain.precip.intensity).toBeCloseTo(0.4 + (2.5 / 5.1) * 0.35);
    expect(() => resolveOverride("nope")).toThrow(/Unknown weather preset/);
  });

  it("keeps saved display settings sane", async () => {
    const { sanitizeDisplaySettings, WEATHER_DISPLAY_DEFAULTS } = await import("../src/js/weather/WeatherDisplay");
    expect(sanitizeDisplaySettings(null)).toEqual(WEATHER_DISPLAY_DEFAULTS);
    const s = sanitizeDisplaySettings({ clouds: false, quality: "ultra", layers: { mid: false, low: "yes" } });
    expect(s.clouds).toBe(false);
    expect(s.quality).toBe("medium");
    expect(s.layers).toEqual({ fog: true, low: true, mid: false, high: true });
  });
});
