import * as THREE from "three";
import { CoverageMap, generateCoverageMap } from "./coverageNoise";

/**
 * Noise for the clouds (specs/weather-clouds-visibility.md §5.2):
 * - shape: 128³ RGBA8, R = Perlin–Worley, G/B/A = Worley fBm at rising frequencies
 * - detail: 32³ RGBA8 Worley fBm, used to erode edges
 * Both are tileable and generated once on the GPU (one draw per slice).
 * - coverage: the 2D per-band cloud pattern, built in a worker (coverageNoise.ts).
 */

const NOISE_GLSL = /* glsl */ `
vec3 hash33(vec3 p) {
  p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
  return fract(sin(p) * 43758.5453123);
}
// tileable Worley: distance to the nearest feature point, period cells per unit
float worley(vec3 p, float period) {
  p *= period;
  vec3 id = floor(p);
  vec3 f = fract(p);
  float d = 1e9;
  for (int z = -1; z <= 1; z++)
  for (int y = -1; y <= 1; y++)
  for (int x = -1; x <= 1; x++) {
    vec3 o = vec3(x, y, z);
    vec3 h = hash33(mod(id + o, period));
    vec3 r = o + h - f;
    d = min(d, dot(r, r));
  }
  return clamp(sqrt(d), 0.0, 1.0);
}
float worleyFbm(vec3 p, float f) {
  return (1.0 - worley(p, f)) * 0.625 + (1.0 - worley(p, f * 2.0)) * 0.25 + (1.0 - worley(p, f * 4.0)) * 0.125;
}
// tileable gradient noise
float gnoise(vec3 p, float period) {
  p *= period;
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float n = 0.0;
  float res[8];
  for (int k = 0; k < 8; k++) {
    vec3 o = vec3(float(k & 1), float((k >> 1) & 1), float((k >> 2) & 1));
    vec3 g = normalize(hash33(mod(i + o, period)) * 2.0 - 1.0);
    res[k] = dot(g, f - o);
  }
  float x00 = mix(res[0], res[1], u.x), x10 = mix(res[2], res[3], u.x);
  float x01 = mix(res[4], res[5], u.x), x11 = mix(res[6], res[7], u.x);
  return mix(mix(x00, x10, u.y), mix(x01, x11, u.y), u.z);
}
float perlinFbm(vec3 p, float f) {
  float s = 0.0, a = 0.5, n = 0.0;
  for (int o = 0; o < 5; o++) { s += a * gnoise(p, f); n += a; a *= 0.5; f *= 2.0; }
  return clamp(0.5 + 0.5 * s / n * 1.6, 0.0, 1.0);
}
float remap(float v, float a, float b, float c, float d) { return c + (v - a) / (b - a) * (d - c); }
`;

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const SHAPE_FRAG = /* glsl */ `
uniform float uZ;
varying vec2 vUv;
${NOISE_GLSL}
void main() {
  vec3 p = vec3(vUv, uZ);
  float pw = perlinFbm(p, 4.0);
  float w1 = worleyFbm(p, 4.0);
  // Perlin–Worley: the gradient noise, dilated by the cells (Schneider 2015)
  float perlinWorley = clamp(remap(pw, w1 - 1.0, 1.0, 0.0, 1.0), 0.0, 1.0);
  gl_FragColor = vec4(perlinWorley, w1, worleyFbm(p, 8.0), worleyFbm(p, 16.0));
}`;

const DETAIL_FRAG = /* glsl */ `
uniform float uZ;
varying vec2 vUv;
${NOISE_GLSL}
void main() {
  vec3 p = vec3(vUv, uZ);
  gl_FragColor = vec4(worleyFbm(p, 2.0), worleyFbm(p, 4.0), worleyFbm(p, 8.0), 1.0);
}`;

function bake3D(renderer: THREE.WebGLRenderer, size: number, frag: string): THREE.Data3DTexture {
  const rt = new THREE.WebGL3DRenderTarget(size, size, size, { depthBuffer: false });
  const tex = rt.texture as unknown as THREE.Data3DTexture;
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
  tex.generateMipmaps = false;

  const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms: { uZ: { value: 0 } }, depthTest: false, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  mesh.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(mesh);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const prevTarget = renderer.getRenderTarget();
  const prevAutoClear = renderer.autoClear;
  renderer.autoClear = false;
  for (let z = 0; z < size; z++) {
    mat.uniforms.uZ.value = (z + 0.5) / size;
    renderer.setRenderTarget(rt, z); // the second argument is the layer for 3D targets
    renderer.render(scene, cam);
  }
  renderer.setRenderTarget(prevTarget);
  renderer.autoClear = prevAutoClear;
  mat.dispose();
  mesh.geometry.dispose();
  return tex;
}

export interface CloudNoise {
  shape: THREE.Data3DTexture;
  detail: THREE.Data3DTexture;
}

let noise: CloudNoise | null = null;

/** The 3D noise textures, baked on first use (~tens of ms on a laptop GPU). */
export function getCloudNoise(renderer: THREE.WebGLRenderer): CloudNoise {
  if (!noise) {
    const t0 = performance.now();
    noise = { shape: bake3D(renderer, 128, SHAPE_FRAG), detail: bake3D(renderer, 32, DETAIL_FRAG) };
    console.info(`Cloud noise baked in ${Math.round(performance.now() - t0)} ms`);
  }
  return noise;
}

// ------------------------------------------------------------------ coverage map

export interface CoverageResult {
  map: CoverageMap;
  texture: THREE.DataTexture;
}

let worker: Worker | null = null;
let jobId = 0;

/** Build the coverage map for a seed in a worker (on the main thread if workers fail). */
export function buildCoverage(seed: number): Promise<CoverageResult> {
  const id = ++jobId;
  const finish = (map: CoverageMap): CoverageResult => {
    // Upload as half float: filtering an 8-bit texture quantizes the coverage value
    // to ~1/255 steps on some GPUs, and the cloud domes (which follow that value)
    // came out as stacked rings. The CPU copy stays 8-bit.
    const half = new Uint16Array(map.data.length);
    for (let i = 0; i < half.length; i++) half[i] = THREE.DataUtils.toHalfFloat(map.data[i] / 255);
    const texture = new THREE.DataTexture(half, map.size, map.size, THREE.RGBAFormat, THREE.HalfFloatType);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    return { map, texture };
  };
  return new Promise((resolve) => {
    const fallback = () => resolve(finish(generateCoverageMap(seed)));
    try {
      worker ??= new Worker(new URL("./coverageWorker.ts", import.meta.url), { type: "module" });
      const onMsg = (e: MessageEvent<{ id: number; map: CoverageMap }>) => {
        if (e.data.id !== id) return;
        worker!.removeEventListener("message", onMsg);
        resolve(finish(e.data.map));
      };
      worker.addEventListener("message", onMsg);
      worker.addEventListener("error", fallback, { once: true });
      worker.postMessage({ seed, id });
    } catch {
      fallback();
    }
  });
}
