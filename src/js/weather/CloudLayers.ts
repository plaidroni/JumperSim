import { buildWindProfile, windAtHeight } from "../wind/WindProfile";
import type { CloudBand, CloudLayer, CloudType, PrecipKind, WeatherLevel, WeatherState } from "./WeatherState";

/**
 * Cloud layers from the forecast profile (specs/weather-clouds-visibility.md §4.4).
 *
 * How much cloud each band has comes from the model's own low/mid/high cover. Where
 * it sits comes from the humidity profile: the per-level cloud cover is estimated
 * from humidity (Sundqvist) and often reads ~0 under real mid and high cloud, while
 * the humidity peak still marks the layer.
 */

/** Open-Meteo's bands (m MSL): low up to 3 km, mid 3–8 km, high above 8 km. */
const LOW_TOP_MSL = 3000;
const MID_TOP_MSL = 8000;
const HIGH_TOP_MSL = 13000;
/** At a high DZ the low band still reaches at least this far above the ground. */
const MIN_LOW_SPAN_M = 1500;
/** Below this cover (%) a band has no layer. */
const MIN_COVER_PCT = 2;
/** The layer is where humidity stays within this many points of its peak. */
const RH_BAND_PTS = 10;
const MIN_BASE_AGL_M = 60;
/** Low and mid layers closer than this become one deep layer. */
const MERGE_GAP_M = 300;

const THICKNESS: Record<"low" | "mid" | "high", { min: number; max: number }> = {
  low: { min: 300, max: 2500 },
  mid: { min: 400, max: 3000 },
  high: { min: 600, max: 3000 },
};

const RAINY: ReadonlySet<CloudType> = new Set([
  "stratus",
  "stratocumulus",
  "cumulus",
  "cumulonimbus",
  "nimbostratus",
  "altostratus",
]);

/** Round cover (%) to oktas (eighths of sky). */
export function oktas(coverPct: number): number {
  return Math.max(0, Math.min(8, Math.round(coverPct / 12.5)));
}

/** METAR-style amount: FEW (1–2 oktas), SCT (3–4), BKN (5–7), OVC (8). */
export function coverLabel(coverPct: number): "SKC" | "FEW" | "SCT" | "BKN" | "OVC" {
  if (!(coverPct > 0)) return "SKC";
  const o = oktas(coverPct);
  if (o <= 2) return "FEW";
  if (o <= 4) return "SCT";
  if (o <= 7) return "BKN";
  return "OVC";
}

/** Lifting condensation level above the ground: ≈ 125 m per °C of dew-point spread. */
export function lclAglM(tempC: number, dewPointC: number): number {
  const spread = tempC - dewPointC;
  if (!Number.isFinite(spread)) return 600;
  return Math.max(MIN_BASE_AGL_M, Math.min(4000, 125 * Math.max(0, spread)));
}

interface Extent {
  baseMsl: number;
  topMsl: number;
  peakMsl: number;
  /** No level below the peak inside the band, so the base isn't known from humidity. */
  openBelow: boolean;
}

/** Find the humid layer inside [lo, hi] m MSL. Null when no level in the band has humidity. */
function humidExtent(levels: WeatherLevel[], lo: number, hi: number): Extent | null {
  const inBand = (l: WeatherLevel | undefined) =>
    !!l && l.mslM >= lo && l.mslM <= hi && Number.isFinite(l.rhPct);
  const idx = levels.map((_, i) => i).filter((i) => inBand(levels[i]));
  if (!idx.length) return null;

  const withCloud = idx.filter((i) => levels[i].cloudPct > 0);
  const pool = withCloud.length ? withCloud : idx;
  const peak = pool.reduce((best, i) => {
    const a = levels[i];
    const b = levels[best];
    const ka = withCloud.length ? a.cloudPct : a.rhPct;
    const kb = withCloud.length ? b.cloudPct : b.rhPct;
    return ka > kb || (ka === kb && a.rhPct > b.rhPct) ? i : best;
  }, pool[0]);

  const thr = levels[peak].rhPct - RH_BAND_PTS;
  const cross = (a: WeatherLevel, b: WeatherLevel) =>
    a.mslM + ((b.mslM - a.mslM) * (a.rhPct - thr)) / (a.rhPct - b.rhPct);

  let baseMsl = lo;
  let openBelow = true;
  for (let i = peak; i > 0; i--) {
    const b = levels[i - 1];
    if (!inBand(b)) break;
    if (b.rhPct < thr) {
      baseMsl = cross(levels[i], b);
      openBelow = false;
      break;
    }
  }
  let topMsl = hi;
  for (let i = peak; i < levels.length - 1; i++) {
    const b = levels[i + 1];
    if (!inBand(b)) break;
    if (b.rhPct < thr) {
      topMsl = cross(levels[i], b);
      break;
    }
  }
  return { baseMsl, topMsl, peakMsl: levels[peak].mslM, openBelow };
}

