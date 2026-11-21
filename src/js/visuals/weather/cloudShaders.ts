import { COMBINE } from "./coverageNoise";

/**
 * GLSL for the clouds (specs/weather-clouds-visibility.md §5.2–5.5). All maths is in
 * metres in the flat local frame: +Y up, the DZ ground at y = 0.
 *
 * Per-layer uniforms (packed by CloudVolume.ts):
 *   uLayerA[i] = (base m, top m, coverage threshold, edge width)
 *   uLayerB[i] = (offset x m, offset z m, pattern tile m, coverage channel)
 *   uLayerC[i] = (density, shape feature size m, stretch along drift, profile id)
 *   uLayerD[i] = (drift dir x, drift dir z, albedo, shadow strength)
 */

const f = (n: number) => n.toFixed(6);

/** Coverage lookups; shared by the raymarch and the composite (cloud shadows). */
export const COVERAGE_GLSL = /* glsl */ `
#ifndef MAX_LAYERS
#define MAX_LAYERS 4
#endif
uniform sampler2D uCoverage;
uniform vec4 uLayerA[MAX_LAYERS];
uniform vec4 uLayerB[MAX_LAYERS];
uniform vec4 uLayerC[MAX_LAYERS];
uniform vec4 uLayerD[MAX_LAYERS];
uniform int uLayerCount;

// keep in sync with coverageNoise.ts COMBINE (the CPU measures cover on the same mix)
const float COMB_W1 = ${f(COMBINE.w1)};
const float COMB_W2 = ${f(COMBINE.w2)};
const float COMB_S2 = ${f(COMBINE.scale2)};
const mat2 COMB_R = mat2(${f(Math.cos(COMBINE.angle2))}, ${f(Math.sin(COMBINE.angle2))}, ${f(-Math.sin(COMBINE.angle2))}, ${f(Math.cos(COMBINE.angle2))});

float pickChannel(vec4 t, float ch) {
  return ch < 0.5 ? t.r : ch < 1.5 ? t.g : ch < 2.5 ? t.b : t.a;
}

/** The value the coverage threshold applies to, at world x/z (m). */
float coverageRaw(int i, vec2 xz) {
  vec4 B = uLayerB[i];
  vec4 C = uLayerC[i];
  vec4 D = uLayerD[i];
  vec2 rel = xz - B.xy;
  vec2 dir = D.xy;
  vec2 perp = vec2(-dir.y, dir.x);
  vec2 uv = vec2(dot(rel, dir) / C.z, dot(rel, perp)) / B.z;
  float s1 = pickChannel(texture(uCoverage, uv), B.w);
  float s2 = pickChannel(texture(uCoverage, COMB_R * uv * COMB_S2), B.w);
  return COMB_W1 * s1 + COMB_W2 * s2;
}

// B-spline (bicubic) lookup from 4 bilinear taps (Sigg & Hadwiger 2005). Smooth
// across texel edges, so the cloud domes, which follow it, don't show rings.
uniform vec2 uCoverageSize;
vec4 bsplineWeights(float v) {
  vec4 n = vec4(1.0, 2.0, 3.0, 4.0) - v;
  vec4 s3 = n * n * n;
  float x = s3.x;
  float y = s3.y - 4.0 * s3.x;
  float z = s3.z - 4.0 * s3.y + 6.0 * s3.x;
  return vec4(x, y, z, 6.0 - x - y - z) * (1.0 / 6.0);
}
vec4 textureBSpline(sampler2D tex, vec2 uv) {
  vec2 inv = 1.0 / uCoverageSize;
  uv = uv * uCoverageSize - 0.5;
  vec2 fxy = fract(uv);
  uv -= fxy;
  vec4 xc = bsplineWeights(fxy.x);
  vec4 yc = bsplineWeights(fxy.y);
  vec4 c = uv.xxyy + vec2(-0.5, 1.5).xyxy;
  vec4 sm = vec4(xc.xz + xc.yw, yc.xz + yc.yw);
  vec4 off = (c + vec4(xc.yw, yc.yw) / sm) * inv.xxyy;
  vec4 s0 = texture(tex, off.xz);
  vec4 s1 = texture(tex, off.yz);
  vec4 s2 = texture(tex, off.xw);
  vec4 s3 = texture(tex, off.yw);
  float sx = sm.x / (sm.x + sm.y);
  float sy = sm.z / (sm.z + sm.w);
  return mix(mix(s3, s2, sx), mix(s1, s0, sx), sy);
}

/** Like coverageRaw, but smooth (for dome heights; cover itself uses coverageRaw). */
float coverageSmooth(int i, vec2 xz) {
  vec4 B = uLayerB[i];
  vec4 C = uLayerC[i];
  vec4 D = uLayerD[i];
  vec2 rel = xz - B.xy;
  vec2 perp = vec2(-D.y, D.x);
  vec2 uv = vec2(dot(rel, D.xy) / C.z, dot(rel, perp)) / B.z;
  float s1 = pickChannel(textureBSpline(uCoverage, uv), B.w);
  float s2 = pickChannel(textureBSpline(uCoverage, COMB_R * uv * COMB_S2), B.w);
  return COMB_W1 * s1 + COMB_W2 * s2;
}

/** 0–1: how cloudy layer i is above (x, z). */
float coverageAt(int i, vec2 xz) {
  vec4 A = uLayerA[i];
  return smoothstep(A.z - A.w, A.z + A.w, coverageRaw(i, xz));
}
`;

