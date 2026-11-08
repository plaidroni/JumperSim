# Spec: Editor-Style Layout (Dock, Floating Tabs, Timeline, Weather & Scene Objects)

**Status:** Implemented (rev 3)
**Replaces:** floating windows (`src/js/classes/Panel.ts`, `PanelManager.ts`, `#minimized-bar`, `src/css/minimized-windows.css`, the `.panel` window styles in `devconsole.css`)
**Touches:** `index.html`, `src/js/Menubar.ts`, `src/js/TimeScrubber.ts`, `src/js/Scripts.ts` (viewport sizing, mouse picking, camera follow), new `src/js/editor/*`, new `src/js/panels/*`, new `src/css/editor.css`

**Rev 2 decisions**
- The side the dock sits on is a **setting** (left or right). The dock can be **closed** and **resized**.
- The **Weather** panel stays as a core feature and gains a camera-relative **wind widget** for each height (§7).
- Tabs can be **dragged out into floating windows** and docked back afterwards (§5.3).
- **Scene Objects** becomes an object list with jumper details and a **Zoom in** button (§8).

**Rev 3 decisions**
- No 3D model preview in Scene Objects: the low-poly canvas is dropped (§8).
- The Weather wind widget shows **forecast heights only** (§7).
- The unused *Belly / Freefly jumper speed* inputs have been **removed from the app** (done, see §2).

---

## 1. Summary

Replace the free-floating windows with an editor layout like a game engine (Unity, Unreal, Godot):

- **3D viewport** in the middle. It resizes whenever the docks open, close or resize.
- **Side dock** on the left or right (a setting). It holds the tool panels as **tabs** in up to two stacked groups. It can be resized and closed.
- **Bottom panel** above the timeline for wide tools. Plane Settings lives here by default.
- **Floating windows:** drag any tab out of a dock to float it over the viewport, and drag it back onto a tab strip to dock it again.
- **Timeline bar** pinned to the bottom edge with the playback controls. It is always visible and is not a tab.
- The layout is saved per browser. **Window → Reset Layout** restores the defaults.

```
Dock side = Right (default)                                   Dock side = Left
┌────────────────────────────────────────────────────────┐    ┌────────────────────────────────────────────────────────┐
│ menubar                                                 │    │ menubar                                                 │
├──────────────────────────────────────────┬─┬───────────┤    ├───────────┬─┬──────────────────────────────────────────┤
│                    ┌─ floating ─────┐    │ │ Location… │    │ Location… │ │                                          │
│      3D VIEWPORT   │ Following  ⧉ × │    │↔│───────────│    │───────────│↔│              3D VIEWPORT                 │
│                    │  …             │    │ │ Weather…  │    │ Weather…  │ │                                          │
│                    └────────────────┘    │ │           │    │           │ │                                          │
├──────────────────── ↕ ───────────────────┴─┴───────────┤    ├───────────┴─┴─────────────── ↕ ──────────────────────────┤
│ Plane Settings │ +                                ▁ ✕  │    │ Plane Settings │ +                                ▁ ✕  │
├────────────────────────────────────────────────────────┤    ├────────────────────────────────────────────────────────┤
│ ⏮ ⏴ ▶ ⏵ ⏭  ━━━━━━━━━━━━━━━━●━━━━━━━━━━━━━━━  42.6 s   │    │ ⏮ ⏴ ▶ ⏵ ⏭  ━━━━━━━━━━━━━━━━●━━━━━━━━━━━━━━━  42.6 s   │
└────────────────────────────────────────────────────────┘    └────────────────────────────────────────────────────────┘
```

---

## 2. Current state

