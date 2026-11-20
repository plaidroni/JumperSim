# Spec: Live Weather, Volumetric Clouds, Rain & Visibility

**Status:** Draft for implementation
**Scope:** new files under `src/js/weather/` and `src/js/visuals/weather/`, replacing `src/apidata/OpenMateo.ts`. Changes to:
- `src/js/wind/WindProfile.ts` and `src/js/panels/WindWidget.ts`
- `src/js/Scripts.ts` (render loop, picking) and `src/js/LocationSelect.ts`
- the objects that must stay visible above clouds: `src/js/terrain/MapScene.ts`, `src/js/wind/WindTower.ts`, `src/js/ui/TrajectoryLines.ts`, `src/js/visuals/Markers.ts`, `src/js/dropzone/PlanOverlays.ts`, `src/js/dropzone/PlannerView.ts`
- `index.html` and a new `src/css/weather.css`

**Related:** `world-scale.md` (scene units are metres × 5.8), `editor-layout.md` §7 (Weather tab), `map-terrain-buildings.md` §6 (fog and lights), `dropzone-planner.md` (top-down view)
**API checked against:** the Open-Meteo docs, plus live requests on 2026-11-20 UTC (§4.6 lists what was confirmed by testing).

---

## 1. Summary

Four pieces. Each can ship on its own.

1. **Fresh weather.** The sim currently flies the forecast for 00:00 UTC. In Pacific time that is 4 PM the previous day, and it only changes when the UTC date changes, at 4 PM (§2.1). The fix uses Open-Meteo's `current` block: the current 15-minute step, including the winds aloft. Times are shown in the DZ's time zone, and the data refreshes every 15 minutes.
2. **All the cloud, precipitation and visibility data.** It goes into one typed weather state that the physics, the Weather tab and the renderer all share. The Weather tab shows all of it.
3. **Volumetric clouds**, one raymarched layer per cloud band (fog, low, mid, high):
   - the share of sky covered matches the forecast cover %;
   - base and top come from the humidity profile, and the shape fits the cloud type;
   - each layer drifts with the wind at its height, on the sim clock.
4. **Rain, darkening and visibility.**
   - Rain or snow particles around the camera, and rain shafts under raining clouds.
   - The map darkens with rain intensity.
   - Haze is set from the reported visibility, and the Weather tab compares it with the FAA parachute minimums.
   - Every visual has its own toggle.

**Key design decision: a small custom render pipeline, not a library.** The pipeline renders the scene, then the clouds and haze, then the overlays:
- clouds need the scene's depth, so terrain and jumpers sit correctly in and behind them;
- planning overlays (zones, trajectories, labels) must stay readable above the clouds.

Appendix A explains why `@takram/three-clouds` doesn't fit.

---

## 2. Current state

| Area | What the code does today |
|---|---|
| Fetch | `OpenMateo.ts` calls `fetchWeatherApi` once per DZ selection (`LocationSelect.ts:84-85`).<br>Hourly: temperature, 10 m wind, wind at 1000–500 hPa, `visibility`, `cloud_cover_low/mid/high`. Current: total cloud cover, weather code, 10 m wind. Daily: weather code.<br>Units are mph and °F. No `timezone` is set. |
| Snapshot | Strings ("12 mph", "220°") in `window.weatherSnapshotLog`. `currentWindProfile()` parses `weatherSnapshotLog[0]` (`WindProfile.ts:131`). Level heights come from the standard atmosphere (ISA). |
| Consumers | Physics (`SimEntities.ts:217`), the wind tower, the wind widget, and the planner HUD and patterns. **Cloud cover, visibility and the weather code are fetched but never shown or used.** |
| Weather tab | Only the "Winds aloft" widget (`WindWidget.ts`), with the snapshot time in its header. |
| Sky | A fixed dark gradient (`Scripts.ts:92-117`) and `scene.fog` from 15 to 60 km (× `WORLD_SCALE`, `MapScene.ts:574`), which hides the terrain's level-of-detail edge at the horizon. No clouds or precipitation. |
| Render | `renderer.render(scene, camera)` straight to the canvas (`Scripts.ts:951`). Logarithmic depth buffer, no MSAA. The planner renders with its own orthographic camera. |

### 2.1 Why the data is from yesterday and changes at 4 PM

- **B1. No time zone.** `declareParams()` doesn't set `timezone`, so Open-Meteo uses GMT. The hourly series starts at 00:00 UTC on the current UTC date.
- **B2. The sim reads the first hour.** `currentWindProfile()` uses `weatherSnapshotLog[0]`, which is 00:00 UTC. In Pacific Standard Time (UTC−8) that is 4 PM the previous day, and the UTC date rolls over at 4 PM PST (5 PM PDT).
  - Before 4 PM, the sim flies yesterday's 4 PM forecast.
  - After 4 PM, it flies today's 4 PM forecast.
  - So the data is always 0–24 h old. The wind widget's header shows the same hour.
- **B3. Wrong loop bound.** The snapshot loop runs `daily.time.length` times (7 days), so the log only ever holds hours 00–06 UTC. `window.currentWeatherData` ends up as 06:00 UTC (10 PM PST the previous day), which is a different hour from the one the physics uses (`OpenMateo.ts:200-239`).
- **B4. Time labels.** Times add `utcOffsetSeconds` to a UTC epoch and are then formatted in the browser's time zone (`OpenMateo.ts:131, 139-152`). Once a time zone is set, that shifts the time twice. It also never shows the DZ's local time.
- **B5. Never refreshed, no ordering.** There is one fetch per DZ selection, so a tab left open keeps old data. Two quick DZ switches can let the older response arrive last and win.

---

## 3. Goals / non-goals

**Goals**
- G1. The physics, wind tower, panel and 3D view all use the same **current 15-minute step**. It is labelled in the DZ's local time and refreshes every 15 minutes while the app is visible.
- G2. Fetch every cloud-relevant variable:
  - cloud cover: total, low, mid, high, and per pressure level;
  - per pressure level: humidity, temperature and geopotential height;
  - precipitation by type, and its probability;
  - weather code, visibility, freezing level, CAPE / lifted index / CIN, boundary-layer height, dew point.
- G3. Volumetric clouds for each layer present. They cover the forecast share of the sky, sit at the forecast heights, and are shaped for the cloud type.
- G4. Clouds drift downwind with their layer's wind on the sim clock, so scrubbing back puts them back.
- G5. Rain or snow particles around the camera, rain shafts under raining clouds, and the map darkening with rain intensity.
- G6. Haze that matches the reported visibility. Visibility and cloud clearances are shown in the panel against the FAA parachute minimums.
- G7. Every new visual has a toggle (each layer, shadows, rain, darkening, haze). Toggles are remembered, and anything switched off costs nothing.
- G8. ≥ 50 fps at 1080p on the reference laptop with clouds at Medium. When there's nothing to draw, the frame time and the image are the same as today.

