# Spec: Dropzone Planner (Landing Zones, Danger Zones, Canopy Pattern, Freefall Patterns, Tracking Jumps, Slots)

**Status:** Implemented. §15 lists where the build differs from this text.
**Scope:** new `src/js/dropzone/*`, new `src/js/physics/{CanopyGuidance,FreefallGuidance,Hazards,FlockShapes,Separation}.ts`, new `src/js/visuals/{ZoneOverlays,PatternOverlays}.ts`, new `src/js/panels/DropzonePanel.ts`; changes to `src/js/classes/SimEntities.ts`, `src/js/utils/AlignJumprun.ts`, `src/js/LocationSelect.ts`, `src/js/physics/BodyPositions.ts`, `src/js/physics/FormationShapes.ts`, `src/js/physics/FormationFlight.ts`, `src/js/ui/PlaneLoad.ts`, `src/js/panels/jumperStatus.ts`, `src/js/editor/Timeline.ts`, `src/js/Scripts.ts`, `index.html`, `src/css/editor.css`
**Depends on:** `map-terrain-buildings.md` (8 km map coverage, `getGroundHeight`), `editor-layout.md` (dock tabs, `window.dock`), canopy phases (`physics/Canopy.ts`)

---

## 1. Summary

Add a **top-down Dropzone Planner** over the DZ map. In it the user can set the jumprun and point and click to create:

1. **The jumprun:** set and edit its position and direction by dragging, typing a heading, or snapping it into the upper winds or parallel to a runway. Each jumper's exit point is marked along it.
2. **Landing zones (LZs):** areas where jumpers should land. One is the primary LZ, which holds the landing target.
3. **Danger zones:** runways, power lines, washes, roads, water and so on. Each has a **ceiling** (default **500 ft AGL**): jumpers under canopy must not be over the zone when they are lower than its ceiling.
4. **The canopy landing pattern:** three legs that every jumper tries to fly: **downwind** from 1,000 ft, **base** from 500 ft and **final** from 250 ft. The user draws the pattern once. At sim time it is **flipped to its mirror image** when needed, so **final is flown into the wind** and the pattern stays on the same side of the landing area.
5. **Freefall patterns:** zoom out and draw a **tracking pattern** and a **wingsuit pattern**. Each is a chain of legs, and each leg has its own end rule (altitude, arrival or time). Trackers and wingsuiters follow them in freefall as well as they can.

It also adds:
- a **Tracking body position**: the jumper tracks from exit to pull, following the tracking pattern;
- **slots**:
  - every jumper in a **round** gets a numbered slot on the ring, at a set radial distance from the centre, plus a breakoff slot further out that they track to, so the group ends up a set distance apart;
  - linked **wingsuiters** fly a **flock**: the base flies the wingsuit pattern and everyone else holds a slot offset from them;
  - solo wingsuiters and trackers on the same pattern each fly their own parallel **lane**.

The planner is an **orthographic, north-up camera on the same three.js scene**, not a separate 2D image. Zones, patterns, terrain, buildings, the jumprun and simulated tracks then line up exactly. The planner becomes the one place to set the jumprun, replacing the two-click **Align Jumprun** flow. Everything drawn in the planner also shows in the normal 3D view.

---

## 2. Current state (as of this spec)

| Area | What the code does today |
|---|---|
| Top view | Plane Settings → **Top view** calls `startPlaneEdit()` (`Scripts.ts`). It puts the perspective camera above the plane so the user can drag the jumprun. `isEditingPlane` turns off picking until the camera moves. |
| Jumprun | Stored only as the plane's start position and direction. It is set three ways: **Align Jumprun** in Jump Settings (click two points on the map → `alignPlaneToJumprun()` in `utils/AlignJumprun.ts`, which draws a temporary arrow); `defaultJumprun` points in `dropzones.json` (loaded by `LocationSelect.ts`); and dragging in **Top view**. It isn't saved per DZ, and nothing shows where each jumper exits. Exit points follow from plane speed, wind and the exit interval. |
| Map | `terrain/MapScene.ts` streams an 8 km radius around the DZ. `getGroundHeight(x, z)` gives terrain height. The DZ ground is `y = 0`. World axes: +X east, −Z north, metres. |
| Canopy navigation | `SimJumper.precalculate()` has a local `desiredHeading()`. It flies to an aim point on a straight-in line, with final into the surface wind (`windVectorAt(10)`). Landing targets are a 12 m grid around the DZ origin. There are no pattern legs, no LZ boundaries and no hazard checks. |
| Freefall gliding | `trackingDir` is fixed per jumper: perpendicular to jumprun, or radial after a formation breakoff. **Track** (on by default) starts tracking at `TRACK_START_FT` (4,500 ft). Wingsuits glide from exit along `trackingDir` at glide 2.5. Nobody steers. |
| Formations | Linked groups fly a **round** (`FormationShapes.ts`, `FormationFlight.ts`). Slots sit evenly on a ring whose radius comes from 1.7 m between neighbours (at least 1.0 m). A jumper's slot is their exit order within the group, with slot 0 on the jumprun side. The group breaks off at `TRACK_START_FT` (4,500 ft) and each member tracks straight out from the centre until pull. Wingsuits never join a group. Nothing checks separation at deployment. |
| Body positions | `belly`, `sitfly`, `headdown`, `wingsuit` (`BodyPositions.ts`). `TRACK_SPEC` has area 0.71 m² and glide 1.0, but it is only used for the breakoff track. |
| Persistence | Dock layout uses `localStorage`. Dropzones come from `public/json/dropzones.json`, and some have a `defaultJumprun`. There is no per-DZ planning data. |

---

## 3. Goals / non-goals

