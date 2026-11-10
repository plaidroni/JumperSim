import { WORLD_SCALE } from "../core/WorldScale";
import * as THREE from "three";
import {
  MS_TO_KT,
  STRONG_SHEAR_KT_PER_1000FT,
  WindLevel,
  currentWindProfile,
  vectorToFromDeg,
  windAtHeight,
  windShears,
} from "./WindProfile";

/**
 * Wind arrows on the height tower (HeightAxis):
 * - a solid, labelled arrow at every forecast level we have data for,
 * - a fainter arrow at each 1000 ft tower tick in between, interpolated,
 * - a pulsing red glow over any layer with strong wind shear.
 * Rebuilds itself whenever new weather arrives ("weather-updated" event).
 */

const FT = 0.3048;
const TICK_M = 1000 * FT;
const SKIP_NEAR_LEVEL_M = 60; // don't draw a tick arrow right on top of a data arrow

// arrow sizing (metres in the scene)
const M_PER_KT = 18;
const MIN_LEN = 40;
const MAX_LEN = 850;

const SPEED_STOPS: Array<[number, THREE.Color]> = [
  [0, new THREE.Color(0x6fb7ff)], // light winds: blue
  [15, new THREE.Color(0xffd700)], // moderate: gold (matches the UI accent)
  [30, new THREE.Color(0xff7a00)], // strong: orange (red is reserved for shear)
];

export class WindTower {
  readonly object = new THREE.Group();
  private towerX: number;
  private towerTop: number;
  private disposables: Array<{ dispose(): void }> = [];
  private shaftGeo: THREE.CylinderGeometry;
  private headGeo: THREE.ConeGeometry;
  private glowTexture: THREE.Texture;
  private onWeather = () => this.rebuild();

  constructor(towerX: number, towerTop: number) {
    this.towerX = towerX;
    this.towerTop = towerTop;
    this.object.name = "WindTower";

    // unit arrow parts along +Y, scaled per arrow
    this.shaftGeo = new THREE.CylinderGeometry(1, 1, 1, 10);
    this.shaftGeo.translate(0, 0.5, 0);
    this.headGeo = new THREE.ConeGeometry(1, 1, 14);
    this.headGeo.translate(0, 0.5, 0);
    this.glowTexture = makeGlowTexture();

    window.addEventListener("weather-updated", this.onWeather);
    this.rebuild();
  }

  setVisible(visible: boolean) {
    this.object.visible = visible;
  }

  dispose() {
    window.removeEventListener("weather-updated", this.onWeather);
    this.clear();
    this.shaftGeo.dispose();
    this.headGeo.dispose();
    this.glowTexture.dispose();
  }

  /** Rebuild from the snapshot the sim is using. */
  rebuild() {
    this.clear();
    const levels = currentWindProfile().filter(
      (l) => l.heightM <= this.towerTop,
    );
    if (levels.length === 0) return;

    // forecast levels: solid + labelled
    for (const level of levels) {
      this.addArrow(level.heightM, level.vector, true);
      this.addLabel(
        level.heightM,
        `${Math.round(level.speedKt)} kt  ${pad3(level.fromDeg)}°`,
        "#ffffff",
        "right",
      );
    }

    // 1000 ft ticks between the lowest and highest level: interpolated
    const lo = levels[0].heightM;
    const hi = levels[levels.length - 1].heightM;
    const v = new THREE.Vector3();
    for (let h = Math.ceil(lo / TICK_M) * TICK_M; h < hi; h += TICK_M) {
      if (levels.some((l) => Math.abs(l.heightM - h) < SKIP_NEAR_LEVEL_M)) continue;
      windAtHeight(levels, h, v);
      this.addArrow(h, v, false);
    }

    // strong shear between adjacent levels: red glow over that layer
    for (const shear of windShears(levels)) {
      if (shear.ktPer1000ft >= STRONG_SHEAR_KT_PER_1000FT) {
        this.addShearGlow(shear.lower, shear.upper, shear.ktPer1000ft);
      }
    }
  }

  // ------------------------------------------------------------------ drawing

