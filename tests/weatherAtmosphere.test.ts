import { describe, expect, it } from "vitest";
import {
  atmosphereTargets,
  darkenFactor,
  hazeSigma0,
  opticalDepth,
} from "../src/js/weather/Atmosphere";
import { WEATHER_PRESETS, applyOverride } from "../src/js/weather/Overrides";
import { parseWeather, ResponseLike, NOW_VARS } from "../src/js/weather/OpenMeteoClient";

/**
 * Haze from visibility and darkening in rain (specs/weather-clouds-visibility.md
 * §5.5–5.6, acceptance A7–A8). The composite shader repeats opticalDepth().
 */

const transmittance = (h0: number, h1: number, L: number, V: number, mixTop = 1000) =>
  Math.exp(-opticalDepth(h0, h1, L, hazeSigma0(V), mixTop));

describe("visibility haze", () => {
  it("follows Koschmieder at poor visibility (A8)", () => {
    // camera and target at the ground, inside the hazy layer
    expect(transmittance(2, 0, 2500, 5000)).toBeCloseTo(Math.exp(-1.956), 3); // 14 %
    expect(transmittance(2, 0, 5000, 5000)).toBeCloseTo(0.02, 3);
  });

  it("fades out for clear-day visibility", () => {
    expect(hazeSigma0(24000)).toBe(0);
    expect(hazeSigma0(60000)).toBe(0);
    expect(hazeSigma0(16000)).toBeGreaterThan(0);
    expect(hazeSigma0(16000)).toBeLessThan(3.912 / 16000);
    expect(hazeSigma0(NaN)).toBe(0);
  });

  it("thins above the mixed layer", () => {
    const sigma = hazeSigma0(5000);
    // a horizontal path 1 km above a 1 km mixed layer: e^-1 of the ground value
    expect(opticalDepth(2000, 2000, 1000, sigma, 1000)).toBeCloseTo(sigma * 1000 * Math.exp(-1), 6);
    // looking straight down from 4 km through a 1 km layer: 1 km at full strength
    // plus ∫ above = sigma · Hs · (1 − e^-3)
    const tau = opticalDepth(4000, 0, 4000, sigma, 1000, 1000);
    expect(tau).toBeCloseTo(sigma * 1000 + sigma * 1000 * (1 - Math.exp(-3)), 6);
    // the order of the end points doesn't matter
    expect(opticalDepth(0, 4000, 4000, sigma, 1000, 1000)).toBeCloseTo(tau, 9);
  });
});

describe("darkening", () => {
  it("darkens with rain and overcast (A7)", () => {
    expect(darkenFactor(0, 0)).toBe(0);
    expect(darkenFactor(0, 100)).toBeCloseTo(0.15);
    const d = darkenFactor(0.4 + (2.5 / 5.1) * 0.35, 100); // 5 mm/h under overcast
    expect(d).toBeCloseTo(0.41, 2);
    expect(darkenFactor(1, 100)).toBe(0.55);
  });
});

describe("atmosphere targets", () => {
  const now = Object.fromEntries(NOW_VARS.map((v) => [v, NaN]));
  const block = (values: Record<string, number>) => ({
    time: () => 0,
    timeEnd: () => 900,
    interval: () => 900,
    variables: (i: number) => ({ value: () => values[NOW_VARS[i]], valuesArray: () => null }),
  });
  const response: ResponseLike = {
    timezone: () => "UTC",
    elevation: () => 0,
    current: () => block({ ...now, visibility: 40000, cloud_cover: 0, precipitation: 0, weather_code: 0 }),
    minutely15: () => null,
    hourly: () => null,
  };
  const clear = parseWeather(response, { name: "t", latitude: 0, longitude: 0 }, 0);
  const rain = applyOverride(clear, WEATHER_PRESETS["overcast-rain"], "overcast-rain");
  const all = { haze: true, darken: true };

  it("draws nothing on a clear day", () => {
    const t = atmosphereTargets(clear, all);
    expect(t.sigma0).toBe(0);
    expect(t.darken).toBe(0);
    expect(t.tint.toArray()).toEqual([1, 1, 1]);
  });

  it("hazes and darkens in rain, and each toggle turns its part off", () => {
    const t = atmosphereTargets(rain, all);
    expect(t.sigma0).toBeCloseTo(3.912 / 6000, 6);
    expect(t.darken).toBeCloseTo(0.41, 2);
    expect(t.tint.x).toBeLessThan(1);
    expect(atmosphereTargets(rain, { haze: false, darken: true }).sigma0).toBe(0);
    const noDark = atmosphereTargets(rain, { haze: true, darken: false });
    expect(noDark.darken).toBe(0);
    expect(noDark.tint.toArray()).toEqual([1, 1, 1]);
  });
});
