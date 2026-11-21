# Spec: Formation Jumps (Multi-Plane Loads, .jump Upload, Multi-Point Sequences, Slot-Seeking)

**Status:** Draft for review, rev 2 (spec only, nothing built yet)
**Scope:** new `src/js/fleet/*`, `src/js/formations/*`, `src/js/physics/{SlotSeeking,SequenceSolver}.ts`, `src/js/visuals/FallRateArrows.ts`, `src/js/core/data/{JumpSettings,JsimFile}.ts` and `src/js/ui/FileMenu.ts`. Changes to:
- `src/js/classes/BaseEntities.ts`, `src/js/classes/SimEntities.ts`, `src/js/physics/FormationFlight.ts`
- `src/js/PlaneSelect.ts` (aircraft catalogue and model loading)
- `src/js/ui/PlaneLoad.ts` and `src/css/planeloadui.css` (load menu)
- `src/js/Scripts.ts` (fleet, recalculation, startup load)
- `src/js/panels/{jumperStatus,SceneObjects,WeatherPanel}.ts`, `src/js/editor/Timeline.ts`
- `src/js/dropzone/{PlanContext,PlanOverlays,PlannerView}.ts`
- `index.html`, `src/js/DevConsole.ts`, `src/js/Menubar.ts`
- `src/js/LocationSelect.ts` and `src/js/weather/WeatherService.ts` (loading a `.jsim`)
- **Replaces:** `src/js/classes/Formations.ts` (the `Formation` class) and `src/js/exampleData/Formations.ts`

**Related:** `dropzone-planner.md` §5.0 (jumprun), `editor-layout.md` §8 (Scene Objects) and §6 (timeline), `world-scale.md` (physics in metres, drawn × 5.8), `weather-clouds-visibility.md` §6 (jump conditions use the exit altitude)

**Decisions from the brief**
- **Capacities:** Twin Otter **21** slots, Skyvan **22** slots, Cessna-172 **4** jumpers (rev 2). The DC-9 has no capacity yet (§18 Q1).
- **Upload:** a `.jump` upload works out how many planes the jump needs and splits the jumpers across them. A group that fits fills a single plane (§6).
- **Exit altitude** is a Jump Settings parameter. The tab already has an unwired "Jump Height" input; it becomes the real setting (§7).
- **Multi-point formations:** every slot moves to its position for each point. A user-set **time per point** paces the sequence until breakoff, and the score is the number of points completed within the working time (§8).
- **Slot-seeking AI:** jumpers who aren't in the exit piece fly to their slot: approach, fall-rate matching, docking and moving between points. It also covers what happens when a slot can't be reached (§9).
- **Load menu:** a small plane selector at the top picks which plane is being edited (§10).

**Rev 2 decisions**
- **Fall-rate arrow:** every formation jumper gets an up or down arrow showing how much they're changing their fall rate to stay with the group or get down to it (§9.8).
- **Cessna-172 holds 4 jumpers** (§5.1).
- **Plane position index:** in a `.jump` file, `planeSlot.index` 0 may be the pilot's end of the cabin or the first jumper out. The import handles both (§4.3).
- **Floaters** hang on the outside of the plane, so the initial exit holds the floaters **plus** the people in the door (§5.4, §6.3). Floaters leave from their spots outside the fuselage, not from the door.
- **Save and load:** the whole JumperSim environment saves to and loads from a **`.jsim`** file, through the File menu's existing Save, Load from File and Auto-Save items (§12).

---

## 1. Summary

Today the sim flies **one plane** with a hand-made load. Formations from `.jump` files are only half wired: the import makes jumpers that never join the load, only the first point is read, and its scale is about 6.5× too big. This spec turns JumperSim into a tool for planning **big-ways and sequential formation skydives**:

1. **Fleet.** One or more aircraft fly jumprun in formation: a **lead** plane on the jumprun and **trail** planes offset behind, to the side and stacked higher. Each plane has its own load, door, exit order and exit timing. Every plane exits on the lead's "go".
2. **Upload and split.** Uploading a `.jump` file reads every point, slot, name and colour. It honours the planes in the file when they make sense. Otherwise it picks the number of planes from the aircraft's capacity. It then assigns jumpers to planes by where their slot is (base in the lead, a sector of the formation per trail plane) and sets the exit order.
3. **Exit altitude.** A real Jump Settings value drives the plane tracks, exits, formation timing, jumprun winds, the planner and the weather jump conditions.
4. **Sequences.** A formation has several **points**. The formation flies them in order, each held for the **time per point**, and repeats until the working time or breakoff. Points that every slot reaches in time are **scored**.
5. **Slot-seeking.** After exit, each diver dives down and across to a set-up point outside their slot. They match fall rate, wait for the people they grip, dock, and then follow the transitions. A jumper who can't make it follows the standard safety rules (stay out, never come up under the formation, break off on time) and is reported. An arrow on each formation jumper shows how much they're speeding up or slowing their fall to do this.
6. **Load menu.** A strip of plane chips at the top of Plane Settings ("1 · Twin Otter · 16/21"). The table below edits the selected plane. There's also an **All** view and a formation bar for the sequence settings and the score.
7. **`.jsim` files.** File → Save writes the whole environment (dropzone, plan, jump settings, planes, jumpers, formations, weather, view) to a `.jsim` file. File → Load from File, or dropping the file on the window, brings it back exactly.

### 1.1 Terms

| Term | Meaning here |
|---|---|
| **Point** | One formation in the sequence (one entry of `.jump` `points[]`). |
| **Slot** | One jumper's place in a point. `.jump` `jumpers[i]` flies `slots[i]` in every point. |
| **Initial exit** | Everyone who leaves a plane on "go" at the same instant: its floaters plus the jumpers in the door. |
| **Exit piece** | The lead plane's initial exit, leaving already gripped (the base). They don't need the AI to build point 1. |
| **Floater** | A jumper who climbs out and hangs on the outside of the plane (bar, strut or step) before "go". Floaters let more people leave on the initial exit than fit in the door. |
| **Diver** | Anyone not in the exit piece. They fly to their slot with the AI. |
| **Keyed** | Every slot of the point is docked (and held for `minHoldS`). The point counts at that moment. |
| **Working time** | The scoring window, from the first formation exit. |
| **Lead / trail** | The plane on the jumprun, and the planes flying in formation with it. |

---

## 2. Current state

| Area | What the code does today |
|---|---|
| Planes | One `SimPlane` at `(0, 3962, 0)` (13,000 ft), 90 kt (`Scripts.ts:497-502`). The Aircraft picker (`#plane-select`) swaps **that plane's** model and door (`PlaneSelect.ts:53-132`). `PlaneSelect.ts` keeps one module-level `planeMesh`. |
| Aircraft data | `planeConfigs` (`PlaneSelect.ts:18-51`): model file, units-to-metres, door offset, colour, name. **No capacity.** |
| Jumpers | `SimJumper` holds `plane`, `index` (load order), `jumpTime`, `linked`, `formationSlot`, `isInFormation`, `formationOffset`, `origin`. `window.simJumpers` is the load. |
| Exit timing | `PlaneLoad.normalizeJumpTimes()` (`PlaneLoad.ts:127-172`) spaces groups `jumpIntervalSeconds` (10 s) apart. **All** linked jumpers make one group, whichever formation they belong to. Linked wingsuiters leave 1 s apart. |
| Load order | `groupAndReindexJumpers()` (`Scripts.ts:235-324`) puts formation jumpers first, then the DZ boarding order. |
| `.jump` at startup | Loads `jff2.jump` into a `Formation`, but `createJumpersForPlane` is commented out (`Scripts.ts:516-519`). So the formation has no jumpers and the load is 10 default jumpers. |
| Formations menu | **Formations → Import Formation → From .jump** calls `handleFileSelect()` (`Menubar.ts:11-19`), which only logs the chosen file. **Save Formation** does nothing. |
| Import .jump | `PlaneLoad.openFormationImport()` (`PlaneLoad.ts:944-972`) makes jumpers with `createJumpersForPlane` and adds the formation. But `refreshJumpers()` reads `window.simJumpers` (`PlaneLoad.ts:111-118`), so **the new jumpers never join the load**: no rows, no meshes, no physics. Only the Formation dropdown changes. |
| `Formation` class | Uses `points[0]` only. `transitionToPoint()` and `update()` exist but nothing calls them. Offsets are `(origin − centroid) × SCALE_FACTOR (0.065)` (`Formations.ts:61, 119-159`). The slot's `angleDeg` becomes a quaternion about +Y (`Formations.ts:108`), and then `precalculate()` overwrites it with the jumprun heading (`SimEntities.ts:445`). The slot picker calls `assignExistingJumperToSlot`, which doesn't exist (`PlaneLoad.ts:731`). |
| Formation flight | `FormationFlight.ts`: linked belly / sit / head-down jumpers with the same `jumpTime` (±0.05 s) and group key share one **centre path** (average mass and drag), and ease from their exit offset into a slot over `FORMATION_DOCK_S` = 8 s. Shapes are `round` or `none` (`FormationShapes.ts`). The file's own comment suggests a "use the .jump file's slots" shape. Breakoff is at `roundSettings.breakoffFt` (4,500 ft), then a radial track to `breakoffDistance()` and a hold. |
| Exit altitude | **Hard-coded** as `simPlane.initialPosition.y`. The Jump Settings "Jump Height" input has `id="pullAltitude"`, value 12,500 (`index.html:365-375`). `DevConsole.ts:18` copies it into `devConsoleVars.pullAltitude`, which nothing reads. `dropzone-planner.md` §5.0 assumes "the exit altitude stays the Jump Height setting". The Plane Speed input (`planeSpeed`) isn't wired after startup either. |
| Who reads the exit altitude | `Jumprun.ts` (into-upper-winds mean), `PlanOverlays.ts:305` (3D jumprun and exit markers), `PlannerView.ts:818` (HUD), `DropzonePanel.ts:161, 468`, `WeatherPanel.ts:342` (jump conditions, via `window.simPlane`). |
| Single-plane assumptions | Scene Objects, Markers, CameraZoop, SeparationGame, the planner, PlanContext and `hasJumperExited(j, plane)` all take one `plane()` getter. `allJumpers(plane)` already returns every jumper. `computeSeparation()` already checks every jumper against every other. |
| Persistence | The load (plane, jumpers, formations) is **not saved**. Every reload starts from the defaults. The dropzone plan is in `localStorage`. |
| Tests | Vitest in `tests/` (`npm test`). |

### 2.1 Problems this spec fixes on the way

