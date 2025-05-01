# 🪂 JumperSim
A visual physics simulation built with Three.js, modeling skydiver dynamics under the influence of layered wind and user-controlled playback. Features include a draggable Unity-style developer console, time scrubber with full playback control, and configurable environmental conditions.

## Simulation Logic
Plane class moves based on time and vector

Jumper class transitions from freefall to canopy

Modifiable wind variables at 3,6,9,12k ft MSL let you simulate layered wind environments

Time-aware updates for scrubbing and playback

## Libraries & Addons used

Three.JS
OrbitControls
Parcel

## Libraries & Addons used

To install and start local server:

git clone https://github.com/plaidroni/JumperSim.git

npx parcel ./src/index.html