**Goals**
- G0. Set and edit the jumprun direction and position in the planner: drag, type a heading, auto into the upper winds, or snap to a runway. Show each jumper's exit point live.
- G1. A top-down planner that zooms from about 100 m across (the landing area) to about 16 km across (wingsuit patterns), within the 8 km map coverage.
- G2. Point-and-click creation and editing of landing zones and danger zones, with polygon, rectangle and line shapes.
- G3. A danger-zone ceiling per zone (default 500 ft AGL). It is enforced in canopy navigation and reported when broken.
- G4. A three-leg canopy pattern (downwind 1,000 / base 500 / final 250 ft, editable), flipped to its mirror image at sim time so final is flown into the wind.
- G5. Tracking and wingsuit freefall patterns made of legs, which jumpers follow with wind-corrected steering.
- G6. A **Tracking** body position that tracks the whole jump.
- G8. Slots: numbered round slots with a set slot radius and breakoff distance; wingsuit flocks with slots relative to the base; parallel lanes for solo wingsuiters and trackers on a shared pattern; a separation check at deployment.
- G7. Plans are saved per dropzone. They can be exported and imported as JSON, and edits recalculate the sim automatically.

**Non-goals (this spec)**
- Canopy-to-canopy traffic separation and collision avoidance.
- Altitude lost in canopy turns, spirals and swoops. Turns stay rate-limited and level, as today.
- Per-jumper landing priority (students first, tandems in a separate area). See §14, Q1.
- Airspace, NOTAMs and aircraft traffic.

---

## 4. The planner view

### 4.1 Entering and leaving
- **View → Dropzone Planner** (shortcut **P**), a **Plan** button in the viewport's top-right corner, and **Open planner** in the Dropzone tab.
- Entering saves the current perspective camera, follow target and controls state. It then switches the renderer to an `OrthographicCamera` that looks straight down, north up, centred on the primary LZ target (or the DZ origin).
- **Esc** with no tool active, or the **Exit planner** button, restores the saved camera exactly.
- Plane Settings → **Top view** and Jump Settings → **Align Jumprun** both open the planner with the **Jumprun** tool active (§4.5, §5.0). This replaces the perspective `startPlaneEdit()` path, its `isEditingPlane` flag, the two-click `collectTwoAlignPoints()` flow and its temporary `alignArrow`.

### 4.2 Camera controls
- **Wheel:** zoom towards the cursor. The view width is clamped to 100 m–20 km.
- **Pan:** right- or middle-drag, Space + left-drag, or left-drag on empty map in the Select tool.
- **Presets** in the planner toolbar:

  | Preset | View width |
  |---|---|
  | Landing area | about 1.2 km |
  | Canopy | about 3 km |
  | Freefall | about 8 km |
  | Fit plan | everything in the plan |

- No rotation. The map stays north-up so headings read naturally.
- HUD (DOM overlay):
  - scale bar;
  - north arrow;
  - surface wind arrow with speed;
  - cursor readout: ground elevation, and distance and bearing from the LZ target.

### 4.3 Map style in the planner
Power lines and washes are hard to see on Mapbox Dark. The planner gets a **Satellite in planner** toggle, on by default and remembered. When on, it switches to Cesium satellite on entry and back to the user's style on exit, using the existing map-style switch.

### 4.4 Layers
These checkboxes sit in the planner toolbar and are mirrored in the Location tab for the 3D view. Each is remembered:
- Landing zones
- Danger zones
- Canopy pattern
- Freefall patterns
- Jumprun (line, exit markers and ground-speed label)
- Wind
- Simulated tracks: jumper ground tracks for the current calculation, to check how well the patterns are followed. Danger-zone violations are coloured red.

### 4.5 Tools (planner toolbar)

| Tool | Key | Click behaviour |
|---|---|---|
| Jumprun | J | Edits the jumprun (§5.0): drag the start handle to move it, drag the arrowhead handle to rotate, drag the line to move it sideways. With no jumprun, or after **Redraw**, click the start point and then a point along the direction. |
| Select | V | Click to select. Drag a vertex to move it, drag the body to move the item, click a midpoint handle to insert a vertex. **Delete** removes the selected vertex or item. |
| Landing zone | L | Polygon: click to add vertices. To close, click the first vertex, double-click or press Enter. |
| Danger zone | D | Sub-modes: **Polygon** (washes, water), **Rectangle** (drag; runways, roads) and **Line** (click points, Enter to finish; power lines, fences), with a width. |
| Canopy pattern | C | Click 3 points: downwind start (1,000 ft), turn to base (500 ft), turn to final (250 ft). Final runs to the primary LZ target. If a pattern exists, the tool edits it. |
| Tracking pattern | T | Click waypoints from the jumprun outwards. Enter finishes, and the last point is the deploy area. |
| Wingsuit pattern | W | Same as Tracking pattern. |

Common keys:
- **Backspace** removes the last point placed.
- **Esc** cancels the shape being drawn.
- **Ctrl+Z** and **Ctrl+Shift+Z** undo and redo. The stack holds whole-plan JSON snapshots and is capped at 100 steps.

Snapping: holding **Shift** while placing constrains the segment to 15° steps. Pattern points snap to the LZ target within 10 px. With the Jumprun selected, the **arrow keys** rotate it 1° (Shift: 10°) and **R** reverses it.

A click becomes a world point by unprojecting through the ortho camera to `(x, z)`, then `y = getGroundHeight(x, z)`.

### 4.6 Dropzone tab (inspector)
A new dock tab, **Dropzone**, docked by default next to Location. It has:
- **Item list**, grouped: Jumprun, Landing zones, Danger zones, Canopy pattern, Freefall patterns. Clicking a row selects the item and frames it in the planner.
- **Properties** for the selected item (§5).
- **Warnings**, refreshed live, for example:
  - "Final crosses *Runway* below 500 ft";
  - "No primary landing zone";
  - "No wind data: pattern shown as drawn".

  Clicking a warning frames the problem.
- **Plan actions:** Export, Import, Reset to DZ default, Clear.

---

## 5. Items and their properties

All positions are stored as **metres east/north of the DZ origin** (`{ e, n }`). In the world, `x = e` and `z = −n`. Heights are **ft AGL**, measured from the terrain under the point being checked.

### 5.0 Jumprun
The jumprun is the plane's ground track during exits. It is a **start point** (the green light, where the plane is at the first exit) plus a **heading** in degrees true. The exit altitude stays the Jump Height setting.

