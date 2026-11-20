import { describe, expect, it } from "vitest";
import {
  HOURLY_VARS,
  MINUTELY_15_VARS,
  NOW_VARS,
  ResponseLike,
  parseWeather,
  requestParams,
} from "../src/js/weather/OpenMeteoClient";
import { formatDzTime, isaHeightM } from "../src/js/weather/WeatherState";
import {
  SURFACE_LABEL,
  buildWindProfile,
  maxWindChangeMs,
  windAtHeight,
  windShears,
} from "../src/js/wind/WindProfile";

/**
 * Weather data (specs/weather-clouds-visibility.md §4): "now" comes from the current
 * 15-minute step, levels are placed at their geopotential height, and the jump wind
 * profile starts with the 10 m surface wind.
 */

const PERRIS = { name: "Skydive Perris", latitude: 33.7646, longitude: -117.219 };
// 2026-11-20 03:15 UTC = 2026-11-19 7:15 PM PST
const STEP_S = 1795144500;

function block(time: number, interval: number, count: number, values: Record<string, number | number[]>, names: readonly string[]) {
  return {
    time: () => BigInt(time),
    timeEnd: () => BigInt(time + interval * count),
    interval: () => interval,
    variables: (i: number) => {
      const v = values[names[i]];
      return {
        value: () => (typeof v === "number" ? v : NaN),
        valuesArray: () => (Array.isArray(v) ? Float32Array.from(v) : null),
      };
    },
  };
}

function mockResponse(now: Record<string, number>, elevation = 431): ResponseLike {
  return {
    timezone: () => "America/Los_Angeles",
    elevation: () => elevation,
    current: () => block(STEP_S, 900, 1, now, NOW_VARS),
    minutely15: () => block(STEP_S - 3600, 900, 12, { precipitation: Array(12).fill(0.5) }, MINUTELY_15_VARS),
    hourly: () => block(STEP_S - 4500, 3600, 13, { cloud_cover: Array(13).fill(40) }, HOURLY_VARS),
  };
}

const LEVEL = (hpa: number, speed: number, dir: number, gh?: number) => ({
  [`wind_speed_${hpa}hPa`]: speed,
  [`wind_direction_${hpa}hPa`]: dir,
  ...(gh === undefined ? {} : { [`geopotential_height_${hpa}hPa`]: gh }),
  [`temperature_${hpa}hPa`]: 10,
});

const NOW = {
  temperature_2m: 12,
  wind_speed_10m: 3,
  wind_direction_10m: 270,
  wind_gusts_10m: 7,
  surface_pressure: 965,
  precipitation: 0.5, // mm in the 15-minute step
  visibility: 17400,
  cloud_cover_low: 20,
  ...LEVEL(1000, 1, 0, 110), // higher pressure than the surface: underground
  ...LEVEL(975, 2, 0, 330), // also underground (975 > 965 hPa)
  ...LEVEL(950, 6, 250, 540),
  ...LEVEL(925, 8, 250), // no geopotential height: standard atmosphere
  ...LEVEL(850, 12, 260, 1485),
  ...LEVEL(500, 25, 270, 5800),
  ...LEVEL(300, 45, 270, 9400), // cloud level, not a jump level
};

describe("parseWeather", () => {
  const state = parseWeather(mockResponse(NOW), PERRIS, 1234);

  it("uses the current 15-minute step, not the first hourly sample", () => {
    expect(state.validTime).toBe(STEP_S * 1000);
    expect(new Date(state.validTime).toISOString()).toBe("2026-11-20T03:15:00.000Z");
    expect(state.timezone).toBe("America/Los_Angeles");
    expect(state.fetchedAt).toBe(1234);
  });

  it("labels the valid time in the dropzone's time zone", () => {
    expect(formatDzTime(state.validTime, state.timezone)).toMatch(/7:15\s?PM PST/);
    expect(formatDzTime(state.validTime, "Asia/Dubai")).toMatch(/7:15\s?AM GMT\+4/);
  });

  it("skips missing and underground levels and uses geopotential heights", () => {
    expect(state.levels.map((l) => l.hpa)).toEqual([950, 925, 850, 500, 300]);
    expect(state.levels.find((l) => l.hpa === 850)!.aglM).toBeCloseTo(1485 - 431);
    expect(state.levels.find((l) => l.hpa === 925)!.mslM).toBeCloseTo(isaHeightM(925));
  });

  it("turns 15-minute sums into hourly rates and reads series by time", () => {
    expect(state.precip.mmPerH).toBeCloseTo(2);
    expect(state.trend15.time).toHaveLength(12);
    expect(state.trend15.precipMmPerH[0]).toBeCloseTo(2);
    expect(state.trendHourly.time[0]).toBe((STEP_S - 4500) * 1000);
    expect(state.trendHourly.totalPct).toHaveLength(13);
  });

  it("asks for the current step in the dropzone's time zone", () => {
    const p = requestParams(PERRIS);
    expect(p.timezone).toBe("auto");
    expect(p.current).toContain("wind_speed_850hPa");
    expect(p.current).toContain("wind_direction_10m");
    expect(p.wind_speed_unit).toBe("ms");
  });
});

describe("jump wind profile", () => {
  const state = parseWeather(mockResponse(NOW), PERRIS, 0);
  const profile = buildWindProfile(state);

  it("starts with the 10 m surface wind and leaves out the cloud levels", () => {
    expect(profile[0].label).toBe(SURFACE_LABEL);
    expect(profile[0].heightM).toBe(10);
    expect(profile[0].speedKt).toBeCloseTo(3 * 1.943844);
    expect(profile.map((l) => l.label)).toEqual(["10m", "950hPa", "925hPa", "850hPa", "500hPa"]);
    expect(buildWindProfile(state, { allLevels: true }).at(-1)!.label).toBe("300hPa");
  });

  it("interpolates between the 10 m wind and the first pressure level", () => {
    const lo = profile[0].vector;
    const hi = profile[1].vector;
    const h = 50;
    const t = (h - 10) / (profile[1].heightM - 10);
    const w = windAtHeight(profile, h);
    expect(w.x).toBeCloseTo(lo.x + (hi.x - lo.x) * t);
    expect(w.z).toBeCloseTo(lo.z + (hi.z - lo.z) * t);
    // a westerly at the surface blows toward +X (east)
    expect(windAtHeight(profile, 2).x).toBeCloseTo(3);
  });

  it("does not flag the surface layer as shear", () => {
    expect(windShears(profile).some((s) => s.lower.label === SURFACE_LABEL)).toBe(false);
  });

  it("measures wind changes between updates", () => {
    const same = parseWeather(mockResponse(NOW), PERRIS, 0);
    expect(maxWindChangeMs(state, same)).toBe(0);
    const gusty = parseWeather(mockResponse({ ...NOW, wind_speed_10m: 4 }), PERRIS, 0);
    expect(maxWindChangeMs(state, gusty)).toBeCloseTo(1);
    const fewer = parseWeather(mockResponse({ ...NOW, wind_speed_500hPa: NaN }), PERRIS, 0);
    expect(maxWindChangeMs(state, fewer)).toBe(Infinity);
  });
});