**Non-goals**
- Real cloud positions. Open-Meteo gives the cover for a grid cell, not where each cloud is. The clouds are synthetic but match the forecast's amount, height and type (§4.4).
- Clouds affecting the physics (turbulence, lift).
- Lighting from the real sun position, and night rendering.
- A forecast-hour picker.
- Warnings when a jumper's track passes through cloud. That is future work; §5.2 keeps a CPU copy of the cloud cover so it stays possible.
- Lightning, hail, wet-ground effects.

---

## 4. Weather data

### 4.1 Request

One request per refresh to `https://api.open-meteo.com/v1/forecast`, through the `openmeteo` SDK (flatbuffers), as today.
- The variable lists are `as const` arrays (Appendix B).
- Each value is read back by its variable's position in its list (`NOW_VARS.indexOf(name)`).
- Today's hand-numbered indices (`hourly.variables(23)`) silently break when a variable is added.

| Parameter | Value | Why |
|---|---|---|
| `timezone` | `auto` | DZ-local day boundaries and labels (fixes B1). |
| `current` | `NOW_VARS`: 25 surface variables + 6 per pressure level × 14 levels = 109 | Values for the current 15-minute step. Confirmed by testing: `current` accepts the pressure-level winds, cloud cover, humidity, temperature and geopotential height. |
| `minutely_15` | `precipitation, rain, showers, snowfall, visibility, weather_code, cloud_cover, freezing_level_height` | Short-term trend for precipitation and visibility. |
| `past_minutely_15` / `forecast_minutely_15` | `4` / `8` | 1 h back to 1 h 45 ahead (12 steps). |
| `hourly` | `cloud_cover, cloud_cover_low, cloud_cover_mid, cloud_cover_high, precipitation, precipitation_probability, visibility, weather_code, wind_speed_10m, wind_gusts_10m` | The "Next hours" strip. |
| `past_hours` / `forecast_hours` | `1` / `12` | Starts one hour before the current hour (confirmed by testing). |
| `wind_speed_unit` | `ms` | Physics units. The display converts to kt. |
| `temperature_unit` / `precipitation_unit` | `celsius` / `mm` | The display converts to °F and in. |
| `models` | not set (best match) | Regional models change, so don't pin one. North America uses NOAA RRFS, and Open-Meteo lists HRRR as discontinued from 2026-11-30. |

**Pressure levels:** `1000, 975, 950, 925, 900, 850, 800, 700, 600, 500` are today's wind levels. `400, 300, 250, 200` are added for mid and high cloud heights and their winds.

**Cost:**
- The URL is about 2.7 kB. The JSON response is about 8 kB (smaller as flatbuffers) and comes back in under 1 s.
- Open-Meteo counts large requests as fractional calls (15 variables = 1.5 calls). This request is about 13 calls, so a tab open all day uses about 1,200.
- The free tier allows 10,000 per day, 5,000 per hour and 600 per minute, per IP. See §11 Q4.

### 4.2 Freshness and refresh

**Times.** Every time is a UTC epoch in ms.
- Display uses `Intl.DateTimeFormat(undefined, { timeZone: response.timezone(), hour: "numeric", minute: "2-digit", timeZoneName: "short" })` (fixes B4).
- The tooltip adds the user's own time and UTC.
- Don't display `timezone_abbreviation`; the API returns "GMT-8" rather than "PST".

**"Now" is the `current` block.** Its `time` is the start of the current 15-minute step: at 03:17 UTC the API returned 03:15 with `interval: 900`. Series are only for trends and are looked up by time, never by array position (fixes B2 and B3).

**Refresh schedule** (`WeatherService`):
- fetch when a DZ is selected;
- refetch 90 s ± 30 s after the next 15-minute step starts. The delay lets the API roll over, and the jitter spreads clients out;
- also refetch when the tab becomes visible with data from an older step, on the `online` event, and on the panel's ⟳ button;
- never fetch while the tab is hidden.

**Failures.**
- Keep the last good state, and retry after 1, 2, 5 and 10 min, then every 15 min.
- After 30 min without fresh data, the status shows **Stale** (amber).
- Show one error toast per failure streak, and one toast when the data is back.

**Ordering.** Each fetch carries `{ requestId, dzKey }`. A response is dropped if a newer request, or a different DZ, started after it (fixes B5).

**Hold.** A panel toggle stops automatic refreshes, so a session can be analysed against fixed weather. Manual ⟳ still works. Hold isn't saved across reloads.

**Recalculation.** When new data arrives, compare its jump wind levels with the profile in use.
- If any level's vector changed by ≥ 0.5 m/s (1 kt):
  - swap in the new winds and call `handleForeignRecalculation()`;
  - if playback is running or a planner drag is in progress, wait until it pauses or ends.
- Otherwise:
  - keep the old winds, so the wind tower still shows exactly the wind the jumpers were computed with;
  - update everything else (clouds, precipitation, visibility, panel).
- The wind widget's header shows the winds' own valid time.

**Toasts** only for:
- the first load of a DZ;
- a manual refresh;
- a failure, and the recovery after it.

Automatic refreshes are silent; the status line says "Updated just now".

**Model age (optional).**
- Open-Meteo's metadata endpoint `https://api.open-meteo.com/data/{model}/static/meta.json` is free and not counted against the limits.
- It returns `last_run_initialisation_time`, `last_run_availability_time` and `update_interval_seconds`.
- Checked on 2026-11-20: HRRR's 01Z run reached the API at 02:32Z (hourly runs); GFS 0.13°'s 18Z run reached it at 23:24Z (6-hourly).
- Best match blends models, so show this only as a tooltip, e.g. "Newest US run 01Z, on the API at 02:32Z".

### 4.3 Weather state

`src/js/weather/WeatherState.ts` holds SI numbers, with `NaN` wherever the model has no value.