/** Haze optical depth (keep in sync with weather/Atmosphere.ts opticalDepth). */
export const HAZE_GLSL = /* glsl */ `
uniform float uSigma0;
uniform float uMixTop;
uniform float uScaleH;
float opticalDepth(float h0, float h1, float L) {
  if (uSigma0 <= 0.0 || L <= 0.0) return 0.0;
  float lo = min(h0, h1);
  float hi = max(h0, h1);
  float dh = hi - lo;
  if (dh < 1e-3) return uSigma0 * L * (lo <= uMixTop ? 1.0 : exp(-(lo - uMixTop) / uScaleH));
  float below = max(0.0, min(hi, uMixTop) - lo);
  float tau = uSigma0 * L * (below / dh);
  if (hi > uMixTop) {
    float a = max(lo, uMixTop);
    tau += uSigma0 * uScaleH * (L / dh) * (exp(-(a - uMixTop) / uScaleH) - exp(-(hi - uMixTop) / uScaleH));
  }
  return tau;
}
`;

/**
 * Raymarch at reduced resolution → (radiance premultiplied, transmittance).
 * Defines: MAX_STEPS, LIGHT_STEPS, USE_DETAIL.
 */
export const CLOUD_FRAG = /* glsl */ `
precision highp sampler3D;
${COVERAGE_GLSL}
${HAZE_GLSL}
uniform sampler2D uViewDepth;   // view depth (scene units) at this resolution; < 0 = sky
uniform sampler3D uShape;
uniform sampler3D uDetail;
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
uniform vec3 uCamPosM;
uniform float uWorldScale;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uAmbTop;
uniform vec3 uAmbBottom;
uniform vec3 uHazeColor;
uniform vec3 uRainColor;
uniform vec4 uRain;             // (layer index, intensity, cell threshold, on)
uniform float uTime;            // sim time (s)
uniform float uFrame;
uniform float uMaxDist;         // m
varying vec2 vUv;

const float EXTINCTION = 0.05;  // per metre at density 1
const float PI4 = 12.566371;

float hg(float c, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (PI4 * pow(1.0 + g2 - 2.0 * g * c, 1.5));
}

float profile(float h, float p) {
  if (p < 0.5) return 1.0 - smoothstep(0.3, 1.0, h);                                   // fog
  if (p < 1.5) return smoothstep(0.0, 0.12, h) * (1.0 - smoothstep(0.75, 1.0, h));       // sheet
  if (p < 2.5) return smoothstep(0.0, 0.15, h) * (1.0 - smoothstep(0.45, 1.0, h));       // rounded top
  if (p < 3.5) return smoothstep(0.0, 0.06, h) * (1.0 - smoothstep(0.30, 1.0, h));       // cumulus
  if (p < 4.5) return smoothstep(0.0, 0.05, h) * (1.0 - smoothstep(0.85, 1.0, h));       // cumulonimbus
  return smoothstep(0.0, 0.3, h) * (1.0 - smoothstep(0.6, 1.0, h));                      // veil
}

float remap(float v, float a, float b, float c, float d) { return c + (v - a) / (b - a) * (d - c); }

/**
 * Density of layer i at p (m), from the raw coverage value there. Clouds are
 * domed: the top drops toward a cell's edge (how far the value is past the
 * threshold), so heaped types get rounded tops; sheets stay flat.
 */
float cloudDensity(int i, vec3 p, float raw, float smoothRaw, bool detail) {
  vec4 A = uLayerA[i];
  vec4 B = uLayerB[i];
  vec4 C = uLayerC[i];
  vec4 D = uLayerD[i];
  float cov = smoothstep(A.z - A.w, A.z + A.w, raw);
  if (cov <= 0.0) return 0.0;
  float h0 = (p.y - A.x) / max(1.0, A.y - A.x);
  if (h0 <= 0.0 || h0 >= 1.0) return 0.0;
  vec2 rel = p.xz - B.xy;
  vec2 perp = vec2(-D.y, D.x);
  vec3 sp = vec3(dot(rel, D.xy) / C.z, p.y - uTime * 0.3, dot(rel, perp)) / C.y;
  vec4 s = texture(uShape, sp);
  float wfbm = s.g * 0.625 + s.b * 0.25 + s.a * 0.125;
  // dome height from how deep inside the cell this is. The coverage map is bilinear,
  // so on its own the domes step at every texel (~47 m rings); the 3D noise breaks
  // those rings up into lumpy cloud tops.
  float core = smoothstep(A.z - A.w, A.z + 0.22, smoothRaw + (wfbm - 0.5) * 0.16);
  float sheet = C.w > 0.5 && C.w < 1.5 ? 1.0 : 0.0;   // stratus-like: no domes
  float topScale = mix(mix(0.25, 1.0, core), 1.0, sheet);
  float h = h0 / topScale;
  if (h >= 1.0) return 0.0;
  float base = clamp(remap(s.r, wfbm - 1.0, 1.0, 0.0, 1.0), 0.0, 1.0);
  float d = clamp((base * profile(h, C.w) - (1.0 - cov)) / max(cov, 0.05), 0.0, 1.0);
#ifdef USE_DETAIL
  if (detail && d > 0.0 && d < 0.9) {
    vec3 dt = texture(uDetail, sp * 5.3).rgb;
    float df = dt.r * 0.625 + dt.g * 0.25 + dt.b * 0.125;
    d = clamp((d - (1.0 - df) * 0.3) / 0.7, 0.0, 1.0);
  }
#endif
  return d * C.x;
}

/** Interleaved gradient noise (Jimenez 2014): per-pixel jitter, no texture needed. */
float ign(vec2 px) { return fract(52.9829189 * fract(0.06711056 * px.x + 0.00583715 * px.y)); }

void main() {
  float w = texture(uViewDepth, vUv).r;
  vec4 pp = uInvProj * vec4(vUv * 2.0 - 1.0, -1.0, 1.0);
  vec3 v = pp.xyz / pp.w;
  vec3 dir = normalize((uCamWorld * vec4(v, 0.0)).xyz);
  vec3 ro = uCamPosM;
  float tMax = uMaxDist;
  if (w >= 0.0) {
    vec3 endM = (uCamWorld * vec4(v * (w / -v.z), 1.0)).xyz / uWorldScale;
    tMax = min(tMax, length(endM - ro));
  }

  // slab intervals (layers + one rain-shaft slab), sorted front to back
  vec2 iv[MAX_LAYERS + 1];
  int ids[MAX_LAYERS + 1];
  int n = 0;
  for (int i = 0; i < MAX_LAYERS + 1; i++) {
    bool isRain = i == MAX_LAYERS;
    if (!isRain && i >= uLayerCount) continue;
    if (isRain && uRain.w < 0.5) continue;
    float lo = isRain ? 0.0 : uLayerA[i].x;
    float hi = isRain ? uLayerA[int(uRain.x)].x : uLayerA[i].y;
    float tin, tout;
    if (abs(dir.y) < 1e-5) {
      if (ro.y < lo || ro.y > hi) continue;
      tin = 0.0;
      tout = tMax;
    } else {
      float t0 = (lo - ro.y) / dir.y;
      float t1 = (hi - ro.y) / dir.y;
      tin = max(min(t0, t1), 0.0);
      tout = min(max(t0, t1), tMax);
    }
    if (tout <= tin) continue;
    iv[n] = vec2(tin, tout);
    ids[n] = isRain ? -1 : i;
    n++;
  }
  for (int a = 1; a < MAX_LAYERS + 1; a++) {
    if (a >= n) break;
    for (int b = a; b > 0; b--) {
      if (iv[b - 1].x <= iv[b].x) break;
      vec2 tv = iv[b]; iv[b] = iv[b - 1]; iv[b - 1] = tv;
      int ti = ids[b]; ids[b] = ids[b - 1]; ids[b - 1] = ti;
    }
  }

  float T = 1.0;
  vec3 L = vec3(0.0);
  float wsum = 0.0;
  float dsum = 0.0;
  float jitter = ign(gl_FragCoord.xy + uFrame * 5.588238);
  float cosSun = dot(dir, uSunDir);
  float phase = PI4 * mix(hg(cosSun, 0.8), hg(cosSun, -0.3), 0.3);
  int steps = 0;

  for (int k = 0; k < MAX_LAYERS + 1; k++) {
    if (k >= n || T < 0.03 || steps >= MAX_STEPS) break;
    int i = ids[k];
    vec2 seg = iv[k];
    if (i < 0) {
      // rain shafts under the raining layer: a thin grey medium
      int ri = int(uRain.x);
      float baseH = uLayerA[ri].x;
      float st = max(150.0, (seg.y - seg.x) / 16.0);
      float t = seg.x + st * jitter;
      for (int s = 0; s < 32; s++) {
        if (t >= seg.y || steps >= MAX_STEPS) break;
        vec3 p = ro + dir * t;
        float raw = coverageRaw(ri, p.xz);
        float mask = smoothstep(uRain.z - 0.06, uRain.z + 0.06, raw);
        float hn = p.y / max(1.0, baseH);
        float fade = smoothstep(0.0, 0.08, hn) * (1.0 - smoothstep(0.85, 1.0, hn)) * (1.0 - smoothstep(30000.0, 40000.0, t));
        float sigma = 0.0012 * uRain.y * mask * fade;
        float a = 1.0 - exp(-sigma * st);
        L += T * uRainColor * a;
        wsum += T * a; dsum += T * a * t;
        T *= 1.0 - a;
        t += st;
        steps++;
      }
      continue;
    }
    vec4 A = uLayerA[i];
    float thick = max(1.0, A.y - A.x);
    float baseStep = clamp(thick / 16.0, 20.0, 300.0);
    float albedo = uLayerD[i].z;
    float t = seg.x + baseStep * jitter;
    for (int s = 0; s < MAX_STEPS; s++) {
      if (t >= seg.y || T < 0.03 || steps >= MAX_STEPS) break;
      float st = max(baseStep, t * 0.03);
      vec3 p = ro + dir * t;
      float raw = coverageRaw(i, p.xz);
      steps++;
      if (raw < A.z - A.w) { t += st * 3.0; continue; } // empty column: skip ahead
      float smoothRaw = coverageSmooth(i, p.xz);
      float d = cloudDensity(i, p, raw, smoothRaw, true) * (1.0 - smoothstep(30000.0, 40000.0, t));
      if (d > 0.001) {
        // light: march toward the sun through this layer
        float ls = thick / float(LIGHT_STEPS) / max(uSunDir.y, 0.25);
        float od = 0.0;
        for (int j = 0; j < LIGHT_STEPS; j++) {
          // jittered like the primary steps, so the sample count crossing the layer
          // top doesn't step the brightness into terraces (smoothing averages it out)
          vec3 q = p + uSunDir * ls * (float(j) + jitter);
          if (q.y > A.y) break;
          // light rays cross the slab mostly vertically: reuse this column's coverage
          od += cloudDensity(i, q, raw, smoothRaw, false);
        }
        float tauL = od * ls * EXTINCTION;
        float lightT = max(exp(-tauL), 0.7 * exp(-tauL * 0.25)); // cheap multiple scattering
        float hn = (p.y - A.x) / thick;
        vec3 col = albedo * (uSunColor * lightT * phase + mix(uAmbBottom, uAmbTop, hn));
        float a = 1.0 - exp(-d * EXTINCTION * st);
        L += T * col * a;
        wsum += T * a; dsum += T * a * t;
        T *= 1.0 - a;
      }
      t += st;
    }
  }

  // haze between the camera and the clouds (at their weighted mean distance)
  if (wsum > 1e-4) {
    float tm = dsum / wsum;
    vec3 pm = ro + dir * tm;
    float Th = exp(-opticalDepth(ro.y, pm.y, tm));
    L = L * Th + uHazeColor * (1.0 - Th) * (1.0 - T);
  }
  gl_FragColor = vec4(L, T);
}
`;