- **P1. Import is a no-op.** Imported jumpers aren't in `window.simJumpers` (§2, Import .jump).
- **P2. Scale.** `SCALE_FACTOR = 0.065` was tuned when jumpers were drawn 5.8× life size, before `world-scale.md`: 0.065 / 5.8 ≈ 0.011 m. In today's metre physics it makes neighbours 8–9.5 m apart and the 32-way about 83 m across. §4.4 shows the real unit is about 1 cm.
- **P3. Orientation.** Offsets go straight onto world X/Z (page-up = north), ignoring the jumprun. The slot heading is applied counter-clockwise, although `angleDeg` is clockwise (§4.4), and it's overwritten anyway.
- **P4. One exit group.** All linked jumpers exit as one group, even from different formations.
- **P5. Exit altitude and plane speed inputs do nothing.**
- **P6. Colours.** The STL load gives every jumper a random colour (`Scripts.ts:838-847`), so the `.jump` colours are lost.
- **P7. Formations menu.** Its *From .jump* item only logs the file (§2). It will run the same import as the Plane Settings button (§10.4).

---

## 3. Goals / non-goals

**Goals**
- G1. Fly **1 to 10 aircraft** in formation on one jumprun. Each has its own type, capacity, load, door, exit order and exit timing.
- G2. **Upload** a `.jump` file. Planes, split, exit order, names and colours are worked out automatically, with a one-click **Undo**. Groups that fit go in one plane.
- G3. **Exit altitude** in Jump Settings drives everything that uses the exit height. It's saved per browser.
- G4. Fly **every point** of a formation with correct size, orientation and headings. Hold each point for the user's **time per point**, repeat until working time or breakoff, and **score** completed points.
- G5. **Slot-seeking AI** for divers, within the physics limits of each jumper's weight and body position. Unreachable slots are handled safely and explained.
- G6. **Load menu** with a plane selector strip, a per-plane editor, an All view and a formation bar.
- G7. **Deterministic:** the same inputs give the same tracks, so scrubbing and recalculation stay exact.
- G8. A 100-way across 5 planes recalculates in under 1 s on the reference laptop.
- G9. A **fall-rate arrow** on each formation jumper shows how much they're compensating (§9.8).
- G10. **Save and load** the whole environment as a `.jsim` file. Loading it elsewhere gives the same jump, and with the saved weather the same tracks and score (§12).

**Non-goals (v1)**
- Planes doing anything but fly straight down jumprun. No climb, no descent after exits, no wake or turbulence.
- Collision avoidance between jumpers beyond the approach routing (§9.4).
- Freefly or vertical formations (head-down big-ways). Imported stances are flown belly-to-earth (§4.3).
- Merging two `.jsim` files, or saving per-browser preferences (dock layout, view toggles) in them.
- Formation canopy work (CRW), and wingsuit or tracking jumpers inside a `.jump` formation.

---

## 4. The `.jump` file (as found)

The files are JSON exported by Skydive Designer (the comment in `Formations.ts:39` says so). Four examples are in `public/formations/`.

### 4.1 Top level

| Key | Type | In | Use |
|---|---|---|---|
| `docVersion` | number (2) | all | Reject anything other than 2 with a clear message. |
| `title` | string | 3way6a only | Formation title. Fallback: `exportInfo.title`, then the file name without extension. |
| `whiteBackpacks` | bool | all | Ignored. |
| `tunnelFt` | number (0) | 3way6a only | > 0 probably means a wind-tunnel dive. Warn and fly it as a skydive (§18 Q12). |
| `people` | `{ name }[]` | all (often empty) | A roster. **Not** tied to slots, so ignored. Names come from `jumpers[].person`. |
| `jumpers` | array | all | One per slot (§4.3). |
| `points` | array | all | The sequence (§4.2). |
| `planes` | array | all (3way6a: empty) | The organizer's aircraft (§4.3). |
| `exportInfo` | object | 3way6a only | `pages[].title` gives point labels ("1", "2", …), matched by `pages[].point`. |

### 4.2 Points and slots

```json
{ "inter": false,
  "slots": [ { "stance": "bellyNarrowArms", "info": null, "angleDeg": 123.16, "origin": [-80.40, -49.42] }, … ] }
```

- `slots[i]` belongs to `jumpers[i]` **in every point**. Evidence: from one point to the next, the same index moves 4–191 units on average, while random pairs are 101–502 units apart.
- `origin` is `[x, y]` in **page units, y pointing down** (§4.4).
- `angleDeg` is the jumper's heading (the way the head points), **clockwise from page-up**, 0–360.
- `stance` values found: `belly`, `bellyNarrowArms`, `bellyWideArms`. All map to body position `belly`. The arm variants are cosmetic. Any other stance maps to `belly` with an import warning that lists the names (§18 Q6).
- `info` is null or missing. Ignored.
- `inter` is false in all four files. It probably marks an intermediate (the middle of an FS block): flown, but not scored (§8.5, §18 Q5).

### 4.3 Jumpers and planes

```json
"jumpers": [ { "person": { "name": "…" }, "color": "#0061FD",
               "planeSlot": { "planeId": "589CA651-…", "index": 2 } }, … ]
"planes":  [ { "id": "589CA651-…", "name": "Caravan", "slotCount": 8, "floaters": 4, "autoColour": "#E6194B" } ]
```