  private addArrow(heightM: number, vector: THREE.Vector3, isLevel: boolean) {
    const speedKt = vector.length() * MS_TO_KT;
    if (speedKt < 0.5) return; // calm: nothing to point
    const len = THREE.MathUtils.clamp(speedKt * M_PER_KT, MIN_LEN, MAX_LEN);
    const headLen = Math.min(110, len * 0.35);
    const shaftLen = len - headLen;
    const shaftR = isLevel ? 8 : 5;
    const headR = isLevel ? 26 : 17;

    const material = new THREE.MeshBasicMaterial({
      color: speedColor(speedKt),
      transparent: !isLevel,
      opacity: isLevel ? 1 : 0.5,
      depthWrite: isLevel,
    });
    this.disposables.push(material);

    const arrow = new THREE.Group();
    const shaft = new THREE.Mesh(this.shaftGeo, material);
    shaft.scale.set(shaftR, shaftLen, shaftR);
    const head = new THREE.Mesh(this.headGeo, material);
    head.scale.set(headR, headLen, headR);
    head.position.y = shaftLen;
    arrow.add(shaft, head);

    // point the +Y-built arrow along the horizontal wind direction
    const dir = vector.clone().setY(0).normalize();
    arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    arrow.position.set(this.towerX, heightM, 0);
    arrow.userData.windKt = speedKt;
    arrow.userData.fromDeg = vectorToFromDeg(vector);
    this.object.add(arrow);
  }

  private addLabel(
    heightM: number,
    text: string,
    color: string,
    side: "left" | "right",
  ) {
    const sprite = makeTextSprite(text, color);
    sprite.position.set(this.towerX, heightM, 0);
    // anchor the label beside the tower on screen, whichever way the camera faces
    // and just above the arrow so it doesn't cover it
    sprite.center.set(side === "right" ? -0.06 : 1.06, -0.2);
    this.disposables.push(sprite.material, sprite.material.map!);
    this.object.add(sprite);
  }

  private addShearGlow(lower: WindLevel, upper: WindLevel, ktPer1000ft: number) {
    const severity = THREE.MathUtils.clamp(
      (ktPer1000ft - STRONG_SHEAR_KT_PER_1000FT) / STRONG_SHEAR_KT_PER_1000FT,
      0,
      1,
    );
    const baseOpacity = 0.45 + 0.45 * severity;
    const material = new THREE.SpriteMaterial({
      map: this.glowTexture,
      color: 0xff2a2a,
      transparent: true,
      opacity: baseOpacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    this.disposables.push(material);

    const glow = new THREE.Sprite(material);
    const span = upper.heightM - lower.heightM;
    glow.position.set(this.towerX, (lower.heightM + upper.heightM) / 2, 0);
    glow.scale.set(220 + 120 * severity, span * 1.15, 1);
    glow.renderOrder = 2;
    // gentle pulse so it reads as a warning
    glow.onBeforeRender = () => {
      const t = performance.now() / 1000;
      material.opacity = baseOpacity * (0.75 + 0.25 * Math.sin(t * 2.6));
    };
    this.object.add(glow);

    this.addLabel(
      (lower.heightM + upper.heightM) / 2,
      `Shear ${Math.round(ktPer1000ft)} kt/1000 ft`,
      "#ff6b6b",
      "left",
    );
  }

  private clear() {
    for (const child of [...this.object.children]) this.object.remove(child);
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
  }
}

// ---------------------------------------------------------------------- helpers

function speedColor(kt: number): THREE.Color {
  if (kt <= SPEED_STOPS[0][0]) return SPEED_STOPS[0][1].clone();
  for (let i = 0; i < SPEED_STOPS.length - 1; i++) {
    const [k0, c0] = SPEED_STOPS[i];
    const [k1, c1] = SPEED_STOPS[i + 1];
    if (kt <= k1) return c0.clone().lerp(c1, (kt - k0) / (k1 - k0));
  }
  return SPEED_STOPS[SPEED_STOPS.length - 1][1].clone();
}

function pad3(deg: number) {
  return String(Math.round(deg) % 360).padStart(3, "0");
}

function makeGlowTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.35, "rgba(255,255,255,0.55)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Screen-sized text label (doesn't shrink with distance). */
function makeTextSprite(text: string, color: string): THREE.Sprite {
  const font = "500 26px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
  const pad = 10;
  const measure = document.createElement("canvas").getContext("2d")!;
  measure.font = font;
  const w = Math.ceil(measure.measureText(text).width) + pad * 2;
  const h = 40;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "rgba(20,20,20,0.75)";
  roundRect(ctx, 0, 0, w, h, 6);
  ctx.fill();
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textBaseline = "middle";
  ctx.fillText(text, pad, h / 2 + 1);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    sizeAttenuation: false,
    fog: false,
  });
  const sprite = new THREE.Sprite(material);
  // label height ≈ 24 px on a 1080p screen; the tower sits under the world root,
  // whose scale would enlarge a screen-sized sprite too
  const pxToScreen = 0.0006 / WORLD_SCALE;
  sprite.scale.set(w * pxToScreen, h * pxToScreen, 1);
  sprite.renderOrder = 3;
  return sprite;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
