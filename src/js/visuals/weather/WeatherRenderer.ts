import * as THREE from "three";
import { WORLD_SCALE } from "../../core/WorldScale";
import { AtmosphereParams, atmosphereTargets } from "../../weather/Atmosphere";
import { WEATHER_VISUALS } from "../../weather/config";
import { WeatherQuality, weatherDisplay } from "../../weather/WeatherDisplay";
import { weatherService } from "../../weather/WeatherService";
import { LAYER_ENV, LAYER_OVERLAY, applyOverlayLayers } from "../Layers";
import { CLOUD_FRAG, COVERAGE_GLSL, HAZE_GLSL } from "./cloudShaders";
import { CloudVolume, MAX_LAYERS } from "./CloudVolume";
import { getCloudNoise } from "./NoiseTextures";
import { COVERAGE_SIZE } from "./coverageNoise";
import { PrecipitationParticles } from "./Precipitation";
import { PlannerClouds } from "./PlannerClouds";
import { VisibilityRing } from "./VisibilityRing";

const ACCUM_FRAG = /* glsl */ `
uniform sampler2D uCurrent;
uniform sampler2D uHistory;
uniform float uWeight;
varying vec2 vUv;
void main() { gl_FragColor = mix(texture2D(uHistory, vUv), texture2D(uCurrent, vUv), uWeight); }`;
/** Most frames averaged into a still view. */
const MAX_ACCUM = 24;
import { notificationManager } from "../../classes/NotificationManager";

/** Auto quality (§5.8): drop a preset if frames average over this for AUTO_SLOW_MS. */
const AUTO_FRAME_MS = 25;
const AUTO_SLOW_MS = 5000;
const LOWER: Record<WeatherQuality, WeatherQuality | null> = { high: "medium", medium: "low", low: null };

/**
 * The weather render pipeline (specs/weather-clouds-visibility.md §5.1):
 *
 *   P1 scene     camera on LAYER_ENV            → sceneRT (colour + log depth)
 *   P2 depth     log depth → linear view depth  → depthRT, and depthLowRT at cloud res
 *   P3 clouds    raymarch layers + rain shafts  → cloudRT (radiance, transmittance)
 *   P4 composite cloud shadows, darkening, haze, horizon fog and clouds, blended onto
 *                sceneRT (a multiply pass, then an add pass: final = scene·keep + add)
 *   P5 overlays  camera on LAYER_OVERLAY         → sceneRT, depth-tested against P1
 *   P6 output    linear → sRGB                    → canvas
 *
 * When there's nothing weather-related to draw (or in the planner), the scene is
 * rendered straight to the canvas as before.
 */

/** temporal: average jittered frames while nothing changes (a still view converges); cheap, so on at every level. */
const QUALITY: Record<WeatherQuality, { scale: number; steps: number; light: number; detail: boolean; temporal: boolean }> = {
  low: { scale: 0.25, steps: 40, light: 3, detail: false, temporal: true },
  medium: { scale: 0.5, steps: 64, light: 4, detail: true, temporal: true },
  high: { scale: 0.5, steps: 128, light: 6, detail: true, temporal: true },
};

const FULLSCREEN_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const DEPTH_FRAG = /* glsl */ `
uniform sampler2D uDepth;
uniform float uLogFar;
varying vec2 vUv;
void main() {
  float d = texture2D(uDepth, vUv).r;
  // three's log depth: d = log2(1 + w) / log2(far + 1), w = view depth (scene units)
  float w = d >= 1.0 ? -1.0 : exp2(d * uLogFar) - 1.0;
  gl_FragColor = vec4(w, 0.0, 0.0, 1.0);
}`;

const COPY_DEPTH_FRAG = /* glsl */ `
uniform sampler2D uSrc;
varying vec2 vUv;
void main() { gl_FragColor = vec4(texture2D(uSrc, vUv).r, 0.0, 0.0, 1.0); }`;