| Area | Today |
|---|---|
| Panels | 8 `<div class="panel" id="*-panel">` in `index.html`: Location, Jump Settings, Weather, Scene Objects, Following, Speed Settings, Playback Controls, Plane Settings. Each has a draggable `.panel-header` (–, ×) and a `.panel-body`. |
| Window state | `Panel.ts` keeps position, size and visibility per panel in cookies. Minimized panels become tabs in `#minimized-bar`. |
| Window menu | `Menubar.ts`: *Recenter / Minimize / Restore windows* and `show-<id>` checkboxes. |
| Playback | Lives in `#playback-panel` (`#playback-controls`, `#scrubber`, `#timeLabel`). `TimeScrubber.ts` drives `window.currentTime / isPlaying / maxTime` and lets the controls be dragged. |
| Viewport | `renderer.setSize(window.innerWidth, window.innerHeight)` and the canvas is appended to `<body>`. Picking uses `clientX / window.innerWidth` (`Scripts.ts:130`), which breaks once the canvas doesn't fill the window. |
| Weather | `OpenMateo.populateWeatherPanel()` writes a text table into `#weatherdata-panel .panel-body`. Wind data is shared through `src/js/wind/WindProfile.ts`. |
| Scene Objects | Placeholder text ("TODO: add current active jumpers and planes…"). |
| Speed Settings | Only *Plane speed* now. The belly/freefly speed inputs were removed (body positions drive fall rates), and `DevConsole.ts` reads inputs null-safely. |
| Camera follow | `Scripts.ts` has `followTarget`, `updateCameraFollow()` and a Following panel ("Stop following"). |
| Code that finds panels by id | `PlaneLoad` → `#plane-panel .plane-load-editor`; `OpenMateo` → `#weatherdata-panel .panel-body`; `PlaneLoad.updateRuntime` skips work while hidden (`offsetParent === null`). **These must keep working.** |

---

## 3. Goals / non-goals

**Goals**
- G1. A fixed editor layout: menubar, viewport, side dock (left or right), bottom panel, timeline.
- G2. Every tool panel is a tab, with its contents and element ids unchanged.
- G3. Tabs can be opened, closed, reordered, moved between docks, and stacked into two groups in the side dock.
- G4. Tabs can be **dragged out into floating windows** and **docked back** by dragging onto a tab strip.
- G5. The side dock and bottom panel can each be **resized** and **closed**. The viewport and camera follow at the right size and aspect ratio.
- G6. The dock side (left/right) is a **setting**, changeable at any time without a reload.
- G7. Playback lives in the bottom timeline bar with keyboard shortcuts.
- G8. **Weather** shows a camera-relative wind arrow and truncated speed for each forecast height, updating live as the camera moves.
- G9. **Scene Objects** lists the plane and jumpers. Selecting one shows its details and a **Zoom in** button that flies the main camera to it and follows it.
- G10. The layout and settings persist, and **Reset Layout** restores the defaults.

**Non-goals (v1)**
- Docking into both sides at once, more than two groups per dock, or floating windows outside the browser window.
- Restyling the content inside the other existing tabs (Location, Jump Settings, Speed Settings, Following, Plane Settings).
- Mobile layout: the mobile blocker already covers phones and tablets.

---

## 4. Layout

### 4.1 Structure (`index.html`)

```html
<body>
  <div id="mobile-blocker">…</div>                     <!-- unchanged -->
  <div id="menu">…</div>                               <!-- unchanged -->

  <div id="editor" data-dock-side="right">             <!-- CSS grid below the menubar -->
    <aside class="dock" id="dock-side"></aside>        <!-- side dock: tab groups -->
    <div class="dock-splitter" data-zone="side"></div>
    <main id="viewport">                               <!-- three.js canvas -->
      <!-- overlays: compass, notifications, #map-loader, #map-attribution, #info-tooltip -->
      <div id="float-layer"></div>                     <!-- floating windows live here -->
    </main>
    <div class="dock-splitter" data-zone="bottom"></div>
    <section class="dock" id="dock-bottom"></section>
    <footer id="timeline">…</footer>
  </div>

  <div id="dock-tab-store" hidden><!-- .dock-tab sections, see 4.3 --></div>
</body>
```

Grid (`src/css/editor.css`). The dock side swaps the column order with one attribute:

```css
#editor {
  position: fixed; inset: 32px 0 0 0;
  display: grid;
  --side-w: 340px;            /* 0px when the side dock is closed */
  --bottom-h: 220px;          /* 0px when the bottom panel is closed */
  grid-template-rows: 1fr 4px var(--bottom-h) 44px;
}
#editor[data-dock-side="right"] {
  grid-template-columns: 1fr 4px var(--side-w);
  grid-template-areas:
    "viewport vsplit side"
    "hsplit   hsplit side"
    "bottom   bottom side"
    "timeline timeline timeline";
}
#editor[data-dock-side="left"] {
  grid-template-columns: var(--side-w) 4px 1fr;
  grid-template-areas:
    "side vsplit viewport"
    "side hsplit hsplit"
    "side bottom bottom"
    "timeline timeline timeline";
}
```

