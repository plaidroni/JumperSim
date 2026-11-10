import * as THREE from "three";
import type { SimJumper, SimPlane } from "../classes/SimEntities";
import { hasJumperExited } from "../panels/jumperStatus";
import { poseHeading } from "../physics/Canopy";
import { JUMPER_UNITS_TO_M, WORLD_SCALE } from "../core/WorldScale";

/**
 * Zoomed-out markers (specs/world-scale.md §7). With the world at true proportions,
 * jumpers and the plane get small in wide shots, so each one gets a dot with an
 * arrowhead pointing along its direction of travel. Markers appear only while the
 * model is under 8 px on screen and fade out by 16 px, so close-ups look unchanged.
 * Markers are pickable and stand in for their jumper or plane.
 */

const SHOW_BELOW_PX = 8;
const HIDE_ABOVE_PX = 16;
const MARKER_PX = 18;
const JUMPER_LENGTH_SCENE = 10.4 * JUMPER_UNITS_TO_M * WORLD_SCALE;

function makeTexture(withArrow: boolean): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  g.lineJoin = "round";
  // arrowhead (points up = direction of travel)
  if (withArrow) {
    g.beginPath();
    g.moveTo(32, 3);
    g.lineTo(46, 24);
    g.lineTo(18, 24);
    g.closePath();
    g.fillStyle = "#ffffff";
    g.strokeStyle = "rgba(0,0,0,0.85)";
    g.lineWidth = 4;
    g.stroke();
    g.fill();
  }
  // plain dot
  g.beginPath();
  g.arc(32, 38, 11, 0, Math.PI * 2);
  g.fillStyle = "#ffffff";
  g.strokeStyle = "rgba(0,0,0,0.85)";
  g.lineWidth = 4;
  g.stroke();
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface Marker {
  sprite: THREE.Sprite;
  target: THREE.Object3D;
  length: number; // model length in scene units
}

let group: THREE.Group | null = null;
let getPlane: () => SimPlane = () => null as any;
let getJumpers: () => SimJumper[] = () => [];
const markers = new Map<THREE.Object3D, Marker>();
let arrowTex: THREE.CanvasTexture | null = null;
let dotTex: THREE.CanvasTexture | null = null;

export function initializeMarkers(scene: THREE.Scene, plane: () => SimPlane, jumpers: () => SimJumper[]) {
  group = new THREE.Group();
  group.name = "Zoomed-out markers";
  scene.add(group);
  getPlane = plane;
  getJumpers = jumpers;
  arrowTex = makeTexture(true);
  dotTex = makeTexture(false);
}

function colorOf(obj: THREE.Object3D, fallback: number): THREE.Color {
  let c: THREE.Color | null = null;
  obj.traverse((o: any) => {
    if (!c && o.material?.color) c = o.material.color.clone();
  });
  return c ?? new THREE.Color(fallback);
}