**Editing in the planner (Jumprun tool):**
- **Start handle:** drag to move the start point. The heading is kept.
- **Rotate handle:** the arrowhead at the far end. Drag to change the heading, rotating about the start point. Hold **Alt** to rotate about the line's midpoint. A heading readout ("Jumprun 278°") follows the cursor. **Shift** snaps to 5°.
- **Body:** drag the line to move the whole jumprun. The heading is kept.
- **Snap to runway:** while rotating, the heading snaps when within 3° of the long axis of any *Runway* danger zone (either direction). The code comment in `AlignJumprun.ts` notes jumprun is typically parallel to the runway.
- **Keys:** arrow keys rotate 1° (Shift: 10°); **R** reverses the direction (moving the start point to the far end, so the line stays put).

**Properties (Dropzone tab):**
- **Heading** (° true): number input.
- **Start point:** shown as distance and bearing from the primary LZ target, for example "1.2 km at 245°", with editable e/n fields.
- **Offset from LZ:** the perpendicular distance from the primary LZ target to the jumprun line, signed left or right. It is editable: changing it slides the line sideways and keeps the heading. DZs often fly jumprun offset from the landing area.
- **Mode:**
  - **Fixed** (default): as set.
  - **Into upper winds:** the heading is set into the wind at exit altitude (the mean wind over the top 3,000 ft of the climb). It updates when the weather changes, rotating about the point on the jumprun nearest the primary LZ target, so the jumprun keeps passing the spot. Below the calm threshold it keeps its last heading.
- **Buttons:**
  - **Into wind now:** a one-off set into the upper winds, in Fixed mode;
  - **Reverse;**
  - **Redraw:** two clicks;
  - **Reset to DZ default:** the `defaultJumprun` from `dropzones.json`.

**Display:**
- **Planner:**
  - the line with a direction arrow, start (green) and end (red) markers;
  - an **exit marker per jumper**, numbered in exit order. Each marker sits at the plane's position at that jumper's `jumpTime`, taken from the plane's calculated track, so it accounts for wind and the exit interval;
  - a ground-speed label, for example "Ground speed 72 kt · 9 s apart ≈ 330 m between exits".

  The line runs from the start point to the last exit plus 300 m.
- **3D view:** the same line at exit altitude, with exit markers. It replaces the temporary `alignArrow`.

**Live feedback while dragging:** the line, exit markers and any jumprun-relative freefall patterns (§5.4) move live, without recalculating. The sim recalculates 300 ms after the drag ends.

**Spot check:** after each recalculation, the Warnings list names any jumper who can't reach the primary LZ (§7.2 reachability), for example "Exits 9–10 can't make the main LZ". Clicking the warning frames those exits. This is the main tool for deciding where the jumprun goes.

### 5.1 Landing zone
- Name.
- Primary (exactly one LZ is primary; making another one primary clears the flag on the old one).
- Polygon.
- **Target:** a draggable point, defaulting to the polygon's centroid and kept inside the polygon.
- Spread radius, default 40 m. Each jumper's aim point is spread around the target, clipped to the LZ polygon. This replaces the current 12 m grid.

### 5.2 Danger zone
- Name.
- Type preset, which sets the colour and icon:

  | Preset | Default shape |
  |---|---|
  | Runway | rectangle |
  | Power lines | line, 30 m wide |
  | Wash | polygon |
  | Road | line, 20 m wide |
  | Water | polygon |
  | Buildings | polygon |
  | Trees | polygon |
  | Other | polygon |

- Shape: polygon, or polyline + width.
- **Ceiling (ft AGL):** default 500, range 0–3,000. 0 means "don't land here" but overflying is fine.
- Notes.

**Rule:** a jumper **under canopy** is in violation while their ground position is inside the zone footprint **and** their height above the terrain there is below the ceiling. A landing inside any danger zone is always a violation, whatever its ceiling. Freefall ignores ceilings (§14, Q2).

### 5.3 Canopy landing pattern
- **Legs:** three legs, each defined by the point and altitude where it starts:

  | Leg | Starts at | Default start altitude |
  |---|---|---|
  | Downwind | P0 | 1,000 ft |
  | Base | P1 | 500 ft |
  | Final | P2 | 250 ft |

  Final ends at the primary LZ target T. Altitudes are editable and must stay in decreasing order.
- **Hand** (left or right) is worked out from the drawn turns and shown read-only.
- **Orientation mode:**
  - **Flip** (default): the DZ practice of keeping two mirrored patterns. The sim flies either the drawn pattern or its **mirror image**, whichever has the final heading more into the landing wind, using the larger of `dot(finalDir, −wind)`.
    - The mirror is a reflection across the line through T at right angles to the drawn final.
    - Mirroring reverses the final heading and swaps left-hand ↔ right-hand. It keeps every leg on the **same side of the LZ** as drawn, so a pattern drawn away from the runway or power lines stays away from them.
    - An exact crosswind keeps the drawn pattern.
  - **Fixed:** always as drawn, for example when the LZ can only be landed one way.

  Because a flip only reverses final, final is always within 90° of into the wind. Draw the pattern with final along the LZ's usual wind direction for the best results.
