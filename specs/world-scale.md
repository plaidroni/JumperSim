# Spec: World Scale (map, plane and jumpers in proportion)

**Status:** Draft for implementation
**Scope:** new `src/js/core/WorldScale.ts`. Changes to:
- `src/js/Scripts.ts`
- `src/js/PlaneSelect.ts`
- `src/js/terrain/MapScene.ts` and `src/js/terrain/GroundHeightField.ts`
- `src/js/visuals/CanopyRig.ts`
- `src/js/ui/TrajectoryLines.ts`
- `src/js/dropzone/PlannerView.ts` and `src/js/dropzone/PlanOverlays.ts`
- `src/js/wind/WindTower.ts` and `src/js/panels/WindWidget.ts`
- `src/js/physics/FormationShapes.ts`
- `src/js/GlobalVars.ts`

**Related:** `map-terrain-buildings.md` (map coverage and tiles), `dropzone-planner.md` (top-down view and overlays)

---

## 1. Summary

The map is drawn at real size (1 scene unit = 1 m), but the jumpers are drawn about **5.8× life size** and the planes **8–10× life size**. So people and aircraft look far too big for the ground: a jumper is about a third of a 30 m runway's width, when in reality they are about 1/17 of it.

The user likes the jumpers' current on-screen size, so the fix is to **scale the world up to match them**. A single render-only **world scale of 5.8** is applied to everything that lives in metres:
- terrain, buildings and imagery;
- trajectories;
- plan overlays;
- the wind tower.

Every model is then drawn at its **true size** inside that scaled world. Jumpers end up exactly as big on screen as today. The map and everything on it become 5.8× bigger around them. The planes shrink slightly (from 8–10× to 5.8×) so they are in proportion with the jumpers.

**Physics does not change:** positions, speeds, altitudes, wind and terrain heights stay in metres, and every number shown in the UI stays the same.

---

## 2. Measurements

### 2.1 Current sizes
The plane sizes come from parsing the GLB/GLTF files with the scale `PlaneSelect.ts` applies. The jumper size comes from `public/fabs/skydiver_fix.stl`.

| Object | Model's own size | Real size | Scale applied now | Drawn at | ≈ × life size |
|---|---|---|---|---|---|
| Map (terrain, buildings, imagery) | metres | — | 1 | 1 unit = 1 m | **1×** |
| Jumper (`skydiver_fix.stl`, box position) | 10.4 long, head 0.9 wide, hips 2.4 wide | ≈ 1.8 m long, 0.16 m head, 0.38–0.42 m hips | 1 | 10.4 units | **5.6–6.3× (5.8× by body length)** |
| Canopy rig (`CanopyRig.ts`) | metres | — | 10.4 / 1.8 | — | **5.8×** (matched to the jumper) |
| Twin Otter (`twin_otter_fix.glb`) | 15.6 m long | 15.8 m long, 19.8 m span | 8 | 125 units long | **8×** |
| Skyvan (`skyvan_fix.glb`) | 12.2 m long, 19.8 m span | 12.2 m, 19.8 m | 8 | 97 units long | **8×** |
| Cessna (`cessna_fix.glb`) | 8.2 m long, 10.9 m span | 8.3 m, 11.0 m | 8 | 66 units long | **8×** |
| DC-9 (`dc9.gltf`) | 1,567 units long (≈ 2 cm per unit) | ≈ 31.8 m long | 0.2 | 313 units long | **≈ 10×** |

**Notes on the measurements:**
- **Jumper:** three separate body measurements agree on a scale of about 5.8: body length 10.4 / 1.8 m, head width 0.9 / 0.16 m and hip width 2.4 / 0.4 m.
- **Twin Otter:** its bounding box is 23.4 m wide against a 19.8 m real wingspan, probably because of extra parts in the model. Its length matches the real aircraft, so length is used for scaling.

### 2.2 What that looks like today

| Scene | Now | At true proportions |
|---|---|---|
| 30 m wide runway | ≈ 3 jumper lengths wide | 17 jumper lengths |
| Twin Otter | 12 jumper lengths long | 8.8 jumper lengths |
| 4-way round | 1.08 m slot radius around 10.4-unit bodies, so the bodies overlap almost entirely | bodies visibly overlap, which the formation tuning in §6 fixes |
| Formation, flock and canopy spacing | too tight against the exaggerated bodies | readable |
| Height | 13,000 ft = 3,962 units, only 380 jumper lengths | 2,200 jumper lengths |

### 2.3 Chosen scale

