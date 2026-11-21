# Spec: Dropzone Planner (Landing Zones, Danger Zones, Canopy Pattern, Freefall Patterns, Tracking Jumps)

**Status:** Draft for implementation
**Scope:** new `src/js/dropzone/*`, new `src/js/physics/{CanopyGuidance,FreefallGuidance,Hazards}.ts`, new `src/js/visuals/{ZoneOverlays,PatternOverlays}.ts`, new `src/js/panels/DropzonePanel.ts`; changes to `src/js/classes/SimEntities.ts`, `src/js/utils/AlignJumprun.ts`, `src/js/LocationSelect.ts`, `src/js/physics/BodyPositions.ts`, `src/js/physics/FormationFlight.ts`, `src/js/ui/PlaneLoad.ts`, `src/js/panels/jumperStatus.ts`, `src/js/editor/Timeline.ts`, `src/js/Scripts.ts`, `index.html`, `src/css/editor.css`
**Depends on:** `map-terrain-buildings.md` (8 km map coverage, `getGroundHeight`), `editor-layout.md` (dock tabs, `window.dock`), canopy phases (`physics/Canopy.ts`)

---

## 1. Summary

Add a **top-down Dropzone Planner** over the DZ map. In it the user can point and click to create:

0. **The jumprun:** set and edit its position and direction by dragging, typing a heading, or snapping it into the upper winds or parallel to a runway. Each jumper's exit point is marked along it.
1. **Landing zones (LZs):** areas where jumpers should land. One is the primary LZ, which holds the landing target.
2. **Danger zones:** runways, power lines, washes, roads, water and so on. Each has a **ceiling** (default **500 ft AGL**): jumpers under canopy must not be over the zone when they are lower than its ceiling.
3. **The canopy landing pattern:** three legs that every jumper tries to fly, starting at **1,000 ft**, **500 ft** and **250 ft**. The user draws the pattern once. At sim time it is turned so the **final leg always points into the wind**.
4. **Freefall patterns:** zoom out and draw a **tracking pattern** and a **wingsuit pattern**. Each is a chain of legs, and each leg has its own end rule (altitude, arrival or time). Trackers and wingsuiters follow them in freefall as well as they can.

It also adds a **Tracking body position**: the jumper tracks from exit to pull, following the tracking pattern.

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
| Body positions | `belly`, `sitfly`, `headdown`, `wingsuit` (`BodyPositions.ts`). `TRACK_SPEC` has area 0.71 m² and glide 1.0, but it is only used for the breakoff track. |
| Persistence | Dock layout uses `localStorage`. Dropzones come from `public/json/dropzones.json`, and some have a `defaultJumprun`. There is no per-DZ planning data. |

---

## 3. Goals / non-goals

**Goals**
- G0. Set and edit the jumprun direction and position in the planner: drag, type a heading, auto into the upper winds, or snap to a runway. Show each jumper's exit point live.
- G1. A top-down planner that zooms from about 100 m across (the landing area) to about 16 km across (wingsuit patterns), within the 8 km map coverage.
- G2. Point-and-click creation and editing of landing zones and danger zones, with polygon, rectangle and line shapes.
- G3. A danger-zone ceiling per zone (default 500 ft AGL). It is enforced in canopy navigation and reported when broken.
- G4. A three-leg canopy pattern (1,000 / 500 / 250 ft, editable), turned into the wind at sim time.
- G5. Tracking and wingsuit freefall patterns made of legs, which jumpers follow with wind-corrected steering.
- G6. A **Tracking** body position that tracks the whole jump.
- G7. Plans are saved per dropzone. They can be exported and imported as JSON, and edits recalculate the sim automatically.

**Non-goals (this spec)**
- Canopy-to-canopy traffic separation and collision avoidance.
- Altitude lost in canopy turns, spirals and swoops. Turns stay rate-limited and level, as today.
- Per-jumper landing priority (students first, tandems in a separate area). See §12.
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
| Canopy pattern | C | Click 3 points: leg 1 start (1,000 ft), turn 1 (500 ft), turn 2 (250 ft). Final runs to the primary LZ target. If a pattern exists, the tool edits it. |
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

**Rule:** a jumper **under canopy** is in violation while their ground position is inside the zone footprint **and** their height above the terrain there is below the ceiling. A landing inside any danger zone is always a violation, whatever its ceiling. Freefall ignores ceilings (§12, Q5).

### 5.3 Canopy landing pattern
- **Legs:** three legs, each defined by the point and altitude where it starts:

  | Leg | Starts at | Default start altitude |
  |---|---|---|
  | Leg 1 ("Base leg") | P0 | 1,000 ft |
  | Leg 2 ("Middle leg") | P1 | 500 ft |
  | Leg 3 ("Final") | P2 | 250 ft |

  Final ends at the primary LZ target T. Altitudes are editable and must stay in decreasing order.
