import type { CloudBand } from "./WeatherState";

/**
 * What the 3D view draws for the weather (specs/weather-clouds-visibility.md §7).
 * One store, driven by the Weather tab and the menubar's Weather menu, saved in
 * localStorage. Turning something off skips the work, it doesn't draw it invisibly.
 */

export type WeatherQuality = "low" | "medium" | "high";

export interface WeatherDisplaySettings {
  clouds: boolean;
  layers: Record<CloudBand, boolean>;
  cloudShadows: boolean;
  precipitation: boolean;
  darken: boolean;
  haze: boolean;
  visibilityRing: boolean;
  plannerClouds: boolean;
  quality: WeatherQuality;
}

export const WEATHER_DISPLAY_DEFAULTS: WeatherDisplaySettings = {
  clouds: true,
  layers: { fog: true, low: true, mid: true, high: true },
  cloudShadows: true,
  precipitation: true,
  darken: true,
  haze: true,
  visibilityRing: false,
  plannerClouds: false,
  quality: "medium",
};

const STORAGE_KEY = "jumpersim.weatherDisplay.v1";

type Listener = (s: WeatherDisplaySettings) => void;

function clone(s: WeatherDisplaySettings): WeatherDisplaySettings {
  return { ...s, layers: { ...s.layers } };
}

/** Merge saved JSON over the defaults, ignoring anything of the wrong type. */
export function sanitizeDisplaySettings(raw: unknown): WeatherDisplaySettings {
  const out = clone(WEATHER_DISPLAY_DEFAULTS);
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, any>;
  for (const k of ["clouds", "cloudShadows", "precipitation", "darken", "haze", "visibilityRing", "plannerClouds"] as const) {
    if (typeof r[k] === "boolean") out[k] = r[k];
  }
  if (r.layers && typeof r.layers === "object") {
    for (const b of ["fog", "low", "mid", "high"] as const) {
      if (typeof r.layers[b] === "boolean") out.layers[b] = r.layers[b];
    }
  }
  if (r.quality === "low" || r.quality === "medium" || r.quality === "high") out.quality = r.quality;
  return out;
}

class WeatherDisplayStore {
  private settings: WeatherDisplaySettings;
  private listeners = new Set<Listener>();

  constructor() {
    let saved: unknown = null;
    try {
      const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
      saved = raw ? JSON.parse(raw) : null;
    } catch {
      /* storage blocked or bad JSON: defaults */
    }
    this.settings = sanitizeDisplaySettings(saved);
  }

  get(): WeatherDisplaySettings {
    return clone(this.settings);
  }

  set(patch: Partial<Omit<WeatherDisplaySettings, "layers">> & { layers?: Partial<Record<CloudBand, boolean>> }) {
    const next = clone(this.settings);
    const { layers, ...rest } = patch;
    Object.assign(next, rest);
    if (layers) Object.assign(next.layers, layers);
    this.settings = sanitizeDisplaySettings(next);
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch {
      /* storage blocked: the setting lasts for this session */
    }
    const snapshot = this.get();
    this.listeners.forEach((fn) => {
      try {
        fn(snapshot);
      } catch (err) {
        console.error("weather display listener failed", err);
      }
    });
  }

  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

export const weatherDisplay = new WeatherDisplayStore();
(globalThis as any).weatherDisplay = weatherDisplay;