function markerFor(target: THREE.Object3D, isPlane: boolean): Marker {
  let m = markers.get(target);
  if (m) return m;
  const mat = new THREE.SpriteMaterial({
    map: arrowTex!,
    color: isPlane ? new THREE.Color(0xffffff) : colorOf(target, 0xf5c518),
    transparent: true,
    depthTest: false,
    sizeAttenuation: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.renderOrder = 50;
  sprite.userData.markerFor = target;
  group!.add(sprite);
  let length = JUMPER_LENGTH_SCENE;
  if (isPlane) {
    const size = new THREE.Box3().setFromObject(target).getSize(new THREE.Vector3());
    length = Math.max(size.x, size.y, size.z) || 15 * WORLD_SCALE;
  }
  m = { sprite, target, length };
  markers.set(target, m);
  return m;
}

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();

/** Position, size, fade and rotate the markers for this frame. */
export function updateMarkers(camera: THREE.Camera, renderer: THREE.WebGLRenderer, t: number) {
  if (!group) return;
  const vh = renderer.domElement.clientHeight || 1;
  const ortho = (camera as THREE.OrthographicCamera).isOrthographicCamera;
  const persp = camera as THREE.PerspectiveCamera;
  const orth = camera as THREE.OrthographicCamera;
  const unitsPerPxOrtho = ortho ? (orth.top - orth.bottom) / orth.zoom / vh : 0;
  const tanHalf = ortho ? 0 : Math.tan(THREE.MathUtils.degToRad(persp.fov) / 2);
  camera.updateMatrixWorld();

  const live = new Set<THREE.Object3D>();
  const plane = getPlane();
  const items: { target: THREE.Object3D; isPlane: boolean; jumper?: SimJumper }[] = [];
  const planeMesh = plane?.getMesh?.();
  if (planeMesh) items.push({ target: planeMesh, isPlane: true });
  for (const j of getJumpers() ?? []) {
    const mesh = j.getMesh?.();
    if (mesh && plane && hasJumperExited(j, plane, t)) items.push({ target: mesh, isPlane: false, jumper: j });
  }

  for (const it of items) {
    live.add(it.target);
    const m = markerFor(it.target, it.isPlane);
    const pos = it.target.getWorldPosition(tmpA);
    m.sprite.position.copy(pos);

    // how big is the model on screen?
    let sizePx: number;
    if (ortho) sizePx = m.length / unitsPerPxOrtho;
    else {
      const dist = Math.max(1e-3, camera.position.distanceTo(pos));
      sizePx = (m.length / dist) * (vh / (2 * tanHalf));
    }
    const alpha =
      sizePx <= SHOW_BELOW_PX ? 1 : sizePx >= HIDE_ABOVE_PX ? 0 : 1 - (sizePx - SHOW_BELOW_PX) / (HIDE_ABOVE_PX - SHOW_BELOW_PX);
    const mat = m.sprite.material as THREE.SpriteMaterial;
    mat.opacity = alpha;
    m.sprite.visible = alpha > 0.02;
    if (!m.sprite.visible) continue;

    // constant pixel size
    const s = ortho ? MARKER_PX * unitsPerPxOrtho : (MARKER_PX / vh) * 2 * tanHalf;
    m.sprite.scale.set(s, s, 1);

    // arrow along the direction of travel (dot only when not moving sideways)
    let dir: THREE.Vector3 | null = null;
    if (it.isPlane) dir = new THREE.Vector3(plane.direction.x, 0, plane.direction.z);
    else if (it.jumper) {
      const smp = it.jumper.track.getInterpolatedSample(t);
      const landed = it.jumper.landTime !== null && t >= it.jumper.landTime;
      if (smp && !landed) {
        const v = new THREE.Vector3(smp.velocity.x, 0, smp.velocity.z);
        dir = v.lengthSq() > 0.25 ? v : poseHeading(smp.angle);
      }
    }
    if (!dir || dir.lengthSq() < 1e-9) {
      if (mat.map !== dotTex) {
        mat.map = dotTex;
        mat.needsUpdate = true;
      }
      mat.rotation = 0;
      continue;
    }
    if (mat.map !== arrowTex) {
      mat.map = arrowTex;
      mat.needsUpdate = true;
    }
    dir.normalize();
    tmpA.copy(pos).project(camera);
    tmpB.copy(pos).addScaledVector(dir, m.length).project(camera);
    // screen angle (NDC y is up); the texture's arrow points up
    const aspect = (renderer.domElement.clientWidth || 1) / vh;
    mat.rotation = Math.atan2(tmpB.y - tmpA.y, (tmpB.x - tmpA.x) * aspect) - Math.PI / 2;
  }

  for (const [target, m] of markers) {
    if (live.has(target)) continue;
    m.sprite.removeFromParent();
    (m.sprite.material as THREE.Material).dispose();
    markers.delete(target);
  }
}

/** Visible markers, for picking (each carries userData.markerFor). */
export function markerObjects(): THREE.Object3D[] {
  return [...markers.values()].filter((m) => m.sprite.visible).map((m) => m.sprite);
}