```ts
export interface WeatherLevel {
  hpa: number;
  mslM: number;            // geopotential_height_{L}hPa (ISA if missing)
  aglM: number;            // mslM − elevationM
  windMs: number; windFromDeg: number;
  tempC: number; rhPct: number; cloudPct: number;
}

export type PrecipKind = "none" | "drizzle" | "rain" | "showers" | "snow" | "thunderstorm";
export type CloudBand = "fog" | "low" | "mid" | "high";
export type CloudType = "fog" | "stratus" | "stratocumulus" | "cumulus" | "cumulonimbus"
  | "altocumulus" | "altostratus" | "nimbostratus" | "cirrus" | "cirrostratus";

export interface CloudLayer {
  band: CloudBand; type: CloudType;
  coverPct: number;
  baseAglM: number; topAglM: number;
  drift: THREE.Vector3;    // downwind m/s at mid-layer, +X east / −Z north
  precipitating: boolean;
}

export interface WeatherState {
  dz: { name: string; lat: number; lon: number };
  validTime: number; fetchedAt: number;           // epoch ms
  timezone: string;                               // IANA, e.g. "America/Los_Angeles"
  elevationM: number;                             // forecast cell elevation (as today)
  surface: {
    tempC: number; dewPointC: number; rhPct: number;
    windMs: number; windFromDeg: number; gustMs: number;
    pressureMslHpa: number; surfacePressureHpa: number; isDay: boolean; weatherCode: number;
    capeJkg: number; liftedIndex: number; cinJkg: number;
    boundaryLayerM: number; freezingLevelMslM: number;
  };
  clouds: { totalPct: number; lowPct: number; midPct: number; highPct: number;
            layers: CloudLayer[]; ceilingAglM: number | null };
  precip: { mmPerH: number; rainMmPerH: number; showersMmPerH: number; snowCmPerH: number;
            probabilityPct: number; kind: PrecipKind; intensity: number };   // §4.5
  visibilityM: number;
  levels: WeatherLevel[];                          // valid levels, bottom to top
  trend15: { time: number[]; precipMmPerH: number[]; visibilityM: number[];
             cloudPct: number[]; weatherCode: number[] };
  trendHourly: { time: number[]; lowPct: number[]; midPct: number[]; highPct: number[];
                 precipProbabilityPct: number[]; visibilityM: number[]; weatherCode: number[] };
}
```

**Store.** `weatherStore.get()` and `weatherStore.onChange(fn)` live in `WeatherService.ts`. The existing `weather-updated` window event still fires for the wind tower, wind widget and planner.

**Valid levels.** A level is valid when its wind, humidity and height are finite and it sits above the ground (lower pressure than `surface_pressure`, and ≥ 10 m AGL). Models with fewer levels return `null` for the rest: at Skydive Voss, 975, 950, 900 and 800 hPa were all `null`.

**Wind profile.** `buildWindProfile(state)` takes each level's height from its geopotential height, falling back to the ISA height only when that is missing.
- The physics and the wind widget keep today's 1000–500 hPa levels (`JUMP_LEVELS_HPA`).
- **The 10 m surface wind joins the jump profile** as its lowest level, at 10 m AGL, labelled `"10m"`, from `wind_speed_10m` / `wind_direction_10m`.
  - Today the lowest level is the first pressure level above the ground, e.g. ~110 m AGL at Perris (950 hPa). Everything below it gets that wind, so canopy patterns and landings use a wind that is too strong and often from the wrong direction.
  - With the 10 m level, `windAtHeight()` interpolates between 10 m and the first pressure level, and holds the 10 m wind below 10 m.
  - The planner's landing wind (mean 0–250 ft), canopy guidance and the landing check all pick it up through the profile with no other change.
  - The wind widget shows a "Surface (10 m)" row with the gust (e.g. "8 kt G14"), and the wind tower draws a labelled arrow at 10 m.
  - Gusts are display-only; the physics uses the mean 10 m wind.
  - The surface level is left out of shear warnings. Wind always picks up quickly in the first ~100 m, so it would flag nearly every day.
  - The recalculation check (§4.2) includes the 10 m level.
- Clouds use `cloudWindAt(heightM)` over all levels, so cirrus moves with the jet-level winds.
- Each level's temperature appears in its winds-aloft row's tooltip.

**Compatibility.**
- For one release, keep `window.weatherSnapshotLog = [snapshot]`, built from the state in the old string format (`GlobalVars.ts` points a contributor at it).
- Remove `window.currentWeatherData`.

### 4.4 Cloud layers from the profile

`src/js/weather/CloudLayers.ts` is pure and unit-tested.

**Inputs:**
- `cloud_cover_low/mid/high` say how much cloud each band has;
- the level profile says where it is;
- surface temperature and dew point, CAPE, lifted index, weather code, precipitation and visibility decide the type.

**Why humidity, not per-level cover.** The per-level `cloud_cover_{L}hPa` is a Sundqvist estimate from humidity, and it often reads about 0 even under real cloud.
- On 2026-11-20 at Skydive New England, mid cover was 45% and high 41%, yet every level's cloud cover was ≤ 3%.
- The humidity peaks marked where those layers were: 72% at 400 hPa, and 52–58% at 300–250 hPa.

**Bands.** These are Open-Meteo's definitions, in metres MSL: low up to 3,000; mid 3,000–8,000; high above 8,000. At a high DZ, the low band always extends at least 1,500 m above the ground.

For each band with cover ≥ 2%:

1. **Peak level.** Among the valid levels in the band, take the one with the highest `cloudPct`. If they are all 0, take the highest humidity.
2. **Extent.** Walk down and up from the peak while humidity stays within 10 points of the peak, without leaving the band. Base and top are interpolated where the humidity crosses that threshold.
3. **Thickness limits:**

   | Band | Min | Max | Used when no level helps |
   |---|---|---|---|
   | low | 300 m | 2,500 m. When convective, up to the highest level with RH ≥ 70% (≤ 12 km). | LCL to LCL + 800 m |
   | mid | 400 m | 3,000 m | 4,000–5,500 m MSL |
   | high | 600 m | 3,000 m | 9,000–10,500 m MSL |

4. **Low base.** Estimate the condensation level from the dew-point spread: `LCL ≈ 125 m × (T − Td)` AGL. Use the LCL when the layer is convective or has no humidity signal; otherwise use the humidity-derived base. The base is never below 60 m.
5. **Fog.** Weather code 45/48, or visibility under 1,000 m with RH₂ₘ ≥ 95%, adds a `fog` layer. It runs from the ground to clamp(boundary-layer height, 100 m, 300 m), with cover 100% for codes 45/48 and 60% otherwise.
6. **Merge.** Low and mid layers less than 300 m apart become one deep layer (nimbostratus in steady rain).
7. **Type:**

   | Band | Rule | Type |
   |---|---|---|
   | low | code 95–99, or CAPE ≥ 1,000 J/kg with showers | cumulonimbus |
   | low | showers (codes 80–86), or CAPE ≥ 100 J/kg with lifted index < 0 | cumulus |
   | low | cover ≥ 70% and base < 600 m AGL | stratus |
   | low | otherwise | stratocumulus |
   | mid | steady rain (61–65) with mid ≥ 80%, merged with low | nimbostratus |
   | mid | cover ≥ 60%, else < 60% | altostratus, else altocumulus |
   | high | cover ≥ 50%, else < 50% | cirrostratus, else cirrus |

