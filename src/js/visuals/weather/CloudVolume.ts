import * as THREE from "three";
import type { WeatherDisplaySettings } from "../../weather/WeatherDisplay";
import type { CloudBand, WeatherState } from "../../weather/WeatherState";
import { BAND_PATTERN, CLOUD_LOOKS, CloudLook } from "./CloudTypes";
import { seedFromName, thresholdFor } from "./coverageNoise";
import { CoverageResult, buildCoverage } from "./NoiseTextures";

/**
 * The cloud layers the raymarch draws, eased toward the forecast
 * (specs/weather-clouds-visibility.md §5.2–5.3).
 *
 * - Each layer drifts with its wind on the sim clock: offset = drift × sim time, so
 *   the same sim time always shows the same clouds.
 * - When new weather arrives, heights, cover and drift ease over ~5 s of real time;
 *   layers that appear grow from nothing, layers that go away shrink to nothing.
 */

export const MAX_LAYERS = 4;

/** Exponential ease toward t that snaps once within eps. */
const ease = (x: number, t: number, a: number, eps: number) => (Math.abs(t - x) <= eps ? t : x + (t - x) * a);
const EASE_S = 5;
const EDGE_WIDTH = 0.08;

interface DrawLayer {
  band: CloudBand;
  base: number;
  top: number;
  cover: number; // 0–1
  driftX: number;
  driftZ: number;
  look: CloudLook;
  precipitating: boolean;
  /** false once the forecast no longer has it (it shrinks to 0 cover, then goes) */
  wanted: boolean;
}

export class CloudVolume {
  /** Packed per-layer uniforms (see cloudShaders.ts). */
  readonly a = Array.from({ length: MAX_LAYERS }, () => new THREE.Vector4());
  readonly b = Array.from({ length: MAX_LAYERS }, () => new THREE.Vector4());
  readonly c = Array.from({ length: MAX_LAYERS }, () => new THREE.Vector4());
  readonly d = Array.from({ length: MAX_LAYERS }, () => new THREE.Vector4());
  count = 0;
  /** Band and cover (0–1) of each packed layer, for the planner layer. */
  readonly bands: CloudBand[] = [];
  readonly covers: number[] = [];
  /** Rain shafts: (layer index, intensity 0–1, cell threshold, 1 = on) */
  readonly rain = new THREE.Vector4();

  coverage: CoverageResult | null = null;
  private seedKey = "";
  private layers = new Map<CloudBand, DrawLayer>();

  /** Anything to draw this frame. */
  get active() {
    return this.count > 0 && !!this.coverage;
  }

  update(dt: number, state: WeatherState | null, display: WeatherDisplaySettings, simTime: number) {
    this.ensureCoverage(state);
    const a = 1 - Math.exp(-dt / (EASE_S / 3));
    const targets = new Map<CloudBand, WeatherState["clouds"]["layers"][number]>();
    if (state && display.clouds) {
      for (const l of state.clouds.layers) if (display.layers[l.band]) targets.set(l.band, l);
    }

    // ease existing layers, add new ones (growing from 0 cover), retire missing ones
    for (const [band, cur] of this.layers) {
      const t = targets.get(band);
      cur.wanted = !!t;
      if (!t) {
        cur.cover += (0 - cur.cover) * a;
        if (cur.cover < 0.005) this.layers.delete(band);
        continue;
      }
      // ease, then land exactly on the target (lets a still view settle and smooth)
      cur.base = ease(cur.base, t.baseAglM, a, 0.05);
      cur.top = ease(cur.top, t.topAglM, a, 0.05);
      cur.cover = ease(cur.cover, t.coverPct / 100, a, 1e-4);
      cur.driftX = ease(cur.driftX, t.drift.x, a, 1e-3);
      cur.driftZ = ease(cur.driftZ, t.drift.z, a, 1e-3);
      cur.look = CLOUD_LOOKS[t.type];
      cur.precipitating = t.precipitating;
    }
    for (const [band, t] of targets) {
      if (this.layers.has(band)) continue;
      this.layers.set(band, {
        band,
        base: t.baseAglM,
        top: t.topAglM,
        cover: dt === 0 ? t.coverPct / 100 : 0,
        driftX: t.drift.x,
        driftZ: t.drift.z,
        look: CLOUD_LOOKS[t.type],
        precipitating: t.precipitating,
        wanted: true,
      });
    }

    // pack, bottom to top
    const list = [...this.layers.values()].sort((x, y) => x.base - y.base).slice(0, MAX_LAYERS);
    this.count = this.coverage ? list.length : 0;
    this.rain.set(-1, 0, 2, 0);
    const q = this.coverage?.map.quantiles;
    list.forEach((l, i) => {
      const pat = BAND_PATTERN[l.band];
      const threshold = q ? thresholdFor(q[pat.channel], l.cover) : 2;
      const speed = Math.hypot(l.driftX, l.driftZ);
      const dirX = speed > 0.1 ? l.driftX / speed : 1;
      const dirZ = speed > 0.1 ? l.driftZ / speed : 0;
      const thickness = Math.max(1, l.top - l.base);
      const shadow = l.look.shadow >= 0.5 ? l.look.shadow * Math.min(1, thickness / 1000) : l.look.shadow;
      this.bands[i] = l.band;
      this.covers[i] = l.cover;
      this.a[i].set(l.base, l.top, threshold, EDGE_WIDTH);
      this.b[i].set(l.driftX * simTime, l.driftZ * simTime, pat.tileM, pat.channel);
      this.c[i].set(l.look.density, l.look.shapeScaleM, l.look.stretch, l.look.profile);
      this.d[i].set(dirX, dirZ, l.precipitating ? 0.6 : 1, shadow);
      if (l.precipitating && l.wanted && state && display.precipitation && state.precip.intensity > 0 && q) {
        const showery = state.precip.kind === "showers" || state.precip.kind === "thunderstorm";
        const cellCover = showery ? l.cover * 0.3 : l.cover;
        this.rain.set(i, state.precip.intensity, thresholdFor(q[pat.channel], cellCover), 1);
      }
    });
  }

  /** Build the coverage map for the dropzone in view (once per DZ). */
  private ensureCoverage(state: WeatherState | null) {
    const key = state?.dz.name ?? "";
    if (!key || key === this.seedKey) return;
    this.seedKey = key;
    this.layers.clear();
    buildCoverage(seedFromName(key)).then((res) => {
      if (this.seedKey !== key) {
        res.texture.dispose();
        return;
      }
      this.coverage?.texture.dispose();
      this.coverage = res;
    });
  }
}
