import { deriveWeather } from "./Derive";
import type { WeatherState } from "./WeatherState";

/**
 * Dev overrides: try the weather visuals and panel without waiting for the right
 * weather (specs/weather-clouds-visibility.md §7). Applied on top of the fetched
 * weather; the winds the physics uses are never overridden.
 *
 *   weatherDebug.override("overcast-rain")
 *   weatherDebug.override({ lowPct: 70, rainMmPerH: 5, visibilityM: 3000 })
 *   weatherDebug.clear()
 *   ?weather=fog   (dev builds)
 */

export interface WeatherOverride {
  totalPct?: number;
  lowPct?: number;
  midPct?: number;
  highPct?: number;
  rainMmPerH?: number;
  showersMmPerH?: number;
  snowCmPerH?: number;
  precipProbabilityPct?: number;
  visibilityM?: number;
  weatherCode?: number;
  tempC?: number;
  dewPointC?: number;
  rhPct?: number;
  capeJkg?: number;
  liftedIndex?: number;
  boundaryLayerM?: number;
}

export const WEATHER_PRESETS: Record<string, WeatherOverride> = {
  clear: { totalPct: 0, lowPct: 0, midPct: 0, highPct: 0, rainMmPerH: 0, showersMmPerH: 0, snowCmPerH: 0, visibilityM: 40000, weatherCode: 0 },
  "stratus-drizzle": { lowPct: 95, midPct: 10, highPct: 0, totalPct: 95, rainMmPerH: 0.4, showersMmPerH: 0, weatherCode: 53, visibilityM: 3000, tempC: 10, dewPointC: 9.4, rhPct: 97, precipProbabilityPct: 80 },
  "cumulus-showers": { lowPct: 45, midPct: 20, highPct: 30, totalPct: 60, rainMmPerH: 0, showersMmPerH: 6, weatherCode: 81, visibilityM: 12000, tempC: 24, dewPointC: 14, capeJkg: 900, liftedIndex: -3, precipProbabilityPct: 60 },
  "overcast-rain": { lowPct: 100, midPct: 90, highPct: 50, totalPct: 100, rainMmPerH: 5, showersMmPerH: 0, weatherCode: 63, visibilityM: 6000, tempC: 12, dewPointC: 11, rhPct: 94, precipProbabilityPct: 95 },
  fog: { lowPct: 100, midPct: 0, highPct: 0, totalPct: 100, rainMmPerH: 0, showersMmPerH: 0, weatherCode: 45, visibilityM: 300, tempC: 8, dewPointC: 8, rhPct: 100, boundaryLayerM: 150 },
  cirrus: { lowPct: 0, midPct: 0, highPct: 40, totalPct: 40, rainMmPerH: 0, showersMmPerH: 0, weatherCode: 1, visibilityM: 30000 },
};

const has = (v: number | undefined): v is number => typeof v === "number" && Number.isFinite(v);

/** A copy of `state` with the override applied and the derived fields recomputed. */
export function applyOverride(state: WeatherState, o: WeatherOverride, name: string): WeatherState {
  const s: WeatherState = structuredClone(state);
  const c = s.clouds;
  if (has(o.lowPct)) c.lowPct = o.lowPct;
  if (has(o.midPct)) c.midPct = o.midPct;
  if (has(o.highPct)) c.highPct = o.highPct;
  c.totalPct = has(o.totalPct) ? o.totalPct : Math.max(c.lowPct, c.midPct, c.highPct);
  const p = s.precip;
  if (has(o.rainMmPerH)) p.rainMmPerH = o.rainMmPerH;
  if (has(o.showersMmPerH)) p.showersMmPerH = o.showersMmPerH;
  if (has(o.snowCmPerH)) p.snowCmPerH = o.snowCmPerH;
  if (has(o.rainMmPerH) || has(o.showersMmPerH) || has(o.snowCmPerH)) {
    const num = (v: number) => (Number.isFinite(v) ? v : 0);
    p.mmPerH = num(p.rainMmPerH) + num(p.showersMmPerH) + num(p.snowCmPerH) / 7;
  }
  if (has(o.precipProbabilityPct)) p.probabilityPct = o.precipProbabilityPct;
  if (has(o.visibilityM)) s.visibilityM = o.visibilityM;
  const sf = s.surface;
  if (has(o.weatherCode)) sf.weatherCode = o.weatherCode;
  if (has(o.tempC)) sf.tempC = o.tempC;
  if (has(o.dewPointC)) sf.dewPointC = o.dewPointC;
  if (has(o.rhPct)) sf.rhPct = o.rhPct;
  if (has(o.capeJkg)) sf.capeJkg = o.capeJkg;
  if (has(o.liftedIndex)) sf.liftedIndex = o.liftedIndex;
  if (has(o.boundaryLayerM)) sf.boundaryLayerM = o.boundaryLayerM;
  // the trends follow the override too, so the panel's bars and strips agree with it
  const t15 = s.trend15;
  const hr = s.trendHourly;
  const precipSet = has(o.rainMmPerH) || has(o.showersMmPerH) || has(o.snowCmPerH);
  if (precipSet) t15.precipMmPerH = t15.time.map(() => p.mmPerH);
  if (has(o.visibilityM)) {
    t15.visibilityM = t15.time.map(() => o.visibilityM!);
    hr.visibilityM = hr.time.map(() => o.visibilityM!);
  }
  if (has(o.weatherCode)) {
    t15.weatherCode = t15.time.map(() => o.weatherCode!);
    hr.weatherCode = hr.time.map(() => o.weatherCode!);
  }
  t15.cloudPct = t15.time.map(() => c.totalPct);
  hr.totalPct = hr.time.map(() => c.totalPct);
  hr.lowPct = hr.time.map(() => c.lowPct);
  hr.midPct = hr.time.map(() => c.midPct);
  hr.highPct = hr.time.map(() => c.highPct);
  if (has(o.precipProbabilityPct)) hr.precipProbabilityPct = hr.time.map(() => o.precipProbabilityPct!);
  s.override = name;
  return deriveWeather(s);
}

/** Resolve a preset name or an override object. Throws on an unknown preset. */
export function resolveOverride(input: string | WeatherOverride): { name: string; values: WeatherOverride } {
  if (typeof input === "string") {
    const values = WEATHER_PRESETS[input];
    if (!values) throw new Error(`Unknown weather preset "${input}". Try: ${Object.keys(WEATHER_PRESETS).join(", ")}`);
    return { name: input, values };
  }
  return { name: "custom", values: input };
}
