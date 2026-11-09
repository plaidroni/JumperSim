import type { DangerZone, DropzonePlan, LandingZone } from "../dropzone/DropzonePlan";
import {
  bbox,
  distToPolyline,
  enToXZ,
  FT,
  pointInPolygon,
  polygonCentroid,
  type XZ,
} from "../dropzone/geometry";
import { getGroundHeight } from "../terrain/GroundHeight";

/**
 * Danger zones and landing zones resolved to world XZ for the sim. A jumper under
 * canopy breaks a danger zone while over its footprint below its ceiling (ft AGL,
 * measured from the terrain under the jumper). Landing in one is always a violation.
 */

export interface ResolvedZone {
  zone: DangerZone;
  pts: XZ[];
  line: boolean;
  halfWidth: number;
  ceilingM: number;
  box: ReturnType<typeof bbox>;
}

export interface ResolvedLZ {
  lz: LandingZone;
  pts: XZ[];
  target: XZ;
}

export function resolveZones(plan: DropzonePlan | null): ResolvedZone[] {
  if (!plan) return [];
  return plan.dangerZones
    .filter((z) => z.shape.points.length >= (z.shape.type === "line" ? 2 : 3))
    .map((zone) => {
      const pts = zone.shape.points.map(enToXZ);
      const line = zone.shape.type === "line";
      const halfWidth = line ? Math.max(1, (zone.shape as any).widthM / 2) : 0;
      return {
        zone,
        pts,
        line,
        halfWidth,
        ceilingM: Math.max(0, zone.ceilingFt) * FT,
        box: bbox(pts, halfWidth),
      };
    });
}

export function resolveLandingZones(plan: DropzonePlan | null): ResolvedLZ[] {
  if (!plan) return [];
  return plan.landingZones
    .filter((lz) => lz.polygon.length >= 3)
    .map((lz) => {
      const pts = lz.polygon.map(enToXZ);
      const target = lz.target ? enToXZ(lz.target) : polygonCentroid(pts);
      return { lz, pts, target };
    })
    .sort((a, b) => Number(b.lz.primary) - Number(a.lz.primary));
}

export function zoneContains(rz: ResolvedZone, x: number, z: number): boolean {
  const b = rz.box;
  if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) return false;
  return rz.line ? distToPolyline(rz.pts, x, z) <= rz.halfWidth : pointInPolygon(rz.pts, x, z);
}

/** The first danger zone broken at (x, z) by a jumper `aglM` above the terrain there. */
export function hazardAt(zones: ResolvedZone[], x: number, z: number, aglM: number): ResolvedZone | null {
  for (const rz of zones) if (aglM < rz.ceilingM && zoneContains(rz, x, z)) return rz;
  return null;
}

/** Any danger zone under (x, z), whatever its ceiling (for landings). */
export function zoneAt(zones: ResolvedZone[], x: number, z: number): ResolvedZone | null {
  for (const rz of zones) if (zoneContains(rz, x, z)) return rz;
  return null;
}

export function landingZoneAt(lzs: ResolvedLZ[], x: number, z: number): ResolvedLZ | null {
  for (const r of lzs) if (pointInPolygon(r.pts, x, z)) return r;
  return null;
}

export function maxCeilingM(zones: ResolvedZone[]): number {
  return zones.reduce((m, z) => Math.max(m, z.ceilingM), 0);
}

/** Height above the terrain at a world point. */
export function aglAt(x: number, y: number, z: number): number {
  return y - getGroundHeight(x, z);
}

/**
 * Does a straight ground segment, descending linearly from height h0 to h1 (m AGL),
 * pass through any zone below its ceiling? Sampled every ~10 m. Used to validate the
 * planned canopy pattern legs.
 */
export function segmentViolations(zones: ResolvedZone[], a: XZ, b: XZ, h0: number, h1: number): ResolvedZone[] {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const n = Math.max(2, Math.ceil(len / 10));
  const hit = new Set<ResolvedZone>();
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = a.x + (b.x - a.x) * t;
    const z = a.z + (b.z - a.z) * t;
    const h = h0 + (h1 - h0) * t;
    for (const rz of zones) if (!hit.has(rz) && h < rz.ceilingM && zoneContains(rz, x, z)) hit.add(rz);
  }
  return [...hit];
}
