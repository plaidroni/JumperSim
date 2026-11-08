# JumperSim

JumperSim is a 3D skydiving physics simulator built with Three.js and TypeScript, designed for visualizing and analyzing jumper dynamics in both freefall and canopy flight. Featuring real-time weather data, layered wind modeling, and a full timeline playback system, JumperSim is built as a safety training and planning tool for skydivers, instructors, and dropzone operators.

### Plane Load & Organizer

Open the Plane Settings panel and click "Edit Plane Load" to view the seating map.

Notes:

- Load order is based on the jumper's `index`; jump time = index × interval.
- Works with default jumpers and formation jumpers.
- You can link/unlink formation jumpers to simulate a linked float / dive exit, the rest will independently dive

![A screenshot of JumperSim](https://github.com/user-attachments/assets/ea099efa-3778-4fbd-93d6-a3982caebf26)

## Features

Simulates jumper dynamics based on real-time wind profiles fetched from Open-Meteo

Scrubbable playback timeline with pause, rewind, and jump-to-time controls

Unity-style developer console with draggable panels and live variable tuning

3D terrain (Cesium World Terrain) with a Mapbox Dark or Cesium satellite map style, streamed seamlessly for ~8 km around the selected dropzone

3D buildings (Cesium OSM Buildings), toggleable from the Location panel

Terrain-aware landing: jumpers land on the real ground height, with the DZ landing area at 0 ft

Accurate flight models for DC-9, Skyvan, Twin Otter, and Cessna 172

Seamless transition from freefall to canopy with wind force layers at 1,000 ft AGL

Time-aware physics engine that responds to playback direction and speed

Interactive environment configuration with altitude thresholds and wind adjustments

## Simulation Logic

Plane class moves based on flight vector, time, and selected aircraft model

Simulated jumpers switches states between exit, freefall, deployment, and canopy

Environmental data updates based on location, altitude, and time using Open-Meteo

Jump timeline scrubbing rewinds physics states without reloading simulation

Supports predictive modeling for potential canopy collisions in variable conditions

## Libraries & Addons used

- Three.JS
- OrbitControls
- Vite

## APIs used

- [OpenMeteo](https://open-meteo.com/) (for wind vectors)
- [Cesium Ion](https://ion.cesium.com/) (World Terrain, World Imagery, OSM Buildings)
- [Mapbox](https://www.mapbox.com/) (Dark map style raster tiles)

## Installation

Create a `.env` file in the project root with your tokens:

```
VITE_CESIUM_ION_TOKEN=your_cesium_ion_token
VITE_MAPBOX_TOKEN=your_mapbox_public_token
```

The Cesium token is required for terrain and buildings (assets `1`, `2` and `96188`; all free on a community account). The Mapbox token is needed only for the "Dark (Mapbox)" map style; without it the map uses Cesium satellite imagery. If the Cesium token is missing or terrain fails to load, the sim falls back to the wireframe plane. See `.env.example` and `specs/map-terrain-buildings.md`.

To install and start local server:

- `git clone https://github.com/plaidroni/JumperSim.git`
- `npm i`
- `npm run start`