### 4.2 Dock setting, resizing and closing

- **Dock side** is set in **View → Dock Side → Left / Right** (a radio pair) and stored in the layout (§5.6). Changing it only flips `data-dock-side`; the tabs, groups, sizes and floating windows stay as they are. Floating windows keep their position relative to the viewport, clamped inside it.
- **Resize:**
  - Drag the splitter between a dock and the viewport. The side dock goes from 240 px to 50% of the window width; the bottom panel from 120 px to 60% of the height.
  - Double-clicking a splitter resets its default size.
  - Splitters are 4 px, turn gold (`#ffd700`) on hover or drag, and can be moved with the arrow keys when focused.
- **Close and reopen:**
  - Each dock has a close button (**✕**) at the end of its tab strip. Closing collapses the zone to `0px` and hides its splitter, and the viewport takes the space.
  - Reopen from **Window → Side Dock** / **Window → Bottom Panel** (checkboxes), or with **Ctrl+B** / **Ctrl+J** (Cmd on Mac). Reopening restores the last size and tabs.
  - Opening a tab whose home zone is closed (from the Window menu, **+**, or a call like `dock.focus()`) reopens that zone first.
- **Narrow windows:** under 1100 px, the side dock starts closed on first load. After that the user's saved choice wins.

### 4.3 Panels become tabs

Each `.panel` becomes a tab section, and its **element and id stay the same**:

```html
<!-- before -->
<div class="panel" id="plane-panel">
  <div class="panel-header"><h2>Plane Settings</h2>…</div>
  <div class="panel-body">…</div>
</div>
<!-- after -->
<section class="dock-tab" id="plane-panel" data-tab-id="plane" data-tab-title="Plane Settings">
  <div class="panel-body">…</div>
</section>
```

- A tab's content element is re-parented into whichever group owns it, whether docked or floating. Only the active tab in a group is shown; the others get `hidden`. That keeps the `offsetParent` checks working.
- Tab ids: `location`, `jump-settings`, `weatherdata`, `objects`, `following`, `speed`, `plane`. These match the current `show-<id>` menu ids.
- `#playback-panel` is removed. Its controls move into `#timeline` with the **same ids** (§6).

### 4.4 Default layout

| Zone | Group | Tabs (in order), **active** in bold |
|---|---|---|
| Side (right) | 1 (top, 55%) | **Location**, Jump Settings, Speed Settings |
| Side (right) | 2 (bottom, 45%) | **Weather**, Scene Objects, Following |
| Bottom | – | **Plane Settings** |
| Floating | – | none |

---

## 5. Tabs, docking and floating

### 5.1 Tab strip

- Each tab shows its title and a **×**. The active tab has the panel background (`#2c2c2c`) and a 2 px gold top border. Inactive tabs use `#1e1e1e` with `#ccc` text.
- **Click** activates a tab. **Middle-click** or **×** closes it.
- A **+** at the end of the strip lists closed tabs; picking one opens it here.
- Tabs that overflow scroll horizontally, and a **⌄** menu lists every tab in the group.
- **Right-click** a tab: Close, Close Others, Float, Move to Side Dock, Move to Bottom Panel, Split Down (side dock with one group only).

### 5.2 Dragging tabs (pointer events, no library)

Once a drag passes a 5 px threshold, the tab follows the pointer as a ghost of its label. Drop zones are highlighted while hovered:

| Drop on | Result |
|---|---|
| A tab strip (docked or floating) | Insert at that position: reorder, move between groups or zones, or **dock a floating tab back**. |
| The lower half of a lone side-dock group | **Split** the side dock into two groups. |
| The viewport, away from any strip | **Float:** create a floating window at the drop point holding that tab. |
| `Esc` during the drag | Cancel. |

When a group's last tab leaves, the group is removed. A floating window closes when its last tab leaves, and a dock zone collapses when its last tab leaves (it reopens when a tab is dropped back).

