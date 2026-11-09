/**
 * 2D ground-plane geometry for the dropzone planner and the sim.
 * Plans store points as metres east/north of the DZ origin ({e, n}); the world is
 * +X east, −Z north, so x = e and z = −n.
 */

export interface EN {
  e: number;
  n: number;
}
export interface XZ {
  x: number;
  z: number;
}

export const enToXZ = (p: EN): XZ => ({ x: p.e, z: -p.n });
export const xzToEN = (x: number, z: number): EN => ({ e: x, n: -z });

export const FT = 0.3048;

export function dist(a: XZ, b: XZ) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** Even-odd point in polygon. */
export function pointInPolygon(pts: XZ[], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

export function distToSegment(x: number, z: number, a: XZ, b: XZ): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len2 = dx * dx + dz * dz;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / len2)) : 0;
  return Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t));
}

export function distToPolyline(pts: XZ[], x: number, z: number): number {
  if (pts.length === 1) return Math.hypot(x - pts[0].x, z - pts[0].z);
  let d = Infinity;
  for (let i = 0; i < pts.length - 1; i++) d = Math.min(d, distToSegment(x, z, pts[i], pts[i + 1]));
  return d;
}

/** Area-weighted centroid (falls back to the vertex mean for degenerate shapes). */
export function polygonCentroid(pts: XZ[]): XZ {
  let a = 0;
  let cx = 0;
  let cz = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const f = pts[j].x * pts[i].z - pts[i].x * pts[j].z;
    a += f;
    cx += (pts[j].x + pts[i].x) * f;
    cz += (pts[j].z + pts[i].z) * f;
  }
  if (Math.abs(a) < 1e-6) {
    return {
      x: pts.reduce((s, p) => s + p.x, 0) / Math.max(1, pts.length),
      z: pts.reduce((s, p) => s + p.z, 0) / Math.max(1, pts.length),
    };
  }
  return { x: cx / (3 * a), z: cz / (3 * a) };
}

export function bbox(pts: XZ[], pad = 0) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  return { minX: minX - pad, maxX: maxX + pad, minZ: minZ - pad, maxZ: maxZ + pad };
}

/** Nearest point inside a polygon (the point itself if already inside). */
export function clampToPolygon(pts: XZ[], p: XZ): XZ {
  if (pts.length < 3 || pointInPolygon(pts, p.x, p.z)) return p;
  let best = p;
  let bestD = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2));
    const q = { x: a.x + dx * t, z: a.z + dz * t };
    const d = Math.hypot(q.x - p.x, q.z - p.z);
    if (d < bestD) {
      bestD = d;
      best = q;
    }
  }
  // nudge 1 m towards the centroid so it is strictly inside
  const c = polygonCentroid(pts);
  const d = Math.hypot(c.x - best.x, c.z - best.z) || 1;
  return { x: best.x + ((c.x - best.x) / d) * 1, z: best.z + ((c.z - best.z) / d) * 1 };
}

/** Unit vector pointing to the right of travel direction (dx, dz) in world XZ. */
export function rightOf(dx: number, dz: number): XZ {
  const l = Math.hypot(dx, dz) || 1;
  return { x: -dz / l, z: dx / l };
}

/**
 * Offset a polyline sideways by `offset` metres (positive = right of travel),
 * mitring corners so the legs stay parallel. `first` is the point the line starts from.
 */
export function offsetPolyline(pts: XZ[], offset: number): XZ[] {
  if (!offset || pts.length < 2) return pts.map((p) => ({ ...p }));
  const out: XZ[] = [];
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(pts.length - 1, i + 1)];
    const inDir = i > 0 ? { x: pts[i].x - prev.x, z: pts[i].z - prev.z } : { x: next.x - pts[i].x, z: next.z - pts[i].z };
    const outDir = i < pts.length - 1 ? { x: next.x - pts[i].x, z: next.z - pts[i].z } : inDir;
    const r1 = rightOf(inDir.x, inDir.z);
    const r2 = rightOf(outDir.x, outDir.z);
    let mx = r1.x + r2.x;
    let mz = r1.z + r2.z;
    const ml = Math.hypot(mx, mz);
    if (ml < 1e-6) {
      mx = r1.x;
      mz = r1.z;
    } else {
      mx /= ml;
      mz /= ml;
    }
    // mitre length: offset / cos(half angle), capped so sharp corners don't explode
    const cosHalf = Math.max(0.35, mx * r1.x + mz * r1.z);
    out.push({ x: pts[i].x + (mx * offset) / cosHalf, z: pts[i].z + (mz * offset) / cosHalf });
  }
  return out;
}

/** Heading (degrees true, 0 = north, 90 = east) of a world XZ direction. */
export function headingDegOf(dx: number, dz: number): number {
  const h = (Math.atan2(dx, -dz) * 180) / Math.PI;
  return (h + 360) % 360;
}

/** World XZ unit vector for a heading in degrees true. */
export function dirOfHeading(deg: number): XZ {
  const r = (deg * Math.PI) / 180;
  return { x: Math.sin(r), z: -Math.cos(r) };
}
