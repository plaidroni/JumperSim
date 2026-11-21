import * as THREE from "three";
import { WORLD_SCALE, worldRoot } from "../../core/WorldScale";
import type { WeatherDisplaySettings, WeatherQuality } from "../../weather/WeatherDisplay";
import type { WeatherState } from "../../weather/WeatherState";
import { buildWindProfile, windAtHeight } from "../../wind/WindProfile";
import { LAYER_OVERLAY } from "../Layers";
import { COVERAGE_GLSL } from "./cloudShaders";
import type { CloudVolume } from "./CloudVolume";

/**
 * Rain and snow particles around the camera (specs/weather-clouds-visibility.md §5.4).
 *
 * - GPU-instanced, camera-facing streaks in a 60 × 45 × 60 m box that follows the
 *   camera; each drop's position is `mod(seed · box + velocity · t − corner, box)`.
 * - Streaks show 1/12 s of motion (a camera-like motion blur).
 * - Velocity = the wind at the camera's height + the fall speed (rain 6.5 m/s,
 *   drizzle 2 m/s, snow 1.2 m/s with sway). Above the freezing level, rain is snow.
 * - Only below the raining layer's base; for showers and thunderstorms only inside
 *   its rain cells (the same coverage the rain shafts use), so the camera passes in
 *   and out of showers.
 * - Animates on real time even while paused: drops carry no planning information,
 *   and frozen rain looks like a rendering bug.
 * - Overlay layer: drawn after the composite, depth-tested against the terrain.
 */

// small enough that the drops near the camera read as rain (the far ones are
// covered by the rain shafts and haze)
const BOX_M = new THREE.Vector3(60, 45, 60);
const MAX_PARTICLES = 30000;
const PRESET_MAX: Record<WeatherQuality, number> = { low: 4000, medium: 12000, high: 30000 };

const VERT = /* glsl */ `
${COVERAGE_GLSL}
attribute vec4 aSeed;          // xyz: place in the box, w: phase
uniform vec3 uCamM;            // camera (m)
uniform vec3 uBox;
uniform vec3 uVelRain;         // m/s, wind + fall
uniform vec3 uVelSnow;
uniform float uTime;           // wall clock (s)
uniform float uBaseM;          // raining layer's base (m above the DZ)
uniform float uFreezeM;        // freezing level (m above the DZ); below: rain
uniform float uAllSnow;
uniform float uDrizzle;
uniform float uMaskOn;         // showers: only inside rain cells
uniform int uRainLayer;
uniform float uCellThreshold;
uniform vec2 uViewport;        // px
varying float vAlpha;
varying vec2 vQuad;
varying float vSnow;

void main() {
  vec3 corner = uCamM - uBox * 0.5;
  float snowHere = 0.0;
  vec3 seedPos = aSeed.xyz * uBox;
  vec3 pr = corner + mod(seedPos + uVelRain * uTime - corner, uBox);
  if (uAllSnow > 0.5 || pr.y > uFreezeM) snowHere = 1.0;
  vec3 vel = snowHere > 0.5 ? uVelSnow : uVelRain;
  vec3 p = snowHere > 0.5 ? corner + mod(seedPos + uVelSnow * uTime - corner, uBox) : pr;
  if (snowHere > 0.5) {
    float ph = aSeed.w * 6.2832;
    p.xz += vec2(sin(uTime * 1.3 + ph), cos(uTime * 1.1 + ph)) * 0.4;  // flutter
  }

  // where it falls: below the base, above the ground, inside cells for showers
  float a = (1.0 - smoothstep(uBaseM - 100.0, uBaseM, p.y)) * step(0.0, p.y);
  if (uMaskOn > 0.5) {
    float raw = coverageRaw(uRainLayer, p.xz);
    a *= smoothstep(uCellThreshold - 0.06, uCellThreshold + 0.06, raw);
  }
  // hide the wrap at the box edges and drops right at the lens
  vec3 rel = (p - uCamM) / (uBox * 0.5);
  a *= 1.0 - smoothstep(0.75, 1.0, max(abs(rel.x), max(abs(rel.y), abs(rel.z))));
  float dist = length(p - uCamM);
  a *= smoothstep(0.5, 2.0, dist);

  // a streak from the drop back along its motion (1/30 s), a few px wide
  float streakS = snowHere > 0.5 ? 0.01 : (uDrizzle > 0.5 ? 0.05 : 1.0 / 12.0);
  vec3 tail = p - vel * streakS;
  vec4 c0 = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  vec4 c1 = projectionMatrix * modelViewMatrix * vec4(tail, 1.0);
  vec2 s0 = c0.xy / c0.w;
  vec2 s1 = c1.xy / c1.w;
  vec2 d = (s1 - s0) * uViewport;
  vec2 dir = length(d) > 1e-4 ? normalize(d) : vec2(0.0, 1.0);
  vec2 perp = vec2(-dir.y, dir.x);
  float widthPx = snowHere > 0.5 ? 3.0 : (uDrizzle > 0.5 ? 1.2 : 1.8);
  vec4 c = mix(c0, c1, position.x);
  c.xy += perp * position.y * widthPx / uViewport * c.w;
  if (snowHere > 0.5) c.xy += dir * (position.x - 0.5) * widthPx / uViewport * c.w; // round flakes
  gl_Position = (a <= 0.001 || c0.w <= 0.0) ? vec4(2.0, 2.0, 2.0, 1.0) : c;
  vAlpha = a * (snowHere > 0.5 ? 0.9 : (uDrizzle > 0.5 ? 0.4 : 0.6));
  vQuad = vec2(position.x, position.y);
  vSnow = snowHere;
}`;

