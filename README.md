# 🪂 JumperSim
A visual physics simulation built with Three.js, modeling skydiver dynamics under the influence of layered wind and user-controlled playback. Features include a draggable Unity-style developer console, time scrubber with full playback control, and configurable environmental conditions.

## Simulation Logic
Plane class moves based on time and vector

Jumper class transitions from freefall to canopy

Wind speeds at all heights at 1,000agl steps based on latitude and longitude

Time-aware updates for scrubbing and playback

## Libraries & Addons used

Three.JS

OrbitControls

Parcel

OpenMateo(for wind vectors)

## Libraries & Addons used

To install and start local server:

git clone https://github.com/plaidroni/JumperSim.git

npx parcel ./src/index.html