const COMPOSITE_FRAG = /* glsl */ `
${COVERAGE_GLSL}
${HAZE_GLSL}
uniform sampler2D uViewDepth;   // view depth (scene units); < 0 for sky
uniform sampler2D uCloud;       // (radiance, transmittance) at cloud resolution
uniform sampler2D uCloudDepth;  // view depth at cloud resolution
uniform vec2 uCloudSize;
uniform float uCloudOn;
uniform float uShadowOn;
uniform vec3 uSunDir;
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
uniform vec3 uCamPosM;          // camera position (m)
uniform float uWorldScale;
uniform float uSkyDist;         // sky rays integrate this far (m)
uniform vec3 uHazeColor;
uniform float uDarken;
uniform vec3 uTint;
uniform float uFogOn;           // today's horizon fog (scene.fog), view depth in scene units
uniform float uFogNear;
uniform float uFogFar;
uniform vec3 uFogColor;
uniform float uMode;            // 0: multiply factor, 1: added light
varying vec2 vUv;

float depthKey(float w) { return w < 0.0 ? 1e9 : w; }

/** Upsample the clouds, taking the low-res texel whose depth best matches this pixel. */
vec4 cloudAt(vec2 uv, float wFull) {
  vec2 px = uv * uCloudSize - 0.5;
  ivec2 i0 = ivec2(floor(px));
  ivec2 hi = ivec2(uCloudSize) - 1;
  float kf = depthKey(wFull);
  float best = 1e30;
  float spread = 0.0;
  vec4 pick = vec4(0.0, 0.0, 0.0, 1.0);
  for (int k = 0; k < 4; k++) {
    ivec2 q = clamp(i0 + ivec2(k & 1, k >> 1), ivec2(0), hi);
    float dk = abs(depthKey(texelFetch(uCloudDepth, q, 0).r) - kf);
    spread = max(spread, dk);
    if (dk < best) { best = dk; pick = texelFetch(uCloud, q, 0); }
  }
  // depths agree: smooth bilinear; across an edge: the matching side only
  return spread < 0.05 * min(kf, 1e8) ? texture2D(uCloud, uv) : pick;
}

void main() {
  float w = texture2D(uViewDepth, vUv).r;
  bool sky = w < 0.0;
  vec4 p = uInvProj * vec4(vUv * 2.0 - 1.0, -1.0, 1.0);
  vec3 v = p.xyz / p.w;
  vec3 endM;
  float L;
  if (sky) {
    vec3 dir = normalize((uCamWorld * vec4(v, 0.0)).xyz);
    L = uSkyDist;
    endM = uCamPosM + dir * L;
  } else {
    vec3 viewPos = v * (w / -v.z);
    endM = (uCamWorld * vec4(viewPos, 1.0)).xyz / uWorldScale;
    L = length(endM - uCamPosM);
  }

  // cloud shadows on the ground (and anything else below a layer)
  float shadow = 1.0;
  if (!sky && uShadowOn > 0.5 && uSunDir.y > 0.05) {
    for (int i = 0; i < MAX_LAYERS; i++) {
      if (i >= uLayerCount) break;
      float hMid = 0.5 * (uLayerA[i].x + uLayerA[i].y);
      if (endM.y >= hMid) continue;
      vec2 q = endM.xz + uSunDir.xz * ((hMid - endM.y) / uSunDir.y);
      shadow *= 1.0 - uLayerD[i].w * coverageAt(i, q);
    }
  }

  float T = exp(-opticalDepth(uCamPosM.y, endM.y, L));
  float f = (!sky && uFogOn > 0.5) ? smoothstep(uFogNear, uFogFar, w) : 0.0;
  vec3 keep = (1.0 - uDarken) * uTint * shadow * T * (1.0 - f);
  vec3 added = uHazeColor * (1.0 - T) * (1.0 - f) + uFogColor * f;
  if (uCloudOn > 0.5) {
    vec4 c = cloudAt(vUv, w);
    keep *= c.a;
    added = added * c.a + c.rgb;
  }
  gl_FragColor = vec4(uMode < 0.5 ? keep : added, 1.0);
}`;

const OUTPUT_FRAG = /* glsl */ `
uniform sampler2D uColor;
varying vec2 vUv;
void main() {
  gl_FragColor = vec4(texture2D(uColor, vUv).rgb, 1.0);
  #include <colorspace_fragment>
}`;

