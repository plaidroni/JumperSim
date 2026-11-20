import { fetchWeatherApi } from "openmeteo";
import { WeatherLevel, WeatherState, isaHeightM } from "./WeatherState";
import { deriveWeather } from "./Derive";

/**
 * Open-Meteo forecast request and response → WeatherState
 * (specs/weather-clouds-visibility.md §4.1, Appendix B).
 *
 * "Now" is the `current` block: the current 15-minute step, including the winds
 * aloft, in the dropzone's time zone. Values are read back by their variable's
 * position in the lists below, never by hand-numbered indices.
 */

export const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";

export const LEVELS = [1000, 975, 950, 925, 900, 850, 800, 700, 600, 500, 400, 300, 250, 200] as const;
/** Pressure levels used for the jump's wind profile (physics, wind tower, widget). */
export const JUMP_LEVELS_HPA: readonly number[] = [1000, 975, 950, 925, 900, 850, 800, 700, 600, 500];
const LEVEL_VARS = [
  "wind_speed",
  "wind_direction",
  "cloud_cover",
  "relative_humidity",
  "temperature",
  "geopotential_height",
] as const;

const SURFACE_NOW = [
  "temperature_2m",
  "dew_point_2m",
  "relative_humidity_2m",
  "weather_code",
  "is_day",
  "cloud_cover",
  "cloud_cover_low",
  "cloud_cover_mid",
  "cloud_cover_high",
  "visibility",
  "precipitation",
  "rain",
  "showers",
  "snowfall",
  "precipitation_probability",
  "freezing_level_height",
  "cape",
  "lifted_index",
  "convective_inhibition",
  "boundary_layer_height",
  "wind_speed_10m",
  "wind_direction_10m",
  "wind_gusts_10m",
  "surface_pressure",
  "pressure_msl",
] as const;

export const NOW_VARS: string[] = [
  ...SURFACE_NOW,
  ...LEVELS.flatMap((p) => LEVEL_VARS.map((v) => `${v}_${p}hPa`)),
];
export const MINUTELY_15_VARS = [
  "precipitation",
  "rain",
  "showers",
  "snowfall",
  "visibility",
  "weather_code",
  "cloud_cover",
  "freezing_level_height",
] as const;
export const HOURLY_VARS = [
  "cloud_cover",
  "cloud_cover_low",
  "cloud_cover_mid",
  "cloud_cover_high",
  "precipitation",
  "precipitation_probability",
  "visibility",
  "weather_code",
  "wind_speed_10m",
  "wind_gusts_10m",
] as const;

export interface DropzoneRef {
  name: string;
  latitude: number;
  longitude: number;
}

export function requestParams(dz: DropzoneRef) {
  return {
    latitude: dz.latitude,
    longitude: dz.longitude,
    timezone: "auto",
    current: NOW_VARS,
    minutely_15: MINUTELY_15_VARS,
    past_minutely_15: 4,
    forecast_minutely_15: 8,
    hourly: HOURLY_VARS,
    past_hours: 1,
    forecast_hours: 12,
    wind_speed_unit: "ms",
    temperature_unit: "celsius",
    precipitation_unit: "mm",
  };
}

// ------------------------------------------------------------------ response shape
// The parts of the SDK's WeatherApiResponse we read (structural, so tests can mock it).

interface VariableLike {
  value(): number;
  valuesArray(): Float32Array | ArrayLike<number> | null;
}
interface BlockLike {
  time(): bigint | number;
  timeEnd(): bigint | number;
  interval(): number;
  variables(index: number): VariableLike | null;
}
export interface ResponseLike {
  timezone(): string | null;
  elevation(): number;
  current(): BlockLike | null;
  minutely15(): BlockLike | null;
  hourly(): BlockLike | null;
}

export async function fetchWeather(dz: DropzoneRef, signal?: AbortSignal): Promise<WeatherState> {
  const responses = await fetchWeatherApi(FORECAST_URL, requestParams(dz), 3, 0.2, 2, { signal });
  if (!responses.length) throw new Error("Open-Meteo returned no data");
  return parseWeather(responses[0] as unknown as ResponseLike, dz, Date.now());
}

