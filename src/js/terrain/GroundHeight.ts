// Global, dependency-free ground lookup used by the physics.
// MapScene registers its heightfield here; until then (or in wireframe fallback)
// the ground is the flat plane y = 0, which matches the previous behaviour.

type GroundFn = (x: number, z: number) => number;

let provider: GroundFn | null = null;

/** When false, physics treats the ground as flat y = 0 (old behaviour). */
export let terrainAwareLanding = true;

export function setGroundProvider(fn: GroundFn | null) {
  provider = fn;
}

export function setTerrainAwareLanding(enabled: boolean) {
  terrainAwareLanding = enabled;
}

/** World-space ground height (m) at (x, z). y = 0 is the DZ landing area. */
export function getGroundHeight(x: number, z: number): number {
  if (!terrainAwareLanding || !provider) return 0;
  const h = provider(x, z);
  return Number.isFinite(h) ? h : 0;
}

(window as any).groundHeight = getGroundHeight;
