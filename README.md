# JumperSim

JumperSim is a 3D skydiving physics simulator built with Three.js and TypeScript, designed for visualizing and analyzing jumper dynamics in both freefall and canopy flight. Featuring real-time weather data, layered wind modeling, and a full timeline playback system, JumperSim is built as a safety training and planning tool for skydivers, instructors, and dropzone operators.

## Features

Simulates jumper dynamics based on real-time wind profiles fetched from Open-Meteo

Scrubbable playback timeline with pause, rewind, and jump-to-time controls

Unity-style developer console with draggable panels and live variable tuning

Dynamic Mapbox satellite imagery centered on major USPA dropzones

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

Three.JS

OrbitControls

Vite

## APIs used

OpenMateo(for wind vectors)

Mapbox(satellite view)

## Installation

(DISCLAIMER: Your own Mapbox public API must be declared as VITE_MAPBOX="..." in root dir.)

To install and start local server:

git clone https://github.com/plaidroni/JumperSim.git

~npx parcel ./src/index.html~

npm i

npm run start