/** Turn an Open-Meteo response into a WeatherState. */
export function parseWeather(response: ResponseLike, dz: DropzoneRef, fetchedAt: number): WeatherState {
  const current = response.current();
  if (!current) throw new Error("Open-Meteo response has no current block");
  const interval = current.interval() || 900;
  const now = (name: string) => {
    const i = NOW_VARS.indexOf(name);
    const v = i >= 0 ? current.variables(i)?.value() : NaN;
    return v === undefined || v === null ? NaN : Number(v);
  };
  const perHour = 3600 / interval;
  const elevationM = Number(response.elevation());

  const surfacePressureHpa = now("surface_pressure");
  const levels: WeatherLevel[] = [];
  for (const hpa of LEVELS) {
    const windMs = now(`wind_speed_${hpa}hPa`);
    const windFromDeg = now(`wind_direction_${hpa}hPa`);
    if (!Number.isFinite(windMs) || !Number.isFinite(windFromDeg)) continue; // model has no level
    if (Number.isFinite(surfacePressureHpa) && hpa >= surfacePressureHpa) continue; // underground
    const gh = now(`geopotential_height_${hpa}hPa`);
    const mslM = Number.isFinite(gh) ? gh : isaHeightM(hpa);
    const aglM = mslM - (Number.isFinite(elevationM) ? elevationM : 0);
    if (aglM < 10) continue;
    levels.push({
      hpa,
      mslM,
      aglM,
      windMs,
      windFromDeg,
      tempC: now(`temperature_${hpa}hPa`),
      rhPct: now(`relative_humidity_${hpa}hPa`),
      cloudPct: now(`cloud_cover_${hpa}hPa`),
    });
  }
  levels.sort((a, b) => a.aglM - b.aglM);

  const m15 = readSeries(response.minutely15(), MINUTELY_15_VARS);
  const m15PerHour = 3600 / (m15.interval || 900);
  const hr = readSeries(response.hourly(), HOURLY_VARS);

  return deriveWeather({
    dz: { name: dz.name, lat: dz.latitude, lon: dz.longitude },
    validTime: Number(current.time()) * 1000,
    fetchedAt,
    timezone: response.timezone() || "UTC",
    elevationM,
    surface: {
      tempC: now("temperature_2m"),
      dewPointC: now("dew_point_2m"),
      rhPct: now("relative_humidity_2m"),
      windMs: now("wind_speed_10m"),
      windFromDeg: now("wind_direction_10m"),
      gustMs: now("wind_gusts_10m"),
      pressureMslHpa: now("pressure_msl"),
      surfacePressureHpa,
      isDay: now("is_day") === 1,
      weatherCode: now("weather_code"),
      capeJkg: now("cape"),
      liftedIndex: now("lifted_index"),
      cinJkg: now("convective_inhibition"),
      boundaryLayerM: now("boundary_layer_height"),
      freezingLevelMslM: now("freezing_level_height"),
    },
    clouds: {
      totalPct: now("cloud_cover"),
      lowPct: now("cloud_cover_low"),
      midPct: now("cloud_cover_mid"),
      highPct: now("cloud_cover_high"),
      layers: [],
      ceilingAglM: null,
    },
    precip: {
      mmPerH: now("precipitation") * perHour,
      rainMmPerH: now("rain") * perHour,
      showersMmPerH: now("showers") * perHour,
      snowCmPerH: now("snowfall") * perHour,
      probabilityPct: now("precipitation_probability"),
      kind: "none",
      intensity: 0,
    },
    visibilityM: now("visibility"),
    levels,
    trend15: {
      time: m15.time,
      precipMmPerH: m15.get("precipitation").map((v) => v * m15PerHour),
      visibilityM: m15.get("visibility"),
      cloudPct: m15.get("cloud_cover"),
      weatherCode: m15.get("weather_code"),
    },
    trendHourly: {
      time: hr.time,
      totalPct: hr.get("cloud_cover"),
      lowPct: hr.get("cloud_cover_low"),
      midPct: hr.get("cloud_cover_mid"),
      highPct: hr.get("cloud_cover_high"),
      precipProbabilityPct: hr.get("precipitation_probability"),
      visibilityM: hr.get("visibility"),
      weatherCode: hr.get("weather_code"),
    },
  });
}

function readSeries(block: BlockLike | null, names: readonly string[]) {
  if (!block) return { time: [] as number[], interval: 0, get: (_: string) => [] as number[] };
  const start = Number(block.time());
  const step = block.interval();
  const count = step > 0 ? Math.max(0, Math.round((Number(block.timeEnd()) - start) / step)) : 0;
  const time = Array.from({ length: count }, (_, i) => (start + i * step) * 1000);
  return {
    time,
    interval: step,
    get(name: string): number[] {
      const i = names.indexOf(name);
      const arr = i >= 0 ? block.variables(i)?.valuesArray() : null;
      return arr ? Array.from(arr as ArrayLike<number>, Number) : time.map(() => NaN);
    },
  };
}