```
WORLD_SCALE = JUMPER_MODEL_LENGTH / REAL_BODY_LENGTH_M = 10.4 / 1.8 ≈ 5.78   (use 5.8)
```

With this value, jumpers are drawn at true size inside the scaled world. Their model scale is 1 / 5.8, and the world adds ×5.8, so on screen they are exactly what they are today.

---

## 3. Goals / non-goals

**Goals**
- G1. Map, planes, jumpers, canopies and everything drawn in metres are in true proportion with each other.
- G2. Jumpers look the same size on screen as today when the camera is on them, including "Zoom in" and follow.
- G3. Physics, wind, altitudes, plans and every number shown are unchanged. A precalculated track is identical before and after, in metres.
- G4. One constant controls the relationship (`WORLD_SCALE`). Models carry a "units → metres" factor, not a display scale.
- G5. No loss of map detail, depth precision or frame rate.

**Non-goals**
- Changing the physics or the map coverage (still 8 km radius).
- New aircraft or jumper models.
- A "true scale + enlarged people" mode; §9 describes it as a possible follow-up.

---

## 4. Approach: render-only world scale

### 4.1 One scaled root
`core/WorldScale.ts` creates `worldRoot`, a `THREE.Group` whose scale is `WORLD_SCALE`, added once to the scene. **Everything that is positioned in metres becomes a child of `worldRoot`** instead of the scene:

| Moves into `worldRoot` | Why |
|---|---|
| Terrain, buildings and imagery tiles (`tiles.group`), the fallback ground plane, the grid, the height axis | the map |
| Plane mesh and jumper meshes | their positions come from tracks in metres |
| Canopy rigs | |
| Trajectory lines, the wind tower and its vectors | |
| Plan overlays (zones, walls, patterns, jumprun, hazard segments) | |

| Stays at the scene root | Why |
|---|---|
| Cameras, lights | they live in scene units |
| Screen-sized labels and handles | their size is computed in scene units per pixel (§5.3) |

```ts
// core/WorldScale.ts
export const WORLD_SCALE = 5.8;
export const worldRoot = new THREE.Group();          // scale = WORLD_SCALE
export const toScene = (m: number) => m * WORLD_SCALE;     // metres → scene units
export const toMetres = (u: number) => u / WORLD_SCALE;    // scene units → metres
export function sceneToWorld(p: THREE.Vector3) { return worldRoot.worldToLocal(p.clone()); }
export function worldToScene(p: THREE.Vector3) { return worldRoot.localToWorld(p.clone()); }
```

Code that sets `mesh.position` from a track sample keeps doing exactly that, because the parent group applies the scale.

### 4.2 Models at true size
A model's scale now means **model units → metres** and nothing else:

| Model | Model scale (now → new) | Basis |
|---|---|---|
| Jumper STL | 1 → **1 / 5.8 (0.172)** | 10.4 units = 1.8 m |
| Twin Otter, Skyvan, Cessna | 8 → **1** | the GLBs are already in metres |
| DC-9 | 0.2 → **0.0203** | 1,567 units = 31.8 m |
| Canopy rig | 5.78 → **1** | built in metres |

`PlaneSelect.ts` `planeConfigs[].scale` becomes `unitsToMetres`, with a comment giving each aircraft's real length. `CanopyRig.visualScaleOf()` is removed.

### 4.3 Remove `simScale`
`window.simScale` (GlobalVars, BaseEntities, PlaneLoad, SceneObjects) is a leftover attempt at scaling the physics. It is always 1. Scaling physics would also need the drag, wind and terrain to be scaled, so it is deleted rather than reused.

---

## 5. Things measured in scene units

Everything below works in scene units, so it has to be reviewed. "Map-framed" means it describes an amount of map and is multiplied by `WORLD_SCALE`. "People-framed" means it describes how close the camera is to a jumper or plane and stays as it is (that is how G2 holds).

### 5.1 Cameras and controls
- **Map-framed (scale by `WORLD_SCALE`):**
  - perspective far plane: `100000` → `600000`;
  - fog: `15000–60000` → `87000–348000`;
  - OrbitControls `maxDistance`, if set;
  - the initial camera position (`0, 108, 30`) and target;
  - the Location tab's view presets;
  - the compass and wind-widget sampling heights (camera height → `toMetres(camera.y)`).
- **People-framed (unchanged):**
  - `cameraFocus` "Zoom in" offset `(20, 10, 20)`;
  - `DEFAULT_FOLLOW_OFFSET (100, 100, 100)`;
  - Top view distance over the plane;
  - canopy-rig framing.

  These keep jumpers and planes the same size on screen, with 5.8× more map visible behind them.