### 5.3 Floating windows

```
┌──────────────────────────────────┐
│ Following │ Weather │        ⧉ × │  ← tab strip doubles as the title bar
├──────────────────────────────────┤
│  (active tab content, scrolls)   │
│                                ◢ │  ← resize grip (also edges/corners)
└──────────────────────────────────┘
```

- A floating window is a **group** positioned absolutely inside `#float-layer`, which covers the viewport and lets clicks through where there's no window.
- **Move:** drag empty space on the tab strip. **Resize:** drag the edges or corners (minimum 220×140 px). The window stays inside the viewport and is re-clamped when the viewport resizes or the dock side changes.
- **Multiple tabs:** drop more tabs onto a floating window's strip to group them, just like a docked group.
- **⧉ Dock** sends the whole window back to its tabs' last docked zone. Dragging a single tab out of it onto a dock strip docks just that tab.
- **×** closes the window's tabs; each can be reopened later from the Window menu.
- **Stacking:** clicking a window brings it to the front. The z-order is saved.
- Floating windows can be partly see-through (`--float-opacity`, default 0.97) so the scene stays visible. A **pin** option to keep them on top is out of scope for v1.
- The viewport's mouse handling ignores events that start inside a floating window; OrbitControls and picking are attached to the canvas only.

### 5.4 Public API (`window.dock`)

```ts
dock.open(tabId)               // show the tab where it last was (reopen its zone if closed)
dock.close(tabId)
dock.focus(tabId)              // open + activate + scroll into view
dock.float(tabId, rect?)       // pop the tab out into a floating window
dock.dock(tabId, zone?)        // send it back to a dock zone
dock.setSide("left" | "right")
dock.toggleZone("side" | "bottom", open?)
dock.reset()
```

For example, "Check out the Scene Objects tab!" and the "View Objects" notification actions call `dock.focus("objects")`.

### 5.5 Window and View menus

- **Window**
  - One checkbox per tab, built from the tab registry
  - ─
  - Side Dock (checkbox, Ctrl+B)
  - Bottom Panel (checkbox, Ctrl+J)
  - ─
  - Reset Layout
- **View** gains **Dock Side ▸ Left / Right**.
- Remove *Recenter / Minimize / Restore windows*.

### 5.6 Persistence

`localStorage["jumpersim.layout.v2"]`:

```json
{
  "version": 2,
  "dockSide": "right",
  "side":   { "size": 340, "open": true,
              "groups": [ { "tabs": ["location","jump-settings","speed"], "active": "location", "split": 0.55 },
                          { "tabs": ["weatherdata","objects","following"], "active": "weatherdata", "split": 0.45 } ] },
  "bottom": { "size": 220, "open": true, "tabs": ["plane"], "active": "plane" },
  "floating": [ { "tabs": ["following"], "active": "following", "x": 0.62, "y": 0.08, "w": 320, "h": 240, "z": 3 } ],
  "closed": [],
  "lastDocked": { "following": "side" }
}
```

- Floating `x`/`y` are fractions of the viewport so windows land sensibly on other screen sizes.
- Validate on load: unknown ids are dropped, new tabs go to their default slot, and a bad version or a parse error falls back to the defaults.
- On first run, delete the old per-panel cookies written by `Panel.ts`.

---

## 6. Timeline bar

```
⏮  ⏴  ▶  ⏵  ⏭ │ ━━━━━━━━━━━━━━━━━━━━━━━━━━━●━━━━━━━━━━━━━━━━━━━━━━━ │ 42.6 s / 250 s │ 1× ▾
```

- Same ids as today (`#start`, `#rewind`, `#playPause`, `#forward`, `#end`, `#scrubber`, `#timeLabel`). The scrubber fills the remaining width.
- Remove the drag-to-move code for `playbackControlsEl` in `TimeScrubber.ts`.
- **Keyboard** (ignored while typing in an input, select or textarea):
  - **Space**: play/pause
  - **← / →**: ±1 s (**Shift** for ±10 s)
  - **Home / End**: jump to start / end