export class WeatherRenderer {
  /** Debug: run the pipeline even with nothing to draw (parity checks, A9). */
  forcePipeline = false;
  /** Whether the last frame went through the pipeline. */
  active = false;
  readonly clouds = new CloudVolume();
  /** Rain and snow around the camera (§5.4). */
  readonly precipitation = new PrecipitationParticles(this.clouds);
  /** Optional planner cloud-cover layer (§5.7) and visibility ring (§5.6). */
  readonly plannerClouds = new PlannerClouds(this.clouds);
  readonly visibilityRing = new VisibilityRing();
  private focus: { view: () => THREE.Vector3 | null; planner: () => THREE.Vector3 | null } | null = null;
  private history: THREE.WebGLRenderTarget[] = [];
  private accumMat: THREE.ShaderMaterial;
  private accumCount = 0;
  private accumKey: number[] = [];
  private historyIndex = 0;

  private renderer: THREE.WebGLRenderer;
  private sun: THREE.DirectionalLight | null = null;
  private sceneRT: THREE.WebGLRenderTarget;
  private depthRT: THREE.WebGLRenderTarget;
  private depthLowRT: THREE.WebGLRenderTarget;
  private cloudRT: THREE.WebGLRenderTarget;
  private quadScene = new THREE.Scene();
  private quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quad: THREE.Mesh;
  private depthMat: THREE.ShaderMaterial;
  private copyDepthMat: THREE.ShaderMaterial;
  private cloudMat: THREE.ShaderMaterial | null = null;
  private multiplyMat: THREE.ShaderMaterial;
  private addMat: THREE.ShaderMaterial;
  private outputMat: THREE.ShaderMaterial;
  private size = new THREE.Vector2();
  private quality: WeatherQuality | null = null;
  private frame = 0;
  private emptyCoverage = new THREE.DataTexture(new Uint8Array(4), 1, 1);

