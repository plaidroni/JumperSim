import { describe, expect, it } from "vitest";
import {
  combinedSample,
  sampleChannel,
  generateCoverageMap,
  seedFromName,
  thresholdFor,
} from "../src/js/visuals/weather/coverageNoise";

/**
 * The coverage map clouds the forecast share of the sky
 * (specs/weather-clouds-visibility.md §5.2, acceptance A4).
 */

const map = generateCoverageMap(seedFromName("Skydive Perris"), 256);

/** Share of a region (one tile, sampled on a fresh grid) above the threshold for `cover`. */
function cloudedShare(ch: number, cover: number) {
  const t = thresholdFor(map.quantiles[ch], cover);
  let hit = 0;
  const n = 150;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) if (combinedSample(map, ch, (x + 0.37) / n, (y + 0.61) / n) > t) hit++;
  return hit / (n * n);
}

describe("coverage map", () => {
  it("clouds the forecast share of the sky in every band (A4)", () => {
    for (const ch of [0, 1, 2, 3]) {
      for (const cover of [0.1, 0.3, 0.6, 0.9]) {
        expect(Math.abs(cloudedShare(ch, cover) - cover)).toBeLessThan(0.05);
      }
    }
  });

  it("draws nothing at 0% and everything at 100%", () => {
    expect(cloudedShare(0, 0)).toBe(0);
    expect(cloudedShare(0, 1)).toBe(1);
  });

  it("is tileable and repeatable", () => {
    // the map itself tiles; the shader's second, rotated sample breaks up the repeat
    expect(sampleChannel(map, 0, 0.25, 0.5)).toBeCloseTo(sampleChannel(map, 0, 1.25, -0.5), 6);
    const again = generateCoverageMap(seedFromName("Skydive Perris"), 256);
    expect(Array.from(again.data.slice(0, 64))).toEqual(Array.from(map.data.slice(0, 64)));
  });
});

describe("cloud layers for the raymarch", () => {
  it("drifts with the wind on the sim clock and follows the toggles (A6)", async () => {
    const { CloudVolume } = await import("../src/js/visuals/weather/CloudVolume");
    const { WEATHER_DISPLAY_DEFAULTS } = await import("../src/js/weather/WeatherDisplay");
    const cv = new CloudVolume();
    (cv as any).seedKey = "Skydive Perris";
    cv.coverage = { map, texture: null as any };
    const kt20 = 20 * 0.514444; // m/s
    const layer = (band: "low" | "mid", base: number, drift: number) => ({
      band, type: band === "low" ? "cumulus" : "altocumulus", coverPct: 40,
      baseAglM: base, topAglM: base + 800, drift: { x: drift, z: 0 }, precipitating: band === "low",
    });
    const state: any = {
      dz: { name: "Skydive Perris" },
      clouds: { layers: [layer("low", 1200, kt20), layer("mid", 5000, 15)] },
      precip: { intensity: 0.5, kind: "showers" },
    };
    const display = { ...WEATHER_DISPLAY_DEFAULTS, layers: { ...WEATHER_DISPLAY_DEFAULTS.layers } };
    cv.update(0, state, display, 60); // dt 0: layers start fully grown
    expect(cv.count).toBe(2);
    expect(cv.b[0].x).toBeCloseTo(617, 0); // 20 kt × 60 s, downwind (+X)
    expect(cv.a[0].x).toBe(1200);
    expect(cv.a[0].z).toBeCloseTo(thresholdFor(map.quantiles[0], 0.4));
    expect(cv.rain.w).toBe(1); // showers fall from the low layer...
    expect(cv.rain.z).toBeGreaterThan(cv.a[0].z); // ...only under its densest cells
    cv.update(0, state, display, 120);
    expect(cv.b[0].x).toBeCloseTo(1235, 0); // same sim time → same place, later → further
    display.layers.mid = false;
    for (let i = 0; i < 60; i++) cv.update(0.5, state, display, 120);
    expect(cv.count).toBe(1);
    display.clouds = false;
    for (let i = 0; i < 60; i++) cv.update(0.5, state, display, 120);
    expect(cv.count).toBe(0);
  });
});
