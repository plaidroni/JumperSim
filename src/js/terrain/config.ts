// Central configuration for the map / terrain system.
// See specs/map-terrain-buildings.md for the reasoning behind each value.

export type ImageryKey = "mapbox-dark" | "cesium";

export const MAP_DEFAULTS = {
  /** Radius (m) around the DZ that is always kept loaded at high detail. */
  coverageRadiusM: 8000,
  /** Radius (m) around the DZ for 3D buildings. */
  buildingsRadiusM: 4000,
  /**
   * Geometric error (m) tiles are refined to inside the coverage region.
   * World Terrain error halves per level (~9.4 m at level 13, ~2 km tiles).
   */
  regionErrorTarget: 10,
  imagery: "mapbox-dark" as ImageryKey,
  buildings: true,
  showGrid: false,
  /** Heightfield sample spacing (m) for the physics ground lookup. */
  heightFieldSpacingM: 50,
  /** Max time (ms) to wait for terrain before letting the sim start anyway. */
  terrainReadyTimeoutMs: 25000,
};

export const ION_ASSETS = {
  worldTerrain: "1",
  worldImagery: "2",
  osmBuildings: "96188",
  googlePhotoreal: "2275207",
};

export const THEME: Record<
  ImageryKey,
  { building: number; fog: number; grid: number }
> = {
  "mapbox-dark": { building: 0x3a3f47, fog: 0x0a0a0a, grid: 0x444444 },
  cesium: { building: 0xb8b8b8, fog: 0x0a0a0a, grid: 0x888888 },
};

const env = import.meta.env as Record<string, string | undefined>;
export const CESIUM_ION_TOKEN =
  env.VITE_CESIUM_ION_TOKEN || env.CESIUM_ION_TOKEN || "";
export const MAPBOX_TOKEN =
  env.VITE_MAPBOX_TOKEN || env.VITE_MAPBOX || env.MAPBOX_TOKEN || "";

export function isImageryAvailable(key: ImageryKey): boolean {
  if (key === "mapbox-dark") return Boolean(MAPBOX_TOKEN);
  return Boolean(CESIUM_ION_TOKEN);
}