8. **Drift.** `cloudWindAt((base + top) / 2)`.
9. **Precipitating.** The lowest layer whose type can rain, whenever the precipitation kind isn't `none`.
10. **Ceiling and oktas.** Oktas = round(cover / 12.5): 1–2 is FEW, 3–4 SCT, 5–7 BKN, 8 OVC. The ceiling is the base of the lowest BKN or OVC layer.

**Inconsistent inputs.** Best match takes variables from different models, so the numbers don't always agree. At Skydive Voss, total cover was 2% but low cover was 20%. Layers are drawn as given, and the panel shows the total as reported.

### 4.5 Precipitation and visibility

**Rate:** `mm/h = current.precipitation × 3600 / current.interval`. In phase 1, check it against the `minutely_15` value for the same step.

**Kind**, from the weather code first, then the amounts:

| Codes | Kind |
|---|---|
| 51–57 | drizzle |
| 61–67 | rain (freezing variants drawn as rain) |
| 71–77, 85–86, or `snowfall` > 0 | snow |
| 80–82 | showers |
| 95–99 | thunderstorm |

**Intensity, 0 to 1.**
- Rain is piecewise linear on mm/h: 0.1 → 0.1, 2.5 → 0.4, 7.6 → 0.75, ≥ 25 → 1. The breakpoints are the light/moderate and moderate/heavy limits.
- Drizzle is capped at 0.3.
- Snow uses `snowfall` in cm/h: 0.5 → 0.3, 2 → 0.7, 5 → 1.

**Visibility** is the model's surface visibility in metres. It is shown in statute miles (km in the tooltip) and stands in for flight visibility in §6.8, with a note saying so.

### 4.6 Confirmed by testing against the live API (2026-11-20, 03:15 UTC step)

- Pressure-level variables work in `current`. `cloud_cover_850hPa`, `wind_speed_850hPa` and `geopotential_height_850hPa` all returned values, with `interval: 900`.
- At 03:17 UTC, `past_hours=1&forecast_hours=3` returned 02:00–05:00, and `past_minutely_15=4&forecast_minutely_15=8` returned 02:15–05:00.
- `minutely_15` accepts `cloud_cover`.
- These are valid hourly and current names: `lifted_index`, `convective_inhibition`, `boundary_layer_height`, `freezing_level_height`, `cape`, `is_day`, `precipitation_probability`.
- `freezing_level_height` is `null` when the 0 °C level is below the ground (Voss at −9 °C).
- The full request in Appendix B returns HTTP 200 with no nulls at Perris.
- No variable gives the cloud base, which is why §4.4 derives it.

---

## 5. Rendering

### 5.1 Pipeline

`src/js/visuals/weather/WeatherRenderer.ts` replaces the `renderer.render(...)` call in `renderFrame()` (`Scripts.ts`). While the planner is active, the scene renders straight to the canvas as it does now.

```
P1  scene pass      camera.layers = ENV (0)          → sceneRT (RGBA16F colour + DepthTexture)
P2  depth           log depth → linear metres         → depthRT (R32F, full) + depthHalf (R32F, ½)
P3  clouds          raymarch layers + rain shafts     → cloudRT (RGBA16F at the quality scale)
P4  composite       shadows · darkening · haze · clouds, blended onto sceneRT colour
P5  overlay pass    camera.layers = OVERLAY (1)       → sceneRT (depth-tested against P1)
P6  output          linear → sRGB                     → canvas
```

**No feedback loops.** P4 writes into `sceneRT` with premultiplied "over" blending (`ONE, ONE_MINUS_SRC_ALPHA`).
- It samples only `cloudRT` and `depthRT`, never `sceneRT`'s own colour or depth.
- Darkening and shadows scale the destination through the blend alpha: `1 − a = T_cloud · T_haze · (1 − D) · shadow`.

**Log depth.** With `logarithmicDepthBuffer`, three.js writes `depth = log2(1 + w) / log2(far + 1)`.
- P2 inverts it, `w = 2^(depth · log2(far + 1)) − 1`, then rebuilds the view-space position and divides by `WORLD_SCALE` to get metres.
- A depth of 1.0 is sky.

**Overlay layer.** `LAYER_OVERLAY = 1` holds what must stay readable above clouds and must not be darkened:
- plan overlays, and the planner's handles and preview;
- trajectory lines and their stats sprite;
- markers, the selection box, the grid, and the height axis with its wind tower;
- rain particles (§5.4).

How the layer is applied:
- A `setOverlayLayer(obj)` helper sets the layer on an object and all its children. three.js doesn't pass layers down to children, so call it after every (re)build, e.g. after `WindTower.rebuild` and `PlanOverlays.rebuild`.
- Every camera (main, planner) enables both layers, so a direct render draws everything. Only P1 and P5 narrow the camera to one layer, and they restore it afterwards.
- Lights enable both layers; three.js filters lights by layer too.
- The picking raycaster (`pickAt`, `Scripts.ts:372`) enables layer 1, so markers stay clickable.
- P5 runs with `scene.background = null` and `autoClear = false`.

**Fog.** While the pipeline runs, `scene.fog` is set to null for P1 and P5 and restored afterwards. P4's haze includes today's 15–60 km horizon fade, so the terrain's level-of-detail edge stays hidden.

**Output.** P6 applies `renderer.outputColorSpace`, as a render to the canvas does today. With every effect at zero, the output must match a direct render to within 2/255 (A9).

**Bypass.** When nothing weather-related would show, render straight to the canvas as today. That means no cloud layer drawn, no precipitation, no darkening, and haze off or visibility ≥ 24 km.

### 5.2 Volumetric clouds

The method follows Schneider's Horizon Zero Dawn and Nubis talks (2015, 2017):
- density = coverage map × vertical profile × eroded 3D noise;
- lighting with Beer–Lambert transmittance and a Henyey–Greenstein phase function;
- all the maths in metres, in the flat local frame (camera position ÷ `WORLD_SCALE`).

**Layers.** Up to 4 slabs (fog, low, mid, high), passed as uniform arrays: base, top, coverage threshold, density, type parameters and drift offset.
- Each ray is clipped to each slab and to the scene depth, and only those spans are marched, front to back.
- The march stops once transmittance falls below 0.01.
- Rays outside every slab cost nothing.

**Steps.**
- About 200 m where the 2D coverage is 0, and about layer thickness / 24 inside cloud.
- Steps grow with distance (at least 2% of it) to cap the cost of grazing rays.
- The march ends at 40 km and fades out over the last 10 km.

