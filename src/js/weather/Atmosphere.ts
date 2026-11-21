import * as THREE from "three";
import { WEATHER_VISUALS as C } from "./config";
import type { WeatherDisplaySettings } from "./WeatherDisplay";
import type { WeatherState } from "./WeatherState";

/**
 * Haze from visibility and darkening in rain (specs/weather-clouds-visibility.md
 * §5.5–5.6). Pure: the weather renderer feeds these numbers to its composite shader,
 * which repeats `opticalDepth` in GLSL.
 */

export interface AtmosphereParams {
  /** Haze extinction at the ground (1/m); 0 = no haze. */
  sigma0: number;
  /** Top of the hazy mixed layer (m above the DZ). */
  mixTopM: number;
  /** Haze colour (linear), already darkened. */
  color: THREE.Color;
  /** 0–1: how much the environment is darkened. */
  darken: number;
  /** Per-channel multiplier for the rain tint (linear). */
  tint: THREE.Vector3;
}

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Koschmieder: visibility V (m, 2% contrast) → extinction 3.912 / V, faded out for clear-day values. */
export function hazeSigma0(visibilityM: number): number {
  if (!Number.isFinite(visibilityM) || visibilityM <= 0) return 0;
  const weight = 1 - smoothstep(C.hazeFullBelowM, C.hazeNoneAboveM, visibilityM);
  return (3.912 / Math.max(50, visibilityM)) * weight;
}

/** Darkening factor D from precipitation intensity (0–1) and total cover (%). */
export function darkenFactor(intensity: number, totalCoverPct: number): number {
  const i = Number.isFinite(intensity) ? intensity : 0;
  const cover = Number.isFinite(totalCoverPct) ? totalCoverPct / 100 : 0;
  return Math.min(C.darkenMax, C.darkenRain * i + C.darkenOvercast * smoothstep(0.6, 1, cover));
}

/** What the composite should draw for this weather and these settings. */
export function atmosphereTargets(
  state: WeatherState | null,
  display: Pick<WeatherDisplaySettings, "haze" | "darken">,
): AtmosphereParams {
  const out: AtmosphereParams = {
    sigma0: 0,
    mixTopM: 1000,
    color: new THREE.Color(C.hazeClearColor),
    darken: 0,
    tint: new THREE.Vector3(1, 1, 1),
  };
  if (!state) return out;

  if (display.darken) {
    out.darken = darkenFactor(state.precip.intensity, state.clouds.totalPct);
    const r = state.precip.kind === "none" ? 0 : state.precip.intensity;
    out.tint.set(1 - C.rainTint[0] * r, 1 - C.rainTint[1] * r, 1 - C.rainTint[2] * r);
  }

  const v = state.visibilityM;
  if (display.haze) {
    out.sigma0 = hazeSigma0(v);
    const blh = state.surface.boundaryLayerM;
    out.mixTopM = Math.min(C.hazeMixMaxM, Math.max(C.hazeMixMinM, Number.isFinite(blh) ? blh : 1000));
  }
  const grey = Number.isFinite(v) ? 1 - smoothstep(C.hazeGreyBelowM, C.hazeNoneAboveM, v) : 0;
  out.color.lerp(new THREE.Color(C.hazeGreyColor), grey).multiplyScalar(1 - out.darken);
  return out;
}

/**
 * Haze optical depth along a straight path of length `L` (m) from height h0 to h1
 * (m above the DZ): extinction `sigma0` up to `mixTop`, then decaying with scale
 * height `scaleH`. Transmittance is exp(−τ).
 */
export function opticalDepth(
  h0: number,
  h1: number,
  L: number,
  sigma0: number,
  mixTop: number,
  scaleH = C.hazeScaleHeightM,
): number {
  if (!(sigma0 > 0) || !(L > 0)) return 0;
  const lo = Math.min(h0, h1);
  const hi = Math.max(h0, h1);
  const dh = hi - lo;
  if (dh < 1e-3) {
    return sigma0 * L * (lo <= mixTop ? 1 : Math.exp(-(lo - mixTop) / scaleH));
  }
  // part of the path inside the mixed layer
  const below = Math.max(0, Math.min(hi, mixTop) - lo);
  let tau = sigma0 * L * (below / dh);
  // part above it: ∫ σ0·e^(−(h−H)/Hs) ds with ds = (L/dh)·dh'
  if (hi > mixTop) {
    const a = Math.max(lo, mixTop);
    tau += sigma0 * scaleH * (L / dh) * (Math.exp(-(a - mixTop) / scaleH) - Math.exp(-(hi - mixTop) / scaleH));
  }
  return tau;
}