/** Clamp a layer's thickness, keeping the humidity peak inside it. */
function fitThickness(e: { baseMsl: number; topMsl: number; peakMsl: number }, min: number, max: number) {
  let { baseMsl, topMsl } = e;
  if (topMsl - baseMsl > max) {
    const start = Math.min(Math.max(e.peakMsl - max / 2, baseMsl), topMsl - max);
    baseMsl = start;
    topMsl = start + max;
  }
  if (topMsl - baseMsl < min) {
    const mid = (baseMsl + topMsl) / 2;
    baseMsl = mid - min / 2;
    topMsl = mid + min / 2;
  }
  return { baseMsl, topMsl };
}

function lowType(state: WeatherState, coverPct: number, baseAglM: number): CloudType {
  const s = state.surface;
  const code = Math.round(s.weatherCode);
  const showers = state.precip.showersMmPerH > 0 || (code >= 80 && code <= 86);
  if ((code >= 95 && code <= 99) || (s.capeJkg >= 1000 && showers)) return "cumulonimbus";
  if (showers || (s.capeJkg >= 100 && s.liftedIndex < 0)) return "cumulus";
  if (coverPct >= 70 && baseAglM < 600) return "stratus";
  return "stratocumulus";
}

const isConvective = (t: CloudType) => t === "cumulus" || t === "cumulonimbus";

