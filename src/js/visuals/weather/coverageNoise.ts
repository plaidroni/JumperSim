/**
 * Cloud coverage map (specs/weather-clouds-visibility.md §5.2): a tileable RGBA
 * texture where each channel is one band's cloud pattern, plus per-channel quantile
 * tables so a forecast cover fraction maps to a threshold that clouds exactly that
 * share of the area.
 *
 * Pure and deterministic (seeded): runs in a worker in the app and in Node in tests.
 * The shader samples a channel twice (COMBINE below) and the quantiles are measured
 * on that same combination, so cover matches what is drawn.
 */

export const COVERAGE_SIZE = 512;
export const QUANTILES = 1024;

/** Channels: R low (cumulus-scale cells), G mid patches, B high streaks, A fog patches. */
export const CHANNEL = { low: 0, mid: 1, high: 2, fog: 3 } as const;

/** How the shader combines two samples (keep in sync with cloudShaders.ts). */
export const COMBINE = {
  w1: 0.65,
  w2: 0.35,
  scale2: 2.37,
  /** rotation of the second sample (radians) */
  angle2: 0.83,
};

export interface CoverageMap {
  size: number;
  /** RGBA8, row-major, tileable. */
  data: Uint8Array;
  /** Per channel, QUANTILES sorted values of the combined sample, 0–1. */
  quantiles: Float32Array[];
}

// ------------------------------------------------------------------ noise

function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const mod = (a: number, n: number) => ((a % n) + n) % n;
const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/** Tileable 2D gradient noise in [-1, 1] with an integer period. */
function perlin(x: number, y: number, period: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const g = (ix: number, iy: number, dx: number, dy: number) => {
    const a = hash2(mod(ix, period), mod(iy, period), seed) * Math.PI * 2;
    return Math.cos(a) * dx + Math.sin(a) * dy;
  };
  const u = fade(xf);
  const v = fade(yf);
  const n00 = g(xi, yi, xf, yf);
  const n10 = g(xi + 1, yi, xf - 1, yf);
  const n01 = g(xi, yi + 1, xf, yf - 1);
  const n11 = g(xi + 1, yi + 1, xf - 1, yf - 1);
  return (n00 + (n10 - n00) * u + (n01 - n00) * v + (n00 - n10 - n01 + n11) * u * v) * 1.41;
}

/** Tileable 2D Worley (distance to the nearest feature point), roughly 0–1. */
function worley(x: number, y: number, period: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  let d = Infinity;
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const cx = xi + ox;
      const cy = yi + oy;
      const px = cx + hash2(mod(cx, period), mod(cy, period), seed);
      const py = cy + hash2(mod(cx, period), mod(cy, period), seed + 101);
      d = Math.min(d, (px - x) ** 2 + (py - y) ** 2);
    }
  }
  return Math.min(1, Math.sqrt(d));
}

/** Fractal gradient noise, tileable over [0,1)² at base period `p`. */
function fbm(u: number, v: number, p: number, octaves: number, seed: number): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const per = p << o;
    sum += amp * perlin(u * per, v * per, per, seed + o * 17);
    norm += amp;
    amp *= 0.5;
  }
  return sum / norm; // ~[-1, 1]
}

// ------------------------------------------------------------------ map

function channelValue(ch: number, u: number, v: number, seed: number): number {
  switch (ch) {
    case 0: {
      // low: cumulus-scale cells with ragged edges
      const cells = 1 - worley(u * 10, v * 10, 10, seed + 1);
      return 0.55 * cells + 0.45 * (0.5 + 0.5 * fbm(u, v, 6, 5, seed + 2));
    }
    case 1: {
      const cells = 1 - worley(u * 6, v * 6, 6, seed + 3);
      return 0.35 * cells + 0.65 * (0.5 + 0.5 * fbm(u, v, 4, 5, seed + 4));
    }
    case 2:
      return 0.5 + 0.5 * fbm(u, v, 3, 6, seed + 5);
    default:
      return 0.5 + 0.5 * fbm(u, v, 5, 4, seed + 6);
  }
}

/** Seed from a dropzone name, so each DZ always gets the same pattern. */
export function seedFromName(name: string): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  return (h >>> 0) % 100000;
}

export function generateCoverageMap(seed: number, size = COVERAGE_SIZE): CoverageMap {
  const data = new Uint8Array(size * size * 4);
  const raw = [0, 1, 2, 3].map(() => new Float32Array(size * size));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      for (let ch = 0; ch < 4; ch++) raw[ch][y * size + x] = channelValue(ch, u, v, seed);
    }
  }
  // stretch each channel to the full 0–255 range
  for (let ch = 0; ch < 4; ch++) {
    const r = raw[ch];
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of r) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    const k = hi > lo ? 255 / (hi - lo) : 0;
    for (let i = 0; i < r.length; i++) data[i * 4 + ch] = Math.round((r[i] - lo) * k);
  }
  const map: CoverageMap = { size, data, quantiles: [] };
  map.quantiles = [0, 1, 2, 3].map((ch) => measureQuantiles(map, ch, seed));
  return map;
}

/** Bilinear, repeating sample of one channel at (u, v), 0–1 (matches the GPU's linear filter). */
export function sampleChannel(map: CoverageMap, ch: number, u: number, v: number): number {
  const n = map.size;
  const x = u * n - 0.5;
  const y = v * n - 0.5;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const at = (xx: number, yy: number) => map.data[(mod(yy, n) * n + mod(xx, n)) * 4 + ch] / 255;
  const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * fx;
  const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * fx;
  return a + (b - a) * fy;
}

/** The value the shader thresholds: two samples at different scales and angles. */
export function combinedSample(map: CoverageMap, ch: number, u: number, v: number): number {
  const c = Math.cos(COMBINE.angle2);
  const s = Math.sin(COMBINE.angle2);
  const u2 = (c * u - s * v) * COMBINE.scale2;
  const v2 = (s * u + c * v) * COMBINE.scale2;
  return COMBINE.w1 * sampleChannel(map, ch, u, v) + COMBINE.w2 * sampleChannel(map, ch, u2, v2);
}

function measureQuantiles(map: CoverageMap, ch: number, seed: number, samples = 65536): Float32Array {
  const vals = new Float32Array(samples);
  // a jittered grid over one tile
  const side = Math.sqrt(samples);
  for (let i = 0; i < samples; i++) {
    const gx = i % side;
    const gy = Math.floor(i / side);
    const u = (gx + hash2(gx, gy, seed + 900)) / side;
    const v = (gy + hash2(gy, gx, seed + 901)) / side;
    vals[i] = combinedSample(map, ch, u, v);
  }
  vals.sort();
  const q = new Float32Array(QUANTILES);
  for (let i = 0; i < QUANTILES; i++) q[i] = vals[Math.round((i / (QUANTILES - 1)) * (samples - 1))];
  return q;
}

/**
 * Threshold on the combined sample such that `cover` (0–1) of the area is above it.
 * 0 cover → above the maximum (nothing), 1 → below the minimum (everything).
 */
export function thresholdFor(quantiles: Float32Array, cover: number): number {
  const c = Math.min(1, Math.max(0, cover));
  if (c <= 0) return 2;
  if (c >= 1) return -1;
  const pos = (1 - c) * (quantiles.length - 1);
  const i = Math.floor(pos);
  const f = pos - i;
  const a = quantiles[i];
  const b = quantiles[Math.min(quantiles.length - 1, i + 1)];
  return a + (b - a) * f;
}