- **Calm threshold:** default 3 kt. Below it the pattern is flown as drawn.
- **Landing wind:** the mean wind vector from 0–250 ft (final's altitude band), sampled from the wind profile. If there is no weather, the pattern is flown as drawn and a warning is shown.
- **Planner display:**
  - the drawn pattern in solid lines, with arrows and altitude tags at P0, P1 and P2;
  - its mirror image as a faint dashed outline, so both options can be checked against the danger zones;
  - the one flown today highlighted and labelled, for example "Flown mirrored · right-hand · final 270° into 8 kt".
- **3D view:** the pattern being flown as a descending 3D path, from P0 at 1,000 ft down to T on the ground.
- **Validation:** the danger-zone checks of each leg (§12, step 6) run on **both** the drawn pattern and its mirror, because either may be flown.

### 5.4 Freefall pattern (tracking and wingsuit)
- Name, type (tracking / wingsuit), and whether it is the default for its type. The first pattern of each type becomes its default.
- **Anchor:**
  - **Jumprun-relative** (default): waypoints are stored relative to the jumprun's start point and direction, so the pattern moves and rotates with the jumprun.
  - **Map:** waypoints are fixed on the ground.
- **Legs**, in order. Leg 1 starts at each jumper's own exit point. Each leg has:
  - **Steer:** **To point** (waypoint W_k) or **Heading** (fixed true heading; the waypoint is only a visual hint);
  - **Ends when:**
    - **Altitude** (default): ft AGL;
    - **Arrival:** within 50 m of W_k, or past it along the leg;
    - **Time:** seconds into the leg.

    Whichever condition is set, reaching the jumper's **pull altitude** ends the pattern.
  - The last waypoint is the **deploy area**. It is shown with a ring of radius 150 m, and pulling outside it is a warning.
- **Lane spacing:** default 150 m. Solo jumpers who share the pattern each fly a parallel lane (§9.3).
- **Defaults when created:**
  - Altitude-ended legs.
  - Leg end altitudes spread evenly between the exit altitude and pull altitude.
  - Tracking: legs from exit to 3,500 ft.
  - Wingsuit: legs from exit to 4,000 ft. The wingsuit pull altitude default is unchanged; see §14, Q5.
- **Planner display:**
  - polyline with leg numbers and end-altitude tags;
  - the jumprun exit segment drawn faintly at the start;
  - a ghost of each assigned jumper's simulated ground track, when the Simulated tracks layer is on.

---

## 6. Data model and persistence

```ts
// src/js/dropzone/DropzonePlan.ts
type EN = { e: number; n: number };                  // metres east / north of DZ origin

interface LandingZone { id: string; name: string; primary: boolean;
  polygon: EN[]; target: EN; spreadM: number; }

type DangerKind = "runway" | "powerlines" | "wash" | "road" | "water" | "buildings" | "trees" | "other";
interface DangerZone { id: string; name: string; kind: DangerKind;
  shape: { type: "polygon"; points: EN[] } | { type: "line"; points: EN[]; widthM: number };
  ceilingFt: number; notes?: string; }

interface CanopyPattern { points: [EN, EN, EN];          // downwind start, base turn, final turn (target = primary LZ)
  legAltitudesFt: [number, number, number];          // downwind 1000, base 500, final 250
  orientation: "flip" | "fixed"; calmThresholdKt: number; }

interface FreefallLeg { point: EN; steer: "point" | "heading"; headingDeg?: number;
  end: { by: "altitude"; ft: number } | { by: "arrival" } | { by: "time"; s: number }; }
interface FreefallPattern { id: string; name: string; kind: "tracking" | "wingsuit";
  isDefault: boolean; anchor: "jumprun" | "map"; legs: FreefallLeg[]; deployRadiusM: number;
  laneSpacingM: number; }                                  // §9.3

interface Jumprun { start: EN; headingDeg: number;          // degrees true
  mode: "fixed" | "intoUpperWind"; }

interface DropzonePlan { version: 1; dropzone: string;
  jumprun: Jumprun | null;                                 // null → dropzones.json defaultJumprun
  landingZones: LandingZone[]; dangerZones: DangerZone[];
  canopyPattern: CanopyPattern | null; freefallPatterns: FreefallPattern[]; }
```

**Notes on the model**
- For jumprun-relative patterns, `point` is stored in the jumprun frame: `e` along the jumprun from its start point, `n` to the left of it. `resolvePattern(pattern, jumprun)` converts it to world `{x, z}` once per recalculation.
- **Applying the jumprun:** `applyJumprun(plan.jumprun, simPlane)` converts it to a start point and direction and calls `alignPlaneToJumprun()`. This happens on load, on DZ select (replacing the `defaultJumprunPoints` path in `LocationSelect.ts`) and on every jumprun edit. The plane's start altitude stays the Jump Height. `defaultJumprun` in `dropzones.json` is now only the fallback when a plan has no jumprun.
- **Storage:** `localStorage["jumpersim.dzplan." + dz.name]`, written 500 ms after each change.
- **Defaults:** `dropzones.json` may carry an optional `plan` per DZ, like `defaultJumprun`. **Reset to DZ default** reloads it.
- **Export / Import:** a `<dz>.dzplan.json` file. Import validates `version` and warns when the file's `dropzone` doesn't match the selected DZ (the user can still import).
- **Access:** `getDropzonePlan()` and `onPlanChanged(cb)`. Changes call `requestRecalculation()` 300 ms after the edit ends: when a drag finishes, a shape closes, or a property input commits. They never fire mid-drag.

---

## 7. Sim integration

### 7.1 Geometry and hazards (`physics/Hazards.ts`, `dropzone/geometry.ts`)
- Helpers: `pointInPolygon`, `distanceToPolyline`, `insideZone(zone, x, z)` (a line zone counts as inside when within width/2), `segmentCrossesZone`, `clipToPolygon`.
- Zones are pre-resolved per recalculation into world-space bounding boxes, so most checks are rejected with a cheap box test.
- `hazardAt(x, z, heightFt): DangerZone | null` returns the first zone that is broken at that point.
- **Recording violations:** during canopy flight `precalculate` checks every 0.1 s and saves events on the jumper: `hazardEvents: { zoneId, start, end, minHeightFt }[]`. Landing in a danger zone sets `landingOutcome = { kind: "hazard", zoneId }`. Other outcomes are `{ kind: "lz", lzId }` and `{ kind: "out" }`.

### 7.2 Canopy guidance (`physics/CanopyGuidance.ts`)
This replaces the local `desiredHeading()` in `SimJumper.precalculate()`. The interface stays the same: `desiredHeading(pos, wind) → unit vector`, plus a `phase` label for the status text. Turn-rate limits, wing-loading speeds and the flare are unchanged.

**Pattern being flown.** After the flip choice (§5.3) the points are P0, P1, P2, T with altitudes A0 = 1,000 (downwind), A1 = 500 (base), A2 = 250 (final) and 0 ft. Each jumper's T is their spread aim point inside the LZ.

**Reachability, checked once at full open:**
1. Can the jumper reach P0 by A0? The test is: (distance to P0 ÷ ground speed towards P0) × descent rate ≤ (h − A0).
2. If not, try the other LZs, nearest first, as a straight-in final into the wind. The test is the same, using each LZ target at 0 ft and a 50 ft margin.
3. If none is reachable, the jumper is **landing out**: aim for the original target, avoid hazards, and land wherever they get to.

Status: "Going for *Student LZ*" or "Landing out".

**Phases:**

| Phase | Condition | Steering |
|---|---|---|
| **Holding** | h > A0 + 100 ft | Fly to a holding point H = P0 moved 100 m upwind. Within 150 m of H, S-turn across the wind (alternate ±70° off into-wind every 8 s) to burn height with little drift. |
| **Downwind**, then **Base** | A0 ≥ h > A1, then A1 ≥ h > A2 | Track the leg line (P0 → P1, then P1 → P2). Aim at a point 60 m ahead of the jumper's projection onto the line, with crab correction (the existing `crossWind` maths). |
| **Final** | h ≤ A2 | Aim at T with crab correction. Flare as now. |

**Turns:**
- Jumpers turn **by altitude** (the primary rule): base starts when h ≤ 500 ft and final when h ≤ 250 ft, wherever they are. Being high stretches a leg past its turn point.
- **Cut the corner when low:** if the predicted height on reaching the next turn point is more than 75 ft below its altitude, aim straight at the point after it. Predicted height = h − (distance along the leg ÷ ground speed along the leg) × descent rate.
- **Passing a turn point while still high:** the jumper holds the leg's heading until the altitude gate. They do not turn back.

**Hazard avoidance** applies in every phase, whenever any zone's ceiling is above the jumper:
1. Project the jumper's ground path 8 s ahead along the candidate heading, using wind and descent.
2. If any point of that path breaks a zone, try headings at ±15°, ±30° … ±90° from the desired heading, nearest first.
3. Take the first one that is clear. If none is clear, keep the desired heading.

Avoidance overrides the pattern but not the flare.

**Status labels:**
- "Holding", "Downwind", "Base", "Final", "Going for *LZ*", "Landing out";
- after landing: "Landed · *Main LZ*", "Landed out" or "⚠ Landed in *Runway*".

### 7.3 Freefall guidance (`physics/FreefallGuidance.ts`)
Freefall guidance applies to jumpers in a **gliding** state:
- **Tracking** body position: from exit (after the stabilisation in §8);
- **Wingsuit**: from exit;
- **breakoff tracking** (Track toggle on other positions): unchanged; still radial or perpendicular, with no pattern.

Jumpers fly the pattern assigned to them (§10), offset to their lane (§9.3). Wingsuiters in a flock follow the base instead until flock breakoff (§9.4). With no pattern assigned, they fly today's fixed `trackingDir`.

**Steering:**
- **To point:** crab-corrected heading towards W_k, using the same solver as the canopy, with the jumper's current horizontal glide speed.
- **Heading legs:** that heading, with no wind correction (it's a heading, not a track).
- **Turn-rate limits:** tracking 45°/s, wingsuit 20°/s. The new heading becomes `trackingDir` each step, and the existing `glideBlend` easing keeps velocity smooth.

**Leg ends** follow §5.4. The jumper moves to the next leg; after the last leg they hold its heading until pull. **Pull altitude always wins.**

**Glide modulation ("best they can"):**
- Each gliding position gets a glide range. The default value is unchanged.

  | Position | Glide range | Default |
  |---|---|---|
  | Tracking | 0.6–1.0 | 1.0 |
  | Wingsuit | 1.8–2.8 | 2.5 |

- On altitude-ended to-point legs, predict the height at which the jumper reaches W_k.
  - Arriving high: steepen the glide (lower ratio).
  - Arriving low: flatten it, up to the maximum.
- The glide ratio eases with τ = 2 s.
- This lets jumpers arrive close to the planned point and altitude together. When they can't, they reach the altitude gate early or late and the leg ends there.

**Outputs** recorded on the jumper:
- `freefallLegTimes: number[]`: the time each leg starts;
- `deployOutsideArea: boolean`.

Status: "Tracking jump · Leg 2/3" or "Wingsuit · Leg 1/2".

### 7.4 Where it hooks into `SimJumper.precalculate()`
- Before the loop:
  - get the plan;
  - resolve zones and patterns to world space;
  - work out the landing wind and pick the drawn or mirrored canopy pattern **once per recalculation** (shared by all jumpers);
  - choose each jumper's aim point and freefall pattern.
- **Freefall gliding branch:** `trackingDir` comes from `FreefallGuidance.step()` instead of staying fixed.
- **Canopy flight branch:** the heading comes from `CanopyGuidance.step()` instead of the local `desiredHeading()`.
- **After landing:** set `landingOutcome`.

**Cost:** hazard checks every 0.1 s, plus an 8 s lookahead at most 13 headings × 8 points. For the default load this should add less than 20% to precalc time. Acceptance criterion A9 checks it.

---

## 8. Tracking body position

- Add `tracking` to `BODY_POSITIONS`:

  | Field | Value |
  |---|---|
  | Label | Tracking |
  | Drag area | `TRACK_SPEC.dragAreaM2` (0.71 m²) |
  | Glide | 1.0 (range 0.6–1.0, §7.3) |
  | Gliding | yes |
  | Fall rate | about 95 mph vertical at 80 kg |

- **From exit:** 3 s of plain freefall, so the exit throw bleeds off as it does today. Then the jumper starts gliding, eased in with `GLIDE_TAU_S`, and follows the tracking pattern (§7.3) down to pull altitude. They deploy as usual.
- **Track toggle:** in Plane Settings the checkbox shows ticked and is disabled for Tracking and Wingsuit, with the tooltip "Tracks the whole jump".
- **Formations:** Tracking jumpers don't join rounds or flocks. Linked tracking jumpers get the hint "Tracking jumpers fly lanes, not formations" and fly lanes (§9.3).
- **Exit order:** no automatic reordering. A warning appears in Plane Settings if a Tracking or Wingsuit jumper exits before belly or freefly groups. The usual exit order is wingsuits and trackers last.

---

## 9. Slots: rounds, wingsuit flocks and lanes

A **slot** is the place a jumper is assigned to fly relative to the group or the pattern:
- in a round: a position on the ring, then a breakoff position further out;
- in a wingsuit flock: an offset from the base flyer;
- for solo pattern flyers: a parallel lane.

Slots are numbered from 1 and shown in a new **Slot** column in Plane Settings (§10).

### 9.1 Splitting a linked group
A linked group (same group key, as today) is split by body position. **Exit timing:**
- Belly, freefly (sitfly / head-down) and Tracking members leave the plane **together**, at the group's exit time.
- Wingsuit members leave **one second apart** (`FLOCK_EXIT_GAP_S = 1`), in Plane Settings order: the base first, then slot 2, slot 3 and so on, starting at the group's exit time. `normalizeJumpTimes()` assigns these times.
- The next group's exit time is unchanged; the exit interval still runs from group to group.

How each member then flies:

| Members | What they fly |
|---|---|
| Belly / sitfly / head-down | The group's **round** (or **None**) |
| Wingsuit | A **flock** (§9.4) |
| Tracking | Solo **lanes** (§9.3) after exiting with the group |

### 9.2 Round slots
- **Numbered slots.**
  - Slot 1 sits on the jumprun-forward side of the ring. The others follow clockwise seen from above, as today.
  - Each member's slot defaults to their exit order within the group.
  - It can be changed in the **Slot** column. Picking a slot that is already taken **swaps** the two jumpers.
  - Stored on the jumper as `formationSlot`.
- **Slot radius:** the radial distance from the round's centre to every slot.
  - **Auto** (default) keeps today's rule: 1.7 m between neighbours, at least 1.0 m.
  - A typed value in metres sets the radius directly.
  - The resulting gap between neighbours is shown next to it, for example "≈ 1.7 m apart".
- **Breakoff altitude:** default 4,500 ft. It replaces the fixed `TRACK_START_FT` for rounds.
- **Breakoff slots.** At breakoff each member tracks straight out from the centre through their ring slot, as today, but now towards a **breakoff slot**: the point on that radial line at the **breakoff distance** from the breakoff centre.
  - **Auto** (default): the smallest distance that puts neighbours `minDeploySeparationM` apart (default 150 m). That is r = 150 ÷ (2·sin(π/n)), and never less than 150 m.
  - On reaching their breakoff slot, the member stops tracking and falls belly to earth (wave-off) until their pull altitude.
  - If pull altitude comes first, they pull where they are.
- **Status:** "In round · Slot 3", "Tracking to slot 3", "Holding slot 3", "Pulling".
- **Display:** with the Simulated tracks layer on, the planner shows each round's breakoff centre, the radial lanes and the breakoff slots as small numbered circles.

### 9.3 Lanes (solo wingsuiters and trackers)
Jumpers flying the same freefall pattern on their own (not in a flock) are given **lanes** so they don't converge on the same waypoints.
- **Lane numbers:** 0 is the drawn pattern, then +1, −1, +2, −2 … in exit order among that pattern's solo flyers. Positive is to the right of the direction of flight.
- **Override:** the **Slot** column (shown as "Lane 0", "Lane +1" …). Stored on the jumper as `laneIndex`.
- **Geometry:** a lane is the pattern offset sideways by laneIndex × the pattern's **lane spacing** (default 150 m). Corners are offset along the bisector (a mitred offset), so the legs stay parallel.
- **Guidance:** the same as §7.3, run on the lane's waypoints. Altitude gates and end rules are unchanged.
- **Display:** when a pattern is selected, its lanes are drawn as thin parallel lines labelled with their lane numbers.

### 9.4 Wingsuit flocks (linked wingsuiters)
Linked wingsuiters exit one second apart (§9.1) and fly as a **flock**.
- **Base:** slot 1 flies the group's wingsuit pattern (§7.3), on lane 0.
- **Other slots:** fixed offsets in the base's heading frame `{ across (right +), behind, below }` in metres. They come from the flock **layout**, a registry like `FORMATION_SHAPES`, so new layouts appear in the picker automatically:

  | Layout | Slot k (k = 2, 3 …), with s = spacing |
  |---|---|
  | **Arrowhead** (default) | Alternating right/left. Row r = ⌈(k−1)/2⌉: across ±r·s, behind r·0.8·s. |
  | **Echelon right / left** | Across ±(k−1)·s, behind (k−1)·0.8·s. |
  | **Line abreast** | Alternating right/left. Across ±⌈(k−1)/2⌉·s, behind 0. |
  | **Trail** | Across 0, behind (k−1)·s. |

- **Settings:**
  - spacing, default 15 m;
  - stack, default 0 m: each row flies this much lower than the one ahead;
  - flock breakoff altitude, default 5,500 ft.
- **Flying the flock.** Flock flight uses the same approach as the round:
  - the base's guided wingsuit path is calculated once per recalculation and cached (`flockPath`, alongside `formationPath`);
  - each follower's position is base position + slot offset, rotated with the base's heading;
  - followers leave the plane 1 s after the one before, so they start behind the base. Each moves from where they are at their own exit time into their slot, eased with `smoothstep` over `FLOCK_DOCK_S` (20 s from their exit; wingsuits take longer to close than a round);
  - when the base turns, the whole flock pivots with it.
- **Flock breakoff:**
  - At the flock breakoff altitude each member turns away from the base line by a **fan angle**: right slots turn right, left slots turn left, and the base holds its heading.
  - The fan angle is 30° × row, capped at 90°. Trail slots alternate right and left.
  - Members then fly their own physics (§7.3, holding the new heading) until their pull altitude.
- **Status:** "Wingsuit flock · Slot 3 (R1)", "Flock breakoff", then the normal wingsuit statuses.

### 9.5 Separation at deployment (`physics/Separation.ts`)
- **What is measured:** after each recalculation, the horizontal distance from every jumper's position at their pull time to every other jumper's position at that same time.
- **Warning:** a pair closer than `minDeploySeparationM` (default 150 m, set in Jump Settings) gets a warning. It appears in Plane Settings, Scene Objects and the Dropzone tab warnings, for example "Slots 2 and 3 of Round A are 90 m apart at pull". There is also an orange timeline marker.
- **Not enforced:** jumpers don't change course to fix it. It is information for adjusting the slot radius, breakoff altitudes, lanes or exit order.

---

## 10. UI changes outside the planner

- **Plane Settings:**
  - the Position select gets **Tracking**;
  - a new **Pattern** column appears for tracking and wingsuit jumpers: *Default (name)*, *None*, or a named pattern of the matching kind. Other jumpers show "–". The choice is saved on the jumper as `freefallPatternId?: string`;
  - a new **Slot** column (§9): the round slot ("3"), flock slot ("3 · R1") or lane ("Lane +1"), editable as a dropdown. Picking a taken slot swaps the two jumpers;
  - a **⚙** button next to the Formation select opens a compact popover, so the toolbar stays tidy:
    - Round: slot radius, breakoff altitude, breakoff distance;
    - Wingsuit flock: layout, spacing, stack, breakoff altitude.
  - The settings are saved on the plane, like `linkedFormation`:

    ```ts
    roundSettings: { slotRadiusM: number | "auto"; breakoffFt: number; breakoffDistanceM: number | "auto" }
    flockSettings: { layout: FlockLayoutId; spacingM: number; stackM: number; breakoffFt: number }
    ```
- **Jumper fields:** `formationSlot?: number` and `laneIndex?: number`, saved with the jumper like the other Plane Settings fields.
- **Status:** `jumperStatus` gets the labels from §7.2–7.3.
- **Scene Objects details:**
  - "Pattern: *Tracking A* · Leg 2/3 · Lane +1" or "Round A · Slot 3";
  - separation at pull, for example "Nearest at pull: 180 m (Jumper 4)";
  - "Landing: *Main LZ*", "Out" or "⚠ *Runway*";
  - danger-zone violations, with times.
- **Timeline:**
  - red markers at the start of each hazard event;
  - orange markers for separation warnings at pull;
  - a red landing marker for hazard landings.
- **Trajectory lines:** segments recorded during a hazard event are tinted red in both views.
- **3D view:**
  - LZs: translucent green fill draped on the terrain;
  - danger zones: red fill plus a translucent red wall up to the ceiling, so "don't be below this here" is visible;
  - patterns: as in §5.

  Toggle: Location tab → **Zones & patterns**.

---

## 11. Code structure

```
src/js/dropzone/
  DropzonePlan.ts      model, defaults, load/save/export/import, undo stack, onPlanChanged
  geometry.ts          EN↔world, point-in-polygon, polyline distance, clipping, centroid
  PlannerView.ts       ortho camera, enter/exit, zoom/pan, HUD, layer toggles
  PlannerTools.ts      select/LZ/danger/pattern tools, handles, snapping, keyboard
  JumprunTool.ts       jumprun handles, rotate/move/offset, runway snap, exit markers, into-wind mode
  patternMath.ts       flip canopy pattern to wind (mirror across the crosswind line), resolve freefall patterns, mitred lane offsets
src/js/physics/
  Hazards.ts           resolved zones, hazardAt, path checks
  CanopyGuidance.ts    reachability, holding, legs, final, avoidance
  FreefallGuidance.ts  leg sequencing, crab steering, glide modulation, lane offsets
  FlockShapes.ts       flock layout registry (arrowhead, echelon, line abreast, trail), fan-out rule
  Separation.ts        pairwise distance at pull, warnings
  FormationShapes.ts   (changed) slot radius setting, slot numbering/swaps, breakoff distance
  FormationFlight.ts   (changed) split linked groups by body position; flockPath; breakoff slots
src/js/visuals/
  ZoneOverlays.ts      draped polygons (ShapeUtils triangulation, ≤25 m tessellation, y = ground + 1 m,
                       polygonOffset), ceiling walls, line-zone ribbons
  PatternOverlays.ts   2D/3D pattern paths, arrows, altitude tags (CSS2D labels), ghosts
src/js/panels/
  DropzonePanel.ts     Dropzone dock tab: list, properties, warnings, plan actions
src/js/utils/AlignJumprun.ts
                       gains applyJumprun(jumprun, plane); the two-click flow in Scripts.ts is removed
```

**Rendering details**
- In the planner, overlays render with `depthTest: false` and a high `renderOrder`, so buildings never hide them.
- In 3D they are depth-tested and given a polygon offset.
- Planner handles are screen-sized: their scale is recomputed from the ortho zoom.

---

## 12. Implementation plan

1. **Model and view.** `DropzonePlan` with persistence and undo; the `PlannerView` camera, enter/exit, zoom/pan and HUD; the Dropzone tab shell; Top view now opens the planner.
2. **Jumprun.** `JumprunTool` (handles, heading input, offset, reverse, runway snap); exit markers from the plane track; Into upper winds mode; `applyJumprun`; Align Jumprun now opens the planner; per-DZ saving.
3. **Zones.** LZ and danger-zone tools (polygon, rectangle, line); editing handles; overlays in both views; properties; warnings list.
4. **Hazards in the sim.** `Hazards.ts`; violation events; landing outcomes; status, timeline and track tinting.
5. **Canopy pattern.** Pattern tool; Flip (mirror) and Fixed modes; "as flown today" ghost; `CanopyGuidance` (reachability, holding, legs, final); alternate LZs; per-jumper aim points.
6. **Avoidance and validation.** Lookahead avoidance; checks of each leg against zones in the planner, assuming a straight-line altitude drop along each leg; the jumprun spot-check warning.
7. **Freefall patterns.** Tracking and wingsuit tools; anchors; leg properties; `FreefallGuidance` with glide modulation; Pattern column.
8. **Tracking body position.** Position spec; Plane Settings and formation exclusion; exit-order warning.
9. **Slots.** Round slot numbering, swaps, slot radius and breakoff slots; lanes for solo pattern flyers; wingsuit flocks (layouts, docking, flock breakoff and fan-out); the Slot column and ⚙ popover; `Separation.ts` warnings.
10. **Tests.** Node physics tests (§13) and headless screenshots of the planner and the 3D overlays.

---

## 13. Acceptance criteria

- **A1. View and zoom.** The planner opens north-up over the primary LZ and zooms from 100 m to 16 km across without the map leaving the coverage area. Exiting restores the previous camera exactly.
- **A1b. Jumprun.** In the planner the jumprun can be rotated by dragging, typed to an exact heading, moved, offset and reversed. Exit markers and jumprun-relative patterns follow live. On release the sim recalculates, and the plane flies the new heading from the new start point. With Shift, the heading snaps to 5°; near a runway zone's axis it snaps to that axis. **Into upper winds** sets the heading within 1° of into the wind at exit altitude and follows weather changes. The jumprun is saved per DZ and survives a reload.
- **A2. Creating zones.** Each LZ and danger-zone shape can be created with clicks only, then edited (move a vertex, insert a vertex, move the whole zone, delete), undone and redone. Plans persist across reloads per DZ, and export/import round-trips byte-for-byte.
- **A3. Pattern flip.** In a 10 kt wind from the west (into-wind heading 270°):
  - a pattern drawn with final heading 090° is flown **mirrored**, with final 270°; the hand is swapped and every leg stays on the drawn side of the LZ;
  - a pattern drawn with final heading 300° is flown as drawn;
  - in calm air (< 3 kt) or in Fixed mode, the pattern is flown as drawn.
- **A4. Following the pattern.** In a calm-wind test (80 kg, 190 sq ft, opening 600 m from P0), the jumper:
  - reaches the downwind start (P0) by 1,000 ft;
  - turns to base at 500 ft ± 20 ft and to final at 250 ft ± 20 ft;
  - lands within 30 m of their aim point.

  With 12 kt of wind, they land inside the LZ polygon.
- **A5. Danger zones.** With a power-line zone (500 ft ceiling) across the straight-line path, a jumper above 500 ft may cross it; below 500 ft their track never enters it, provided a clear heading exists. A hazard landing is reported in status, the timeline and Scene Objects.
- **A6. Leg end rules.** A tracking pattern with legs ending at 9,000 / 6,000 / 3,500 ft starts each leg within 100 ft of those altitudes. With no wind, each to-point leg passes within 75 m of its waypoint when it is reachable.
- **A7. Tracking position.** A Tracking jumper starts gliding 3 s after exit, never joins a round or flock, and pulls at their pull altitude.
- **A8. Wingsuit pattern.** With crosswind, wingsuit legs stay within 100 m of the leg line; the crab correction is visible as heading ≠ track.
- **A10. Round slots.** A 4-way with a 2.0 m slot radius holds every member at 2.0 ± 0.05 m from the centre. Swapping two slots in Plane Settings swaps their ring positions and breakoff lanes. With Auto breakoff distance and no wind, every pair is at least 150 m apart at pull; otherwise a separation warning is shown.
- **A11. Wingsuit flock.** Three linked wingsuiters leave 1 s apart (base first) and, in Arrowhead at 15 m spacing, each reaches their slot within 20 s of their own exit. They then stay within 1 m of their slot offsets as the base flies the pattern's turns. At 5,500 ft they fan out, and they are at least 150 m apart at pull.
- **A12. Lanes.** Three solo wingsuiters on one pattern fly lanes 0, +1 and −1, about 150 m apart (± 30 m in calm air), each passing its lane's waypoints at the leg altitudes.
- **A9. Performance.** Precalc time for the default load rises by no more than 20%, and planner interaction stays at 50 fps or more.

---

## 14. Open questions

1. **Per-jumper LZ assignment** (students, tandems, swoop pond). Should it be a Plane Settings column in this phase, or later?
2. **Freefall and danger zones.** Should deploying over a danger zone be a warning? Ceilings currently apply only under canopy.
3. **More than one canopy pattern** per DZ (for example a separate student pattern). It is out of scope here, but the model could hold an array later.
4. **Jumprun wind band.** "Into upper winds" uses the mean wind over the top 3,000 ft of the climb. Should it use only the wind at exit altitude, or the freefall band (exit to pull altitude)?
5. **Wingsuit pull altitude.** Should wingsuits default to a higher pull altitude than other jumpers (commonly 4,000 ft or more), set from the pattern's last leg?

---

## 15. As built: differences from the text above

- **Danger zone shapes** come from the zone type picked in the planner toolbar:
  - **Runway:** three clicks: both ends of the centreline, then a third click that sets the width;
  - **Power lines and Road:** a line with a width;
  - **Every other type:** a polygon.
- **Jumprun:**
  - There is no **Redraw** button and no e/n fields for the start point. The start point is moved by dragging. The heading is typed, rotated or snapped.
  - **Reset** returns to the dropzone's default jumprun.
  - The note under the card shows the plane's speed on jumprun, the exit spacing and the upper winds.
- **Layers:** the planner's last layer is **Simulated hazards**. It shows track segments over danger zones in red and each round's breakoff ring. The jumpers' own trajectory lines already show their ground tracks from above.
- **Minimum separation at pull** is set in the Plane Settings **⚙** popover, together with the round and flock settings, not in Jump Settings.
- **Heading legs on a jumprun-anchored pattern** are measured from the jumprun direction, so they turn with it. On a map-anchored pattern they are degrees true. Switching the anchor converts both points and headings, so nothing moves on the map.
- **Can't make the pattern:**
  - a jumper who can't reach the downwind start flies a **straight-in** to their aim point when that is still reachable;
  - only then do they try alternate LZs;
  - a land-out is the last option.

  When height runs short on downwind or base, the jumper turns final early.
- **Exit altitude:** the plane still starts at its fixed 13,000 ft. The Jump Height input isn't wired to it, as before this work.
- **Touchdown is picked by hand.** The canopy pattern tool takes **4 clicks**:
  - downwind start;
  - turn to base;
  - turn to final;
  - **touchdown**.

  Effects:
  - Landing zones no longer have a target, a "primary" flag or a spread.
  - The LZ that contains the touchdown is shown as **Main**.
  - The spread (default 30 m) belongs to the pattern, and each jumper's touchdown is spread around the picked point.
  - Nobody aims for the middle of an LZ:
    - an alternate LZ is approached at its nearest part, 20 m in from the edge;
    - with no pattern drawn, jumpers keep the old straight-in to the DZ, and the Dropzone tab asks for a pattern.
  - Plans saved earlier are converted on load: the old LZ target becomes the touchdown.
- **Render-loop safety:** a frame or map-tile error is logged and the app keeps running, instead of freezing the view. Before, a 3d-tiles-renderer imagery race when switching map style stopped the render loop, so the view stayed frozen in top-down after leaving the planner. That race is now guarded in `terrain/imagery.ts`.
