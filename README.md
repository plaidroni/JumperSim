# 🪂 JumperSim

A visual physics simulation built with Three.js, modeling skydiver dynamics under the influence of layered wind and user-controlled playback. Features include a draggable Unity-style developer console, time scrubber with full playback control, and configurable environmental conditions.

## Simulation Logic

Plane class moves based on time and vector

Jumper class transitions from freefall to canopy

List of all major USPA regulated dropzones with accurate realtime Weather data (Open-Mateo.com)

Wind speeds at all heights at 1,000agl steps based on latitude and longitude above ground level

Time-aware updates for scrubbing and playback

Dynamic satellite imagery of chosen dropzone (Mapbox.com)

Choose between 4 different planes with different flight characteristics (DC-9, Skyvan, Twin Otter, Cessna-172)

## Libraries & Addons used

Three.JS

OrbitControls

~Parcel~ (removed due to unresponsive developers)

Vite

## APIs used

OpenMateo(for wind vectors)

Mapbox(satellite view)

## Installation

To install and start local server:

git clone https://github.com/plaidroni/JumperSim.git

~npx parcel ./src/index.html~

npm i

npm run start