  private current: AtmosphereParams | null = null;
  private frameMsAvg = 0;
  private slowSince = 0;
  private autoToastShown = false;
  private lastTime = performance.now();
  private v3 = new THREE.Vector3();

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    renderer.getDrawingBufferSize(this.size);
    const { x: w, y: h } = this.size;
    this.sceneRT = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      depthBuffer: true,
      depthTexture: new THREE.DepthTexture(w, h, THREE.FloatType),
    });
    const floatTarget = (fw: number, fh: number) =>
      new THREE.WebGLRenderTarget(fw, fh, {
        type: THREE.FloatType,
        format: THREE.RedFormat,
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        depthBuffer: false,
      });
    this.depthRT = floatTarget(w, h);
    this.depthLowRT = floatTarget(1, 1);
    this.cloudRT = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
    });
    this.emptyCoverage.needsUpdate = true;
    this.history = [0, 1].map(
      () =>
        new THREE.WebGLRenderTarget(1, 1, {
          type: THREE.HalfFloatType,
          minFilter: THREE.LinearFilter,
          magFilter: THREE.LinearFilter,
          depthBuffer: false,
        }),
    );

    this.depthMat = this.fullscreen(DEPTH_FRAG, {
      uDepth: { value: this.sceneRT.depthTexture },
      uLogFar: { value: 1 },
    });
    this.copyDepthMat = this.fullscreen(COPY_DEPTH_FRAG, { uSrc: { value: this.depthRT.texture } });

    // final = scene · keep + added: a multiply pass, then an additive pass
    this.multiplyMat = this.fullscreen(COMPOSITE_FRAG, this.compositeUniforms());
    this.multiplyMat.blending = THREE.CustomBlending;
    this.multiplyMat.blendSrc = THREE.ZeroFactor;
    this.multiplyMat.blendDst = THREE.SrcColorFactor;
    this.addMat = this.fullscreen(COMPOSITE_FRAG, this.compositeUniforms());
    this.addMat.uniforms.uMode.value = 1;
    this.addMat.blending = THREE.CustomBlending;
    this.addMat.blendSrc = THREE.OneFactor;
    this.addMat.blendDst = THREE.OneFactor;
    [this.multiplyMat, this.addMat].forEach((m) => (m.defines = { MAX_LAYERS }));

    this.outputMat = this.fullscreen(OUTPUT_FRAG, { uColor: { value: this.sceneRT.texture } });
    this.accumMat = this.fullscreen(ACCUM_FRAG, {
      uCurrent: { value: this.cloudRT.texture },
      uHistory: { value: null },
      uWeight: { value: 1 },
    });

    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.depthMat);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
    this.resizeCloudTargets();
  }

  /** Use this light's direction as the sun for cloud lighting and shadows. */
  /** Where the visibility ring and planner cloud layer centre (metres). */
  setFocus(focus: { view: () => THREE.Vector3 | null; planner: () => THREE.Vector3 | null }) {
    this.focus = focus;
  }

  setSun(light: THREE.DirectionalLight) {
    this.sun = light;
  }

  /** Call when the canvas changes size. */
  setSize() {
    this.renderer.getDrawingBufferSize(this.size);
    const { x: w, y: h } = this.size;
    this.sceneRT.setSize(w, h);
    this.depthRT.setSize(w, h);
    this.resizeCloudTargets();
  }

  /** Render one frame of `scene` from `camera` (replaces renderer.render). */
  render(scene: THREE.Scene, camera: THREE.Camera, opts: { planner?: boolean } = {}) {
    const now = performance.now();
    const dt = Math.min(1, (now - this.lastTime) / 1000);
    this.lastTime = now;
    const display = weatherDisplay.get();
    const state = weatherService.get();
    const p = this.ease(dt);
    const simTime = Number((window as any).simulationTime) || 0;
    this.clouds.update(dt, state, display, simTime);
    this.precipitation.update(state, display, this.clouds, camera, this.renderer, !!opts.planner);
    const center = (opts.planner ? this.focus?.planner() : this.focus?.view()) ?? null;
    this.plannerClouds.update(this.clouds, !!opts.planner && display.plannerClouds, center);
    this.visibilityRing.update(display.visibilityRing, state?.visibilityM ?? NaN, center);

    const persp = (camera as THREE.PerspectiveCamera).isPerspectiveCamera === true;
    const needed =
      p.sigma0 > 1e-7 || p.darken > 0.002 || Math.abs(p.tint.x - 1) > 0.002 || this.clouds.active;
    this.active = !opts.planner && persp && (needed || this.forcePipeline);
    if (!this.active) {
      this.renderer.render(scene, camera);
      return;
    }
    this.watchFrameRate(dt, now, display.quality);
    if (display.quality !== this.quality) this.setQuality(display.quality);
    this.renderPipeline(scene, camera as THREE.PerspectiveCamera, p, state?.surface.isDay ?? true, display.cloudShadows);
  }

  /** Clouds cost the most: if they keep frames slow, step quality down (once per level). */
  private watchFrameRate(dt: number, now: number, quality: WeatherQuality) {
    if (!this.clouds.active || dt > 0.25 || (typeof document !== "undefined" && document.hidden)) {
      this.slowSince = 0;
      return;
    }
    this.frameMsAvg = this.frameMsAvg * 0.9 + dt * 1000 * 0.1;
    if (this.frameMsAvg <= AUTO_FRAME_MS) {
      this.slowSince = 0;
      return;
    }
    if (!this.slowSince) this.slowSince = now;
    const lower = LOWER[quality];
    if (now - this.slowSince < AUTO_SLOW_MS || !lower) return;
    this.slowSince = 0;
    this.frameMsAvg = 0;
    weatherDisplay.set({ quality: lower });
    if (!this.autoToastShown) {
      this.autoToastShown = true;
      notificationManager.info(
        `Clouds lowered to ${lower[0].toUpperCase() + lower.slice(1)} quality to keep the frame rate up. Change it in the Weather tab.`,
        { duration: 8000 },
      );
    }
  }

  dispose() {
    [this.sceneRT, this.depthRT, this.depthLowRT, this.cloudRT].forEach((t) => t.dispose());
    [this.depthMat, this.copyDepthMat, this.cloudMat, this.multiplyMat, this.addMat, this.outputMat].forEach((m) => m?.dispose());
    this.quad.geometry.dispose();
  }

  // ------------------------------------------------------------------ internals

  private fullscreen(fragmentShader: string, uniforms: Record<string, THREE.IUniform>) {
    return new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader,
      uniforms,
      depthTest: false,
      depthWrite: false,
    });
  }

  private layerUniforms() {
    const c = this.clouds;
    return {
      uCoverage: { value: this.emptyCoverage as THREE.Texture },
      uCoverageSize: { value: new THREE.Vector2(COVERAGE_SIZE, COVERAGE_SIZE) },
      uLayerA: { value: c.a },
      uLayerB: { value: c.b },
      uLayerC: { value: c.c },
      uLayerD: { value: c.d },
      uLayerCount: { value: 0 },
    };
  }

  private compositeUniforms(): Record<string, THREE.IUniform> {
    return {
      ...this.layerUniforms(),
      uViewDepth: { value: this.depthRT.texture },
      uCloud: { value: this.cloudRT.texture },
      uCloudDepth: { value: this.depthLowRT.texture },
      uCloudSize: { value: new THREE.Vector2(1, 1) },
      uCloudOn: { value: 0 },
      uShadowOn: { value: 0 },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uInvProj: { value: new THREE.Matrix4() },
      uCamWorld: { value: new THREE.Matrix4() },
      uCamPosM: { value: new THREE.Vector3() },
      uWorldScale: { value: WORLD_SCALE },
      uSigma0: { value: 0 },
      uMixTop: { value: 1000 },
      uScaleH: { value: WEATHER_VISUALS.hazeScaleHeightM },
      uSkyDist: { value: WEATHER_VISUALS.hazeSkyDistanceM },
      uHazeColor: { value: new THREE.Color() },
      uDarken: { value: 0 },
      uTint: { value: new THREE.Vector3(1, 1, 1) },
      uFogOn: { value: 0 },
      uFogNear: { value: 0 },
      uFogFar: { value: 1 },
      uFogColor: { value: new THREE.Color() },
      uMode: { value: 0 },
    };
  }

  private setQuality(q: WeatherQuality) {
    this.quality = q;
    const cfg = QUALITY[q];
    this.cloudMat?.dispose();
    this.cloudMat = this.fullscreen(CLOUD_FRAG, {
      ...this.layerUniforms(),
      uViewDepth: { value: this.depthLowRT.texture },
      uShape: { value: null },
      uDetail: { value: null },
      uInvProj: { value: new THREE.Matrix4() },
      uCamWorld: { value: new THREE.Matrix4() },
      uCamPosM: { value: new THREE.Vector3() },
      uWorldScale: { value: WORLD_SCALE },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Vector3() },
      uAmbTop: { value: new THREE.Vector3() },
      uAmbBottom: { value: new THREE.Vector3() },
      uHazeColor: { value: new THREE.Color() },
      uRainColor: { value: new THREE.Vector3() },
      uRain: { value: this.clouds.rain },
      uTime: { value: 0 },
      uFrame: { value: 0 },
      uMaxDist: { value: 40000 },
      uSigma0: { value: 0 },
      uMixTop: { value: 1000 },
      uScaleH: { value: WEATHER_VISUALS.hazeScaleHeightM },
    });
    this.cloudMat.defines = {
      MAX_LAYERS,
      MAX_STEPS: cfg.steps,
      LIGHT_STEPS: cfg.light,
      ...(cfg.detail ? { USE_DETAIL: 1 } : {}),
    };
    this.resizeCloudTargets();
  }

  private resizeCloudTargets() {
    const scale = QUALITY[this.quality ?? "medium"].scale;
    const w = Math.max(1, Math.round(this.size.x * scale));
    const h = Math.max(1, Math.round(this.size.y * scale));
    this.depthLowRT.setSize(w, h);
    this.cloudRT.setSize(w, h);
    this.history.forEach((t) => t.setSize(w, h));
    this.accumCount = 0;
    for (const m of [this.multiplyMat, this.addMat]) m?.uniforms.uCloudSize.value.set(w, h);
  }

  /** Move the drawn haze/darkening toward the weather's targets over ~easeS seconds. */
  private ease(dt: number): AtmosphereParams {
    const target = atmosphereTargets(weatherService.get(), weatherDisplay.get());
    if (!this.current) {
      this.current = target;
      return target;
    }
    const c = this.current;
    const a = 1 - Math.exp(-dt / (WEATHER_VISUALS.easeS / 3));
    // ease, then land exactly on the target so a still view can settle (temporal smoothing)
    const snap = (x: number, t: number, eps: number) => (Math.abs(t - x) <= eps ? t : x + (t - x) * a);
    c.sigma0 = snap(c.sigma0, target.sigma0, target.sigma0 * 1e-3 + 1e-9);
    c.mixTopM = snap(c.mixTopM, target.mixTopM, 0.5);
    c.darken = snap(c.darken, target.darken, 1e-4);
    for (const k of ["r", "g", "b"] as const) c.color[k] = snap(c.color[k], target.color[k], 1e-4);
    for (const k of ["x", "y", "z"] as const) c.tint[k] = snap(c.tint[k], target.tint[k], 1e-4);
    if (target.sigma0 === 0 && c.sigma0 < 1e-7) c.sigma0 = 0;
    if (target.darken === 0 && c.darken < 0.002) c.darken = 0;
    return c;
  }

  private sunDirection(target: THREE.Vector3) {
    if (!this.sun) return target.set(0.577, 0.577, 0.577);
    return target.copy(this.sun.position).sub(this.sun.target.position).normalize();
  }

  private renderPipeline(
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    p: AtmosphereParams,
    isDay: boolean,
    shadows: boolean,
  ) {
    const r = this.renderer;
    applyOverlayLayers();

    const savedMask = camera.layers.mask;
    const savedFog = scene.fog;
    const savedBackground = scene.background;
    const savedAutoClear = r.autoClear;
    const savedTarget = r.getRenderTarget();

    camera.updateMatrixWorld();
    const camPosM = camera.getWorldPosition(this.v3).divideScalar(WORLD_SCALE).clone();
    const sunDir = this.sunDirection(new THREE.Vector3());
    const cloudsOn = this.clouds.active;
    const coverage = this.clouds.coverage?.texture ?? this.emptyCoverage;
    const simTimeNow = Number((window as any).simulationTime) || 0;
    let cloudTex: THREE.Texture = this.cloudRT.texture;

    try {
      // P1: environment into sceneRT, without three's fog (the composite does it)
      scene.fog = null;
      camera.layers.set(LAYER_ENV);
      r.autoClear = true;
      r.setRenderTarget(this.sceneRT);
      r.render(scene, camera);

      // P2: linear depth (full and cloud resolution)
      this.depthMat.uniforms.uLogFar.value = Math.log2(camera.far + 1);
      this.drawQuad(this.depthMat, this.depthRT);

      // P3: clouds
      if (cloudsOn && this.cloudMat) {
        this.drawQuad(this.copyDepthMat, this.depthLowRT);
        const noise = getCloudNoise(r);
        const u = this.cloudMat.uniforms;
        u.uShape.value = noise.shape;
        u.uDetail.value = noise.detail;
        u.uCoverage.value = coverage;
        u.uLayerCount.value = this.clouds.count;
        u.uInvProj.value.copy(camera.projectionMatrixInverse);
        u.uCamWorld.value.copy(camera.matrixWorld);
        u.uCamPosM.value.copy(camPosM);
        u.uSunDir.value.copy(sunDir);
        // lighting dims with rain. Not at night: the map is always lit as daytime by the
        // scene's fixed light (§11), and night-dark clouds over a lit map read as one murk
        void isDay;
        const dim = 1 - 0.6 * p.darken;
        u.uSunColor.value.set(1.0, 0.96, 0.9).multiplyScalar(1.3 * dim);
        u.uAmbTop.value.set(0.42, 0.48, 0.58).multiplyScalar(dim);
        u.uAmbBottom.value.set(0.16, 0.18, 0.22).multiplyScalar(dim);
        u.uHazeColor.value.copy(p.color);
        u.uRainColor.value.set(0.17, 0.19, 0.22).multiplyScalar(dim);
        u.uTime.value = Number((window as any).simulationTime) || 0;
        u.uFrame.value = this.frame++ % 64;
        u.uSigma0.value = p.sigma0;
        u.uMixTop.value = p.mixTopM;
        this.drawQuad(this.cloudMat, this.cloudRT);
        cloudTex = this.accumulate(camera, simTimeNow, p);
      }

      // P4: shadows, darkening, haze, the old horizon fog and the clouds
      const fog = savedFog as THREE.Fog | null;
      for (const m of [this.multiplyMat, this.addMat]) {
        const u = m.uniforms;
        u.uInvProj.value.copy(camera.projectionMatrixInverse);
        u.uCamWorld.value.copy(camera.matrixWorld);
        u.uCamPosM.value.copy(camPosM);
        u.uSigma0.value = p.sigma0;
        u.uMixTop.value = p.mixTopM;
        u.uHazeColor.value.copy(p.color);
        u.uDarken.value = p.darken;
        u.uTint.value.copy(p.tint);
        u.uFogOn.value = fog && fog.isFog ? 1 : 0;
        if (fog && fog.isFog) {
          u.uFogNear.value = fog.near;
          u.uFogFar.value = fog.far;
          u.uFogColor.value.copy(fog.color);
        }
        u.uCloudOn.value = cloudsOn ? 1 : 0;
        u.uCloud.value = cloudTex;
        u.uShadowOn.value = cloudsOn && shadows ? 1 : 0;
        u.uSunDir.value.copy(sunDir);
        u.uCoverage.value = coverage;
        u.uLayerCount.value = cloudsOn ? this.clouds.count : 0;
      }
      r.autoClear = false;
      this.drawQuad(this.multiplyMat, this.sceneRT);
      this.drawQuad(this.addMat, this.sceneRT);

      // P5: overlays on top, depth-tested against the environment
      scene.background = null;
      camera.layers.set(LAYER_OVERLAY);
      r.setRenderTarget(this.sceneRT);
      r.render(scene, camera);
    } finally {
      camera.layers.mask = savedMask;
      scene.fog = savedFog;
      scene.background = savedBackground;
      r.autoClear = savedAutoClear;
    }

    // P6: to the canvas
    this.drawQuad(this.outputMat, savedTarget);
  }

  /**
   * Temporal smoothing (Medium/High): while the camera, sim time and weather stay the
   * same, average each new jittered cloud frame into a history buffer, so a still
   * view converges to clean clouds. Any change starts over from the current frame.
   */
  private accumulate(camera: THREE.Camera, simTime: number, p: AtmosphereParams): THREE.Texture {
    if (!QUALITY[this.quality ?? "medium"].temporal) {
      this.accumCount = 0;
      return this.cloudRT.texture;
    }
    const c = this.clouds;
    const key = [
      ...camera.matrixWorld.elements,
      ...(camera as THREE.PerspectiveCamera).projectionMatrix.elements,
      simTime,
      c.count,
      p.sigma0,
      p.darken,
      ...[c.a, c.b, c.c, c.d].flatMap((arr) => arr.slice(0, c.count).flatMap((v) => v.toArray())),
    ];
    const same = key.length === this.accumKey.length && key.every((v, i) => v === this.accumKey[i]);
    this.accumKey = key;
    this.accumCount = same ? Math.min(MAX_ACCUM, this.accumCount + 1) : 1;
    const src = this.history[this.historyIndex];
    const dst = this.history[1 - this.historyIndex];
    this.accumMat.uniforms.uHistory.value = src.texture;
    this.accumMat.uniforms.uWeight.value = 1 / this.accumCount;
    this.drawQuad(this.accumMat, dst);
    this.historyIndex = 1 - this.historyIndex;
    return dst.texture;
  }

  private drawQuad(material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    const autoClear = this.renderer.autoClear;
    this.renderer.autoClear = false;
    this.renderer.render(this.quadScene, this.quadCam);
    this.renderer.autoClear = autoClear;
  }
}
