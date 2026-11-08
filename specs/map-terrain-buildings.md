# Spec: Surrounding-Area Map, Terrain Heightmap & 3D Buildings

**Status:** Draft for implementation
**Scope:** `src/js/CesiumTilesRenderer.ts`, `src/js/LocationSelect.ts`, `src/js/Scripts.ts`, `public/json/dropzones.json`, new files under `src/js/terrain/`
**Library baseline:** `3d-tiles-renderer@0.5.3` (already installed), `three@0.176`

---

## 1. Summary

Replace the "one map around the dropzone" view with a **continuous, streamed area map** that:

1. Covers a configurable radius around the selected dropzone (default 8 km) at high detail, and fades to lower detail out to the horizon. There is no hand-built tile grid, so there are no seams.
2. Uses a **real elevation model**: mountains, valleys and slopes come from Cesium World Terrain, which the code already loads.
3. Adds **3D buildings** (Cesium OSM Buildings), aligned to the same terrain.
4. Drapes the **Mapbox `dark-v11`** style over the terrain by default, keeping the app's dark look. A **Map style** dropdown swaps live between Mapbox Dark and Cesium satellite imagery (§5.6).
5. Exposes a **ground-height lookup** so the sim (landing detection, AGL readouts, jumprun click-to-align) can use the real terrain instead of a flat `y = 0` plane.

The key design decision: **don't hand-stitch Mapbox tiles.** The project already includes `3d-tiles-renderer`, which streams quadtree terrain tiles, handles level of detail, and stitches tile edges with skirts. "More tiles around the DZ" is a matter of telling that renderer which region must stay loaded at high detail. Mapbox stays in as an imagery source only.

---

## 2. Current state (as of this spec)

| Area | What the code does today |
|---|---|
| Dropzone select | `LocationSelect.ts → triggerSelection()` builds a `CesiumTilesRenderer` (World Terrain asset `1` + World Imagery asset `2`). Falls back to a 4618 m wireframe plane on error. |
| Mapbox | `MapboxCanvasRenderer.ts`, `netlify/functions/mapbox-proxy.js`, and `#mapbox-offscreen` in `index.html` exist but **nothing imports or calls them**. `mapbox-gl` is still a dependency. |
| World frame | Three.js world: +Y up, origin = DZ, units = metres. Jumpers land when `position.y < 0` (`SimEntities.ts:332`). `HeightAxis` and `GridHelper` assume ground = `y = 0`. |
| Render loop | `Scripts.ts` calls `cesiumTilesRenderer.update()` every frame. Camera far plane is 100 km. |
| Jumprun align | Raycasts against `window.mapPlane` or `window.gridHelper` (`Scripts.ts:284`), not the terrain. |

### 2.1 Existing bugs this spec must fix first

