import * as THREE from "three";

/**
 * Render layers for the weather pipeline (specs/weather-clouds-visibility.md §5.1).
 *
 * - LAYER_ENV (0, three's default): terrain, buildings, sky, plane, jumpers, canopies.
 *   Clouds, haze and darkening apply to these.
 * - LAYER_OVERLAY (1): planning overlays, trajectory lines, markers, labels, the
 *   height axis and wind tower. Drawn after the weather so they stay readable.
 *
 * Overlay roots register once; their whole subtree is put on the overlay layer before
 * each weather render, so groups that rebuild their children need no extra calls.
 * Cameras, lights and raycasters that must see overlays enable both layers.
 */

export const LAYER_ENV = 0;
export const LAYER_OVERLAY = 1;

const roots = new Set<THREE.Object3D>();

export function registerOverlay(...objs: Array<THREE.Object3D | null | undefined>) {
  for (const o of objs) {
    if (!o) continue;
    roots.add(o);
    setLayerDeep(o, LAYER_OVERLAY);
  }
}

export function unregisterOverlay(...objs: Array<THREE.Object3D | null | undefined>) {
  for (const o of objs) if (o) roots.delete(o);
}

/** Put every registered overlay subtree (including newly added children) on the overlay layer. */
export function applyOverlayLayers() {
  roots.forEach((r) => setLayerDeep(r, LAYER_OVERLAY));
}

function setLayerDeep(root: THREE.Object3D, layer: number) {
  root.traverse((o) => {
    if (o.layers.mask !== 1 << layer) o.layers.set(layer);
  });
}

/** A camera, light or raycaster that sees both the environment and the overlays. */
export function seeAllLayers(target: { layers: THREE.Layers }) {
  target.layers.enable(LAYER_ENV);
  target.layers.enable(LAYER_OVERLAY);
}