- `person.name` → jumper name. `person` can be null or missing; the name is then "Jumper N".
- `color` → mesh colour. Very dark colours (luminance < 0.15, e.g. jff2's `#000000`) are lifted to 35% luminance so they show on the dark scene. The original is kept for display.
- `selected` is ignored.
- `planeSlot` is `null` (3way6a), missing (night 32-way), or `{ planeId, index }`.
- **What `index` counts from.** Index 0 could be the pilot's end of the cabin or the first jumper out.
  - **Evidence:** in both files that assign seats, the indices run 0 … N−1 with no gaps, and every index, 0 included, belongs to a jumper (BW: 0–7 for 8 jumpers; jff2: 0–13 for 14). So index 0 isn't the pilot's own seat in these files.
  - **Still open:** whether index 0 is the first jumper out, or the seat nearest the pilot. In a Twin Otter or Caravan the seat nearest the pilot is at the front of the cabin, which is the **last** out (§18 Q4).
  - **Import setting** ("Plane order in file", in the formation ⚙, §10.4): **First out** (default; index 0 leaves first) or **From the pilot** (index 0 sits nearest the pilot; the order is reversed so the highest index leaves first).
  - **Pilot seat check:** if a file plane's indices start at 1 (no index 0), index 0 is taken to be the pilot's seat and the indices are shifted down by one. The import notification says so.
- **Floaters** are the jumpers who hang on the outside of the plane (§1.1). After the order is resolved, the first `floaters` jumpers out of that plane are its floaters.
- `planes[].slotCount` is the seats the organizer gave that plane. It's at least the jumpers assigned (jff2: 17 seats, 14 jumpers). `name` is free text ("Caravan", "Otter base", "Caravan trail").

### 4.4 Units and axes (measured)

| File | Jumpers | Points | Median nearest neighbour (units) | Span of point 1 (units) | File planes |
|---|---|---|---|---|---|
| `3way6a.jump` | 3 | 7 | 122–149 | 156 | none |
| `BWkemp3_jump6.jump` | 8 | 3 | 131–134 | 423 | Caravan · 8 seats · 4 floaters · all assigned |
| `jff2.jump` | 14 | 6 | 121–145 | 602 | Caravan · 17 seats · 5 floaters · all assigned |
| `night_jump_32way.jump` | 32 | 3 | 134–145 | 1,283 | Otter base 18 / 5 floaters + Caravan trail 14 / 4 floaters · **none assigned** |

- **Units: 1 unit ≈ 1 cm** (`JUMP_UNITS_TO_M = 0.01`). Gripped belly neighbours are 1.2–1.5 m centre to centre, and a 32-way is 12–13 m across, both realistic. `ROUND_SPACING_M` (2.0 m) is the same order. §18 Q3 asks to confirm.
- **Axes:** x to the right, **y down the page**. `angleDeg` is clockwise from page-up. Check: in point 1 of `3way6a` (a star), each slot's `angleDeg` is within 3° of its bearing to the centroid with these axes (123° vs 122°, 1° vs 1°, 238° vs 239°). Point 1 of the BW 8-way and of the 32-way (both rounds) has 100% of slots facing within 45° of the centre.
- **Into the sim:** page-up is **forward along jumprun**, turned by the formation's `orientationDeg` (default 0, §8.1). For a slot at page `(x, y)`:
  - `f` = jumprun forward rotated by `orientationDeg`; `right = (−f.z, 0, f.x)` (the convention `SimEntities.ts` uses);
  - offset (m) = `right × (x − cx) × 0.01 + f × (−(y − cy) × 0.01)`, where `(cx, cy)` is that point's centroid;
  - heading = jumprun heading + `orientationDeg` + `angleDeg` (clockwise, the app's heading convention `atan2(x, −z)`).

### 4.5 Parsing and validation (`formations/JumpFile.ts`)

`parseJumpFile(text, fileName) → ParsedJump` is pure and unit-tested against the four files.

| Check | Result |
|---|---|
| Not JSON, `docVersion` ≠ 2, no `points`, or a point with no `slots` | **Error**, nothing changes: "Not a Skydive Designer .jump file (docVersion 3)". |
| Points with different slot counts | **Error:** "Point 3 has 13 slots, expected 14". |
| `jumpers.length` < slots | Make the missing jumpers ("Jumper 12", default colour) and warn. |
| `jumpers.length` > slots | Ignore the extras and warn. |
| `planeSlot.planeId` not in `planes` | That jumper is unassigned. |
| Two jumpers with the same `planeSlot.index` in a plane | Order by index, then by file order, and warn. |
| 1 slot | Import as one solo jumper, no formation. |
| Unknown stance, `tunnelFt` > 0, `inter` points | Warnings (shown in the import notification's details). |

`ParsedJump` holds metres in the page frame (x right, y up the page), not raw units, so nothing else needs to know the file's conventions.

---

## 5. Aircraft and the fleet

### 5.1 Aircraft catalogue (`fleet/Aircraft.ts`)

`planeConfigs` moves out of `PlaneSelect.ts` and gains these fields:

| Aircraft | Capacity (jumpers) | Door interval | Floaters (max) | In the door | Initial exit (max) | Size (m, span × length) | Name matches |
|---|---|---|---|---|---|---|---|
| Twin Otter | **21** (given) | 0.25 s | 5 (bar outside the door) | 4 | 9 | 19.8 × 15.8 | "otter", "dhc-6" |
| Skyvan | **22** (given) | 0.20 s (ramp) | 0 (ramp, nothing outside) | 6 | 6 | 19.8 × 12.2 | "skyvan", "sky van" |
| Cessna-172 | **4** (given, rev 2) | 1.0 s | 3 (strut and step) | 2 | 4 (whole load) | 11.0 × 8.3 | "cessna", "172", "182" |
| DC-9 | **unknown** (Q1) | 0.25 s | 0 | 2 | 2 | 28.5 × 31.8 | "dc-9", "dc9" |

- **Floaters** hang on the outside of the fuselage before "go", so a plane can launch more people at once than its door holds. Its **initial exit** is the floaters plus the jumpers in the door (§5.4). It's capped at `maxFloaters + inDoor` and at the plane's load, so a Cessna's whole load of 4 can leave as one piece.
- **How many float:** the file's `floaters` when it gives one (capped at the maximum). Otherwise only the people who don't fit in the door: `max(0, initialExit − inDoor)`. A 3-way from a Twin Otter all go in the door; a 3-way from a Cessna has 1 floater and 2 in the door.
- Each aircraft has **floater spots**: positions outside the fuselage in the aircraft frame, like `door`. For example, the Twin Otter's are along the outside bar, forward of the door, 0.6 m apart and 0.5 m outboard; the Cessna's are on the strut and the step. Floaters leave from these spots, not from the door.
- A file asking for more floaters than the aircraft's maximum (e.g. 4 floaters on a Skyvan) gets the maximum. The rest count as in-door jumpers, and there's a warning.
- Door intervals, floater spots and in-door counts are first guesses, like the drag areas in `BodyPositions.ts`. A Twin Otter train of 16 takes about 4 s.
- `capacity: null` (DC-9 for now) means unknown: no seat limit is enforced, the seat count shows "16/—", and auto-split never picks that aircraft. A user can still choose it by hand.
- **Name matching** maps a `.jump` plane name to an aircraft, case-insensitively. No match (e.g. "Caravan", which has no model) uses the **preferred aircraft** (§6.1) and keeps the file's name as the plane's label.

### 5.2 Fleet model

```ts
// src/js/fleet/Fleet.ts
export type FleetLayoutId = "v" | "echelon-right" | "echelon-left" | "trail";
export interface PlaneOffset { backM: number; rightM: number; upM: number }   // in the lead's frame

export class Fleet {
  planes: SimPlane[];                 // planes[0] is the lead
  layout: FleetLayoutId = "v";
  formations: FormationSequence[];    // load-wide (moved from SimPlane.formations)
  get lead(): SimPlane;
  addPlane(aircraft: AircraftId, label?: string): SimPlane;
  removePlane(id: string, moveJumpersTo?: string): void;
  setLead(id: string): void;
  setAircraft(id: string, aircraft: AircraftId): void;   // swaps that plane's model only
  applyLayout(): void;                // offsets from the layout and the spacing (§5.3)
  syncFromLead(): void;               // trail position, heading and speed from the lead + offset
  jumpersOf(plane: SimPlane): SimJumper[];               // ordered by exitOrder
  moveJumper(j: SimJumper, to: SimPlane, exitOrder?: number): void;
}
```

`SimPlane` gains:
- `aircraftId`;
- `label` ("Plane 2", or the `.jump` plane name);
- `offset: PlaneOffset` (lead = 0);
- `floaters`;
- `goOffsetS` (exit signal delay relative to the lead, default 0);
- a `capacity` getter.

`SimJumper` gains:
- `exitOrder` (0-based within its plane);
- `isFloater`;
- `seek` (the AI outcome, §9).

`plane` already exists and becomes meaningful: it is the aircraft the jumper rides. `index` stays the **global** load order (plane order, then exit order), so landing-grid spots and labels stay unique.

**Compatibility:** `window.simPlane` stays and is the lead. `window.simPlanes` and `window.fleet` are new. Code that only needs "the plane" (camera intro, SeparationGame, planner jumprun) uses the lead. Code that needs a jumper's aircraft uses `j.plane`, e.g. `hasJumperExited(j, j.plane, t)`.

**Models:** `PlaneSelect.ts` keeps one GLTF cache per model file. Each plane clones the cached scene for its own mesh, wireframe-coloured from the catalogue. Every plane mesh is pickable (tooltip "Plane 2 · Twin Otter").

### 5.3 Flying in formation

- The **lead** flies the jumprun from the dropzone plan (`applyJumprun`), at the exit altitude, at the Jump Settings plane speed.
- **Trail planes** fly the same heading and speed, at `lead.initialPosition + R(heading) · offset`. `syncFromLead()` runs before every plane precalculation, so moving or rotating the jumprun (including *Into upper winds*) carries the whole fleet with it.
- Trail planes fly **higher** than the lead, so jumpers leaving the lead fall away below the planes behind it, and the base is the lowest group.
- **Default layout offsets** (first guesses; editable per plane in the ⚙ popover, §10.3):

| Layout | Plane k (k ≥ 1) |
|---|---|
| **V** (default) | row `r = ⌈k/2⌉`; odd k on the right, even on the left: `back = 30·r`, `right = ±40·r`, `up = 30·r` (≈ 100 ft per row) |
| Echelon right / left | `back = 30·k`, `right = ±40·k`, `up = 30·k` |
| Trail | `back = 60·k`, `right = 0`, `up = 30·k` |

- **Validation:** two planes closer than one wingspan sideways **and** one length fore-aft get a warning ("Planes 1 and 2 overlap"). Nothing is changed automatically.

### 5.4 Exit order and timing (`fleet/ExitSchedule.ts`)

This replaces the linked-group part of `normalizeJumpTimes()`. Every plane is scheduled on its own:

1. **Go.** `tGo` is the formation's exit time on the lead. The formation is the first exit group, so normally `tGo = 0`. Each plane uses `tGo + plane.goOffsetS`, which is 0 by default, so all planes exit on the lead's call.
2. **Climb-out.** `CLIMB_OUT_S` (5 s) before go, each floater moves from the cabin to their floater spot (§5.1) and rides there. The 3D view shows them hanging on the outside of the plane, and their pre-exit samples sit at the spot instead of the door.
3. **Formation members on a plane**, by `exitOrder`:
   - the **initial exit**, the plane's floaters plus up to `inDoor` jumpers, leaves at the plane's go time. Floaters leave from their spots, the others from the door. On the lead plane this is the **exit piece** (§6.3), which leaves gripped. On trail planes it leaves at the same instant, but each jumper flies to their own slot (gripped trail pieces are phase 9);
   - everyone else leaves one at a time: `jumpTime = go + (n + 1) × doorIntervalS` for the n-th diver after the initial exit.
4. **Other groups on that plane** follow the plane's last formation exit, `Exit interval` (the existing 10 s setting) apart, in the boarding order `groupAndReindexJumpers()` uses today, **per plane**.
5. Linked **rounds and flocks** that aren't from a `.jump` stay as today, but a linked group is now "linked, **same plane**, same exit". `roundMembers()` and `flockMembers()` add the plane check.

### 5.5 Simulation pipeline

`recalculateSimulation()` becomes:

1. Apply the exit altitude and plane speed (§7), then the jumprun to the lead (existing).
2. `fleet.syncFromLead()`, then `precalculate()` each plane (existing straight-line track).
3. `ExitSchedule` sets `jumpTime`, `exitOrder` and `isFloater` for every jumper.
4. For each `FormationSequence`, the **SequenceSolver** (§9) produces each member's freefall track from exit to breakoff, the point schedule and the score. It's cached on a hash of its inputs, like `formationPath`.
5. `precalculateJumpers(allJumpers)`. Members of a sequence **copy their solver track** until their breakoff, then continue with the existing physics: radial track, wave-off, deployment, canopy. This is the existing `groupPath` branch in `SimJumper.precalculate()`, generalised. Flock followers still go last. `computeSeparation()` already spans every plane.
6. `updateSimWindow()`, `notifyRecalculated()` (existing).

---

## 6. Splitting a load across planes (`formations/LoadSplit.ts`)

`LoadSplit` is pure: given a parsed jump, the preferred aircraft and the current load, it returns the planes, their aircraft, labels and counts, and each jumper's plane, exit order, floater flag and exit-piece flag. It's unit-tested with the four example files and the table in §6.5.

### 6.1 How many planes

- **Preferred aircraft:** the selected plane's aircraft when the upload starts. On first run that's the Twin Otter.
- **Use the file's planes** when the file has at least one plane **and** each file plane's jumper count fits its matched aircraft (§5.1). A plane's count is the jumpers assigned to it by `planeSlot`. When nobody is assigned, the counts come from `slotCount` in proportion, rounded so they add up to N. If any count is too big, ignore the file's planes (and say so in the notification).
- **Otherwise, auto:** `P = ⌈N / capacity⌉` planes of the preferred aircraft. **N ≤ capacity → one plane.** Counts are balanced, differing by at most one, and the lead takes the extras, so every plane's exit train is about as long.
- N counts the formation's jumpers only in **Replace** mode (the default). In **Add to load** mode (§6.4), other jumpers fill the remaining seats.
- More than 10 planes is an error: "A 240-way needs 12 Twin Otters (max 10)" (§18 Q11).

### 6.2 Which aircraft each plane is

File planes use their name match, or the preferred aircraft. Auto planes all use the preferred aircraft. Mixed fleets come from editing (change one plane's aircraft, then **Re-split**, §10.4). Re-split splits in proportion to each plane's capacity.

### 6.3 Who goes in which plane, and in what order

When the file assigns jumpers (`planeSlot`), its planes are used as they are, and the exit order comes from `index` after the "Plane order in file" setting and the pilot-seat check (§4.3). Otherwise, using point 1 in metres (formation frame, page-up = forward):

1. **Exit piece (base).** `exitPieceSize` (formation setting, default `auto`). Auto is as many as the lead's initial exit can launch: `min(N, floaters + inDoor)`, where floaters is the file's value, capped at the aircraft's maximum, or the maximum when the file doesn't say. So a Twin Otter launches up to 9 (5 on the bar, 4 in the door), or 8 when the file says 4 floaters, and a Cessna its whole load of 4. Small teams that fit leave entirely gripped, as in FS. The lead takes the exit-piece slots **nearest the centroid**. The number who float follows §5.1. The floaters are the ones on the outside of the piece (furthest from the centroid), and the rest go in the door.
2. **Sectors.** All other slots are sorted by bearing around the centroid (clockwise from forward). Each plane gets a contiguous arc sized to its remaining seats. Arcs are handed out clockwise, starting with the plane whose offset is nearest straight ahead, so each plane's sector faces where that plane flies. The lead's leftover seats get the front arc, the right trail gets the back-right arc, and so on. Divers then approach from their own side and don't cross the formation.
3. **Exit order in a plane:** the initial exit (floaters and in-door jumpers; on the lead, the exit piece), then divers **nearest the centre first**. On trail planes, the initial exit is that plane's divers nearest the centre, up to its floaters + `inDoor`. The build fills from the inside out, and the people with the furthest to go leave last, highest and furthest back, where they have the most room to dive.
4. Fill `formationSlot` (1-based, the `.jump` jumper index + 1), `name`, `colour`, body position (`belly`), `linked = true`, and `isInFormation = true`.

### 6.4 Replace or add

- **Replace load** (default): the uploaded formation becomes the whole load. The default jumpers and any earlier formation go away.
- **Add to load** (a checkbox in the formation ⚙): if the formation fits in the selected plane's free seats, it goes there. Otherwise it gets its own plane(s) per §6.1, and the existing planes keep their jumpers.
- The import notification says what happened, e.g. "Imported Night 32-way: 32 jumpers, 3 points → 2 × Twin Otter (18 + 14, from the file)". It has **Undo**, which restores the previous fleet and load exactly, and **Show**, which selects the lead chip and focuses Plane Settings. Warnings sit behind a "2 warnings" link.

### 6.5 Expected results

| Upload | Preferred | Planes | Split |
|---|---|---|---|
| `3way6a.jump` (no file planes) | Twin Otter | 1 | 3 (exit piece = all 3, all in the door) |
| `BWkemp3_jump6.jump` (Caravan, all assigned) | Twin Otter | 1 · "Caravan" flown as a Twin Otter | 8, file order, 4 floaters + 4 in the door (exit piece = all 8) |
| `jff2.jump` (Caravan, all assigned) | Twin Otter | 1 · "Caravan" | 14, file order, 5 floaters + 4 in the door (exit piece 9) |
| `night_jump_32way.jump` (2 file planes, none assigned) | Twin Otter | 2 · "Otter base" (lead) + "Caravan trail" | 18 + 14 by sector. Exit piece 5 + 4 = 9 on the lead; trail initial exit 4 + 4 = 8 |
| `3way6a.jump` | Cessna-172 | 1 | 3 (1 floater + 2 in the door, all in the exit piece) |
| 4 jumpers, no planes | Cessna-172 | 1 | 4 (2 floaters + 2 in the door) |
| 10 jumpers, no planes | Cessna-172 | 3 | 4 + 3 + 3 |
| 21 jumpers, no planes | Twin Otter | 1 | 21 |
| 22 jumpers, no planes | Twin Otter | 2 | 11 + 11 |
| 22 jumpers, no planes | Skyvan | 1 | 22 |
| 43 jumpers, no planes | Twin Otter | 3 | 15 + 14 + 14 |
| 45 jumpers, no planes | Skyvan | 3 | 15 + 15 + 15 |

---

## 7. Jump settings: exit altitude

### 7.1 Where it lives

`#jump-settings-panel` (the Jump Settings tab). The existing "Jump Height" input becomes:

```
Jump name       [Untitled JumpSim        ]
Exit altitude   [ 13,000 ] ft AGL    13,820 ft MSL
Plane speed     [     90 ] kt
                Breakoff 4,500 ft · ≈ 52 s to breakoff
                ⚠ Above 15,000 ft MSL: oxygen required (14 CFR 91.211)        ← only when it applies
[ Align Jumprun ]
```

- Its id becomes `exitAltitude`. **Default 13,000 ft**, the altitude the sim flies today (3,962 m), not the input's current 12,500, so nothing moves on first load. Range 3,000–18,000 ft, step 100.
- Heights are **above the DZ**, as everywhere else in the app. The MSL readout adds the DZ elevation.
- `planeSpeed` is wired at the same time (P5).
- `DevConsole.ts` stops reading `pullAltitude` and `planeSpeed`.

### 7.2 Model (`core/data/JumpSettings.ts`)

```ts
export interface JumpSettings { name: string; exitAltitudeFt: number; planeSpeedKt: number }
getJumpSettings(): JumpSettings
setJumpSettings(patch: Partial<JumpSettings>): void   // validates, saves, requestRecalculation()
onJumpSettingsChanged(fn): () => void
// localStorage["jumpersim.jump.v1"]; bad or missing → defaults
```

### 7.3 What it drives

| Consumer | Change |
|---|---|
| Lead plane | `initialPosition.y = exitAltitudeFt × 0.3048`. Trail planes add their `offset.upM`. |
| Every exit | Exits come from the plane tracks, so freefall time, breakoff timing, pulls and canopy flight all follow. |
| Formation centre path | Starts at the lead door at `tGo` (`formationPath`). |
| Working time (auto) and points possible | From exit to the centre path reaching breakoff (§8.3). |
| Slot-seeking feasibility | The time budget to breakoff (§9.6). |
| Jumprun *Into upper winds* | `upperWind(profile, exitAltM)`: the mean over the top 3,000 ft (existing call, now a real value). |
| Planner HUD, 3D jumprun line and exit markers | `PlannerView.ts:818` and `PlanOverlays.ts:305` read `getJumpSettings()` (plus each plane's `upM` for its own markers). |
| Weather jump conditions | `WeatherPanel.ts` uses the **highest** plane's exit altitude (lead + max `upM`) for the visibility and cloud-clearance rows, instead of `window.simPlane`. |

### 7.4 Validation

- Below 3,000 ft or above 18,000 ft: clamped, and the field flashes.
- Exit lower than breakoff + 1,000 ft with a formation loaded: a warning on the tab and on the formation bar ("No time to build: exit 5,000 ft, breakoff 4,500 ft"). The jump still runs. The formation breaks off almost at once, and every point scores 0.
- Exit lower than any jumper's pull altitude + 1,000 ft: a warning naming them.

---

## 8. Multi-point formations

### 8.1 Model (`formations/FormationSequence.ts`)

```ts
export interface SlotDef  { x: number; y: number; headingDeg: number; stance: string }  // metres, page frame
export interface PointDef { label: string; inter: boolean; slots: SlotDef[] }            // slots[i] ↔ member slot i
export interface SequenceSettings {
  timePerPointS: number;            // default 6, min 0.5
  firstPointS: number | "auto";     // window for point 1; auto = see §8.3
  advance: "timed" | "early";       // default "timed"
  minHoldS: number;                 // 1: a point must stay complete this long to count
  workingTimeS: number | "auto";    // auto = from tGo to breakoff; presets 35 (4-way FS), 50 (8-way FS)
  repeat: boolean;                  // default true: cycle the points until working time / breakoff
  orientationDeg: number;           // page-up relative to jumprun forward (0)
  exitPieceSize: number | "auto";   // §6.3
  breakoffFt: number;               // defaults to the round settings' breakoff (4,500)
}
export class FormationSequence {
  id: string; title: string; points: PointDef[];
  members: SimJumper[];             // members[i] flies slot i
  settings: SequenceSettings;
  result: SequenceResult | null;    // filled by the solver
}
```

- This replaces `classes/Formations.ts`. The `.jump` group key becomes `formation:<id>` (not the array index), and `FormationFlight.groupKey()` follows.
- Members of a sequence fly it. Linked jumpers outside any sequence fly the `Linked groups` shape (round / none), as today.

### 8.2 Formation frame

- **Centre:** the existing `formationPath()`. It starts at the lead's door at `tGo` and uses the members' average mass and drag area, so it falls at the formation's natural fall rate. It ends when it reaches `breakoffFt`.
- **Axes:** forward `f` = jumprun heading + `orientationDeg`, fixed for the jump; `right = (−f.z, 0, f.x)`.
- **Slots** of point k sit at `centre + right·x + f·y` (§4.4), on the centre's level. Each point is centred on its own centroid, as `.jump` points are drawn.
- **Heading** of slot i in point k: jumprun heading + `orientationDeg` + `slots[i].headingDeg`. It's written to the samples' `angle`, so the 3D view shows the `.jump` headings (P3).

### 8.3 Timing

- **Working time** starts at `tGo`, when the first member separates from the aircraft, as in FS.
  - `auto` = until the centre path reaches breakoff (≈ 52 s from 13,000 ft to 4,500 ft at belly fall rates).
  - A number shorter than that ends scoring early. The members keep flying the sequence until breakoff.
- **Windows.** Window 1 opens at `tGo`. Every later window opens when the one before it closes.
  - **Timed** (default): window 1 lasts `firstPointS`, every later window `timePerPointS`. At the end of a window, every member moves on to the next point, complete or not.
  - **Early:** a window closes at `keyedAt + minHoldS`, but no later than its timed length.
  - `firstPointS = auto`: `timePerPointS` when everyone is in the exit piece (N ≤ the lead's initial exit). Otherwise the solver's pre-flight estimate of the slowest diver (§9.6) plus `minHoldS`, rounded up to a whole second.
- **Repeat:** after the last point the sequence starts again at point 1 (round 2), with `timePerPointS` windows, until breakoff. With repeat off, the last point is held until breakoff.
- **Breakoff:** when the centre reaches `breakoffFt` (raised to the highest member's pull + `TRACK_LEAD_FT`, as rounds do today), every member breaks off from the slot they're in. Then comes the existing radial track to `breakoffDistance(N, …)`, wave-off and pull. Staggered waves are phase 9 (§16).
- **Readout** on the formation bar: "3 points × 6 s · working time 52 s → up to 8 points (2.7 rounds)".

### 8.4 Transitions

- When a window opens, every docked member's target becomes their slot in the new point. They **release**, move straight to the new offset in the formation frame, and redock:
  - duration `max(0.8 s, d / TRANSITION_SPEED_MS + TRANSITION_DOCK_S)`;
  - a smoothstep profile, with the heading slerped over the same time.
- Members who aren't docked yet (still diving) simply get the new slot as their target (§9.5).
- No collision avoidance between members during transitions in v1. Crossing paths are allowed (§15).

### 8.5 Scoring

- A point is **complete** when every member is docked in its slot. It **scores** when it has stayed complete for `minHoldS`, inside its window, and before working time ends.
- `inter: true` points are flown and must be completed to move on in **early** mode, but they **don't score** (§18 Q5).
- **Score** = scored points across all rounds. Strict: one missing slot means the point doesn't score.

```ts
export interface SequenceResult {
  tGo: number; workingTimeEnd: number; breakoffTime: number;
  windows: { point: number; round: number; start: number; end: number;
             keyedAt: number | null; missingSlots: number[] }[];
  score: number;
  members: { slot: number; dockTimes: (number | null)[]; missed: MissReason | null }[];
}
```

### 8.6 Status and timeline

- **Statuses** (`jumperStatus.ts`), before the existing breakoff and canopy statuses:
  - "Diving to slot 12"
  - "Setting up · slot 12"
  - "Waiting for slot 9 · slot 12"
  - "Docking · slot 12"
  - "Docked · point 2/3"
  - "Transition → point 3"
  - "Holding off · slot 12 (low)"
- **Timeline** (`Timeline.ts`):
  - point windows as faint alternating bands under the scrubber, with keyed points as green ticks and missed points as red ticks;
  - working-time end as a white dashed line;
  - hovering shows "Point 2 (round 1) keyed 39.0 s" or "Point 3 missed: slot 9".
- **Scene Objects:** a jumper's details add Slot, Plane and exit order, and dock times per point. A new "Formation" row shows the score and the per-point table.

---

## 9. Slot-seeking AI

### 9.1 Where it runs

- `physics/SequenceSolver.ts` runs once per formation per recalculation, in **lockstep** over all members (step 0.02 s), from `tGo` to breakoff. Lockstep is needed because a member's docking depends on others (who they grip) and, in **early** mode, the windows depend on everyone's dock times.
- Each member follows a state machine in `physics/SlotSeeking.ts`. Cost is N × ≈2,600 steps (about 130k updates for a 50-way), well inside G8.
- **No randomness** (G7). Optional per-jumper skill variation is phase 9.

### 9.2 Motion models

- **Free** (exited, not docked): vertical motion uses the existing drag model, `ay = −g + k(A)·vy²/m` with `k(A) = ½·ρ·Cd·A`. The controller sets the drag area `A`, so fall-rate limits come from each jumper's **weight and body position**. Horizontal motion is flown **relative to the formation centre**, as a commanded relative velocity with acceleration limits. The wind is the same for the formation and the diver, so it cancels in this frame. For the first `EXIT_STABLE_S` after exit, the jumper just falls with the plane's throw (existing physics). The controller then takes over from the actual relative velocity.
- **Docked / transitioning:** kinematic in the formation frame: `position = centre + offset(t)`, `velocity = centre velocity (+ offset rate)`. A docked jumper is carried by their grips, so fall-rate differences don't matter once docked.
- **Exit piece:** starts docked. It eases from the door into its point 1 slots over `EXIT_PIECE_DOCK_S` (the existing smoothstep), then counts as docked.

### 9.3 States

```
 EXIT ──▶ DIVE ──▶ APPROACH ──▶ SETUP ──▶ DOCK ──▶ DOCKED ◀──▶ TRANSITION
   (stable)  (far/high)  (near, level)  (wait for grips)          │
                 │            │                                    │
                 └──── can't make it (§9.6) ──▶ HOLD-OFF ──────────┴──▶ BREAKOFF (existing)
```

| State | Enter when | Drag area range | Max relative horizontal speed |
|---|---|---|---|
| EXIT | jumped | belly | – (physics) |
| DIVE | > 5 m high **or** > 25 m away from the waypoint | `DIVE_AREA` … belly max | `V_H_DIVE` |
| APPROACH | within 5 m of level and 25 m of the waypoint | belly min … belly max | `V_H_BELLY` |
| SETUP | within 0.5 m of the set-up point and moving < 0.5 m/s | belly | `V_H_BELLY` (holding) |
| DOCK | at set-up **and** at least one grip partner docked (§9.5) | belly | `DOCK_SPEED_MS` |
| DOCKED | within `DOCK_TOL_M` of the slot and moving < `DOCK_TOL_V` | – (kinematic) | – |
| HOLD-OFF | §9.6 | belly (max area when low) | `V_H_BELLY` |

### 9.4 Approach geometry

- **Waypoints**, in the formation frame:
  1. an **outer point** on the slot's bearing at `R + OUTER_MARGIN_M`, where R is the current point's radius, level with the formation. It's skipped when the diver is already outside R and within 45° of the slot's bearing;
  2. the **set-up point**: `SETUP_DIST_M` out from the slot along its bearing, `SETUP_HIGH_M` above;
  3. the **slot**.

  Going via the outer point keeps divers off the top of the formation and stops them cutting across it.
- **Vertical:** height error `e = y − y_target`. The wanted relative vertical speed is `−sign(e) · min(V_V_MAX, √(2·A_FLARE·|e|))`, so the diver flares in time rather than overshooting. The area that gives that fall rate at terminal speed, `A* = 2·m·g / (ρ·Cd·v²)`, is clamped to the state's range. A then follows A* with a `BODY_TAU_S` lag.
- **Horizontal:** the wanted relative velocity points at the waypoint, with magnitude `min(V_H_MAX(state), √(2·A_H_BRAKE·d))`. The actual relative velocity moves toward it by at most `A_H_MAX·dt` per step.
- **Never low near the formation:** a diver more than `LOW_TOL_M` below the formation and within `R + NO_LOW_MARGIN_M` of its centre gets an outside waypoint instead (on their bearing, at `R + LOW_STANDOFF_M`). They fly maximum area until level, and only then turn in. This is the standard "don't come up under the formation" rule.

### 9.5 Fall-rate matching, grips and docking

- **Fall-rate range.** A jumper's belly range is `[v(A_BELLY_MAX), v(A_BELLY_MIN)]` at their exit mass (weight + extra weight). `suitType` (stored today but unused) widens it: baggy ×1.15 on the max area, skintight ×0.9 on the min area.
- **Mismatch warning.** If the formation's fall rate is outside a member's range, the jumper can't stay level on their own:
  - too light / slow: "Jumper 7 is too light to keep up with the base: needs +6 kg";
  - too heavy / fast: "Jumper 7 falls too fast to stay level: needs a baggier suit or −5 kg".

  The extra weight comes from `m_needed = m·(v_formation / v_limit)²`. The warning shows in Plane Settings (⚠ in the row) and in the Warnings list. The jumper still flies, at the clamped area, and will usually miss the slot (§9.6).
- **Grips (build order).** In each point, slot i's **grip partners** are the slots within `GRIP_DIST_M` that are nearer the centre. A diver at SETUP docks once at least one grip partner is docked, so the formation builds from the inside out.
  - Slots with no nearer neighbour (the base, or isolated slots) dock as soon as they're set up.
  - If none of a slot's partners docks within `PARENT_WAIT_S` of the diver reaching set-up, they dock anyway. The result notes "docked without a grip".
- **Dock:** close from set-up to the slot at no more than `DOCK_SPEED_MS`. On meeting the DOCKED criteria, snap to the slot and switch to the kinematic model.
- **Retargeting:** when a window changes while a diver is still free, the waypoints are rebuilt for the new slot, and the current state is kept where it still applies.

### 9.6 When a slot can't be reached

- **Check:** every 0.5 s of sim time, each free member compares
  - `tNeed = max(tVertical, tHorizontal) + SETUP_DOCK_S`, where
    - `tVertical` = height to make up ÷ the best relative vertical rate (diving when high; when low, the gap between the formation's fall rate and the jumper's slowest);
    - `tHorizontal` = the waypoint path length ÷ the state's max speed;
  - with `tLeft` = time to the end of the current window, or to breakoff minus `SETUP_DOCK_S` if that's sooner.

**Outcomes:**

| Case | Behaviour | Reported as |
|---|---|---|
| Can't make **this** window but can make a later one | Keep flying. The point misses this slot (`missingSlots`), and the target moves on with the window. | "Late for point 1" |
| **Low**, and can't climb back before breakoff (`tVertical` = ∞ or > `tLeft`) | **HOLD-OFF:** move out to `R + LOW_STANDOFF_M` on their bearing, fly maximum area, never pass back under the formation. They break off when **they** reach breakoff altitude: being low, that's earlier than the others. | "Missed slot 12 · low by 40 m" |
| **Too far / too high** to arrive before breakoff | HOLD-OFF at the outer waypoint, level or above. Break off with everyone. | "Missed slot 12 · 140 m away at exit" |
| Can't match fall rate (§9.5) | Flies at the clamped area. Usually ends in one of the rows above. | "Can't match fall rate (needs +6 kg)" |
| Grip partners all missed | Docks after `PARENT_WAIT_S` (§9.5). | "Docked without a grip" |

- **Effect on scoring:** strict (§8.5). Any point with a missing slot doesn't score. The per-point table says who and why.
- **Pre-flight hint:** a quick estimate without running the solver, using exit-time gap × plane speed and terminal fall rate vs the working time. It flags likely misses in Plane Settings with a suggestion, e.g. "Slot 31 is unlikely: 160 m and 210 m above at exit, needs 26 s. Move earlier in the exit order or to the lead plane".

### 9.7 Constants (first guesses, in `SlotSeeking.ts`)

| Constant | Value | Meaning |
|---|---|---|
| `EXIT_STABLE_S` | 2 | no control right after exit |
| `EXIT_PIECE_DOCK_S` | 3 | exit piece eases into point 1 |
| `BODY_TAU_S` | 0.8 | lag on drag-area changes |
| `A_BELLY_MIN` / `A_BELLY_MAX` | 0.8× / 1.25× belly area | ≈ +12% / −11% fall rate (107–134 mph at 80 kg) |
| `DIVE_AREA` | 0.25 m² | ≈ 160 mph at 80 kg |
| `V_V_MAX` | 20 m/s | max relative vertical closing |
| `A_FLARE` | 4 m/s² | vertical braking used for planning |
| `V_H_DIVE` / `V_H_BELLY` | 20 / 4 m/s | max relative horizontal speed |
| `A_H_MAX` / `A_H_BRAKE` | 1.5 / 1.0 m/s² | horizontal acceleration / planned braking |
| `OUTER_MARGIN_M` | 5 | outer waypoint beyond the formation radius |
| `SETUP_DIST_M` / `SETUP_HIGH_M` | 3 / 0.5 | set-up point |
| `DOCK_SPEED_MS` | 0.5 | final closing speed |
| `DOCK_TOL_M` / `DOCK_TOL_V` | 0.3 m / 0.3 m/s | docked when within both |
| `GRIP_DIST_M` | 2.0 | grip partner distance |
| `PARENT_WAIT_S` | 3 | dock without a grip after this |
| `TRANSITION_SPEED_MS` / `TRANSITION_DOCK_S` | 1.5 / 0.5 | moving between points |
| `LOW_TOL_M` / `NO_LOW_MARGIN_M` / `LOW_STANDOFF_M` | 2 / 10 / 20 | low guard |
| `SETUP_DOCK_S` | 4 | time reserved for set-up and dock |

### 9.8 Fall-rate arrow (rev 2)

An arrow on each formation jumper shows **how much they're changing their fall rate** to get down to the group or to stay level with it.

```
   ▲  cyan: slowing down          ║  no arrow: neutral          ▼  orange: speeding up
   │  (arching, spreading out     ║  (within ±2 mph)            │  (diving or de-arching to
   ●   to stay level or come up)  ●                             ●   get down to the group)
                                                                red: at the limit of their range
```

- **Value:** `adjustMph = v(A) − v(A_neutral)`.
  - `v(A)` is the terminal fall rate at the jumper's **current** drag area (the lagged area from §9.4) and their exit mass.
  - `A_neutral` is their neutral belly area (`BODY_POSITIONS.belly.dragAreaM2`, times the suit factor from §9.5).
  - Positive means falling faster than neutral, so a **down** arrow; negative means slower, so an **up** arrow.
- **Who and when:** between exit and breakoff, in freefall only, for every member of a `.jump` sequence and every member of a linked round (`FormationFlight`). Hidden in the plane, after breakoff (tracking), under canopy, and for solo jumpers (they fall at neutral).
- **What it shows in each state:**
  - **Free** (DIVE, APPROACH, SETUP, DOCK, HOLD-OFF): the controller's actual area. A diver from a trail plane shows a long down arrow in the dive, which shrinks and may flip up as they flare at the formation's level.
  - **Docked, transitioning, exit piece, linked rounds:** these are kinematic in the model (§9.2), so the arrow shows the compensation they need **to stay in**: the area that falls at the formation's rate, `A_hold = 2·m·g / (ρ·Cd·v_formation²)`, clamped to their range. A heavy jumper in a light base shows an up arrow (arching to slow down); a light one shows a down arrow.
- **At the limit:** the arrow turns **red** when a jumper who is trying to **stay level** (APPROACH, SETUP, DOCK, HOLD-OFF, docked, exit piece) needs an area outside their belly range, e.g. a heavy jumper fully spread and still sinking.
  - Diving at `DIVE_AREA` in the DIVE state is normal and stays orange.
  - Docked jumpers at the limit are being carried by their grips. Free jumpers at the limit usually end up in §9.6.
  - For docked members this is the same condition as the fall-rate warning in §9.5, so the arrow and the warning agree.
- **Look:**
  - It starts at the jumper's centre and is **world-vertical**: it doesn't tilt with the body, so up always means slower.
  - Length `clamp(|adjustMph| × 0.06 m, 0.4 m, 3 m)`: 10 mph is 0.6 m, and a full 40 mph dive is 2.4 m (one to two body lengths). Beyond 150 m from the camera it grows with distance, so it stays at least 16 px long on screen.
  - Head 30% of the length. Colours: faster `#ff9f1c`, slower `#4fc3f7`, at the limit `#ff4d4d`.
  - It's on the overlay layer (`registerOverlay`), so clouds and haze don't hide it.
- **Data:** the solver records `{ t, adjustMph, atLimit }` for each member every 0.1 s (`SimJumper.fallAdjust`, typed arrays). The render loop interpolates it at the current time. There's no physics per frame, and scrubbing works.
- **Readouts:**
  - The hover tooltip and the Scene Objects details add "Fall-rate adjust +18 mph (diving, 152 mph)".
  - The Plane Settings **Fall (mph)** column shows "152 (+18)" while the jumper is in the formation.
- **Toggle:** **View → Fall-rate arrows** (checkbox, on by default), saved in `localStorage["jumpersim.view.fallArrows"]`. When it's off, no arrows are created or updated, so it costs nothing.
- **Cost:** one arrow per member, created when needed, updated only while visible: at most 100 updates per frame.
- File: `src/js/visuals/FallRateArrows.ts`, updated from `updateFromPrecalc()` in `Scripts.ts`.

---

## 10. Load menu (Plane Settings)

### 10.1 Layout

```
┌ Plane Settings ────────────────────────────────────────────────────────────────────────────────────┐
│ [● 1 Otter base · Twin Otter · 18/21] [○ 2 Caravan trail · Twin Otter · 14/21] [＋] [All 32]  V ▾ ⚙ │ ← plane strip
├────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Aircraft [Twin Otter ▾]  Seats 18/21  Floaters [5]   Lead · 13,000 ft   90 kt · 278°   [Top view]   │ ← selected plane
├────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Formation [Night 32-way ▾] 3 pts · 32 slots  [Import .jump]   Time per point [6] s                  │ ← formation bar
│ Working time [Auto · 52 s ▾]  ☑ Repeat   Score 4 · P1 ✓ 34.1 s  P2 ✓  P3 ✕ slot 9   ⚙               │
├────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Exit interval [10] s   Linked groups [Round ▾] ⚙                        Unsaved changes  [Apply]    │ ← existing toolbar
│ #  Name  Position  Track  Wt  Canopy  WL  Pull  Linked  Slot  Pattern  Formation  Status  Alt  Fall │ ← this plane's jumpers
└────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 10.2 Plane strip (new, top of `#plane-panel .panel-body`)

- One small chip per plane (24 px high, editor tab styling: active chip `#2c2c2c` with a 2 px gold top border, others `#1e1e1e`). Each chip shows:
  - a colour dot (the plane's wireframe colour);
  - its number and label;
  - the aircraft's short name;
  - **seats used / capacity**: red with ⚠ when over capacity, "16/—" when the capacity is unknown.
- **Click** selects the plane. The header and table below show that plane, and the 3D view briefly highlights its mesh.
  - `role="tablist"`; **←/→** move between chips.
  - The selection is remembered for the session.
- **Right-click** or **⋯** on a chip: Rename, Aircraft ▸, Make lead, Move left/right (fleet order), Remove plane…
  - **Remove** moves the plane's jumpers to the other planes if there are seats, and asks first.
  - Removing the last plane isn't allowed.
- **＋** adds a plane with the lead's aircraft, places it with the layout, and selects it.
- **All** shows every jumper with an extra **Plane** column (a select that moves the jumper). The `#` column then shows "plane · exit", e.g. "2·5".
- **Layout ▾ and ⚙** show only with two or more planes: the layout picker (§5.3), and a popover with each trail plane's back / right / up (m, with ft for up) and go offset (s).
- With one plane, the strip shows its chip, **＋** and **All**. That keeps the feature discoverable and costs one line.

### 10.3 Selected plane header (replaces today's `ps-header`)

- `#plane-select` (same id) now changes **only this plane's** aircraft.
- **Seats**, **Floaters** (number input), position ("Lead", or "30 m back · 40 m right · +100 ft"), that plane's exit altitude, speed and heading. **Top view** stays.
- The `#plane-speed`, `#plane-direction` and `#load-size` readouts (same ids) show the selected plane, so `updatePlaneSummary()` keeps working.

### 10.4 Formation bar (new)

- The **Formation** select and **Import .jump** move here from the toolbar. The import also accepts a `.jump` file **dropped** onto the Plane Settings tab.
- **Time per point** (s), **Working time** (Auto / 35 s 4-way FS / 50 s 8-way FS / Custom…) and **Repeat** are always visible.
- The ⚙ popover holds: Advance (Timed / Early), First point (Auto / s), Min hold, Orientation (°), Exit piece size, Breakoff (ft), "On import: Replace load / Add to load", "Plane order in file: First out / From the pilot" (§4.3), and **Re-split** ("Re-split 32 jumpers across 2 planes": re-runs §6.3 for the current planes and aircraft).
- **Score readout:** score, then per point ✓/✕ with keyed time or the first missing slot. Clicking it opens the per-point table (point, round, window, keyed at, missing slots and reasons).
- The bar is hidden when there's no formation.

### 10.5 Table changes

- In a single-plane view, `#` is the exit order within the plane. ▲/▼ reorder within the plane, which changes `exitOrder` and therefore the exit time.
- **Slot** for `.jump` members: a 1…N select that swaps, reusing `swapInto()`. Swapping changes who flies which slot in **every** point.
- Rows over the plane's capacity get a red left border, and the **Apply** button (today's "Save", renamed in §12.4) shows "⚠ Plane 1 is over capacity (23/21)". Apply still applies.
- **Status** uses the new AI statuses (§8.6). Row ⚠ icons show fall-rate mismatches and likely misses (§9.5, §9.6).

---

## 11. Other UI

| Where | Change |
|---|---|
| 3D view | All plane meshes. The selected chip's plane is outlined for 1.5 s. Optional (phase 9): faint target rings for the current point's slots while following a formation member. |
| Planner | The jumprun line belongs to the lead. Every plane's exit markers are labelled "plane·exit" (e.g. "2·5"). Trail planes are drawn as thin offset lines in the lead's colour. The ground-speed label uses the lead. |
| Scene Objects | Planes are listed in fleet order, each followed by its jumpers (indented). The plane row says "Lead · Twin Otter · 18 aboard". Plus the new Formation row (§8.6). |
| Timeline | Exit markers for every plane, point bands and ticks, working-time end (§8.6). |
| Weather | Exit altitude for the jump conditions (§7.3). |
| Notifications | Import result with Undo / Show / warnings (§6.4). Fall-rate and miss warnings join the Warnings list. |
| View menu | **Fall-rate arrows** toggle (§9.8). |
| File menu | **Save**, **Save As…**, **Load from File…** and **Auto-Save** for `.jsim` files (§12). |

---

## 12. Saving and loading (`.jsim`) (rev 2)

The whole JumperSim environment can be saved to a `.jsim` file and loaded again, by the same person or by anyone they send it to. Opening a `.jsim` gives the same jump: the same dropzone, plan, planes, load, formation and settings. With the saved weather, it also gives the same tracks and score.

### 12.1 Current state

- The **File** menu already has *Save* (calls `handleClick('New Scene')`, which only logs), *Load from File* (no handler) and an *Auto-Save* checkbox (only logs) (`index.html:69-86`, `Menubar.ts:2-8`).
- The only thing that can be exported today is the dropzone plan: `exportPlanJSON()` / `importPlanJSON()` in `DropzonePlan.ts:251-269`, with `validatePlan()`.
- The selected dropzone is a cookie (`selectedDropzoneIndex`, an index into `dropzones.json`, `LocationSelect.ts:39-54`).

### 12.2 What a `.jsim` holds

| Part | Contents |
|---|---|
| Header | `format: "jumpersim"`, `version: 1`, `savedAt` (ISO time), `appVersion` (from `package.json`) |
| Jump | `JumpSettings`: name, exit altitude, plane speed (§7.2) |
| Dropzone | Name, latitude, longitude, elevation. Matched by name, not by list index, so the file still works when `dropzones.json` changes. |
| Plan | The `DropzonePlan` (version 1): jumprun, landing zones, danger zones, canopy pattern, freefall patterns |
| Load settings | Exit interval, `linkedFormation`, `roundSettings`, `flockSettings`, `minDeploySeparationM` |
| Fleet | Layout, and the planes in order: id, label, aircraft id, offset, floaters, go offset |
| Jumpers | id, plane id, exit order, floater flag, name, colour, body position, track on/off, weight, extra weight, suit, canopy size, pull altitude, linked, `formationSlot`, `laneIndex`, `freefallPatternId` |
| Formations | Each `FormationSequence`: id, title, source (`.jump` file name and `docVersion`), settings, points (already in metres, so the `.jump` isn't needed), and member ids in slot order |
| Weather | `mode: "saved" \| "live"`. Saved: the `WeatherState` the physics used, plus the override name if one was on (`weather/Overrides.ts`) |
| View | Sim time, playback speed, camera position and target |

**Not saved:** precalculated tracks and results (the score, misses, fall-rate series), which are recalculated on load and come out the same because the sim is deterministic (G7). Also not saved: meshes, map tiles, and per-browser preferences (dock layout, view toggles, weather toggles).

### 12.3 Format

JSON (UTF-8, pretty-printed), extension `.jsim`, MIME type `application/json`. A 100-way with weather is about 200 KB.

```json
{
  "format": "jumpersim", "version": 1, "savedAt": "2026-11-21T22:14:03Z", "appVersion": "1.0.1",
  "jump": { "name": "Night 32-way", "exitAltitudeFt": 13000, "planeSpeedKt": 90 },
  "dropzone": { "name": "Example DZ", "latitude": 33.0, "longitude": -117.0, "elevationFt": 1400 },
  "plan": { "version": 1, "dropzone": "Example DZ", "jumprun": { … }, "landingZones": [ … ], … },
  "load": {
    "exitIntervalS": 10, "linkedFormation": "round", "roundSettings": { … }, "flockSettings": { … },
    "minDeploySeparationM": 150,
    "fleet": { "layout": "v", "planes": [
      { "id": "p1", "label": "Otter base", "aircraft": "twin-otter",
        "offset": { "backM": 0, "rightM": 0, "upM": 0 }, "floaters": 5, "goOffsetS": 0 } ] },
    "jumpers": [ { "id": "j1", "plane": "p1", "exitOrder": 0, "isFloater": true, "name": "Jumper 1",
                   "color": "#F44336", "position": "belly", "tracking": true, "weightKg": 80, … } ],
    "formations": [ { "id": "f1", "title": "Night 32-way",
                      "source": { "file": "night_jump_32way.jump", "docVersion": 2 },
                      "settings": { "timePerPointS": 6, … }, "points": [ … ], "members": ["j1", "j2", …] } ]
  },
  "weather": { "mode": "saved", "override": null, "state": { … } },
  "view": { "time": 42.6, "speed": 1, "camera": { "position": [ … ], "target": [ … ] } }
}
```

### 12.4 Saving

- **File → Save** (Ctrl+S / Cmd+S) writes the environment to `.jsim`.
  - Where the browser supports the File System Access API (`showSaveFilePicker`), the first Save asks for a location. Later Saves overwrite the same file.
  - Elsewhere it downloads `<jump name>.jsim`, with the name made safe for a file system.
- **File → Save As…** (Ctrl+Shift+S) always asks.
- Pending Plane Settings edits are applied first, so the file matches what's on screen.
- **Unsaved state:** the jump name in the menu bar gets a "•" after any change since the last save or load. The Plane Settings button that applies table edits is renamed **Apply**, so there's only one "Save" in the app.
- A toast confirms "Saved Night 32-way.jsim".

### 12.5 Loading

- **File → Load from File…** (Ctrl+O / Cmd+O), or **drop** a `.jsim` file anywhere on the window. A dropped `.jump` imports a formation instead (§10.4).
- **Steps:**
  1. Leave the planner and Top view.
  2. Parse and validate (§12.7).
  3. **Dropzone:** select it by name in `dropzones.json`, else the nearest listed dropzone within 2 km. If neither exists, add a temporary "*name* (from file)" entry for this session at the saved coordinates and elevation.
  4. **Plan:** the file's plan replaces that dropzone's plan, the same as importing a plan file today (§18 Q10).
  5. Rebuild the fleet, jumpers, formations, meshes and colours, and apply the jump and load settings.
  6. **Weather:**
     - **saved** (the default): the weather service holds the saved state (`hold` on), and the Weather tab says "Weather from file · *time*";
     - **live**: fetch as usual.
  7. Recalculate, then restore the sim time, playback speed and camera.
- **Notification:** "Loaded Night 32-way.jsim · 2 planes, 32 jumpers · weather from file", with **Undo** (restores the whole previous environment, plan included), **Use live weather**, and a warnings link.
- Loading **replaces** the environment. It never merges.
- Saved with a different app version: a note in the notification ("Saved with JumperSim 1.0.1: tracks may differ slightly").

### 12.6 Auto-Save

- The existing **File → Auto-Save** checkbox (off by default, remembered per browser) saves the same JSON to `localStorage["jumpersim.autosave.v1"]`, 2 s after the last change.
- On the next start, if there's an auto-save newer than the last manual save or load, a notification offers **Restore last session** or **Dismiss**.
- If the browser's storage is full, Auto-Save turns itself off and says so.

### 12.7 Validation and safety

A `.jsim` may come from someone else, so it's treated as untrusted data:

- `format` must be `"jumpersim"`. A `version` newer than this build is refused ("Made with a newer JumperSim"). Older versions go through migrations (`migrations[version]`). Unknown keys are ignored.
- **Types:**
  - every number is checked as finite and clamped to the same range as its input, e.g. exit altitude 3,000–18,000 ft;
  - enums (aircraft, body position, layout, suit, advance mode) must be known values. An unknown aircraft becomes the preferred aircraft, with a warning;
  - colours must be `#rrggbb`;
  - strings are trimmed to 100 characters.
- **Limits:** 10 planes, 1,000 jumpers, 100 points, 2 MB. Anything larger is refused.
- **References:** a jumper whose plane doesn't exist moves to the lead. A formation member who doesn't exist leaves the formation. Each case gets a warning.
- **No markup from files:** names and labels are only ever set with `textContent` or `.value`. Settings are coerced to numbers or `"auto"` before use. The ⚙ popover in `PlaneLoad.ts:895-906` builds HTML from the round and flock settings with `innerHTML`, so without coercion a string in a file would be injected as HTML.
- Weather states go through the same checks as live data (`WeatherState` fields, finite numbers).

### 12.8 Code

| File | Role |
|---|---|
| `src/js/core/data/JsimFile.ts` | **New, pure.** `serializeEnvironment()`, `parseJsim(text) → { env, warnings }`, validation, migrations. |
| `src/js/ui/FileMenu.ts` | **New.** File menu items, shortcuts, the save picker or download, drop-to-open, Auto-Save, the unsaved "•". Replaces the stubs in `Menubar.ts`. |
| `src/js/LocationSelect.ts` | Select a dropzone by name or coordinates. Temporary "(from file)" entries. |
| `src/js/weather/WeatherService.ts` | `holdState(state)` to fly a saved weather state, and `exportState()`. |
| `tests/jsimFile.test.ts` | **New.** Round trip (save → load → save is identical apart from `savedAt`), migrations, hostile input (markup in names and settings, out-of-range numbers, missing references). |

---

## 13. Data model changes (summary)

| Type | Added / changed |
|---|---|
| `AircraftSpec` (`fleet/Aircraft.ts`) | Existing config + `capacity: number \| null`, `doorIntervalS`, `maxFloaters`, `floaterSpots: {right, up, back}[]`, `inDoor`, `wingspanM`, `lengthM`, `nameMatches: string[]` |
| `Fleet` (`fleet/Fleet.ts`) | New (§5.2). `window.fleet`, `window.simPlanes`. |
| `SimPlane` | `aircraftId`, `label`, `offset`, `floaters`, `goOffsetS`, `capacity` getter. `formations` moves to `Fleet`. |
| `SimJumper` | `exitOrder`, `isFloater`, `seek: { states: {t, state}[]; dockTimes; missed: MissReason \| null }`, `fallAdjust: { t: Float32Array; mph: Float32Array; atLimit: Uint8Array } \| null` (§9.8). `formationSlot` reused for `.jump` slots. |
| `ParsedJump` (`formations/JumpFile.ts`) | Parsed file in metres (§4.5). |
| `FormationSequence`, `SequenceSettings`, `SequenceResult` | New (§8.1, §8.5). Replace `Formation`, `FormationData`, `FormationPoint`, `FormationSlot`. |
| `JumpSettings` | New (§7.2), saved to `localStorage["jumpersim.jump.v1"]`. |
| `MissReason` | `{ kind: "late" \| "low" \| "far" \| "fallRate"; detail: string }` |
| `JsimEnvironment` (`core/data/JsimFile.ts`) | New (§12.2–12.3): the whole environment as saved to `.jsim` and to Auto-Save. |

The load (fleet, jumpers, formations) lives in memory while the app runs. It's saved with the rest of the environment to a `.jsim` file (§12), or to Auto-Save when that's on.

---

## 14. Code structure

| File | Role |
|---|---|
| `src/js/core/data/JumpSettings.ts` | **New.** Exit altitude, plane speed, jump name. Validation, saving, change events. |
| `src/js/fleet/Aircraft.ts` | **New.** The aircraft catalogue (moved from `PlaneSelect.ts`): capacities, floater spots, in-door counts, name matching. |
| `src/js/fleet/Fleet.ts` | **New.** Planes, lead, layouts, offsets, `syncFromLead`, moving jumpers. |
| `src/js/fleet/ExitSchedule.ts` | **New.** Per-plane exit order and jump times (§5.4). Replaces the linked-group logic in `PlaneLoad.normalizeJumpTimes()`. |
| `src/js/formations/JumpFile.ts` | **New.** Parse and validate `.jump` (§4.5). Replaces `exampleData/Formations.ts`. |
| `src/js/formations/LoadSplit.ts` | **New, pure.** Plane count, counts, sectors, exit order (§6). |
| `src/js/formations/FormationSequence.ts` | **New.** Sequence model and settings (§8.1). Replaces `classes/Formations.ts`. |
| `src/js/physics/SlotSeeking.ts` | **New.** Member state machine, limits, feasibility (§9.3–9.7). |
| `src/js/physics/SequenceSolver.ts` | **New.** Lockstep solve per formation: windows, docking, transitions, scoring, member tracks, fall-rate series (§8.3–8.5, §9.1–9.2, §9.8). |
| `src/js/visuals/FallRateArrows.ts` | **New.** The fall-rate arrows and the View menu toggle (§9.8). |
| `src/js/core/data/JsimFile.ts`, `src/js/ui/FileMenu.ts` | **New.** `.jsim` save, load, validation and Auto-Save (§12.8). |
| `src/js/PlaneSelect.ts` | Model loading per plane with a GLTF cache. No module-level `planeMesh`. |
| `src/js/classes/BaseEntities.ts`, `SimEntities.ts` | New fields. `precalculate()` copies solver tracks until breakoff. `precalculateJumpers()` pipeline (§5.5). |
| `src/js/physics/FormationFlight.ts` | `groupKey` by formation id. Linked groups per plane. `formationPath` keyed by formation. |
| `src/js/ui/PlaneLoad.ts`, `src/css/planeloadui.css` | Plane strip, selected-plane header, formation bar, All view, import flow (§10). |
| `src/js/panels/jumperStatus.ts`, `SceneObjects.ts` | New statuses. Planes grouped. Formation row. |
| `src/js/editor/Timeline.ts` | Point bands and ticks, working-time line. |
| `src/js/dropzone/PlanContext.ts`, `PlanOverlays.ts`, `PlannerView.ts` | Lead's jumprun frame. Exit markers per plane. Exit altitude from `JumpSettings`. |
| `src/js/panels/WeatherPanel.ts` | Highest exit altitude for the jump conditions. |
| `src/js/Scripts.ts` | Create the fleet. Startup load without the empty `jff2` formation. Mesh colours from `.jump`. Pipeline (§5.5). |
| `src/js/Menubar.ts` | Formations → From .jump runs the real import (P7). The File menu stubs move to `FileMenu.ts`. |
| `src/js/LocationSelect.ts`, `src/js/weather/WeatherService.ts` | Dropzone by name or coordinates, and holding a saved weather state (§12.8). |
| `index.html`, `src/js/DevConsole.ts` | Jump Settings ids (§7.1). Plane Settings structure (§10). View → Fall-rate arrows. File → Save As…. |
| `tests/jumpFile.test.ts`, `loadSplit.test.ts`, `sequenceSolver.test.ts`, `jsimFile.test.ts` | **New.** The four example files (both plane orders, the pilot-seat check), §6.5, a 4-way sequence, a forced low miss, the fall-rate series of a heavy jumper, `.jsim` round trip and hostile input. |
| **Delete** | `src/js/classes/Formations.ts`, `src/js/exampleData/Formations.ts` (once phase 2 lands). |

---

## 15. Edge cases

- **Overfull plane after an aircraft change** (Skyvan 22 → Twin Otter 21): the chip turns red, and Apply warns. Nothing moves until the user clicks **Re-split** or moves someone. Uploads always split, edits never move people.
- **Capacity unknown** (DC-9): no limit, "/—", never chosen by auto-split.
- **More floaters in the file than the aircraft can hang** (e.g. 4 on a Skyvan ramp): capped at the maximum, the rest go in the door, warning (§5.1).
- **Plane order in file guessed wrong:** switching "Plane order in file" re-runs the split for that file's planes. It reverses each plane's exit order and picks the new floaters (§4.3).
- **Loading a `.jsim` with a formation, then importing a `.jump`:** the import works on the loaded environment like any other (Replace or Add, with Undo).
- **A `.jsim` from an unlisted dropzone, or a newer version, or with bad values:** §12.5 and §12.7.
- **File plane bigger than its aircraft** (a "Caravan" with 25 assigned, flown as a 21-seat Twin Otter): the file's planes are ignored, the split is automatic, and the notification says why.
- **More than 10 planes needed:** error with the count. Nothing changes.
- **Exit below breakoff + 1,000 ft:** warning. The formation breaks off almost at once, and points score 0 (§7.4).
- **Time per point shorter than a transition** (e.g. 0.5 s for 3 m moves): points never key. The per-point table shows "needs ≥ 2.5 s".
- **Working time longer than exit → breakoff:** clamped to breakoff, with a note.
- **Black or very dark `.jump` colours:** lifted for display (§4.3).
- **Re-importing** with Replace: the old formation and fleet go away (Undo brings them back).
- **Two formations on one load** (Add to load): each has its own centre path, exit piece and solver. Their `tGo`s are one exit interval apart on a shared plane. A formation spread over several planes exits on the common go.
- **A jumper moved to another plane after the split:** allowed. Their exit order is appended to that plane, the pre-flight hint updates, and the solver uses the new exit.
- **Jumprun changed while a formation is loaded:** the fleet and formation frame turn with it (`orientationDeg` is relative to jumprun).
- **Lead removed:** the next plane becomes lead, offsets are recomputed from the layout, and the formation's exit piece moves to the new lead only after **Re-split** (until then a warning says the base isn't in the lead).
- **Members with different pull altitudes:** breakoff rises to the highest pull + `TRACK_LEAD_FT` (existing rule).
- **Crossing transitions:** allowed in v1 (no avoidance). Points stay scoreable.
- **Wingsuit or tracking body position set on a `.jump` member by hand:** they leave the sequence. Their slot is then always missing, so points never score. Their row warns "Not a formation body position".
- **Scrubbing backwards:** everything is precalculated and deterministic (G7), so it behaves as it does today.

---

## 16. Implementation plan

Each phase leaves the app working.

1. **Exit altitude and plane speed** (§7). `JumpSettings`, wired inputs, saving. All the exit-altitude consumers. Fixes P5.
2. **`.jump` parser and a working import, single plane** (§4). `JumpFile` (including plane order and the pilot-seat check), `FormationSequence` with point 1 only, flown with the existing centre path and easing at the right scale, orientation and headings, with names and colours. Imported jumpers join the load, from both the Plane Settings button and the Formations menu (P1, P2, P3, P6, P7). Remove the startup placeholder formation and `classes/Formations.ts`. Tests on the four files.
3. **Fleet** (§5). `Aircraft` with capacities (Cessna 4), floater spots and in-door counts, `Fleet`, per-plane meshes, layouts and offsets. `ExitSchedule` with climb-out and the initial exit (fixes P4). Every consumer moved off the single plane: Scene Objects, planner markers, timeline exits, weather.
4. **Load menu** (§10.1–10.3, §10.5). Plane strip, selected-plane header, All view, moving jumpers, capacity warnings.
5. **Auto-split on upload** (§6). `LoadSplit`, Replace / Add, the import notification with Undo, Re-split. Tests for §6.5.
6. **Save and load `.jsim`** (§12). `JsimFile` and `FileMenu`: Save, Save As, Load, drop-to-open, Auto-Save, validation, saved weather. Rename the Plane Settings button to **Apply**. Later phases add their own fields (sequence settings, view) under the same `version: 1`, with defaults for files that don't have them.
7. **Slot-seeking for point 1** (§9). `SlotSeeking` and `SequenceSolver` with the exit piece, divers, grips, docking, low guard, misses, fall-rate warnings, pre-flight hints, statuses, and the **fall-rate arrows** (§9.8).
8. **Sequences and scoring** (§8). Windows, timed and early advance, repeat, transitions, working time, score. Formation bar (§10.4), timeline bands and ticks, the Scene Objects Formation row.
9. **Polish:** staggered breakoff waves for 20+ ways, gripped initial-exit pieces on trail planes, optional seeded skill variation, slot target rings, simple separation between moving members during transitions.

---

## 17. Acceptance criteria

**Exit altitude**
- [ ] Setting 10,000 ft puts every plane track at 3,048 m (trail planes + their offset). Exits, the planner HUD, the 3D jumprun line and the weather jump conditions follow, and the value survives a reload.
- [ ] On first run the sim flies at 13,000 ft, as before.

**Upload and split**
- [ ] Each example file imports to the result in §6.5, including names and colours from the file. The imported jumpers appear in the table and the 3D view, and fly.
- [ ] 21 jumpers with a Twin Otter give one plane, and 22 give two (11 + 11). 22 with a Skyvan give one plane. 4 with a Cessna give one plane, and 10 give three (4 + 3 + 3).
- [ ] With "Plane order in file: From the pilot", `jff2.jump` exits in reverse index order (index 13 first), and its floaters are the first 5 out in that order.
- [ ] **Undo** after an import restores the previous fleet and load exactly.
- [ ] A broken file (point with a missing slot) shows an error and changes nothing.

**Geometry**
- [ ] Point 1 of the 32-way is 12–13 m across in the sim (not about 83 m). In `3way6a` point 1, all three jumpers face the centre in the 3D view.
- [ ] Rotating the jumprun 90° rotates the formation 90° with it.

**Fleet**
- [ ] Two planes fly the V layout: the trail plane is 30 m back, 40 m right and 30 m higher, and both exit on the same go. Each plane's divers leave one door interval apart.
- [ ] Changing plane 2's aircraft leaves plane 1 untouched.
- [ ] For 5 s before go, floaters are drawn hanging at their spots outside the plane. On go, the floaters and the jumpers in the door leave at the same instant: the whole load from a Cessna 4-way, 8 from `BWkemp3_jump6.jump` in a Twin Otter.

**Sequence and scoring**
- [ ] `3way6a` from 13,000 ft with 6 s per point and auto working time cycles through all 7 points and repeats. Its score equals the green ticks on the timeline. Changing the time per point and applying re-scores it.
- [ ] In **early** mode a point closes `minHoldS` after it keys.
- [ ] An `inter` point (a test file) is flown but adds nothing to the score.

**Slot-seeking**
- [ ] With defaults from 13,000 ft, the 32-way (2 Twin Otters) keys point 1 before breakoff. Every diver's track stays outside `R + NO_LOW_MARGIN_M` whenever they're more than `LOW_TOL_M` below the formation.
- [ ] Giving one diver +30 kg extra weight produces the fall-rate warning. That diver holds off at least 20 m out and breaks off when they reach breakoff altitude, and point 1 is reported missing their slot.
- [ ] From 6,500 ft some 32-way slots are reported "Missed · … away", and those divers hold off and break off on time.

**Fall-rate arrows**
- [ ] In the 32-way, a trail-plane diver shows a long orange down arrow while diving. It shrinks as they flare and level off at the formation.
- [ ] The +30 kg diver above shows a red up arrow (slowing as much as they can and still too fast). A member of normal weight who has docked shows a short arrow or none.
- [ ] Scrubbing the timeline moves the arrows with it. **View → Fall-rate arrows** off hides them all, and the setting survives a reload.

**Save and load (`.jsim`)**
- [ ] Save, then load the file in a browser with cleared storage. The dropzone, plan, exit altitude, fleet, jumpers, formation and settings are all back. With the saved weather, the tracks are identical (landing points within 1 cm) and so is the score.
- [ ] Save → load → save gives the same file apart from `savedAt`.
- [ ] A `.jsim` whose dropzone isn't in the list loads at its saved coordinates, with a warning.
- [ ] Markup in a jumper name or a settings value in a `.jsim` shows as plain text and never runs. Out-of-range numbers are clamped.
- [ ] With Auto-Save on, a reload offers **Restore last session**, which brings back the same environment.
- [ ] **Undo** after a load restores the previous environment, including the previous dropzone plan.

**Load menu**
- [ ] The strip shows one chip per plane with seats used / capacity. Clicking a chip switches the header and table. **All** shows every jumper with a Plane column that moves them. Over-capacity shows red.

**Performance**
- [ ] A 100-way across 5 Twin Otters recalculates in under 1 s on the reference laptop (G8).

---

## 18. Open questions

1. **DC-9 capacity** (and its door interval). Until answered, its capacity is unknown: no limit, and never picked by auto-split. (Rev 2: the Cessna-172 holds 4.)
2. **Fleet layout defaults:** is V with 30 m back, 40 m sideways and 100 ft step-up per row right for the DZs in mind, or should echelon be the default?
3. **`.jump` units:** 1 unit = 1 cm fits all four files (§4.4). Is there a Skydive Designer reference or a file with a known size to confirm it?
4. **`planeSlot.index` order:** index 0 may be the pilot's end of the cabin or the first jumper out (rev 2). In both example files a jumper holds index 0, so it isn't the pilot's own seat. This spec defaults to **first out**, with a "From the pilot" setting and a pilot-seat check (§4.3). Is there a Skydive Designer file with a known exit order to settle the default? (Rev 2: floaters are the people hanging on the outside of the plane, §1.1.)
5. **`inter` points:** are they FS block intermediates (flown, not scored)? Should they get a full time-per-point window in timed mode?
6. **Other stances:** what are Skydive Designer's freefly stance names, and should they map to sit / head-down (which today can't build `.jump` formations)?
7. **Aircraft not modelled** ("Caravan"): fly them as the preferred aircraft (this spec), or add a Caravan model? If added, what capacity?
8. **Advance default:** timed (predictable, this spec) or early (finishes each point as fast as the team can)?
9. **Big-way scoring:** for a single-point big-way, is "keyed at T s" (build time) the result to show, instead of a point count?
10. **Plan in a loaded `.jsim`:** this spec replaces the dropzone's saved plan with the file's (as importing a plan file does today), with Undo. Should a `.jsim` plan instead apply only while that file is open, leaving the dropzone's own plan alone? (Rev 2: saving the load is now `.jsim`, §12.)
11. **Max planes:** is 10 enough?
12. **Tunnel dives** (`tunnelFt` > 0): fly them as skydives with a warning (this spec), or refuse them?
13. **Orientation:** is "page-up = along jumprun" the convention organizers expect, or should page-up face the lead plane (backwards)?
14. **Formations → Save Formation:** the menu item does nothing today. Should it export the selected formation as a `.jump` for Skydive Designer (with the current plane split), or be removed now that `.jsim` saves everything?
15. **Fall-rate arrow scope:** vertical only (this spec), or also a flat arrow for horizontal drive (sliding toward the slot)?
16. **Floater and in-door defaults:** Twin Otter 5 floaters / 4 in the door, Skyvan 6 on the ramp, Cessna 3 / 2 (§5.1). Do these match how the DZs in mind exit?
