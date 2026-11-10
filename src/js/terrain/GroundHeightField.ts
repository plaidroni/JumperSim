import { worldRoot } from "../core/WorldScale";
import * as THREE from "three";

/**
 * A regular grid of ground heights (world Y, metres) centred on the DZ, built by
 * rasterising the loaded terrain triangles. Lookups are synchronous and cheap so the
 * physics precalculation can call them every step.
 *
 * Where several tiles cover the same cell, the finest one (smallest geometric error)
 * wins. Near-vertical triangles (terrain tile skirts) are ignored.
 */
export class GroundHeightField {
  readonly radius: number;
  readonly spacing: number;
  readonly size: number;
  private heights: Float32Array;
  private errors: Float32Array;
  private hasData = false;

  constructor(radius: number, spacing: number) {
    this.radius = radius;
    this.spacing = spacing;
    this.size = Math.floor((2 * radius) / spacing) + 1;
    this.heights = new Float32Array(this.size * this.size);
    this.errors = new Float32Array(this.size * this.size);
    this.clear();
  }

  clear() {
    this.heights.fill(NaN);
    this.errors.fill(Infinity);
    this.hasData = false;
  }

  get ready() {
    return this.hasData;
  }

  /**
   * Rasterise all loaded tile meshes into the grid.
   * @param forEachModel - iterator over (scene, tile) pairs, e.g. tiles.forEachLoadedModel
   */
  build(
    forEachModel: (cb: (scene: THREE.Object3D, tile: any) => void) => void,
  ) {
    this.clear();
    const v0 = new THREE.Vector3();
    const v1 = new THREE.Vector3();
    const v2 = new THREE.Vector3();

    // vertices are taken into the metre frame (worldRoot), not scene units
    worldRoot.updateMatrixWorld(true);
    const toMetres = new THREE.Matrix4().copy(worldRoot.matrixWorld).invert();
    const meshToMetres = new THREE.Matrix4();
    forEachModel((scene, tile) => {
      const error: number = tile?.geometricError ?? 0;
      scene.updateMatrixWorld(true);
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh || !mesh.geometry) return;
        const pos = mesh.geometry.getAttribute(
          "position",
        ) as THREE.BufferAttribute;
        if (!pos) return;
        const index = mesh.geometry.getIndex();
        const triCount = index ? index.count / 3 : pos.count / 3;

        // transform vertices to world space once
        const world = new Float32Array(pos.count * 3);
        const tmp = new THREE.Vector3();
        meshToMetres.multiplyMatrices(toMetres, mesh.matrixWorld);
        for (let i = 0; i < pos.count; i++) {
          tmp.fromBufferAttribute(pos, i).applyMatrix4(meshToMetres);
          world[i * 3] = tmp.x;
          world[i * 3 + 1] = tmp.y;
          world[i * 3 + 2] = tmp.z;
        }

        for (let t = 0; t < triCount; t++) {
          const a = index ? index.getX(t * 3) : t * 3;
          const b = index ? index.getX(t * 3 + 1) : t * 3 + 1;
          const c = index ? index.getX(t * 3 + 2) : t * 3 + 2;
          v0.set(world[a * 3], world[a * 3 + 1], world[a * 3 + 2]);
          v1.set(world[b * 3], world[b * 3 + 1], world[b * 3 + 2]);
          v2.set(world[c * 3], world[c * 3 + 1], world[c * 3 + 2]);
          this.rasterTriangle(v0, v1, v2, error);
        }
      });
    });
  }

  private rasterTriangle(
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
    error: number,
  ) {
    // signed area in the XZ plane; skip degenerate / vertical triangles (skirts)
    const area = (b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z);
    if (Math.abs(area) < 1e-3) return;

    const { radius, spacing, size } = this;
    const minX = Math.min(a.x, b.x, c.x);
    const maxX = Math.max(a.x, b.x, c.x);
    const minZ = Math.min(a.z, b.z, c.z);
    const maxZ = Math.max(a.z, b.z, c.z);
    if (maxX < -radius || minX > radius || maxZ < -radius || minZ > radius)
      return;

    const i0 = Math.max(0, Math.ceil((minX + radius) / spacing));
    const i1 = Math.min(size - 1, Math.floor((maxX + radius) / spacing));
    const j0 = Math.max(0, Math.ceil((minZ + radius) / spacing));
    const j1 = Math.min(size - 1, Math.floor((maxZ + radius) / spacing));
    const eps = -1e-6;

    for (let j = j0; j <= j1; j++) {
      const z = j * spacing - radius;
      for (let i = i0; i <= i1; i++) {
        const x = i * spacing - radius;
        const w0 = ((b.x - x) * (c.z - z) - (c.x - x) * (b.z - z)) / area;
        const w1 = ((c.x - x) * (a.z - z) - (a.x - x) * (c.z - z)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < eps || w1 < eps || w2 < eps) continue;
        const h = w0 * a.y + w1 * b.y + w2 * c.y;
        const k = j * size + i;
        const prevErr = this.errors[k];
        if (
          error < prevErr ||
          (error === prevErr && !(h <= this.heights[k]))
        ) {
          this.errors[k] = error;
          this.heights[k] = h;
          this.hasData = true;
        }
      }
    }
  }

  /** Shift every sample by `dy` (used after re-centering the tiles vertically). */
  offset(dy: number) {
    for (let k = 0; k < this.heights.length; k++) this.heights[k] += dy;
  }

  private sample(i: number, j: number): number {
    const { size } = this;
    i = Math.min(size - 1, Math.max(0, i));
    j = Math.min(size - 1, Math.max(0, j));
    return this.heights[j * size + i];
  }

  /** Bilinear ground height at world (x, z). Returns NaN where no data. */
  getHeight(x: number, z: number): number {
    if (!this.hasData) return NaN;
    const { radius, spacing } = this;
    const fx = (x + radius) / spacing;
    const fz = (z + radius) / spacing;
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const tx = fx - i;
    const tz = fz - j;
    const h00 = this.sample(i, j);
    const h10 = this.sample(i + 1, j);
    const h01 = this.sample(i, j + 1);
    const h11 = this.sample(i + 1, j + 1);
    const hs = [h00, h10, h01, h11];
    if (hs.some((h) => Number.isNaN(h))) {
      // fall back to any valid neighbour rather than returning a hole
      const valid = hs.filter((h) => !Number.isNaN(h));
      return valid.length ? valid.reduce((s, h) => s + h, 0) / valid.length : NaN;
    }
    return (
      h00 * (1 - tx) * (1 - tz) +
      h10 * tx * (1 - tz) +
      h01 * (1 - tx) * tz +
      h11 * tx * tz
    );
  }
}
