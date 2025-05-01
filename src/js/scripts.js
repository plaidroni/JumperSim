import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

/**
 * START BASIC THREEJS SETUP
 */
const renderer = new THREE.WebGLRenderer();

renderer.setSize(window.innerWidth, window.innerHeight);

// inject renderer into dom
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();

// setting up camera
const camera = new THREE.PerspectiveCamera(
  50,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);

const controls = new OrbitControls(camera, renderer.domElement);

const axisHelper = new THREE.AxesHelper(5);
var grid = new THREE.GridHelper(250, 50, "aqua", "gray");

//compass
var dir = new THREE.Vector3();
var sph = new THREE.Spherical();
var compass = document.getElementById("compass");

scene.add(axisHelper);
scene.add(grid);

camera.position.set(0, 40, 40);
controls.update();

/**
 * END BASIC THREEJS SETUP
 */

/**
 * START GLOBAL VARS
 */

class GlobalWindVars {
  /**
   *
   * @param {ThreeJS.Vector3(x,x,x)} upperWinds
   * @param {ThreeJS.Vector3(x,x,x)} lowerWinds
   */
  constructor(twelveWinds, nineWinds, sixWinds, threeWinds) {
    this.twelveWinds = twelveWinds;
    this.nineWinds = nineWinds;
    this.sixWinds = sixWinds;
    this.threeWinds = threeWinds;
  }
}

console.log(window.devConsoleVars.planeSpeed);
class Plane {
  constructor(
    position,
    speedKnots = window.devConsoleVars.planeSpeed,
    direction = new THREE.Vector3(1, 0, 0)
  ) {
    this.initialPosition = position.clone();
    this.position = position.clone();
    this.direction = direction.normalize();
    this.speed = speedKnots * 0.51444 * window.simScale;
    this.vector = this.direction.clone().multiplyScalar(this.speed);
  }

  update(simulationTime) {
    this.position.copy(
      this.initialPosition
        .clone()
        .add(this.vector.clone().multiplyScalar(simulationTime))
    );
  }
}

class Jumper {
  constructor(
    index,
    plane,
    jumpInterval = 15,
    deployDelay = 7,
    canopySize = 190
  ) {
    this.index = index;
    this.jumpTime = index * jumpInterval;
    this.deployDelay = deployDelay;
    this.canopySize = canopySize;
    this.plane = plane;
    this.initialVelocity = new THREE.Vector3(0, 0, 0);

    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xff0000 })
    );
    scene.add(this.mesh);
    this.position = new THREE.Vector3();
  }

  update(simulationTime) {
    if (simulationTime < this.jumpTime) {
      // Still in plane
      this.position.copy(this.plane.position);
    } else {
      const timeSinceJump = simulationTime - this.jumpTime;
      const deployTime = Math.max(0, timeSinceJump - this.deployDelay);
      const fallTime = Math.min(timeSinceJump, this.deployDelay);

      const gravity = new THREE.Vector3(0, -9.81 * window.simScale, 0);
      const canopyDescentRate = new THREE.Vector3(0, -2.5 * window.simScale, 0);

      const freefall = gravity
        .clone()
        .multiplyScalar(0.5 * fallTime * fallTime);
      const canopyFall = canopyDescentRate.clone().multiplyScalar(deployTime);

      const totalFall = freefall.add(canopyFall);

      this.position.copy(
        this.plane.initialPosition
          .clone()
          .add(this.plane.vector.clone().multiplyScalar(this.jumpTime))
          .add(totalFall)
      );
    }

    this.mesh.position.copy(this.position);
  }
}

const windVars = new GlobalWindVars(
  new THREE.Vector3(0, 4, 1), // winds at 12,000
  new THREE.Vector3(0, 0, 2), // winds at 9,000
  new THREE.Vector3(0, 0, 2), // winds at 6,000
  new THREE.Vector3(0, 0, 2) // winds at 3,000
);

const plane = new Plane(new THREE.Vector3(0, 20, 0));
const jumpers = Array.from({ length: 10 }, (_, i) => new Jumper(i, plane));
let simulationTime = 0;
let lastFrameTime = performance.now();

// Plane mesh
const planeMesh = new THREE.Mesh(
  new THREE.BoxGeometry(1, 0.3, 0.3),
  new THREE.MeshBasicMaterial({ color: 0x00ff00 })
);
scene.add(planeMesh);

// not needed because we have scrubber now?
function restartSimulation() {}

function updateSimulation(simulationTime) {
  plane.update(simulationTime);
  planeMesh.position.copy(plane.position);

  for (const jumper of jumpers) {
    jumper.update(simulationTime, windVars, 5); // deploy canopy at 5m
  }
}

let lastSimTime = -1;

renderer.setAnimationLoop(() => {
  const now = performance.now();
  const deltaTime = (now - lastFrameTime) / 1000;
  lastFrameTime = now;

  if (window.isPlaying) {
    simulationTime += deltaTime;
    window.updateScrubber(simulationTime);
  } else {
    simulationTime = window.currentTime;
  }

  if (simulationTime !== lastSimTime) {
    updateSimulation(simulationTime);
    lastSimTime = simulationTime;
  }

  controls.update();
  renderer.render(scene, camera);
  camera.getWorldDirection(dir);
  sph.setFromVector3(dir);
  //thx guy on stack overflow
  compass.style.transform = `rotate(${
    THREE.MathUtils.radToDeg(sph.theta) - 180
  }deg)`;
});