/** Cloud layers (bottom to top) and the ceiling for a weather state. */
export function deriveCloudLayers(
  state: WeatherState,
  kind: PrecipKind = state.precip.kind,
): { layers: CloudLayer[]; ceilingAglM: number | null } {
  const elev = Number.isFinite(state.elevationM) ? state.elevationM : 0;
  const levels = state.levels.slice().sort((a, b) => a.mslM - b.mslM);
  const c = state.clouds;
  const s = state.surface;
  const code = Math.round(s.weatherCode);
  const lcl = lclAglM(s.tempC, s.dewPointC);
  const lowTop = Math.max(LOW_TOP_MSL, elev + MIN_LOW_SPAN_M);
  const minBaseMsl = elev + MIN_BASE_AGL_M;

  type Draft = { band: CloudBand; type: CloudType; coverPct: number; baseMsl: number; topMsl: number };
  const drafts: Draft[] = [];

  // ---- low
  if (c.lowPct >= MIN_COVER_PCT) {
    const e = humidExtent(levels, elev, lowTop);
    let baseMsl: number;
    let topMsl: number;
    if (!e) {
      baseMsl = elev + lcl;
      topMsl = baseMsl + 800;
    } else {
      ({ baseMsl, topMsl } = fitThickness(e, THICKNESS.low.min, THICKNESS.low.max));
      if (e.openBelow) baseMsl = elev + lcl;
    }
    let type = lowType(state, c.lowPct, Math.max(0, baseMsl - elev));
    if (isConvective(type)) {
      // cumulus: base at the condensation level, tops up to the moist air (≤ 12 km)
      baseMsl = elev + lcl;
      const moistTop = levels
        .filter((l) => l.mslM > baseMsl && l.mslM <= 12000 && l.rhPct >= 70)
        .reduce((m, l) => Math.max(m, l.mslM), -Infinity);
      topMsl = Math.max(baseMsl + 800, Number.isFinite(moistTop) ? moistTop : -Infinity);
      if (type === "cumulus") topMsl = Math.min(topMsl, baseMsl + 4000);
    }
    baseMsl = Math.max(baseMsl, minBaseMsl);
    topMsl = Math.max(topMsl, baseMsl + THICKNESS.low.min);
    if (!isConvective(type)) type = lowType(state, c.lowPct, baseMsl - elev); // final base decides St vs Sc
    drafts.push({ band: "low", type, coverPct: c.lowPct, baseMsl, topMsl });
  }

  // ---- mid
  if (c.midPct >= MIN_COVER_PCT) {
    const e = humidExtent(levels, lowTop, MID_TOP_MSL);
    const { baseMsl, topMsl } = e
      ? fitThickness(e, THICKNESS.mid.min, THICKNESS.mid.max)
      : { baseMsl: 4000, topMsl: 5500 };
    drafts.push({
      band: "mid",
      type: c.midPct >= 60 ? "altostratus" : "altocumulus",
      coverPct: c.midPct,
      baseMsl: Math.max(baseMsl, minBaseMsl),
      topMsl,
    });
  }

  // ---- high
  if (c.highPct >= MIN_COVER_PCT) {
    const e = humidExtent(levels, MID_TOP_MSL, HIGH_TOP_MSL);
    const { baseMsl, topMsl } = e
      ? fitThickness(e, THICKNESS.high.min, THICKNESS.high.max)
      : { baseMsl: 9000, topMsl: 10500 };
    drafts.push({
      band: "high",
      type: c.highPct >= 50 ? "cirrostratus" : "cirrus",
      coverPct: c.highPct,
      baseMsl: Math.max(baseMsl, minBaseMsl),
      topMsl,
    });
  }

  // ---- merge a low and mid layer that touch (a deep rain layer)
  const low = drafts.find((d) => d.band === "low");
  const mid = drafts.find((d) => d.band === "mid");
  if (low && mid && mid.baseMsl - low.topMsl < MERGE_GAP_M) {
    const steadyRain = code >= 61 && code <= 65 && c.midPct >= 80;
    low.topMsl = Math.max(low.topMsl, mid.topMsl);
    low.coverPct = Math.max(low.coverPct, mid.coverPct);
    if (steadyRain) low.type = "nimbostratus";
    drafts.splice(drafts.indexOf(mid), 1);
  }

  // ---- fog
  const foggy = code === 45 || code === 48 || (s.rhPct >= 95 && state.visibilityM < 1000);
  if (foggy) {
    const top = Math.min(300, Math.max(100, Number.isFinite(s.boundaryLayerM) ? s.boundaryLayerM : 150));
    drafts.unshift({
      band: "fog",
      type: "fog",
      coverPct: code === 45 || code === 48 ? 100 : 60,
      baseMsl: elev,
      topMsl: elev + top,
    });
  }

  const profile = buildWindProfile(state, { allLevels: true });
  let rainAssigned = kind === "none";
  const layers: CloudLayer[] = drafts
    .sort((a, b) => a.baseMsl - b.baseMsl)
    .map((d) => {
      const baseAglM = Math.max(0, d.baseMsl - elev);
      const topAglM = Math.max(baseAglM + 1, d.topMsl - elev);
      const v = windAtHeight(profile, (baseAglM + topAglM) / 2);
      const precipitating = !rainAssigned && RAINY.has(d.type);
      if (precipitating) rainAssigned = true;
      return {
        band: d.band,
        type: d.type,
        coverPct: d.coverPct,
        baseAglM,
        topAglM,
        drift: { x: v.x, z: v.z },
        precipitating,
      };
    });

  const ceiling = layers.find((l) => l.band !== "fog" && oktas(l.coverPct) >= 5);
  return { layers, ceilingAglM: ceiling ? ceiling.baseAglM : null };
}

export const CLOUD_TYPE_LABEL: Record<CloudType, { abbr: string; name: string }> = {
  fog: { abbr: "FG", name: "fog" },
  stratus: { abbr: "St", name: "stratus" },
  stratocumulus: { abbr: "Sc", name: "stratocumulus" },
  cumulus: { abbr: "Cu", name: "cumulus" },
  cumulonimbus: { abbr: "Cb", name: "cumulonimbus" },
  altocumulus: { abbr: "Ac", name: "altocumulus" },
  altostratus: { abbr: "As", name: "altostratus" },
  nimbostratus: { abbr: "Ns", name: "nimbostratus" },
  cirrus: { abbr: "Ci", name: "cirrus" },
  cirrostratus: { abbr: "Cs", name: "cirrostratus" },
};
