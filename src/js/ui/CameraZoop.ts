import * as THREE from "three";
import { WORLD_SCALE } from "../core/WorldScale";
import { getGroundHeight } from "../terrain/GroundHeight";

/**
 * "Zoop" the camera to the ground or back up to jump height, with two viewport
 * buttons and the G / J keys.
 *
 * - Ground: drops to eye height (1.8 m) on the terrain under whatever you're looking
 *   at, keeps your heading and looks slightly up, so you see the clouds from below.
 * - Jump height: flies back up to the plane (wherever it is in the sim right now) and
 *   follows it again.
 * Orbiting or zooming during the flight cancels it.
 */

const EYE_M = 1.8;
const LOOK_AHEAD_M = 500;
const LOOK_UP_M = 60; // ≈ 7° above the horizon
const COVERAGE_M = 7000; // stay over the detailed terrain
const DURATION_S = 1.6;
const PLANE_OFFSET = new THREE.Vector3(100, 100, 100); // the usual follow offset (scene units)

export interface ZoopDeps {
  camera: THREE.PerspectiveCamera;
  controls: { target: THREE.Vector3; update(): void; addEventListener(type: string, fn: () => void): void };
  viewport: HTMLElement;
  /** Stop following anything (the zoop owns the camera while it flies). */
  release(): void;
  /** Follow the plane again from where the camera is now. */
  followPlane(): void;
  planeMesh(): THREE.Object3D | null;
  plannerActive(): boolean;
}

interface Flight {
  fromPos: THREE.Vector3;
  fromTarget: THREE.Vector3;
  /** Recomputed each frame (the plane moves while the sim plays). */
  end(): { pos: THREE.Vector3; target: THREE.Vector3 };
  start: number;
  onDone?: () => void;
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export function initializeCameraZoop(d: ZoopDeps) {
  let flight: Flight | null = null;
  let flying = false; // our own controls.update() calls fire "start"? no, but guard anyway

  const fly = (end: Flight["end"], onDone?: () => void) => {
    if (d.plannerActive()) return;
    d.release();
    flight = {
      fromPos: d.camera.position.clone(),
      fromTarget: d.controls.target.clone(),
      end,
      start: performance.now(),
      onDone,
    };
    requestAnimationFrame(step);
  };

  const step = () => {
    if (!flight) return;
    const t = Math.min(1, (performance.now() - flight.start) / 1000 / DURATION_S);
    const k = ease(t);
    const { pos, target } = flight.end();
    flying = true;
    d.camera.position.lerpVectors(flight.fromPos, pos, k);
    d.controls.target.lerpVectors(flight.fromTarget, target, k);
    d.controls.update();
    flying = false;
    if (t < 1) {
      requestAnimationFrame(step);
      return;
    }
    const done = flight.onDone;
    flight = null;
    done?.();
  };

  // any manual orbit / zoom takes the camera back
  d.controls.addEventListener("start", () => {
    if (!flying) flight = null;
  });

  function toGround() {
    // the spot under what you're looking at, kept over the detailed terrain
    const lookM = d.controls.target.clone().divideScalar(WORLD_SCALE);
    const r = Math.hypot(lookM.x, lookM.z);
    if (r > COVERAGE_M) lookM.multiplyScalar(COVERAGE_M / r);
    const heading = new THREE.Vector3();
    d.camera.getWorldDirection(heading).setY(0);
    if (heading.lengthSq() < 1e-6) heading.set(0, 0, -1); // looking straight down: face north
    heading.normalize();
    // guard against an uncalibrated terrain lookup (heights are metres above the DZ)
    const raw = getGroundHeight(lookM.x, lookM.z);
    const groundM = Number.isFinite(raw) && Math.abs(raw) < 9000 ? raw : 0;
    const pos = new THREE.Vector3(lookM.x, groundM + EYE_M, lookM.z).multiplyScalar(WORLD_SCALE);
    const target = new THREE.Vector3(lookM.x, groundM + EYE_M + LOOK_UP_M, lookM.z)
      .addScaledVector(heading, LOOK_AHEAD_M)
      .multiplyScalar(WORLD_SCALE);
    fly(() => ({ pos, target }));
  }

  function toJumpHeight() {
    const plane = d.planeMesh();
    if (!plane) return;
    const centre = () => new THREE.Box3().setFromObject(plane).getCenter(new THREE.Vector3());
    fly(
      () => {
        const c = centre();
        return { pos: c.clone().add(PLANE_OFFSET), target: c };
      },
      () => d.followPlane(),
    );
  }

  // ------------------------------------------------------------------ UI
  const bar = document.createElement("div");
  bar.className = "cam-zoop";
  bar.innerHTML = `
    <button type="button" data-zoop="ground" title="Fly down to the ground (G)">⤓ Ground</button>
    <button type="button" data-zoop="jump" title="Fly back up to the plane at jump height (J)">⤒ Jump height</button>`;
  d.viewport.appendChild(bar);
  bar.querySelector('[data-zoop="ground"]')!.addEventListener("click", toGround);
  bar.querySelector('[data-zoop="jump"]')!.addEventListener("click", toJumpHeight);

  const typing = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA" || t.isContentEditable);
  };
  window.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || typing(e) || d.plannerActive()) return;
    const k = e.key.toLowerCase();
    if (k === "g") toGround();
    else if (k === "j") toJumpHeight();
  });

  const api = { toGround, toJumpHeight, get flying() { return !!flight; } };
  (window as any).cameraZoop = api;
  return api;
}
