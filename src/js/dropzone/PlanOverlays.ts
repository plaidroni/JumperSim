import { WORLD_SCALE } from "../core/WorldScale";
import * as THREE from "three";
import type { SimJumper, SimPlane } from "../classes/SimEntities";
import { DANGER_KINDS, mainLandingZone, type DropzonePlan } from "./DropzonePlan";
import { enToXZ, FT, offsetPolyline, polygonCentroid, type XZ } from "./geometry";
import {
  flyCanopyPattern,
  jumprunFrameOf,
  laneForOrder,
  laneOfPattern,
  meanWind,
  resolveFreefallPattern,
  type FlownPattern,
} from "./patternMath";
import { exitPoints } from "./Jumprun";
import { getGroundHeight } from "../terrain/GroundHeight";
import type { WindLevel } from "../wind/WindProfile";

/**
 * Everything the plan draws in the scene: landing and danger zones, the canopy pattern
 * (drawn, mirror and as flown), freefall patterns and lanes, the jumprun with exit
 * markers, and simulated hazard segments. Drawn flat on the ground in the planner and
 * in 3D (danger-zone ceiling walls, patterns at altitude) in the normal view.
 */

export interface OverlayLayers {
  lz: boolean;
  danger: boolean;
  canopy: boolean;
  freefall: boolean;
  jumprun: boolean;
  tracks: boolean;
}

export const DEFAULT_LAYERS: OverlayLayers = {
  lz: true,
  danger: true,
  canopy: true,
  freefall: true,
  jumprun: true,
  tracks: true,
};

export interface OverlayInput {
  plan: DropzonePlan;
  plane: SimPlane;
  jumpers: SimJumper[];
  wind: WindLevel[];
  planner: boolean;
  layers: OverlayLayers;
  /** Show the 3D overlays at all (Location tab → Zones & patterns). */
  show3D: boolean;
  selectedId: string | null;
}

const COLORS = {
  lz: 0x3ccf6e,
  canopy: 0xf5c518,
  canopyGhost: 0x8a7a2a,
  tracking: 0x4fa3ff,
  wingsuit: 0xc77dff,
  jumprun: 0xffffff,
  hazard: 0xff3b30,
};

interface ScreenItem {
  obj: THREE.Object3D;
  px: number;
  aspect: number;
}

/** A text label that keeps its on-screen size. */
export function makeLabel(text: string, color = "#ffffff", bg = "rgba(10,10,10,0.72)"): THREE.Sprite {
  const font = 26;
  const pad = 8;
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d")!;
  ctx.font = `600 ${font}px Inter, system-ui, sans-serif`;
  const w = Math.ceil(ctx.measureText(text).width) + pad * 2;
  const h = font + pad * 2;
  c.width = w;
  c.height = h;
  ctx.font = `600 ${font}px Inter, system-ui, sans-serif`;
  ctx.fillStyle = bg;
  ctx.beginPath();
  (ctx as any).roundRect ? (ctx as any).roundRect(0, 0, w, h, 8) : ctx.rect(0, 0, w, h);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.textBaseline = "middle";
  ctx.fillText(text, pad, h / 2 + 1);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, sizeAttenuation: false });
  const s = new THREE.Sprite(mat);
  s.renderOrder = 30;
  s.userData.aspect = w / h;
  s.userData.labelPx = 18;
  return s;
}

function lineMat(color: number, opacity = 1, dashed = false): THREE.Material {
  const m = dashed
    ? new THREE.LineDashedMaterial({ color, dashSize: 18, gapSize: 12, transparent: true, opacity })
    : new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity });
  return m;
}

function line(points: THREE.Vector3[], mat: THREE.Material, closed = false): THREE.Line {
  const geo = new THREE.BufferGeometry().setFromPoints(closed ? [...points, points[0]] : points);
  const l = new THREE.Line(geo, mat);
  if ((mat as any).isLineDashedMaterial) l.computeLineDistances();
  l.renderOrder = 20;
  l.frustumCulled = false;
  return l;
}

const ground = (p: XZ, lift = 2) => new THREE.Vector3(p.x, getGroundHeight(p.x, p.z) + lift, p.z);

/** Flat polygon draped on the terrain (each vertex at ground + lift). */
function fill(pts: XZ[], color: number, opacity: number, lift = 1.5): THREE.Mesh {
  const shape = new THREE.Shape(pts.map((p) => new THREE.Vector2(p.x, p.z)));
  const geo = new THREE.ShapeGeometry(shape);
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getY(i);
    pos.setXYZ(i, x, getGroundHeight(x, z) + lift, z);
  }
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    }),
  );
  mesh.renderOrder = 10;
  return mesh;
}

