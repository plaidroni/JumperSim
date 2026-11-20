/**
 * Weather state shared by the physics, the wind tower, the Weather tab and (later)
 * the weather renderer. Numbers are SI; a value the model doesn't have is NaN.
 * See specs/weather-clouds-visibility.md §4.3.
 */

export interface WeatherLevel {
  hpa: number;
  /** Geopotential height (m MSL); the standard-atmosphere height if the model has none. */
  mslM: number;
  /** Height above the forecast ground (m). */
  aglM: number;
  windMs: number;
  windFromDeg: number;
  tempC: number;
  rhPct: number;
  cloudPct: number;
}

export interface WeatherSurface {
  tempC: number;
  dewPointC: number;
  rhPct: number;
  /** 10 m wind (m/s) and the direction it comes from (deg). */
  windMs: number;
  windFromDeg: number;
  gustMs: number;
  pressureMslHpa: number;
  surfacePressureHpa: number;
  isDay: boolean;
  weatherCode: number;
  capeJkg: number;
  liftedIndex: number;
  cinJkg: number;
  boundaryLayerM: number;
  freezingLevelMslM: number;
}

export type PrecipKind = "none" | "drizzle" | "rain" | "showers" | "snow" | "thunderstorm";

export type CloudBand = "fog" | "low" | "mid" | "high";
export type CloudType =
  | "fog"
  | "stratus"
  | "stratocumulus"
  | "cumulus"
  | "cumulonimbus"
  | "altocumulus"
  | "altostratus"
  | "nimbostratus"
  | "cirrus"
  | "cirrostratus";

/** One cloud layer to draw (weather/CloudLayers.ts). */
export interface CloudLayer {
  band: CloudBand;
  type: CloudType;
  coverPct: number;
  baseAglM: number;
  topAglM: number;
  /** Downwind drift (m/s) at mid-layer, +X east / −Z north. */
  drift: { x: number; z: number };
  precipitating: boolean;
}

export interface WeatherState {
  dz: { name: string; lat: number; lon: number };
  /** Start of the 15-minute step the values are for (epoch ms). */
  validTime: number;
  /** When the response arrived (epoch ms). */
  fetchedAt: number;
  /** IANA time zone of the dropzone, e.g. "America/Los_Angeles". */
  timezone: string;
  /** Elevation of the forecast grid cell (m MSL); the sim's y = 0. */
  elevationM: number;
  surface: WeatherSurface;
  clouds: {
    totalPct: number;
    lowPct: number;
    midPct: number;
    highPct: number;
    /** Derived layers, bottom to top (weather/CloudLayers.ts). */
    layers: CloudLayer[];
    /** Base of the lowest BKN/OVC layer (m AGL), or null. */
    ceilingAglM: number | null;
  };
  precip: {
    mmPerH: number;
    rainMmPerH: number;
    showersMmPerH: number;
    snowCmPerH: number;
    probabilityPct: number;
    kind: PrecipKind;
    /** 0–1 (specs/weather-clouds-visibility.md §4.5). */
    intensity: number;
  };
  /** Set when dev overrides (window.weatherDebug) changed this state. */
  override?: string;
  visibilityM: number;
  /** Valid pressure levels above the ground, bottom to top. */
  levels: WeatherLevel[];
  trend15: {
    time: number[];
    precipMmPerH: number[];
    visibilityM: number[];
    cloudPct: number[];
    weatherCode: number[];
  };
  trendHourly: {
    time: number[];
    totalPct: number[];
    lowPct: number[];
    midPct: number[];
    highPct: number[];
    precipProbabilityPct: number[];
    visibilityM: number[];
    weatherCode: number[];
  };
}

/**
 * The old string snapshot (`window.weatherSnapshotLog[0]`), kept for one release
 * for code outside the app that still reads it.
 * @deprecated read the weather store (weather/WeatherService.ts) instead.
 */
export type WeatherSnapshot = {
  time: string;
  elevationM?: number;
  temperature2m: string;
  /** "850hPa": "12 mph" */
  windSpeeds: { [key: string]: string };
  /** "850hPa": "220°" */
  windDirections: { [key: string]: string };
  visibility: string;
  cloudCover: { high: string; mid: string; low: string };
};

export const MS_TO_MPH = 2.236936;
export const M_TO_FT = 3.28084;
export const M_PER_STATUTE_MILE = 1609.344;

export const cToF = (c: number) => (c * 9) / 5 + 32;

/** International Standard Atmosphere height (m MSL) of a pressure level (hPa). */
export function isaHeightM(pressureHpa: number): number {
  return 44330.8 * (1 - Math.pow(pressureHpa / 1013.25, 0.190263));
}

/** "7:15 PM PST" in the dropzone's time zone. */
export function formatDzTime(epochMs: number, timezone: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: timezone,
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(epochMs);
  } catch {
    return new Date(epochMs).toUTCString();
  }
}

/** Build the deprecated string snapshot from a weather state. */
export function toLegacySnapshot(state: WeatherState): WeatherSnapshot {
  const windSpeeds: Record<string, string> = {
    "10m": `${(state.surface.windMs * MS_TO_MPH).toFixed(1)} mph`,
  };
  const windDirections: Record<string, string> = {
    "10m": `${state.surface.windFromDeg}°`,
  };
  for (const l of state.levels) {
    windSpeeds[`${l.hpa}hPa`] = `${(l.windMs * MS_TO_MPH).toFixed(1)} mph`;
    windDirections[`${l.hpa}hPa`] = `${l.windFromDeg}°`;
  }
  return {
    time: formatDzTime(state.validTime, state.timezone),
    elevationM: state.elevationM,
    temperature2m: `${cToF(state.surface.tempC).toFixed(1)} °F`,
    windSpeeds,
    windDirections,
    visibility: `${state.visibilityM} m`,
    cloudCover: {
      high: `${state.clouds.highPct}%`,
      mid: `${state.clouds.midPct}%`,
      low: `${state.clouds.lowPct}%`,
    },
  };
}
