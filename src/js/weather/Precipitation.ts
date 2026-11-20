import type { PrecipKind } from "./WeatherState";

/**
 * Precipitation kind and intensity (specs/weather-clouds-visibility.md §4.5).
 * The WMO weather code decides the kind first; the amounts fill in when the code
 * says nothing (models don't always agree with themselves).
 */

export function precipKind(
  weatherCode: number,
  p: { mmPerH: number; showersMmPerH: number; snowCmPerH: number },
): PrecipKind {
  const c = Math.round(weatherCode);
  if (c >= 95 && c <= 99) return "thunderstorm";
  if (c >= 51 && c <= 57) return "drizzle";
  if (c >= 61 && c <= 67) return "rain";
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return "snow";
  if (c >= 80 && c <= 82) return "showers";
  if (p.snowCmPerH > 0) return "snow";
  if (p.showersMmPerH > 0.05) return "showers";
  if (p.mmPerH > 0.05) return "rain";
  return "none";
}

/** Piecewise-linear lookup on (x, y) breakpoints, flat outside them. */
function ramp(x: number, pts: Array<[number, number]>): number {
  if (!(x > 0)) return 0;
  if (x <= pts[0][0]) return (pts[0][1] * x) / pts[0][0];
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return pts[pts.length - 1][1];
}

/**
 * 0–1. Rain: 0.1 mm/h → 0.1, 2.5 → 0.4, 7.6 → 0.75, 25 → 1 (the AMS light /
 * moderate / heavy limits). Drizzle caps at 0.3. Snow uses cm/h of snowfall.
 */
export function precipIntensity(kind: PrecipKind, mmPerH: number, snowCmPerH: number): number {
  if (kind === "none") return 0;
  if (kind === "snow") {
    // Open-Meteo: cm of snow ÷ 7 = mm of water, so with no snowfall value use mm × 0.7
    const cm = snowCmPerH > 0 ? snowCmPerH : mmPerH * 0.7;
    return Math.max(0.15, ramp(cm, [[0.5, 0.3], [2, 0.7], [5, 1]]));
  }
  const rain = ramp(mmPerH, [[0.1, 0.1], [2.5, 0.4], [7.6, 0.75], [25, 1]]);
  const base = kind === "drizzle" ? Math.min(0.3, rain) : rain;
  // a precipitation code with a zero amount (models disagree): still show a little
  return Math.max(base, kind === "drizzle" ? 0.1 : 0.15);
}

/** Word for the panel: "light", "moderate" or "heavy". */
export function intensityWord(kind: PrecipKind, mmPerH: number, snowCmPerH: number): string {
  if (kind === "none") return "";
  if (kind === "snow") return snowCmPerH < 1 ? "light" : snowCmPerH < 4 ? "moderate" : "heavy";
  if (kind === "drizzle") return mmPerH < 0.25 ? "light" : mmPerH < 0.5 ? "moderate" : "dense";
  return mmPerH < 2.5 ? "light" : mmPerH < 7.6 ? "moderate" : "heavy";
}