- **Depth:**
  - Turn on `logarithmicDepthBuffer: true` in the `WebGLRenderer`. The near plane can then stay small (0.5) while the far plane grows 6× without z-fighting on distant terrain.
  - Check that the 3D Tiles materials and `ShapeGeometry` overlays still use `polygonOffset` correctly under the logarithmic depth buffer.
  - If they don't, fall back to a near plane that follows the camera height: `near = clamp(distanceToTarget / 2000, 0.5, 50)`.

### 5.2 Map
- **3D Tiles:** `tiles.group` goes under `worldRoot`.
  - The level of detail is computed from each tile's geometric error against the camera distance in the tile's own frame, so scaling the parent doesn't change which tiles load for a given on-screen size.
  - `errorTarget` stays the same. Acceptance check A5 verifies the tile count.
- **Ground heights:** `GroundHeightField` samples heights by raycasting the terrain.
  - It casts rays in **metres**, transforming through `worldRoot` (`sceneToWorld` / `worldToScene`).
  - It stores heights in metres, so `getGroundHeight()` and the physics are unchanged.
- **Grid and height axis:** spacing stays in metres (children of `worldRoot`). Their line widths are pixels, so nothing else changes.
- **Coverage:** still 8 km radius, which becomes 46 km in scene units. The fog and far plane above already cover it.