**Coverage map.** A tileable 512² RGBA8 texture, generated once on the CPU in a Web Worker and seeded from the DZ name.
- R: low cells (24 km tile). G: mid patches (48 km). B: high streaks (96 km, stretched 4:1 along the layer's drift). A: fog patches.
- Each layer samples its channel twice, at different scales and rotations, to hide the repetition.

**Cover matches the forecast.** A 256-bin histogram of each channel gives the threshold `t(c)` at which the share of texels above it equals the cover fraction `c`.
- Coverage = `smoothstep(t − w, t + w, map)`.
- Measured top-down, the clouded area is within ±5 points of the forecast cover (A4).
- Rain cells are the densest 30% of the raining layer's coverage: a higher threshold on the same channel.
- The CPU keeps its copy of the map and thresholds. `coverageAt(layer, x, z, t)` feeds the planner layer (§5.7) and future cloud-penetration checks.

**Shape noise.**
- 128³ RGBA8 Perlin–Worley noise (64³ on Low), plus 32³ Worley detail noise for erosion.
- Generated once on the GPU into a `WebGL3DRenderTarget`, one draw per slice. The fallback is 64³ on the CPU.
- Interleaved gradient noise in the shader jitters the steps, so no blue-noise texture is needed.

**Type parameters** (`CloudTypes.ts`):

| Type | Look | Vertical profile | Feature size | Relative density |
|---|---|---|---|---|
| fog | flat, thins upward | fades to the top | 400 m | 0.6 |
| stratus | even sheet, ragged base | flat | 1.5 km | 0.5 |
| stratocumulus | lumpy sheet with gaps | rounded top | 1.2 km | 0.6 |
| cumulus | flat base, cauliflower top | dense low, rounded top | 0.8 km | 0.9 |
| cumulonimbus | tall tower, dark base | widens toward the top | 1.5 km | 1.0 |
| altocumulus | small puffs | thin, rounded | 300 m | 0.5 |
| altostratus | grey sheet | flat | 3 km | 0.4 |
| nimbostratus | thick dark sheet | flat | 3 km | 0.9 |
| cirrus | wispy streaks | thin | 2 km, stretched 4:1 | 0.15 |
| cirrostratus | thin veil | thin | 3 km | 0.1 |

**Lighting.**
- The sun is the scene's directional light (`light.position`, normalised), so clouds and terrain agree.
- 3–6 light samples toward the sun, a dual-lobe phase function (g = 0.8 and −0.3), a "powder" darkening term, and ambient light that brightens toward the cloud top.
- Raining layers get their albedo × 0.6, so rain clouds have dark bases.

**Inside a cloud.** The march starts at the camera. Following a jumper through a layer whites out the view, as it would for the jumper.

**Height-axis labels.** Each drawn layer gets a label such as "BKN 4,200 ft" at its base on the height axis (overlay layer). The labels follow the layer toggles.

### 5.3 Moving with the wind

**Offsets.** Each layer's offset is `drift × t` metres, where `t` is the sim clock (`window.simulationTime`).
- The offset moves the coverage map and the shape noise together, so clouds travel as whole bodies.
- A slow vertical scroll of the noise (about 0.3 m/s) makes them evolve as they go.

**Why the sim clock, not wall time:**
- the same sim time always shows the same clouds, so scrubbing back restores them;
- pausing freezes them along with the jumpers;
- a future cloud-penetration check will match what's drawn.

At 20 kt, a cloud moves 617 m per minute of sim time.

**New data.** When new weather arrives, heights, thresholds and drift ease over 5 s of real time, so clouds grow or shrink instead of jumping. A DZ switch rebuilds everything.

### 5.4 Rain and snow

**Particles.** GPU-instanced streaks facing the camera, in a box around it (160 × 120 × 160 m), under `worldRoot`, on the overlay layer.
- Position, computed in the shader: `mod(seed · box + v · t − camera, box)`.
- `v` = the wind at the camera's height + the fall speed:
  - rain: 6.5 m/s;
  - drizzle: 2 m/s, smaller and fainter;
  - snow: 1.2 m/s, with sway and round flakes.
- Streak length = speed × 1/30 s.
- Count = intensity × the preset's maximum (§5.8).

**Where particles appear:**
- only below the raining layer's base, fading out over the 100 m below it;
- as snow above the freezing level;
- for showers and thunderstorms, only inside rain cells, which drift with the layer, so the camera passes in and out of showers;
- for steady rain, everywhere under the layer.

**Timing.** Particles animate on real time, even while paused. They carry no planning information, and frozen rain looks like a rendering bug.

**Rain shafts.** P3 adds a thin grey medium from the ground up to a raining layer's base.
- Density is proportional to intensity × coverage, times the rain-cell mask for showers.
- Shafts can be seen from a distance and move with the clouds (sim clock).

### 5.5 Darkening in rain, and cloud shadows

**Darkening:** `D = min(0.55, 0.45 · intensity + 0.15 · smoothstep(0.6, 1.0, totalCover))`.
- P4 multiplies environment pixels (terrain, buildings, sky, plane, jumpers) by `1 − D`. In rain it also tints them slightly cooler and less saturated.
- Overlays (P5) keep full brightness, so zones, lines and labels stay readable.
- `D` eases over 3 s.

**Cloud shadows** (default on). For each ground pixel, P4 steps toward the sun to each layer's mid-height and samples the coverage there.
- `shadow = Π (1 − s · coverage)`.
- `s` = 0.5 × min(1, thickness / 1 km), or 0.15 for cirrus.
- Shadows drift with the clouds and show where the clouds are, even from above a layer.

### 5.6 Visibility haze

**Extinction.** By Koschmieder's law, with the 2% contrast threshold: `σ₀ = 3.912 / V`, where V is the visibility in metres.

**Height.** The haze sits in the boundary layer.
- `σ(h) = σ₀` up to `H = clamp(boundary_layer_height, 200 m, 3,000 m)`, and `σ₀ · e^(−(h − H) / 1,000 m)` above it.
- Seen from the plane, you look down through a hazy layer, and the air at exit height stays clear.
- The optical depth from the camera to each pixel is the closed-form integral of that profile, and transmittance is `T = e^(−τ)`.
- Sky pixels integrate out to 60 km.

**Model caps.** Models report about 16–24 km on clear days; Perris showed 17.4 km on a clear night. So:
- the haze is exact for V ≤ 8 km;
- above that it scales down by `1 − smoothstep(8 km, 24 km, V)`;
- at ≥ 24 km only today's horizon fade is left, so clear days look the same as now.

The constants live in `weather/config.ts`.

**Colour.**
- The haze goes from the theme's fog colour (`0x0a0a0a`) at good visibility toward grey (`#7d858f`) as V falls (smoothstep from 24 km to 3 km), times `1 − D`.
- Clouds receive haze at their transmittance-weighted mean distance.

**Observer.** The haze is measured from the camera. When following the plane or a jumper, the haze is what they see.

**Visibility ring (optional, default off).** A ground circle of radius V around the camera's focus point, labelled e.g. "Visibility 6.2 sm". In the planner it is centred on the primary LZ target.

### 5.7 Planner (top-down view)

- No raymarching, haze or particles: planning needs a clear map.
- **Optional "Clouds" planner layer** (default off). Each layer's coverage map is drawn as a translucent white raster at its altitude, more opaque for layers that set the ceiling. It drifts on the sim clock and is a plain textured mesh on the overlay layer.
- **HUD.** Add "Ceiling 4,200 ft · Vis 6 sm" next to the existing landing-wind readout (`.planner-wind`).

### 5.8 Performance

| Preset | Cloud res. | Max steps | Light samples | Detail noise | Temporal | Shape noise | Max rain particles |
|---|---|---|---|---|---|---|---|
| Low | ¼ | 48 | 3 | off | off | 64³ | 4k |
| **Medium** (default) | ½ | 96 | 5 | on | off | 128³ | 12k |
| High | ½ | 160 | 6 | on | on | 128³ | 30k |

- **Upsampling.** P4 upsamples `cloudRT` by nearest depth (using `depthRT`), so ridges and jumpers don't get halos.
- **Temporal (High only).** Blend with the reprojected previous frame, rejecting samples whose depth or colour disagree. Reset on camera cuts and DZ switches.
- **Auto quality.** If frame time averages over 25 ms for 5 s with clouds on, drop one preset and toast once: "Clouds lowered to Low to keep the frame rate up. Change it in Weather."
- **GPU memory at 1080p:** about 50 MB (render targets about 40 MB, noise about 8 MB, coverage map 1 MB).

---

## 6. Weather panel

`src/js/panels/WeatherPanel.ts` builds the Weather tab and mounts the existing wind widget in section 4.
- Each section collapses from its header, and the state is remembered.
- The panel redraws when the weather changes, not every frame.
- While the tab is visible, "updated N min ago" ticks every 30 s.

1. **Status.**
   - ● Live / Stale / Hold.
   - "Valid 7:15 PM PST", in DZ time; the tooltip shows your time and UTC.
   - "updated 2 min ago", ⟳ and Hold.
   - "Weather data by Open-Meteo.com", the attribution their CC BY 4.0 licence requires.
2. **Now.** Weather icon and text (Appendix C), temperature and dew point, surface wind and gusts (kt), QNH (hPa and inHg), day or night.
3. **Show in 3D.** Clouds, Shadows, Rain, Darken and Haze, plus a quality dropdown (§7).
4. **Winds aloft.** The existing widget, now at the valid time. Rows inside a cloud layer get a small cloud mark.
5. **Clouds.**
   - "Total 72% · Ceiling 4,200 ft AGL".
   - One row per layer: show/hide box, band, type (e.g. "Sc stratocumulus"), base–top in ft AGL (MSL in the tooltip), cover % and oktas (FEW/SCT/BKN/OVC) as a bar, and drift (e.g. "from 250° at 22 kt").
   - Freezing level in ft MSL, plus CAPE and lifted index when convective.
   - A note: "Cloud positions are illustrative; amounts and heights are forecast."
6. **Precipitation.** Kind and intensity word, rate (mm/h and in/h), probability, and 15-minute bars from 1 h ago to 1 h 45 ahead with a "now" mark.
7. **Visibility.** Statute miles (km in the tooltip) on a bar marked at 3 and 5 sm, a 15-minute sparkline, and the label "surface visibility".
8. **Jump conditions** (US DZs only; informational, not a go/no-go). 14 CFR 105.17 sets minimums by altitude:

   | Altitude | Visibility | Distance below / above / beside cloud |
   |---|---|---|
   | ≤ 1,200 ft AGL | 3 sm | 500 ft / 1,000 ft / 2,000 ft |
   | > 1,200 ft AGL and < 10,000 ft MSL | 3 sm | 500 ft / 1,000 ft / 2,000 ft |
   | > 1,200 ft AGL and ≥ 10,000 ft MSL | 5 sm | 1,000 ft / 1,000 ft / 1 sm |

   No parachute operation may go into or through a cloud.
   - Exit altitude is the plane's altitude (`plane.initialPosition.y`, AGL); MSL = AGL + elevation.
   - Lines shown:
     - visibility against the requirement at exit altitude;
     - each layer between the ground and the exit, with its required clearances;
     - an OVC layer under the jumprun, flagged as having no way through;
     - FEW or SCT layers, marked "needs a hole with the clearance above".
   - Non-US DZs show the values without pass/fail (§11 Q6).
9. **Next hours.** A 12-column hourly strip: low, mid and high cover, precipitation probability, visibility and icon.

**Other states:**
- "Loading weather…";
- "Weather unavailable · Retry", with the last data marked stale;
- "No data at this level" where the model has no value.

**Units:** ft, kt, sm and °F first, which is what US jumpers use, with metric in tooltips.

---

## 7. Toggles and settings

`src/js/weather/WeatherDisplay.ts` is one settings store with change events.
- Saved in `localStorage["jumpersim.weatherDisplay.v1"]`.
- Reads and writes are wrapped in try/catch; if storage is blocked, the defaults apply.

| Setting | Default | Controls |
|---|---|---|
| `clouds` | on | all cloud layers, rain shafts and height-axis labels |
| `layers.fog` / `.low` / `.mid` / `.high` | on | that layer only |
| `cloudShadows` | on | §5.5 shadows |
| `precipitation` | on | particles and rain shafts |
| `darken` | on | §5.5 darkening |
| `haze` | on | §5.6 haze |
| `visibilityRing` | off | §5.6 ring |
| `plannerClouds` | off | §5.7 planner layer |
| `quality` | medium | §5.8 presets |

**Where the toggles live.** Two places drive the same store:
- the Weather tab: the "Show in 3D" row and the per-layer boxes in section 5;
- the menubar's **Weather** menu. It replaces the placeholder Undo/Redo items (`index.html:119-129`) with the same checkboxes, plus "Refresh weather now", "Hold weather" and "Open Weather panel".

**Behaviour.** A toggle takes effect instantly and never refetches. Off means the work is skipped (no pass, no draw call), not drawn invisibly.

**Dev overrides** for testing the visuals without waiting for the right weather:
- `window.weatherDebug.override({ lowPct: 70, rainMmPerH: 5, visibilityM: 3000, … })` and `window.weatherDebug.clear()`;
- presets: `"stratus-drizzle"`, `"cumulus-showers"`, `"overcast-rain"`, `"fog"`, `"cirrus"`, `"clear"`;
- in dev builds, the same presets via a `?weather=<preset>` URL parameter.

---

## 8. Files

| File | Change |
|---|---|
| `src/js/weather/OpenMeteoClient.ts` | **New.** Variable lists, the request, and response → `WeatherState`. |
| `src/js/weather/WeatherService.ts` | **New.** Store, refresh schedule, Hold, request ordering, backoff, toasts, recalculation policy. |
| `src/js/weather/WeatherState.ts` | **New.** Types and unit helpers. |
| `src/js/weather/CloudLayers.ts` | **New.** §4.4 (pure). |
| `src/js/weather/Conditions.ts` | **New.** §6.8 checks (pure). |
| `src/js/weather/Precipitation.ts`, `Derive.ts` | **New.** §4.5 kind and intensity; `deriveWeather()` fills the derived fields (pure). |
| `src/js/weather/Overrides.ts` | **New.** §7 dev overrides and presets. Presets also fill the trend series, so the panel stays consistent. |
| `src/js/weather/WeatherCodes.ts` | **New.** Appendix C text and icons. |
| `src/js/ui/WeatherMenu.ts` | **New.** The menubar's Weather menu (§7). |
| `src/js/weather/WeatherDisplay.ts` | **New.** §7 settings store. |
| `src/js/weather/config.ts` | **New.** Tunable values (haze limits, darkening, refresh timing). |
| `src/js/visuals/weather/WeatherRenderer.ts` | **New.** §5.1 passes, render targets, resize, bypass. |
| `src/js/visuals/weather/CloudVolume.ts`, `cloudShaders.ts`, `CloudTypes.ts` | **New.** §5.2–5.3. |
| `src/js/visuals/weather/NoiseTextures.ts`, `coverageWorker.ts` | **New.** 3D noise on the GPU; coverage map and thresholds in a worker. |
| `src/js/visuals/weather/Precipitation.ts` | **New.** §5.4. |
| `src/js/visuals/weather/Composite.ts` | **New.** §5.5–5.6: shadows, darkening, haze, upsampling, output. |
| `src/js/visuals/Layers.ts` | **New.** `LAYER_OVERLAY`, `setOverlayLayer()`. |
| `src/js/panels/WeatherPanel.ts` | **New.** §6. |
| `src/apidata/OpenMateo.ts` | **Delete.** Replaced by the client and the service. |
| `src/js/LocationSelect.ts` | Call `weatherService.setDropzone(dz)` instead of `declareParams(); fetchWeatherData()`. |
| `src/js/wind/WindProfile.ts` | Build from `WeatherState` levels; `currentWindProfile()` reads the store; add `cloudWindAt()`. |
| `src/js/panels/WindWidget.ts` | Valid time from the store; cloud marks and temperature tooltips on rows. |
| `src/js/Scripts.ts` | Render through `WeatherRenderer`; the picking raycaster enables the overlay layer; lights on both layers; call `setSize` on resize. |
| `MapScene.ts`, `WindTower.ts`, `TrajectoryLines.ts`, `Markers.ts`, `PlanOverlays.ts`, `PlannerView.ts` | Put objects on the overlay layer after each (re)build; planner HUD; planner clouds layer. |
| `index.html` | Weather menu items; link `weather.css`. |
| `src/css/weather.css` | **New.** Panel styles. |
| `tests/weather/*.test.ts` | **New.** §10. |
| `README.md` | Update "Features", and "APIs used: Open-Meteo (wind, clouds, precipitation, visibility)" with attribution. |

---

## 9. Implementation plan

1. **Fresh weather (B1–B5).**
   - Client, service and state, carrying today's variables plus `timezone=auto` and the `current` winds.
   - The refresh, Hold and ordering rules from §4.2.
   - Wind profile from the store, with geopotential heights and the 10 m level (§4.3); the panel's status line.
   - *Small; ship it on its own.*
2. **All data and the panel.**
   - The full request (Appendix B), `CloudLayers` and `Conditions`.
   - All nine panel sections.
   - The toggle store and the Weather menu. Toggles do nothing until their visuals land.
   - Dev overrides.
3. **Pipeline, haze and darkening.**
   - `WeatherRenderer` passes P1–P6, the overlay layer, and the bypass.
   - Pass A9 (identical image with every effect at zero) before adding any effect.
   - Then haze and darkening.
4. **Clouds.** Noise, coverage map and thresholds, the raymarch, cloud types, drift, shadows, height-axis labels and quality presets.
5. **Rain and snow.** Particles and rain shafts.
6. **Planner and polish.** The planner clouds layer and HUD readout, the visibility ring, auto quality, and temporal accumulation for High.

---

## 10. Acceptance criteria

**Data**
- [ ] **A1. Current.**
  - At 10:05 AM PST the panel says "Valid 10:00 AM PST", and the physics used winds with that same valid time.
  - At 3:50 PM and at 4:10 PM, the date shown is today, not yesterday.
  - Unit test: with a mocked response, "now" comes from `current`, not hourly index 0.
- [ ] **A2. Time zones.** Skydive Dubai shows Dubai time ("GMT+4" in en-US). Perris shows "PST", whatever the user's own time zone.
- [ ] **A3. Refresh.**
  - In an hour with the tab visible, there are 4 requests, each just after a 15-minute step. With Hold on, there are none.
  - A hidden tab makes none.
  - Five quick DZ switches end on the last DZ's weather.
- [ ] **A3b. Sparse models.** Skydive Voss (ECMWF-style levels) loads without errors, and the missing levels are skipped.
- [ ] **A3c. Surface wind.**
  - The jump profile's lowest level is at 10 m AGL and matches `wind_speed_10m` / `wind_direction_10m`.
  - Unit test: at 50 m AGL, `windAtHeight()` interpolates the u/v components between the 10 m level and the first pressure level.
  - The planner's landing wind and the wind widget's "Surface (10 m)" row both show the 10 m wind and gust.

**Clouds**
- [ ] **A4. Cover.** For covers of 10, 30, 60 and 90%, the clouded share of a 20 km square, measured top-down through `coverageAt`, is within ±5 points.
- [ ] **A5. Heights.**
  - Unit tests run on recorded profiles: Perris clear, New England with mid and high cloud, Voss with low cloud and sparse levels, and synthetic stratus and cumulus. Each gives the layers §4.4 predicts.
  - In 3D, flying the camera up through a base enters cloud within one step of `baseAglM`.
- [ ] **A6. Drift.**
  - At 20 kt, a cloud moves 617 m ± 5% downwind in 60 s of sim time.
  - Scrubbing back to the same time shows the identical image.

**Rain and visibility**
- [ ] **A7. Rain.**
  - With the `overcast-rain` preset (5 mm/h, 100% cover):
    - streaks fall below the base, slanted with the low-level wind, and there are none above it;
    - the environment is darker by `D` ≈ 0.4, while overlays are unchanged.
  - With `cumulus-showers`, rain falls only under cells.
- [ ] **A8. Haze.**
  - With V = 5 km and the camera at the ground, a ground point 2.5 km away keeps 14% contrast (e^−1.956), and one 5 km away keeps 2%.
  - At V ≥ 24 km, the image matches today's.
  - Conditions: an exit at 13,000 ft MSL with 4 sm visibility is flagged (5 sm needed). An exit at 9,500 ft MSL with 4 sm passes.

**Toggles and performance**
- [ ] **A9. Parity.** With the pipeline forced on and every effect at zero, the image is within 2/255 of a direct render.
- [ ] **A10. Toggles.** Each toggle hides exactly its effect, instantly. Toggles survive a reload and work with storage blocked. With everything off, frame time is within 5% of today.
- [ ] **A11. Frame rate.**
  - ≥ 50 fps at 1080p on the reference laptop: Medium preset, three layers, rain and haze, both at the default view and following a jumper through a layer.
  - ≥ 60 fps on Low.
- [ ] **A12. Planner.**
  - Entering the planner shows the clear map, and the HUD shows ceiling and visibility.
  - The optional clouds layer drifts with sim time.
  - Picking and handles work in both views.

---

## 11. Decisions and remaining risks

**Decided (2026-11-19)**
1. **API budget:** about 13 calls per refresh (≈ 1,200 per tab per day) is accepted for now. If a DZ office running several screens behind one IP hits the 10,000/day limit, add a Netlify function that caches each DZ for 5 minutes. Commercial use would need an Open-Meteo API key.
2. **10 m wind:** it joins the jump profile (§4.3). This deliberately changes landing winds and canopy patterns.
3. **Geopotential heights for winds:** used. Wind levels move by up to about ±150 m compared with the ISA heights, so tracks change slightly. That is accepted, because the clouds and the winds then share the same heights.
4. **Illustrative positions:** the note in the Clouds section ("Cloud positions are illustrative…") is enough.
5. **Layer heights from the humidity peak:** accepted. They are accurate to about one pressure level (0.5–1 km aloft).
6. **Other countries:** only the FAA table. DZs in the UAE, Spain, Italy and Norway show the values without pass/fail. EASA SERA VMC minimums can follow if asked for.
7. **Units:** ft, kt, sm and °F first, with metric in tooltips. No units setting in this work.
8. **Lighting:** clouds use the scene's fixed light. The real sun position and night rendering are a follow-up.

**Remaining risks**
- **Auto-refresh and "Into upper winds":** a jumprun set to "Into upper winds" can rotate every 15 minutes as the winds change. That feature is designed to follow the winds, and Hold stops it.
- **GPU range:** integrated GPUs may need the Low preset. Auto quality handles this; check the frame rate on the reference laptop in phase 4.

---

## Appendix A: Why not `@takram/three-clouds`

It is the most complete volumetric-cloud library for three.js, but it fits this app badly:
- it is a pmndrs `postprocessing` effect, composited by the atmosphere package's `AerialPerspectiveEffect`; this app uses neither;
- it works only in Earth-centred (ECEF) coordinates. Its `worldToECEFMatrix` may only rotate and translate, which conflicts with `WORLD_SCALE = 5.8`;
- its local-weather texture is mapped for a globe (cube-sphere UVs). It allows at most 4 layers, at heights measured from the ellipsoid;
- it doesn't document logarithmic depth;
- its physically based sky would change the app's dark look.

A raymarcher in our flat local frame is a few hundred lines and uses the same published techniques (Schneider 2015 and 2017; Hillaire 2016).

## Appendix B: Request

```ts
const LEVELS = [1000, 975, 950, 925, 900, 850, 800, 700, 600, 500, 400, 300, 250, 200] as const;
const JUMP_LEVELS_HPA = [1000, 975, 950, 925, 900, 850, 800, 700, 600, 500] as const;
const LEVEL_VARS = ["wind_speed", "wind_direction", "cloud_cover", "relative_humidity",
                    "temperature", "geopotential_height"] as const;
const SURFACE_NOW = [
  "temperature_2m", "dew_point_2m", "relative_humidity_2m", "weather_code", "is_day",
  "cloud_cover", "cloud_cover_low", "cloud_cover_mid", "cloud_cover_high", "visibility",
  "precipitation", "rain", "showers", "snowfall", "precipitation_probability",
  "freezing_level_height", "cape", "lifted_index", "convective_inhibition",
  "boundary_layer_height", "wind_speed_10m", "wind_direction_10m", "wind_gusts_10m",
  "surface_pressure", "pressure_msl",
] as const;
const NOW_VARS = [...SURFACE_NOW, ...LEVELS.flatMap((p) => LEVEL_VARS.map((v) => `${v}_${p}hPa`))];
const MINUTELY_15 = ["precipitation", "rain", "showers", "snowfall", "visibility",
                     "weather_code", "cloud_cover", "freezing_level_height"] as const;
const HOURLY = ["cloud_cover", "cloud_cover_low", "cloud_cover_mid", "cloud_cover_high",
                "precipitation", "precipitation_probability", "visibility", "weather_code",
                "wind_speed_10m", "wind_gusts_10m"] as const;

const params = {
  latitude, longitude, timezone: "auto",
  current: NOW_VARS,
  minutely_15: MINUTELY_15, past_minutely_15: 4, forecast_minutely_15: 8,
  hourly: HOURLY, past_hours: 1, forecast_hours: 12,
  wind_speed_unit: "ms", temperature_unit: "celsius", precipitation_unit: "mm",
};
// read back by name: response.current()!.variables(NOW_VARS.indexOf(name))!.value()
```

## Appendix C: Weather codes (WMO)

| Code | Text | Kind |
|---|---|---|
| 0, 1, 2, 3 | Clear, mainly clear, partly cloudy, overcast | none |
| 45, 48 | Fog, rime fog | none (adds a fog layer) |
| 51–55, 56–57 | Drizzle (light to dense), freezing drizzle | drizzle |
| 61–65, 66–67 | Rain (light to heavy), freezing rain | rain |
| 71–75, 77 | Snow (light to heavy), snow grains | snow |
| 80–82 | Rain showers (light to violent) | showers |
| 85–86 | Snow showers | snow |
| 95–99 | Thunderstorm (96 and 99 with hail) | thunderstorm |