- Hand (left/right) is worked out from the drawn turns and shown read-only.
- **Orientation mode:**
  - **Rotate into wind** (default): rotate the whole pattern about T so the final heading points exactly into the landing wind. The drawn hand is kept.
  - **Flip:** DZ-style. Use the drawn pattern, or its mirror across the crosswind line through T (left-hand ↔ right-hand), whichever puts final more into the wind. The pattern stays on the side of the LZ it was drawn on, which helps when the hazards are all on one side.
  - **Fixed:** always as drawn.
- **Calm threshold:** default 3 kt. Below it the pattern is used as drawn.
- **Landing wind:** the mean wind vector from 0–250 ft (the final leg's altitude band), sampled from the wind profile. If there is no weather, the pattern is used as drawn and a warning is shown.
- **Planner display:**
  - the drawn pattern in solid lines, with arrows and altitude tags at P0, P1 and P2;
  - an "as flown today" ghost after orientation, dashed, labelled "Final 275° · into 8 kt".
- **3D view:** the oriented pattern as a descending 3D path (P0 at 1,000 ft down to T on the ground).

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
- **Defaults when created:**
  - Altitude-ended legs.
  - Leg end altitudes spread evenly between the exit altitude and pull altitude.
  - Tracking: legs from exit to 3,500 ft.
  - Wingsuit: legs from exit to 4,000 ft. The wingsuit pull altitude default is unchanged; see §12, Q7.
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

interface CanopyPattern { points: [EN, EN, EN];          // P0, P1, P2 (target comes from the primary LZ)
  legAltitudesFt: [number, number, number];          // 1000, 500, 250
  orientation: "rotate" | "flip" | "fixed"; calmThresholdKt: number; }

interface FreefallLeg { point: EN; steer: "point" | "heading"; headingDeg?: number;
  end: { by: "altitude"; ft: number } | { by: "arrival" } | { by: "time"; s: number }; }
interface FreefallPattern { id: string; name: string; kind: "tracking" | "wingsuit";
  isDefault: boolean; anchor: "jumprun" | "map"; legs: FreefallLeg[]; deployRadiusM: number; }

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

**Oriented pattern.** After orientation (§5.3) the points are P0, P1, P2, T with altitudes A0 = 1,000, A1 = 500, A2 = 250 and 0 ft. Each jumper's T is their spread aim point inside the LZ.

**Reachability, checked once at full open:**
1. Can the jumper reach P0 by A0? The test is: (distance to P0 ÷ ground speed towards P0) × descent rate ≤ (h − A0).
2. If not, try the other LZs, nearest first, as a straight-in final into the wind. The test is the same, using each LZ target at 0 ft and a 50 ft margin.
3. If none is reachable, the jumper is **landing out**: aim for the original target, avoid hazards, and land wherever they get to.

Status: "Going for *Student LZ*" or "Landing out".

**Phases:**

| Phase | Condition | Steering |
|---|---|---|
| **Holding** | h > A0 + 100 ft | Fly to a holding point H = P0 moved 100 m upwind. Within 150 m of H, S-turn across the wind (alternate ±70° off into-wind every 8 s) to burn height with little drift. |
| **Leg k** (k = 1, 2) | A_{k-1} ≥ h > A_k | Track the leg line from P_{k-1} to P_k. Aim at a point 60 m ahead of the jumper's projection onto the line, with crab correction (the existing `crossWind` maths). |
| **Final** | h ≤ A2 | Aim at T with crab correction. Flare as now. |

**Turns:**
- Jumpers turn **by altitude** (the primary rule): leg k+1 starts when h ≤ A_k, wherever they are. Being high stretches a leg past its turn point.
- **Cut the corner when low:** if the predicted height on reaching P_k is more than 75 ft below A_k, aim straight at P_{k+1} instead. Predicted height = h − (distance along the leg ÷ ground speed along the leg) × descent rate.
- **Passing a turn point while still high:** the jumper holds the leg's heading until the altitude gate. They do not turn back.

**Hazard avoidance** applies in every phase, whenever any zone's ceiling is above the jumper:
1. Project the jumper's ground path 8 s ahead along the candidate heading, using wind and descent.
2. If any point of that path breaks a zone, try headings at ±15°, ±30° … ±90° from the desired heading, nearest first.
3. Take the first one that is clear. If none is clear, keep the desired heading.

Avoidance overrides the pattern but not the flare.

**Status labels:**
- "Holding", "Base leg", "Middle leg", "Final", "Going for *LZ*", "Landing out";
- after landing: "Landed · *Main LZ*", "Landed out" or "⚠ Landed in *Runway*".

### 7.3 Freefall guidance (`physics/FreefallGuidance.ts`)
Freefall guidance applies to jumpers in a **gliding** state:
- **Tracking** body position: from exit (after the stabilisation in §8);
- **Wingsuit**: from exit;
- **breakoff tracking** (Track toggle on other positions): unchanged; still radial or perpendicular, with no pattern.

Jumpers fly the pattern assigned to them (§9). With none assigned, they fly today's fixed `trackingDir`.

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
  - work out the landing wind and the oriented canopy pattern **once per recalculation** (the oriented pattern is shared by all jumpers);
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
- **Formations:** `formationPlanFor` already leaves out wingsuits; it also leaves out Tracking jumpers. Linked tracking jumpers get the hint "Tracking jumpers don't build formations".
- **Exit order:** no automatic reordering. A warning appears in Plane Settings if a Tracking or Wingsuit jumper exits before belly or freefly groups. The usual exit order is wingsuits and trackers last.

---

## 9. UI changes outside the planner

- **Plane Settings:**
  - the Position select gets **Tracking**;
  - a new **Pattern** column appears for tracking and wingsuit jumpers: *Default (name)*, *None*, or a named pattern of the matching kind. Other jumpers show "–".

  The choice is saved on the jumper as `freefallPatternId?: string`.
- **Status:** `jumperStatus` gets the labels from §7.2–7.3.
- **Scene Objects details:**
  - "Pattern: *Tracking A* · Leg 2/3";
  - "Landing: *Main LZ*", "Out" or "⚠ *Runway*";
  - danger-zone violations, with times.
- **Timeline:**
  - red markers at the start of each hazard event;
  - a red landing marker for hazard landings.
- **Trajectory lines:** segments recorded during a hazard event are tinted red in both views.
- **3D view:**
  - LZs: translucent green fill draped on the terrain;
  - danger zones: red fill plus a translucent red wall up to the ceiling, so "don't be below this here" is visible;
  - patterns: as in §5.

  Toggle: Location tab → **Zones & patterns**.

---

## 10. Code structure

```
src/js/dropzone/
  DropzonePlan.ts      model, defaults, load/save/export/import, undo stack, onPlanChanged
  geometry.ts          EN↔world, point-in-polygon, polyline distance, clipping, centroid
  PlannerView.ts       ortho camera, enter/exit, zoom/pan, HUD, layer toggles
  PlannerTools.ts      select/LZ/danger/pattern tools, handles, snapping, keyboard
  patternMath.ts       orient canopy pattern to wind (rotate/flip), resolve freefall patterns
src/js/physics/
  Hazards.ts           resolved zones, hazardAt, path checks
  CanopyGuidance.ts    reachability, holding, legs, final, avoidance
  FreefallGuidance.ts  leg sequencing, crab steering, glide modulation
src/js/visuals/
  ZoneOverlays.ts      draped polygons (ShapeUtils triangulation, ≤25 m tessellation, y = ground + 1 m,
                       polygonOffset), ceiling walls, line-zone ribbons
  PatternOverlays.ts   2D/3D pattern paths, arrows, altitude tags (CSS2D labels), ghosts
src/js/panels/
  DropzonePanel.ts     Dropzone dock tab: list, properties, warnings, plan actions
src/js/dropzone/
  JumprunTool.ts       jumprun handles, rotate/move/offset, runway snap, exit markers, into-wind mode
src/js/utils/AlignJumprun.ts
                       gains applyJumprun(jumprun, plane); the two-click flow in Scripts.ts is removed
```

**Rendering details**
- In the planner, overlays render with `depthTest: false` and a high `renderOrder`, so buildings never hide them.
- In 3D they are depth-tested and given a polygon offset.
- Planner handles are screen-sized: their scale is recomputed from the ortho zoom.

---

## 11. Implementation plan

1. **Model and view.** `DropzonePlan` with persistence and undo; the `PlannerView` camera, enter/exit, zoom/pan and HUD; the Dropzone tab shell; Top view now opens the planner.
2. **Jumprun.** `JumprunTool` (handles, heading input, offset, reverse, runway snap); exit markers from the plane track; Into upper winds mode; `applyJumprun`; Align Jumprun now opens the planner; per-DZ saving.
3. **Zones.** LZ and danger-zone tools (polygon, rectangle, line); editing handles; overlays in both views; properties; warnings list.
4. **Hazards in the sim.** `Hazards.ts`; violation events; landing outcomes; status, timeline and track tinting.
5. **Canopy pattern.** Pattern tool; orientation modes; "as flown today" ghost; `CanopyGuidance` (reachability, holding, legs, final); alternate LZs; per-jumper aim points.
6. **Avoidance and validation.** Lookahead avoidance; checks of each leg against zones in the planner, assuming a straight-line altitude drop along each leg; the jumprun spot-check warning.
7. **Freefall patterns.** Tracking and wingsuit tools; anchors; leg properties; `FreefallGuidance` with glide modulation; Pattern column.
8. **Tracking body position.** Position spec; Plane Settings and formation exclusion; exit-order warning.
9. **Tests.** Node physics tests (§12) and headless screenshots of the planner and the 3D overlays.

---

## 12. Acceptance criteria

- **A1. View and zoom.** The planner opens north-up over the primary LZ and zooms from 100 m to 16 km across without the map leaving the coverage area. Exiting restores the previous camera exactly.
- **A1b. Jumprun.** In the planner the jumprun can be rotated by dragging, typed to an exact heading, moved, offset and reversed. Exit markers and jumprun-relative patterns follow live. On release the sim recalculates, and the plane flies the new heading from the new start point. With Shift, the heading snaps to 5°; near a runway zone's axis it snaps to that axis. **Into upper winds** sets the heading within 1° of into the wind at exit altitude and follows weather changes. The jumprun is saved per DZ and survives a reload.
- **A2. Creating zones.** Each LZ and danger-zone shape can be created with clicks only, then edited (move a vertex, insert a vertex, move the whole zone, delete), undone and redone. Plans persist across reloads per DZ, and export/import round-trips byte-for-byte.
- **A3. Pattern orientation.** In a 10 kt west wind:
  - Rotate mode: the canopy pattern's final heading is 270° ± 1°.
  - Flip mode: the pattern is the drawn one or its mirror, whichever has final within 90° of into-wind.
  - Calm (< 3 kt): the pattern is flown as drawn.
- **A4. Following the pattern.** In a calm-wind test (80 kg, 190 sq ft, opening 600 m from P0), the jumper:
  - reaches the P0 area by 1,000 ft;
  - turns at 500 ft ± 20 ft and 250 ft ± 20 ft;
  - lands within 30 m of their aim point.

  With 12 kt of wind, they land inside the LZ polygon.
- **A5. Danger zones.** With a power-line zone (500 ft ceiling) across the straight-line path, a jumper above 500 ft may cross it; below 500 ft their track never enters it, provided a clear heading exists. A hazard landing is reported in status, the timeline and Scene Objects.
- **A6. Leg end rules.** A tracking pattern with legs ending at 9,000 / 6,000 / 3,500 ft starts each leg within 100 ft of those altitudes. With no wind, each to-point leg passes within 75 m of its waypoint when it is reachable.
- **A7. Tracking position.** A Tracking jumper starts gliding 3 s after exit, never joins a formation, and pulls at their pull altitude.
- **A8. Wingsuit pattern.** With crosswind, wingsuit legs stay within 100 m of the leg line; the crab correction is visible as heading ≠ track.
- **A9. Performance.** Precalc time for the default load rises by no more than 20%, and planner interaction stays at 50 fps or more.

---

## 13. Open questions

1. **Leg names.** At most DZs the 1,000 / 500 / ~300 ft legs are called **downwind / base / final**. This spec uses the requested names ("base leg", "middle leg", "final"). Should the UI use the standard names instead, or show both ("Downwind (base leg)")? The final default stays 250 ft as requested; 300 ft is the more common default.
2. **Default orientation mode.** This spec defaults to **Rotate into wind**, so final is always exactly into the wind. Many DZs instead **flip** between two mirrored patterns to keep traffic on one side of the LZ. Which should be the default?
3. **Per-jumper LZ assignment** (students, tandems, swoop pond). Should it be a Plane Settings column in this phase, or later?
4. **Lane spacing.** Several trackers or wingsuiters on one pattern converge on the same waypoints. Should each jumper get a lateral lane offset (for example 50 m × exit order)?
5. **Freefall and danger zones.** Should deploying over a danger zone be a warning? Ceilings currently apply only under canopy.
6. **More than one canopy pattern** per DZ (for example a separate student pattern). It is out of scope here, but the model could hold an array later.
7. **Jumprun wind band.** "Into upper winds" uses the mean wind over the top 3,000 ft of the climb. Should it use only the wind at exit altitude, or the freefall band (exit to pull altitude)?
8. **Wingsuit pull altitude.** Should wingsuits default to a higher pull altitude than other jumpers (commonly 4,000 ft or more), set from the pattern's last leg?