- **Phase 7 (optional):**
  - Event markers on the scrubber: exits (`jumpTime`) white, track starts (`trackStartTime`) gold, landings (`landTime`) grey. Hovering a marker shows the jumper and event. Markers redraw after `onRecalculated()`.
  - A playback speed selector (0.5×, 1×, 2×, 4×).

---

## 7. Weather panel: camera-relative wind widget

The Weather tab keeps the forecast text table that `OpenMateo` fills, and adds a **wind widget above it**:

```
 Winds aloft · from camera view           ⟳ 12:00
 ┌──────────┬────┬────────┐
 │ 14,800 ft│ ↗  │ 35 kt  │
 │ 10,900 ft│ ↗  │ 26 kt  │
 │  7,400 ft│ ↑  │ 22 kt  │
 │  3,200 ft│ ←  │ 26 kt  │  ░ red tint: strong shear with the row below
 │  1,800 ft│ ↗  │ 10 kt  │
 │  1,100 ft│ →  │  9 kt  │
 │    350 ft│ →  │  7 kt  │
 └──────────┴────┴────────┘
```

- **Rows:** one per **forecast level** from `currentWindProfile()` (`src/js/wind/WindProfile.ts`), highest first. Heights are above the DZ, rounded to 100 ft. These are the same levels the wind tower labels. No interpolated rows: the forecast heights only, so the list stays short.
- **Arrow:** a small SVG arrow showing where the wind **blows to**, rotated **relative to the camera**. "Up" means away from the viewer, into the screen, so the arrows match what you see on the tower and terrain from the current viewpoint:
  - wind blows toward bearing `β = (fromDeg + 180) % 360`
  - camera heading `ψ = atan2(dir.x, −dir.z)` in degrees, from `camera.getWorldDirection(dir)` (world: +X east, −Z north; the same maths as the compass)
  - arrow rotation (CSS, clockwise) = `β − ψ`
- **Speed:** **truncated** knots, `Math.trunc(level.speedKt)`, with a "kt" unit. Arrow color uses the tower's speed ramp (blue → gold → orange).
- **Shear:** when a layer meets `STRONG_SHEAR_KT_PER_1000FT`, the boundary between the two rows gets a faint red tint and a tooltip with the shear value, matching the tower's red glow.
- **Updates:**
  - On camera change (an OrbitControls `change` listener, throttled to one update per animation frame) and on the `weather-updated` event.
  - Only the arrow rotations change per frame; rows are rebuilt only when the weather changes.
  - The widget does nothing while its tab is hidden (an `IntersectionObserver` or the `tab-shown`/`tab-hidden` events).
- **Empty state:** "No wind data yet" until a weather snapshot exists.
- The header shows the forecast time of the snapshot in use (`snapshot.time`). This also makes the "first hour vs current hour" question (see the wind tower notes) visible to the user.

File: `src/js/panels/WindWidget.ts`, mounted into `#weatherdata-panel` above `.panel-body`.

---

## 8. Scene Objects panel

```
┌ Scene Objects ───────────────────────────────────────┐
│ ▸ Plane  Twin Otter          In air · 12,999 ft      │
│ ● 1  Jumper 1   Wingsuit     Wingsuit flight         │  ← list (color swatch = jumper mesh color)
│ ● 2  Jumper 2   Belly        Tracking                │
│ ● 3  …                                               │
├──────────────────────────────────────────────────────┤
│ ● Jumper 2 · Belly · Track on                         │
│   Status      Tracking                                │
│   Altitude    4,320 ft                                │
│   Fall rate   96 mph                                  │
│   Ground spd  101 mph · heading 080°                  │
│   Weight      82 kg (+0)                              │
│   Exit        10.0 s · Lands 84.3 s                   │
│   Nearest     Jumper 3 · 412 ft                       │
│ [ Zoom in ]  [ Follow ]  [ Edit in Plane Settings ]   │
└──────────────────────────────────────────────────────┘
```

### 8.1 Object list