**B1. Wrong location: degrees passed where radians are expected.**
`ReorientationPlugin` takes `lat`/`lon` **in radians** (see the plugin's JSDoc in `ReorientationPlugin.js`, lines 13–14). `CesiumTilesRenderer.initialize()` passes `dz.latitude`/`dz.longitude` in degrees. For Perris, `33.7646` is read as 33.76 rad, so the terrain is centered somewhere else on Earth.
*Fix:* `lat: THREE.MathUtils.degToRad(latitude)`, `lon: THREE.MathUtils.degToRad(longitude)`.

**B2. Ground isn't at `y = 0`.**
`ReorientationPlugin({ height: 0 })` puts the **ellipsoid** at the origin. Real DZ ground is hundreds of metres above it (Perris is about 430 m MSL; Skydive Arizona about 460 m). Terrain will float above the plane, and jumpers will "land" underground.
*Fix:* re-center at the DZ's ground ellipsoid height (§5.2).

**B3. Leaks on dropzone change.**
Each `triggerSelection()` adds a new `GridHelper` and `HeightAxis` without removing the old ones. `cesiumTilesRenderer.dispose()` never removes `tiles.group` from the scene.
*Fix:* a single `MapScene` owner that tears down everything it added (§4).

---

## 3. Goals / non-goals

**Goals**
- G1. Seamless map coverage of at least an 8 km radius around the DZ, high-res inside, LOD falloff outside.
- G2. Real terrain relief, with optional vertical exaggeration for visibility (default 1.0).
- G3. 3D buildings clamped to terrain, toggleable.
- G4. DZ landing area sits at `y = 0`, so existing physics, HeightAxis and jumprun data keep working unchanged.
- G5. A synchronous `getGroundHeight(x, z)` usable from the physics precalc.
- G6. Mapbox Dark is the default imagery. A UI control swaps between Mapbox Dark and Cesium at runtime, without reloading terrain or resetting the camera, and the choice is remembered.
- G7. Same frame rate as today on a mid-range laptop (target ≥ 50 fps at 1080p with the default radius).

**Non-goals (this iteration)**
- Trees and vegetation, obstacle collision with buildings, offline caching, custom DZ-uploaded photogrammetry.
- Terrain-aware wind (Open-Meteo profile stays as-is).

---

## 4. Architecture

```
LocationSelect.triggerSelection(dz)
        │
        ▼
 MapScene (new, src/js/terrain/MapScene.ts)    ← owns everything map-related
   ├─ TerrainLayer   (TilesRenderer: World Terrain + imagery overlay)
   ├─ BuildingsLayer (TilesRenderer: Cesium OSM Buildings, optional)
   ├─ LoadRegionPlugin(SphereRegion r = coverageRadius) on both layers
   ├─ GroundHeightField (sampled heightfield, sync lookup)
   └─ helpers: GridHelper, HeightAxis (moved here so they're disposed together)
        │
        ▼
 window.mapScene → Scripts.ts render loop calls mapScene.update()
```

Both tile layers use the **same** `ReorientationPlugin` parameters (lat/lon in radians, same height), so terrain and buildings share one local frame.

### 4.1 New/changed files

| File | Change |
|---|---|
| `src/js/terrain/MapScene.ts` | **New.** Lifecycle: `load(dz) → Promise<void>`, `update()`, `dispose()`, `setOptions()`. |
| `src/js/terrain/TerrainLayer.ts` | **New**, replaces `CesiumTilesRenderer.ts`. Terrain + imagery overlay + load region. |
| `src/js/terrain/BuildingsLayer.ts` | **New.** OSM Buildings tileset. |
| `src/js/terrain/GroundHeightField.ts` | **New.** Builds and serves the heightfield. |
| `src/js/terrain/imagery.ts` | **New.** Factory: `'mapbox-dark' \| 'cesium'` → overlay instance. |
| `src/js/ui/MapStyleSelect.ts` | **New.** Wires the Map style dropdown to `mapScene.setImagery()` (§5.6). |
| `index.html` | Add the `#map-style-select` dropdown next to `#dropzone-select` (§5.6). |
| `src/js/terrain/config.ts` | **New.** Defaults + asset IDs. |
| `src/js/LocationSelect.ts` | Delegate to `MapScene`; remove inline grid/axis/tiles code. |
| `src/js/Scripts.ts` | Render loop calls `mapScene.update()`; jumprun raycast targets `mapScene.getRaycastTarget()`. |
| `src/js/classes/SimEntities.ts` | Landing check uses `groundHeight(x, z)` instead of `0` (behind a flag, §7). |
| `public/json/dropzones.json` | Optional `groundElevationM` per DZ (§5.2). |
| `src/js/CesiumTilesRenderer.ts` | Delete after migration. |
| `src/js/MapboxCanvasRenderer.ts`, `netlify/functions/mapbox-proxy.js`, `#mapbox-offscreen` div, `mapbox-gl` dep | Delete (dead code). The `mapbox-gl` package is large, and removing it shrinks the bundle. |

---

## 5. Detailed design

### 5.1 Coverage: "tiles around the DZ"

`3d-tiles-renderer` loads tiles based on camera screen-space error. To **guarantee** the surrounding area is loaded at good detail regardless of where the camera points:

```ts
import { LoadRegionPlugin, SphereRegion } from "3d-tiles-renderer/three/plugins";

const region = new SphereRegion({
  sphere: new THREE.Sphere(new THREE.Vector3(0, 0, 0), cfg.coverageRadiusM), // 8000
  errorTarget: cfg.regionErrorTarget,                                        // 4 (lower = sharper)
});
const loadRegion = new LoadRegionPlugin();
loadRegion.addRegion(region);
tiles.registerPlugin(loadRegion);
```

- The region sphere is in the tiles' **local** frame. After reorientation, the origin is the DZ, so center = `(0,0,0)`. If the frame looks wrong, transform the sphere by `tiles.group.matrixWorld` inverse.
- Leave `mask: false`, so tiles outside the radius still stream at camera-driven LOD out to the horizon. That gives a full surrounding view without paying for high detail everywhere.
- `tiles.errorTarget` stays at the default for camera-driven tiles. Expose both values in DevConsole for tuning.
- Seams: terrain tiles from `QuantizedMeshPlugin` have skirts and shared edges, so no manual stitching is needed. Imagery overlays are composited per tile by `ImageOverlayPlugin` (`TiledTextureComposer`), so imagery is seamless too.

### 5.2 Height datum: put the DZ at `y = 0` (fixes B2)

Order of preference for the DZ ground height (ellipsoid metres):

1. `dz.groundElevationM` from `dropzones.json`, if present. Note that this is orthometric/MSL. Convert it to ellipsoid height by adding the geoid undulation, or simply store the ellipsoid value directly (recommended: store the value measured by method 2 once, and commit it).
2. **Runtime probe:** after the root tileset loads, add a `RayRegion` straight down through the origin (forces the finest tiles there), wait for `tiles-load-end`, raycast from `(0, 10000, 0)` downward against `tiles.group`, and take the hit `y`.
3. Then call `reorientationPlugin.transformLatLonHeightToOrigin(latRad, lonRad, hitHeightEllipsoid)` on **both** layers, and clear the probe region.

Until step 2 completes, keep the map hidden (`tiles.group.visible = false`) and don't call `signalMeshReady()`. This avoids a visible jump.

Expose `mapScene.dzGroundEllipsoidM` and `mapScene.dzGroundMslM` (for display: "DZ elev 1,417 ft MSL").

### 5.3 Terrain + imagery layer

```ts
tiles.registerPlugin(new ReorientationPlugin({ up: "+y", recenter: true, lat: latRad, lon: lonRad, height: groundEllipsoidM }));
tiles.registerPlugin(new CesiumIonAuthPlugin({ apiToken, assetId: "1", autoRefreshToken: true,
  assetTypeHandler: (type, t) => { if (type === "TERRAIN") t.registerPlugin(new QuantizedMeshPlugin({})); } }));
tiles.registerPlugin(new ImageOverlayPlugin({ renderer, overlays: [createImageryOverlay(cfg.imagery)] }));
tiles.registerPlugin(new TileCompressionPlugin());
tiles.registerPlugin(new UpdateOnChangePlugin());
tiles.registerPlugin(loadRegion);
```

`imagery.ts`:

| Key | Label in UI | Overlay | URL / asset |
|---|---|---|---|
| `mapbox-dark` (**default**) | Dark (Mapbox) | `XYZTilesOverlay` | `https://api.mapbox.com/styles/v1/mapbox/dark-v11/tiles/512/{z}/{x}/{y}@2x?access_token=…`, `tileDimension: 512`, `levels: 19` |
| `cesium` | Satellite (Cesium) | `CesiumIonOverlay` | asset `2` (current behaviour) |

If `VITE_MAPBOX_TOKEN` is missing, fall back to `cesium`, disable the Dark option in the dropdown with a tooltip ("Mapbox token not set"), and log one warning.

**Token handling.** Use a Mapbox **public** token (`pk.…`) with URL restrictions set in the Mapbox dashboard, read from `VITE_MAPBOX_TOKEN` (already wired in `vite.config.ts`). Don't route tiles through the Netlify function: a single view requests hundreds of tiles, and a serverless round trip per tile is slow and costly. If the token must stay secret, use `preprocessURL` to point at a CDN-cached edge proxy instead. That's out of scope here.

**Vertical exaggeration.** World Terrain via quantized mesh has no built-in height scale. Implement it by scaling `tiles.group.scale.y` (and the buildings group to match). Keep the default at 1.0, and gate it behind a dev setting, because any value ≠ 1 breaks the physics-to-terrain relationship.

### 5.4 Buildings layer

```ts
const CESIUM_OSM_BUILDINGS_ASSET_ID = "96188";
buildings.registerPlugin(new ReorientationPlugin({ /* identical to terrain */ }));
buildings.registerPlugin(new CesiumIonAuthPlugin({ apiToken, assetId: CESIUM_OSM_BUILDINGS_ASSET_ID, autoRefreshToken: true }));
buildings.registerPlugin(new TileCompressionPlugin());
buildings.registerPlugin(new UpdateOnChangePlugin());
buildings.registerPlugin(new LoadRegionPlugin(/* same SphereRegion, maybe smaller radius e.g. 4 km */));
buildings.addEventListener("load-model", ({ scene }) => scene.traverse(applyBuildingMaterial));
```

- OSM Buildings are designed to sit on Cesium World Terrain, so they need no extra clamping once both layers share the reorientation.
- `applyBuildingMaterial`: replace materials with one shared `MeshLambertMaterial`, and dispose the replaced materials. Pick the color from the current map style: `0x3a3f47` on Mapbox Dark (reads as dark-theme blocks, a step lighter than the ground), and `0xb8b8b8` on Cesium satellite. `setImagery()` updates the shared material's color, so no buildings need reloading.
- Toggle: `mapScene.setOptions({ buildings: false })` sets `buildings.group.visible = false` **and** stops calling `buildings.update()`.
- Attribution required: "© OpenStreetMap contributors" in the UI footer, alongside Cesium and imagery credits.

**Optional "Photoreal" mode (later).** Google Photorealistic 3D Tiles via Cesium ion asset `2275207` replace terrain, imagery and buildings with one photogrammetry mesh. They look far better in covered cities but are sparse in rural areas, where most DZs are. They're also heavier, and you'd lose the separate terrain heightfield (raycast the mesh instead). Implement as a third mutually exclusive mode only if wanted.

### 5.5 Ground height service (heightmap for the sim)

Physics precalc (`precalculate(300)`) needs **synchronous, cheap** ground lookups. Raycasting streamed tiles per step is too slow, and the results depend on what's currently loaded.

`GroundHeightField`:
- After the load region finishes (`tiles-load-end` with the region satisfied), sample a regular grid over the coverage area: default 50 m spacing over ±8 km gives a 321×321 grid of about 103k raycasts. Run these in chunks over several frames, or use the raycast BVH the tiles build. Store the results in a `Float32Array`.
- `getGroundHeight(x, z): number`: bilinear interpolation. Outside the grid, it returns the nearest edge value.
- `ready: Promise<void>`. `signalMeshReady()` fires only after this resolves (or after a timeout, falling back to a flat 0).
- Cache per DZ in `sessionStorage` (keyed by DZ name + spacing + radius), so switching back is instant.
- Optional dev overlay: draw the heightfield as a wireframe to verify alignment.

Expose it as `window.groundHeight = (x, z) => mapScene.heightField.getGroundHeight(x, z)`, matching the existing `window.*` pattern.

---

## 6. Rendering & performance

- Camera `far` = 100 km already. Set `near` to 1 m (currently 0.1) to cut z-fighting on distant terrain.
- Call `tiles.setResolutionFromRenderer(camera, renderer)` on window resize (currently only once).
- Budget: `tiles.lruCache.maxSize` around 800 for terrain and 400 for buildings. Tune in DevConsole.
- Lighting: World Terrain needs a light to show relief (if materials are Lambert or Standard). Add a `HemisphereLight` and a low-angle `DirectionalLight` owned by `MapScene`, unless the scene already has one.
- Fog: `scene.fog = new THREE.Fog(skyColor, 15000, 60000)` hides the LOD transition at the horizon.

---

## 7. Sim integration

| Consumer | Change | Flag |
|---|---|---|
| `SimEntities` landing (`currentPosition.y < 0`) | `currentPosition.y < groundHeight(x, z)` | `terrainAwareLanding` (default **on**) |
| AGL readouts / `HeightAxis` | Unchanged: `y` stays "height above DZ ground". Add an optional "AGL here" readout = `y − groundHeight(x,z)` for the selected jumper. | — |
| Jumprun align click (`Scripts.ts:284`) | Raycast against `mapScene.getRaycastTarget()` (terrain group). The `defaultJumprun` points in `dropzones.json` have `y ≈ 0`, so they remain valid. | — |
| `GridHelper` | Keep at `y = 0` but make it toggleable. Default **off** when terrain loads, since it clips through hills. | — |
| Wireframe fallback | Keep as is. `getGroundHeight` returns 0 in fallback mode. | — |

---

## 8. Config

`src/js/terrain/config.ts`:

```ts
export const MAP_DEFAULTS = {
  coverageRadiusM: 8000,
  buildingsRadiusM: 4000,
  regionErrorTarget: 4,
  imagery: "cesium" as "cesium" | "mapbox-satellite" | "mapbox-dark",
  buildings: true,
  verticalExaggeration: 1,
  heightFieldSpacingM: 50,
  showGrid: false,
};
export const ION_ASSETS = { worldTerrain: "1", worldImagery: "2", osmBuildings: "96188", googlePhotoreal: "2275207" };
```

Persist user choices (imagery, buildings, grid) with the existing `setCookie` helper. Add UI controls next to `#dropzone-select`: an imagery dropdown and a buildings checkbox.

`.env.example`: keep `VITE_CESIUM_ION_TOKEN`. Change the `VITE_MAPBOX_TOKEN` comment from "legacy" to "imagery (public pk. token, URL-restricted)". The Cesium token needs access to assets 1, 2 and 96188 (all are free on community accounts).

---

## 9. Implementation plan

1. **Fix B1/B2/B3** in the existing `CesiumTilesRenderer` (radians, ground re-center, disposal). Verify that Perris terrain appears with the landing area at `y ≈ 0`. *Small, ship on its own.*
2. **Introduce `MapScene`** and move grid, axis and tiles ownership into it. Swap `LocationSelect` over to it. No visual change.
3. **Add `LoadRegionPlugin` coverage**, fog and lighting. Tune the radius and error target.
4. **Imagery factory** with the Mapbox XYZ overlays and a UI dropdown.
5. **BuildingsLayer** with a toggle and attribution.
6. **GroundHeightField**, then wire it into landing detection and the jumprun raycast.
7. **Delete dead Mapbox code** and update README "APIs used" and "Features".

## 10. Acceptance criteria

- [ ] Selecting each DZ in `dropzones.json` centers the map on the right place: the runway/landing area is under the origin, within 50 m.
- [ ] Ground at the origin is within ±5 m of `y = 0`.
- [ ] Orbiting the camera at 4 km altitude shows continuous terrain with no gaps or seams out to at least 8 km in every direction.
- [ ] Mountains are visibly correct near Skydive Arizona (Picacho Peak, SE) and Perris (hills to the E/SE).
- [ ] Buildings appear on terrain, not floating or buried, and toggle on/off.
- [ ] Switching DZ five times leaves exactly one terrain group, one grid and one height axis in `scene.children`, and GPU memory returns to baseline (check `renderer.info.memory`).
- [ ] A jumper landing on a 30 m rise lands at `y ≈ 30`, not `0`.
- [ ] ≥ 50 fps at 1080p on the reference machine with defaults. Without a Cesium token, it falls back to the wireframe with no console errors other than the warning.

## 11. Risks & open questions

1. **Imagery default.** Is Cesium/Bing fine, or should Mapbox satellite be the default? The Mapbox free tier has monthly raster-tile limits, so check usage expectations.
2. **Datum.** Open-Meteo wind heights are above ground at the grid cell. With terrain, "AGL" at a jumper's position can differ from "above DZ". Out of scope, but worth a follow-up.
3. **Buildings quality.** OSM building heights are often estimated, and rural hangars may be missing or blocky. Acceptable for situational awareness, not for obstacle avoidance.
4. **Heightfield build time.** About 100k raycasts could take a second or two. If it's too slow, drop to 100 m spacing or sample terrain tile vertex data directly.

---

## Appendix A: Why not a hand-built Mapbox tile grid?

The alternative approach is to compute slippy tile x/y around the DZ, fetch N×N `mapbox.satellite` and `mapbox.terrain-rgb` (`.pngraw`) tiles, decode heights with `h = −10000 + (R·65536 + G·256 + B)·0.1`, displace one `PlaneGeometry` per tile, and extrude building footprints from `mapbox-streets-v8` vector tiles. It works, but you'd have to write:

- edge stitching (shared edge vertices or skirts) to avoid cracks between tiles,
- your own LOD, or else a fixed-size area with no horizon,
- a vector-tile parser (`@mapbox/vector-tile` + `pbf`), polygon extrusion and ground clamping for buildings,
- Web Mercator ↔ local metres conversion, including the `cos(lat)` scale.

That's roughly 3× the code for a worse result, and `3d-tiles-renderer` already does all of it. If Mapbox elevation is ever specifically wanted, the installed library ships `TerrainRGBMeshPlugin`, which consumes `mapbox.terrain-rgb` tiles directly and provides `sampleCartographicElevation(lat, lon)`. It could replace the Cesium World Terrain source inside `TerrainLayer` without changing the rest of this design. Note that Mapbox's newer Terrain-DEM v1 tileset is SDK-only and not served by the Raster Tiles API, so the older Terrain-RGB v1 would be the one used.