const FRAG = /* glsl */ `
varying float vAlpha;
varying vec2 vQuad;
varying float vSnow;
void main() {
  float across = 1.0 - abs(vQuad.y);
  float along = vSnow > 0.5 ? 1.0 - abs(vQuad.x * 2.0 - 1.0) : mix(0.35, 1.0, vQuad.x);
  float a = vAlpha * across * along;
  if (a < 0.01) discard;
  vec3 col = vSnow > 0.5 ? vec3(0.92, 0.94, 0.97) : vec3(0.70, 0.76, 0.84);
  gl_FragColor = vec4(col, a);
}`;

export class PrecipitationParticles {
  readonly mesh: THREE.Mesh;
  private geometry: THREE.InstancedBufferGeometry;
  private material: THREE.ShaderMaterial;
  private profileKey: WeatherState | null = null;
  private profile: ReturnType<typeof buildWindProfile> = [];
  private wind = new THREE.Vector3();

  constructor(clouds: CloudVolume) {
    const base = new THREE.PlaneGeometry(1, 2, 1, 1);
    base.translate(0.5, 0, 0); // x: 0 at the drop, 1 at the tail; y: -1..1 across
    this.geometry = new THREE.InstancedBufferGeometry();
    this.geometry.index = base.index;
    this.geometry.setAttribute("position", base.getAttribute("position"));
    const seeds = new Float32Array(MAX_PARTICLES * 4);
    let s = 1234567;
    const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296);
    for (let i = 0; i < seeds.length; i++) seeds[i] = rnd();
    this.geometry.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 4));
    this.geometry.instanceCount = 0;

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      defines: { MAX_LAYERS: 4 },
      uniforms: {
        uCoverage: { value: null },
        uLayerA: { value: clouds.a },
        uLayerB: { value: clouds.b },
        uLayerC: { value: clouds.c },
        uLayerD: { value: clouds.d },
        uLayerCount: { value: 0 },
        uCamM: { value: new THREE.Vector3() },
        uBox: { value: BOX_M.clone() },
        uVelRain: { value: new THREE.Vector3() },
        uVelSnow: { value: new THREE.Vector3() },
        uTime: { value: 0 },
        uBaseM: { value: 0 },
        uFreezeM: { value: 1e9 },
        uAllSnow: { value: 0 },
        uDrizzle: { value: 0 },
        uMaskOn: { value: 0 },
        uRainLayer: { value: 0 },
        uCellThreshold: { value: 2 },
        uViewport: { value: new THREE.Vector2(1, 1) },
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = "Precipitation";
    this.mesh.frustumCulled = false; // positions are made in the shader
    this.mesh.renderOrder = 5;
    this.mesh.layers.set(LAYER_OVERLAY);
    this.mesh.visible = false;
    worldRoot.add(this.mesh);
  }

  /** Per frame, before the scene renders. */
  update(
    state: WeatherState | null,
    display: WeatherDisplaySettings,
    clouds: CloudVolume,
    camera: THREE.Camera,
    renderer: THREE.WebGLRenderer,
    planner: boolean,
  ) {
    const p = state?.precip;
    const rainLayer = state?.clouds.layers.find((l) => l.precipitating);
    const camM = camera.getWorldPosition(new THREE.Vector3()).divideScalar(WORLD_SCALE);
    const baseM = rainLayer ? rainLayer.baseAglM : 2500; // no layer: rain from a nominal base
    const on =
      !planner &&
      !!state &&
      !!p &&
      display.precipitation &&
      p.kind !== "none" &&
      p.intensity > 0 &&
      camM.y < baseM + 60 &&
      camM.y > -50;
    this.mesh.visible = on;
    if (!on) {
      this.geometry.instanceCount = 0;
      return;
    }

    if (state !== this.profileKey) {
      this.profileKey = state;
      this.profile = buildWindProfile(state, { allLevels: true });
    }
    windAtHeight(this.profile, Math.min(Math.max(camM.y, 10), baseM), this.wind);
    const fall = p.kind === "drizzle" ? 2 : 6.5;
    const u = this.material.uniforms;
    u.uCamM.value.copy(camM);
    u.uVelRain.value.set(this.wind.x, -fall, this.wind.z);
    u.uVelSnow.value.set(this.wind.x * 0.8, -1.2, this.wind.z * 0.8);
    u.uTime.value = performance.now() / 1000;
    u.uBaseM.value = baseM;
    const fzl = state.surface.freezingLevelMslM - state.elevationM;
    u.uFreezeM.value = Number.isFinite(fzl) ? fzl : p.kind === "snow" ? -1e9 : 1e9;
    u.uAllSnow.value = p.kind === "snow" ? 1 : 0;
    u.uDrizzle.value = p.kind === "drizzle" ? 1 : 0;

    // showers/storms: only under the cells the rain shafts use
    const cells = clouds.rain.w > 0.5 && clouds.coverage && (p.kind === "showers" || p.kind === "thunderstorm");
    u.uMaskOn.value = cells ? 1 : 0;
    if (cells) {
      u.uCoverage.value = clouds.coverage!.texture;
      u.uRainLayer.value = Math.round(clouds.rain.x);
      u.uCellThreshold.value = clouds.rain.z;
      u.uLayerCount.value = clouds.count;
    }
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    u.uViewport.value.copy(size);
    this.geometry.instanceCount = Math.round(Math.min(1, p.intensity) * PRESET_MAX[display.quality]);
  }

  dispose() {
    this.mesh.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}