### 5.3 Picking, the planner and screen-sized items
- **Picking:** `pickAt` and `checkHoverIntersect` already raycast against meshes; the hits are objects, not positions, so they are unaffected. Anything that reads a hit **position** converts it with `sceneToWorld` (Align Jumprun's old map click, `cameraFocus` centres).
- **Planner:** the camera works in scene units, and every plan coordinate is in metres.
  - `screenToWorld` returns metres: divide by `WORLD_SCALE`.
  - `center`, `viewW` and the zoom presets stay in metres. `updateCamera()` sets the orthographic frustum to `viewW × WORLD_SCALE` and the position to `center × WORLD_SCALE`.
  - Metres per pixel in the HUD scale bar stays `viewW / width`.
- **Labels and handles** (`PlanOverlays.updateScreenSizes`, the planner's handle sprites): they keep a constant pixel size. They are children of `worldRoot`, so their scale is divided by `WORLD_SCALE`, or they move to a screen-space group at the root that follows their world anchor.
- **Jumper meshes** keep their `userData.label` and selection behaviour.

### 5.4 Other visuals
- **Trajectory lines:** buffers in metres, under `worldRoot`. No change.
- **Wind tower:**
  - The mast, heights and vector spacing are in metres under `worldRoot`.
  - The arrow sizes are currently tuned for the unscaled view. Size them in metres so they read at the tower's new size: the arrow head is 5% of the tower height.
- **Canopy rig:** model scale 1 (true size). Line lengths and span already come from `canopyDimensions()` in metres.
- **Plane nose line** (`addNoseLine`): built in plane-local metres. Check its length after the model scale changes.

---

## 6. Things that come into view at true proportions

Once bodies and the map share one scale, geometry that was hidden by the oversized bodies becomes visible. These defaults change with this work:

| Setting | Now | New | Reason |
|---|---|---|---|
| `ROUND_SPACING_M` (gap between neighbours on the ring) | 1.7 | **2.0** | gripped hands: about an arm's length between hips |
| `ROUND_MIN_RADIUS_M` | 1.0 | **1.5** | hip to the round's centre for a 4-way: head and shoulders towards the centre, arms gripped |
| Exit spot | plane centre | **plane door** (`exitOffset` per aircraft, in model metres) | at true size, appearing in the middle of the cabin is visible |
| Canopy line length | 0.72 × span | unchanged | already real |

Each aircraft config gains `doorOffsetM: [x, y, z]`, the door position in model metres. Example: Twin Otter, rear left door ≈ `[-0.9, -0.4, -2.5]`. Jumpers exit from that point plus the plane's track. The physics exit point moves by at most a few metres; the planner's exit markers follow it.

---

## 7. Zoomed-out views

The camera now has to be 5.8× farther away to show the same patch of map, so jumpers and planes look **5.8× smaller in wide shots**. A whole-load view with 3 km of map in frame shows jumpers about 2 px long. To keep them findable:

- **Markers:** every jumper and the plane get a **screen-space marker**: a 6 px dot in the jumper's colour, plus the name label when the object is selected or hovered.
- **When markers show:** only when the model's projected size is below 8 px. They fade over 8 → 16 px, so close-up views look exactly as they do now.
- **Clicks:** the marker is pickable (it forwards to the jumper or plane), so clicking and Scene Objects zoom still work at any distance.
- **Planner:** the planner's top-down view uses the same markers. It also keeps the jumprun exit-order labels, which are already screen-sized.

---

## 8. Implementation plan

1. **`WorldScale.ts`** and `worldRoot`; reparent the map, plane, jumpers, rigs, lines, overlays and wind tower. Add `logarithmicDepthBuffer`. Scale the far plane and fog.
2. **Models at true size:**
   - change the jumper STL scale to 1/5.8 and the aircraft configs to `unitsToMetres`;
   - drop the canopy rig's visual scale;
   - remove `simScale`.
3. **Map:** move `tiles.group` under `worldRoot`; make `GroundHeightField` raycast in metres; check tile counts and the cached heightfield against the current build.
4. **Cameras:** apply the map-framed and people-framed split (§5.1); update `cameraFocus` and follow; scale the initial camera position and the Location view presets.
5. **Planner:** convert `screenToWorld`, `updateCamera` and the HUD; keep labels and handles a constant pixel size.
6. **Proportion fixes:** round spacing and radius, aircraft door offsets.
7. **Markers:** screen-space jumper and plane markers with fade and picking.
8. **Tests:**
   - a Node check that tracks are identical before and after, in metres;
   - headless screenshots: LZ close-up with a jumper and a runway, whole load, planner, follow cam;
   - a check in the user's running app with real tiles.

---

## 9. Alternatives considered

- **Scale the physics (`simScale`):** rejected. Every force, the drag areas, the wind, the terrain heights and the displays would all need scaling, and the shown numbers would drift.
- **True scale + enlarged people:** keep the map at 1:1, draw jumpers and planes at true size close up, and grow them with camera distance so they stay visible. This is what flight sims do. It changes how big people look on screen, which the user wants to keep. The markers in §7 give the same "always findable" benefit without that. This can be revisited later as a setting.
- **Shrink the people instead (no world scale):** rejected. It contradicts the stated preference, and jumpers would be under a pixel in most views.

---

## 10. Acceptance criteria

- **A1. Proportions.** In the 3D view, the scene-unit ratios match reality within 5%:
  - jumper body length : Twin Otter length = 1.8 : 15.8;
  - jumper : runway width = 1.8 : 30 m (measured on a runway drawn in the planner);
  - all aircraft: their real lengths (Cessna 8.3 m, Skyvan 12.2 m, DC-9 31.8 m).
- **A2. People size unchanged.** With "Zoom in" on a jumper, the jumper's on-screen height is within 5% of the current build at the same window size.
- **A3. Physics unchanged.** Checked before the door offsets in §6 go in, since those move the exit point by design. For the default load and a load with rounds, flocks, trackers and canopies, every jumper's sample positions, velocities, pull, open and land times and landing outcome are identical to the current build (to float precision). Every displayed altitude, speed and distance matches.
- **A4. Map.**
  - No z-fighting or flicker on terrain, buildings, LZ fills or danger walls, from 10 m to 25 km camera distance.
  - Fog starts beyond the 8 km coverage edge from the default view.
  - `getGroundHeight()` returns the same metres as before at 20 sample points.
- **A5. Tiles and frame rate.** At the default view and the planner's Freefall preset, the loaded tile count and frame time are within 15% of the current build.
- **A6. Planner.** Clicks land on the intended map point (a click on a runway corner records that corner's metres within 1 m at the LZ preset). Every tool, handle, label and the HUD scale bar behave as before.
- **A7. Zoomed out.** With the whole load in view, every airborne jumper and the plane show as markers, and clicking a marker selects that object. Up close, markers are invisible.
- **A8. Formations.** No two round members' bodies intersect in a 4-way to 8-way round. Jumpers appear at the aircraft door.

---

## 11. Open questions

1. **Body length.** The scale assumes the jumper model is 1.8 m from head to toe. If a typical jumper should read smaller (1.7 m) or larger, `WORLD_SCALE` moves with it (1.7 m → 6.1).
2. **Aircraft exaggeration.** Should the planes stay slightly larger than true for readability (for example ×1.25 on top of true size), or be strictly true size as specified?
3. **Marker style.** Plain coloured dots, or small arrows showing each jumper's heading?