- Rows: the **plane**, then jumpers in load order.
  - Each row shows a color swatch (the jumper mesh's material color), number, name (or "Jumper N"), body position, and live status. Status uses the same rules as Plane Settings; reuse `PlaneLoad.statusFor`, moved into a shared helper.
  - The plane row shows the aircraft type and its state (in air / altitude).
- **Click** selects the object and shows its details below. **Double-click** zooms in (§8.4).
- Selection stays in sync with the viewport: clicking a jumper in the 3D view (existing hover/pick code) selects it here, and selecting it here highlights it in the scene (outline or slightly larger emissive).
- Rebuild rows when the jumper set changes (formation import, Plane Settings Save). Update status text every frame only while the tab is visible.

### 8.2 No 3D preview

The low-poly model canvas from rev 2 is dropped. The details header shows the jumper's color swatch, name, body position and track setting instead. **Zoom in** (§8.4) is the way to see the jumper in 3D.

### 8.3 Details

- **Jumper:** name, body position, track on/off, status, altitude (ft above DZ), fall rate (mph), ground speed and heading, weight (+ extra), exit time, track-start time, landing time, and **nearest jumper** with separation distance at the current time.
  - Live values come from `j.track.getInterpolatedSample(t)`.
  - Nearest neighbour is a simple O(n) loop over the other jumpers' samples at the same time.
- **Plane:** type, speed (kt), heading, altitude, jumpers still on board.
- **Edit in Plane Settings** focuses the Plane Settings tab and scrolls to and highlights that jumper's row.

### 8.4 Zoom in / Follow

- **Zoom in:**
  - Smoothly moves the main camera (about 1.2 s, ease-in-out) to a framing offset from the object.
  - The offset is about 25 m behind and 10 m above a jumper, along its horizontal velocity, or 80 m back for the plane.
  - When the move finishes, **follow** starts. This reuses `followTarget` / `updateCameraFollow()` in `Scripts.ts`, and the Following tab shows the target.
- **Follow** starts following without the fly-in.
- Any manual orbit or zoom by the user stops the fly-in, matching today's `isUserControllingCamera` behaviour.
- Expose `window.cameraFocus(object3D, { follow: boolean })` from `Scripts.ts` so the panel doesn't reach into the module's internals.

File: `src/js/panels/SceneObjects.ts`.

---

## 9. Viewport changes (`Scripts.ts`)

Required before any docking work:

1. Append `renderer.domElement` to `#viewport`.
2. Replace the window resize handler with a `ResizeObserver` on `#viewport` that sets the renderer size, camera aspect and `mapScene.onResize()`. Coalesce resizes to one per animation frame.
3. Work out picking coordinates from the canvas rectangle, not the window:
   ```ts
   const r = renderer.domElement.getBoundingClientRect();
   mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1;
   mouse.y = -((e.clientY - r.top) / r.height) * 2 + 1;
   ```
4. Ignore pointer events that start in `#float-layer` windows.
5. Move the overlays (compass, notifications, `#map-loader`, `#map-attribution`, `#info-tooltip`) inside `#viewport` with `position: absolute`.
6. Add `window.cameraFocus()` (§8.4) and selection highlighting hooks (`setSelected(object)`).

---

## 10. Code structure

| File | Role |
|---|---|
| `src/js/editor/DockLayout.ts` | **New.** Pure layout model: zones (`side`, `bottom`), floating groups, tabs, active tab, sizes, open/closed, dock side. `open/close/focus/move/float/dock/split/resize/setSide`, `toJSON/fromJSON/defaults`. No DOM, so it can be unit-tested. |
| `src/js/editor/DockView.ts` | **New.** Renders the model (tab strips, groups, splitters, floating windows), handles pointer events for dragging, resizing and floating, and re-parents `.dock-tab` elements. Emits `tab-shown` / `tab-hidden`. |
| `src/js/editor/Dock.ts` | **New.** Facade (`window.dock`), persistence, menu wiring, shortcuts (Ctrl+B / Ctrl+J). |
| `src/js/editor/Timeline.ts` | **New.** Playback keyboard shortcuts, optional markers and speed selector. |
| `src/js/panels/WindWidget.ts` | **New.** Camera-relative wind rows (§7). |
| `src/js/panels/SceneObjects.ts` | **New.** Object list, details, zoom/follow (§8). |
| `src/js/panels/jumperStatus.ts` | **New.** Shared status/telemetry helpers, moved out of `PlaneLoad.ts`. |
| `src/css/editor.css` | **New.** Grid, docks, tab strips, splitters, floating windows, timeline, widget and list styles. Existing palette: `#1e1e1e`, `#2c2c2c`, `#444`, `#ccc`, `#ffd700`. |
| `src/js/Menubar.ts` | Window and View menus per §5.5. |
| `src/js/TimeScrubber.ts` | Remove dragging. |
| `src/js/Scripts.ts` | §9. |
| `index.html` | §4 structure; panels → `.dock-tab`; playback → `#timeline`. |
| **Delete** | `src/js/classes/Panel.ts`, `PanelManager.ts`, `src/css/minimized-windows.css`, the `.panel` window rules in `devconsole.css`, `#minimized-bar`. |

**Accessibility:**
- Tab strips use `role="tablist"`, tabs `role="tab"` with `aria-selected` and `aria-controls`, and contents `role="tabpanel"`.
- Arrow keys move between tabs and **Delete** closes the focused tab.
- Splitters are `role="separator"` and can be moved with the keyboard.
- Floating windows are `role="dialog"` with `aria-modal="false"` and are labelled by their active tab.

---

## 11. Implementation plan

Each phase leaves the app working.

1. **Viewport (§9.1–9.5):** canvas in `#viewport`, ResizeObserver, rectangle-based picking, overlays moved. Old windows still float on top.
2. **Grid shell + timeline (§6):** remove `#playback-panel` and its drag code.
3. **Static docks:** `DockLayout` + `DockView` with the default layout, panels → `.dock-tab`, delete `Panel.ts` / `PanelManager.ts` / `#minimized-bar`.
4. **Open/close, Window and View menus, dock side setting, persistence, Reset Layout.**
5. **Resize and close for both docks;** drag and drop (reorder, move, split); **floating windows** (float, move, resize, re-dock, z-order).
6. **Weather wind widget (§7)** and **Scene Objects (§8)**: list, details, Zoom in / Follow, selection sync.
7. **Polish:** timeline markers, speed selector, overflow menus, keyboard navigation.

## 12. Acceptance criteria

**Layout and docking**
- [ ] On first load the layout matches §4.4, with the dock on the right.
- [ ] **View → Dock Side → Left** moves the dock to the left with no reload. Tabs, sizes and floating windows are kept, and the setting survives a reload.
- [ ] Both docks resize by dragging (within their limits) and close with ✕, Window menu or shortcut. Reopening restores the previous size and tabs. The 3D view never stretches.
- [ ] A tab dragged onto the viewport becomes a floating window there. It can be moved, resized, given more tabs, brought to the front, and docked back by dragging a tab onto a dock strip or with ⧉. Positions are restored after a reload and kept inside the viewport after resizing the window.
- [ ] Closing and reopening any tab keeps its contents and form values.

**Viewport**
- [ ] Jumprun click-to-align and hover picking land under the cursor with the dock on either side, at three different dock widths, and with a floating window open.

**Playback**
- [ ] Space, ←/→, Shift+←/→ and Home/End control playback, but not while typing.

**Weather**
- [ ] One row per forecast level with truncated knots. Orbiting the camera 90° clockwise rotates every arrow 90° counter-clockwise.
- [ ] An arrow pointing "up" in the widget matches the wind tower's arrow pointing away from the camera at the same height.
- [ ] Rows with strong shear between them show the red tint.

**Scene Objects**
- [ ] Lists the plane and every jumper with live status.
- [ ] Selecting a jumper shows its details, updating live while the tab is visible and not at all while hidden.
- [ ] **Zoom in** flies the camera to the selected jumper and follows it, and manual orbiting cancels it. Selecting in the 3D view selects the row, and the reverse.

**Other panels**
- [ ] Plane Settings in the bottom panel shows all 12 columns at 1440 px. `OpenMateo` still fills `#weatherdata-panel .panel-body`.

**Accessibility and performance**
- [ ] Keyboard-only: reach a tab strip, switch tabs, close a tab, move a splitter.
- [ ] With Weather and Scene Objects both visible, the main view stays at 50 fps or more on the reference laptop.

## 13. Open questions

1. **Speed Settings tab:** it now holds only *Plane speed*. Fold that into Jump Settings and remove the tab, or keep it as its own tab for future speed settings?
