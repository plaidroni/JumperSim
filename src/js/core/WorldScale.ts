import * as THREE from "three";

/**
 * World scale (specs/world-scale.md).
 *
 * Physics, plans and the map all work in metres. Everything positioned in metres
 * lives under `worldRoot`, which is drawn WORLD_SCALE times larger, and every model
 * inside it is at its true size. That keeps jumpers, aircraft and the ground in
 * proportion while jumpers stay the on-screen size they always had (the jumper model
 * used to be drawn ≈ 5.8× life size on a 1:1 map).
 */

/** Jumper model length (10.4 units) ÷ real body length (1.8 m). */
export const WORLD_SCALE = 5.8;

/** Jumper STL units → metres (10.4 units = 1.8 m). */
export const JUMPER_UNITS_TO_M = 1.8 / 10.4;

/** Aircraft are drawn this much larger than true size so they stay readable. */
export const PLANE_READABILITY = 1.25;

export const worldRoot = new THREE.Group();
worldRoot.name = "World (metres)";
worldRoot.scale.setScalar(WORLD_SCALE);
worldRoot.updateMatrixWorld(true);

export const toScene = (metres: number) => metres * WORLD_SCALE;
export const toMetres = (sceneUnits: number) => sceneUnits / WORLD_SCALE;

/** Scene-space point → metres (world frame). */
export function sceneToWorld(p: THREE.Vector3, target = new THREE.Vector3()) {
  return target.copy(p).divideScalar(WORLD_SCALE);
}

/** Metres (world frame) → scene-space point. */
export function worldToScene(p: THREE.Vector3, target = new THREE.Vector3()) {
  return target.copy(p).multiplyScalar(WORLD_SCALE);
}

(window as any).WORLD_SCALE = WORLD_SCALE;