/** Ribbon for line zones (power lines, roads): the polyline buffered to its width. */
function ribbon(pts: XZ[], width: number): XZ[] {
  const left = offsetPolyline(pts, -width / 2);
  const right = offsetPolyline(pts, width / 2);
  return [...left, ...right.reverse()];
}

/** Translucent wall from the ground up to `heightM` along an outline. */
function wall(pts: XZ[], heightM: number, color: number): THREE.Mesh {
  const pos: number[] = [];
  const ring = [...pts, pts[0]];
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i];
    const b = ring[i + 1];
    const ya = getGroundHeight(a.x, a.z);
    const yb = getGroundHeight(b.x, b.z);
    pos.push(a.x, ya, a.z, b.x, yb, b.z, b.x, yb + heightM, b.z);
    pos.push(a.x, ya, a.z, b.x, yb + heightM, b.z, a.x, ya + heightM, a.z);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  const m = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false }),
  );
  m.renderOrder = 9;
  return m;
}

function arrowHead(at: THREE.Vector3, dir: THREE.Vector3, color: number, sizeM: number): THREE.Line {
  const d = dir.clone().setY(0).normalize();
  const r = new THREE.Vector3(-d.z, 0, d.x);
  const a = at.clone().addScaledVector(d, -sizeM).addScaledVector(r, sizeM * 0.5);
  const b = at.clone().addScaledVector(d, -sizeM).addScaledVector(r, -sizeM * 0.5);
  return line([a, at, b], lineMat(color));
}

export class PlanOverlays {
  readonly group = new THREE.Group();
  private screen: ScreenItem[] = [];
  /** The pattern drawn as flown (for the panel's label), updated on rebuild. */
  flown: FlownPattern | null = null;

  constructor(scene: THREE.Object3D) {
    this.group.name = "Dropzone plan";
    scene.add(this.group);
  }

  private clear() {
    this.group.traverse((o: any) => {
      o.geometry?.dispose?.();
      const m = o.material;
      if (m) (Array.isArray(m) ? m : [m]).forEach((mm: any) => (mm.map?.dispose?.(), mm.dispose?.()));
    });
    this.group.clear();
    this.screen = [];
  }

  private label(text: string, at: THREE.Vector3, color?: string, px = 18) {
    const s = makeLabel(text, color);
    s.position.copy(at);
    s.userData.labelPx = px;
    this.group.add(s);
    this.screen.push({ obj: s, px, aspect: s.userData.aspect });
    return s;
  }

  rebuild(i: OverlayInput) {
    this.clear();
    const { plan, planner, layers } = i;
    const g = this.group;
    g.visible = planner || i.show3D;
    if (!g.visible) return;
    const lift = planner ? 5 : 2;

    // ---------------------------------------------------------------- landing zones
    const mainLz = mainLandingZone(plan);
    if (layers.lz) {
      for (const lz of plan.landingZones) {
        if (lz.polygon.length < 3) continue;
        const pts = lz.polygon.map(enToXZ);
        g.add(fill(pts, COLORS.lz, lz.id === i.selectedId ? 0.35 : 0.2));
        g.add(line(pts.map((p) => ground(p, lift)), lineMat(COLORS.lz), true));
        const isMain = mainLz?.id === lz.id;
        this.label(`${isMain ? "Main · " : ""}${lz.name}`, ground(polygonCentroid(pts), lift + 1), "#7dffa8", 16);
      }
    }

    // ---------------------------------------------------------------- danger zones
    if (layers.danger) {
      for (const z of plan.dangerZones) {
        const raw = z.shape.points.map(enToXZ);
        if (raw.length < (z.shape.type === "line" ? 2 : 3)) continue;
        const color = DANGER_KINDS[z.kind]?.color ?? COLORS.hazard;
        const outline = z.shape.type === "line" ? ribbon(raw, (z.shape as any).widthM) : raw;
        g.add(fill(outline, color, z.id === i.selectedId ? 0.45 : 0.28));
        g.add(line(outline.map((p) => ground(p, lift)), lineMat(color), true));
        if (z.shape.type === "line") g.add(line(raw.map((p) => ground(p, lift)), lineMat(color, 0.9, true)));
        if (!planner && z.ceilingFt > 0) g.add(wall(outline, z.ceilingFt * FT, color));
        this.label(`${z.name} · ${z.ceilingFt} ft`, ground(polygonCentroid(raw), lift + 1), "#ffb3ad", 15);
      }
    }

    // ---------------------------------------------------------------- canopy pattern
    this.flown = null;
    if (layers.canopy && plan.canopyPattern) {
      const landingWind = i.wind.length ? meanWind(i.wind, 0, 250 * FT) : null;
      const flown = flyCanopyPattern(plan.canopyPattern, landingWind);
      this.flown = flown;
      const drawn = plan.canopyPattern.points.map(enToXZ);
      const T = drawn[3];
      // touchdown the user picked, and the spread around it
      const tRing: THREE.Vector3[] = [];
      const sp: THREE.Vector3[] = [];
      for (let k = 0; k <= 48; k++) {
        const a = (k / 48) * Math.PI * 2;
        tRing.push(ground({ x: T.x + Math.cos(a) * 6, z: T.z + Math.sin(a) * 6 }, lift + 1));
        const r = plan.canopyPattern.spreadM ?? 30;
        sp.push(ground({ x: T.x + Math.cos(a) * r, z: T.z + Math.sin(a) * r }, lift + 1));
      }
      g.add(line(tRing, lineMat(COLORS.canopy)));
      g.add(line(sp, lineMat(COLORS.canopy, 0.45, true)));
      this.label("Touchdown", ground(T, lift + 1), "#ffe27a", 14);
      // mirror image of the drawn pattern (always shown faint so both can be checked)
      const f = { x: T.x - drawn[2].x, z: T.z - drawn[2].z };
      const fl = Math.hypot(f.x, f.z) || 1;
      f.x /= fl;
      f.z /= fl;
      const mirror = drawn.map((p) => {
        const along = (p.x - T.x) * f.x + (p.z - T.z) * f.z;
        return { x: p.x - 2 * along * f.x, z: p.z - 2 * along * f.z };
      });
      const other = flown.mirrored ? drawn : mirror;
      g.add(line(other.map((p) => ground(p, lift)), lineMat(COLORS.canopyGhost, 0.7, true)));
      const fp = flown.points;
      const fpV = fp.map((p) => ground(p, lift + 1));
      g.add(line(fpV, lineMat(COLORS.canopy)));
      for (let k = 0; k < 3; k++) {
        const a = fpV[k];
        const b = fpV[k + 1];
        const mid = a.clone().lerp(b, 0.6);
        g.add(arrowHead(mid, b.clone().sub(a), COLORS.canopy, 14));
      }
      const names = ["Downwind", "Base", "Final"];
      for (let k = 0; k < 3; k++) {
        this.label(`${names[k]} ${plan.canopyPattern.legAltitudesFt[k]} ft`, fpV[k], "#ffe27a", 15);
      }
      if (!planner) {
        // 3D: the descending path as flown
        const alts = [...flown.altsM];
        const path = fp.map((p, k) => new THREE.Vector3(p.x, getGroundHeight(p.x, p.z) + alts[k], p.z));
        g.add(line(path, lineMat(COLORS.canopy, 0.9)));
      }
    }

    // ---------------------------------------------------------------- freefall patterns
    const frame = jumprunFrameOf(i.plane);
    const exitAlt = i.plane.initialPosition.y;
    if (layers.freefall) {
      for (const p of plan.freefallPatterns) {
        if (!p.legs.length) continue;
        const color = p.kind === "wingsuit" ? COLORS.wingsuit : COLORS.tracking;
        const r = resolveFreefallPattern(p, frame);
        const pts = [r.origin, ...r.legs.map((l) => l.point)];
        const selected = p.id === i.selectedId;
        g.add(line(pts.map((q) => ground(q, lift + 2)), lineMat(color, selected ? 1 : 0.85)));
        let gateY = exitAlt;
        for (let k = 1; k < pts.length; k++) {
          const a = ground(pts[k - 1], lift + 2);
          const b = ground(pts[k], lift + 2);
          g.add(arrowHead(a.clone().lerp(b, 0.55), b.clone().sub(a), color, 30));
          const leg = p.legs[k - 1];
          if (leg.end.by === "altitude") gateY = leg.end.ft * FT;
          const end =
            leg.end.by === "altitude" ? `${leg.end.ft.toLocaleString()} ft` : leg.end.by === "time" ? `${leg.end.s}s` : "arrive";
          const at = planner ? b : new THREE.Vector3(b.x, gateY, b.z);
          this.label(`${p.kind === "wingsuit" ? "W" : "T"}${k} · ${end}`, at, p.kind === "wingsuit" ? "#e3c2ff" : "#b8d8ff", 14);
        }
        // deploy area
        const last = pts[pts.length - 1];
        const ring: THREE.Vector3[] = [];
        for (let k = 0; k <= 40; k++) {
          const a = (k / 40) * Math.PI * 2;
          ring.push(ground({ x: last.x + Math.cos(a) * p.deployRadiusM, z: last.z + Math.sin(a) * p.deployRadiusM }, lift + 2));
        }
        g.add(line(ring, lineMat(color, 0.6, true)));
        // lanes of the selected pattern
        if (selected && planner) {
          for (let k = 1; k <= 4; k++) {
            const lane = laneForOrder(k);
            const lr = laneOfPattern(r, lane * p.laneSpacingM);
            const lp = [lr.origin, ...lr.legs.map((l) => l.point)];
            g.add(line(lp.map((q) => ground(q, lift + 1)), lineMat(color, 0.35, true)));
            this.label(`Lane ${lane > 0 ? "+" : ""}${lane}`, ground(lp[lp.length - 1], lift + 1), "#cccccc", 12);
          }
        }
        if (!planner) {
          // 3D: from exit altitude down through the leg gates
          let y = exitAlt;
          const path = pts.map((q, k) => {
            if (k > 0) {
              const e = p.legs[k - 1].end;
              if (e.by === "altitude") y = e.ft * FT;
            }
            return new THREE.Vector3(q.x, y, q.z);
          });
          g.add(line(path, lineMat(color, 0.7)));
        }
      }
    }

    // ---------------------------------------------------------------- jumprun
    if (layers.jumprun) {
      const exits = exitPoints(i.plane, i.jumpers);
      const y = planner ? getGroundHeight(frame.origin.x, frame.origin.z) + lift + 3 : exitAlt;
      const lastExit = exits.length ? exits[exits.length - 1] : null;
      const lenAlong = lastExit
        ? (lastExit.x - frame.origin.x) * frame.dir.x + (lastExit.z - frame.origin.z) * frame.dir.z + 300
        : 1200;
      const a = new THREE.Vector3(frame.origin.x, y, frame.origin.z);
      const b = new THREE.Vector3(frame.origin.x + frame.dir.x * lenAlong, y, frame.origin.z + frame.dir.z * lenAlong);
      g.add(line([a, b], lineMat(COLORS.jumprun, 0.95)));
      g.add(arrowHead(b, b.clone().sub(a), COLORS.jumprun, 40));
      this.label("Green light", a, "#7dffa8", 14);
      const seen = new Set<string>();
      for (const e of exits) {
        const key = `${Math.round(e.x / 5)}:${Math.round(e.z / 5)}`;
        if (seen.has(key)) continue; // linked groups exit together: one marker
        seen.add(key);
        const same = exits.filter((x) => `${Math.round(x.x / 5)}:${Math.round(x.z / 5)}` === key).map((x) => x.order);
        this.label(same.length > 1 ? `${same[0]}–${same[same.length - 1]}` : `${same[0]}`, new THREE.Vector3(e.x, y, e.z), "#ffffff", 13);
      }
    }

    // ---------------------------------------------------------------- simulated hazards
    if (layers.tracks) {
      for (const j of i.jumpers) {
        for (const ev of j.hazardEvents ?? []) {
          const pts: THREE.Vector3[] = [];
          for (let t = ev.start; t <= ev.end + 0.05; t += 0.2) {
            const s = j.track.getInterpolatedSample(t);
            if (s) pts.push(planner ? ground({ x: s.position.x, z: s.position.z }, lift + 4) : s.position.clone());
          }
          if (pts.length > 1) g.add(line(pts, lineMat(COLORS.hazard)));
        }
        if (planner && j.breakoffDistanceM && j.formationEndTime !== null && j.roundSlot === 1) {
          // round breakoff: centre, radial lanes and breakoff slots (drawn once per round)
          const c = j.track.getInterpolatedSample(j.formationEndTime);
          if (c) {
            const centre = { x: c.position.x, z: c.position.z };
            const ring: THREE.Vector3[] = [];
            for (let k = 0; k <= 48; k++) {
              const a = (k / 48) * Math.PI * 2;
              ring.push(ground({ x: centre.x + Math.cos(a) * j.breakoffDistanceM, z: centre.z + Math.sin(a) * j.breakoffDistanceM }, lift));
            }
            g.add(line(ring, lineMat(0xffffff, 0.35, true)));
          }
        }
      }
    }

    // planner: everything on top; 3D: depth tested (labels always on top)
    g.traverse((o: any) => {
      if (!o.material || o.isSprite) return;
      o.material.depthTest = !planner;
    });
  }

  /** Keep labels a constant size on screen. */
  updateScreenSizes(camera: THREE.Camera, viewportHeightPx: number) {
    const ortho = (camera as THREE.OrthographicCamera).isOrthographicCamera;
    let k: number;
    if (ortho) {
      const c = camera as THREE.OrthographicCamera;
      k = (c.top - c.bottom) / c.zoom / viewportHeightPx; // metres per pixel
    } else {
      const c = camera as THREE.PerspectiveCamera;
      k = (2 * Math.tan(THREE.MathUtils.degToRad(c.fov) / 2)) / viewportHeightPx;
    }
    // labels sit under the world root, which scales them by WORLD_SCALE again
    k /= WORLD_SCALE;
    for (const s of this.screen) {
      const h = s.px * k;
      s.obj.scale.set(h * s.aspect, h, 1);
    }
  }
}
