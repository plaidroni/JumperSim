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
    direction = new THREE.Vector3(1, 0, 0),
    jumpersLeft = 10
  ) {
    this.position = position.clone();
    this.direction = direction.normalize();
    this.speed = speedKnots * 0.51444; // knots to m/s
    this.vector = this.direction.clone().multiplyScalar(this.speed);
    this.jumpersLeft = jumpersLeft;
    this.lastJumpTime = 0;
    this.timeBetweenJumpers = this.calculateJumpInterval();
  }

  calculateJumpInterval(twelveWinds = 60) {
    return (60 / twelveWinds) * 2.0;
  }

  update(simulationTime) {
    if (window.isPlaying) {
      this.position.add(this.vector.clone().multiplyScalar(simulationTime));
    }
  }

  canDropJumper(currentTime) {
    return (
      this.jumpersLeft > 0 &&
      currentTime - this.lastJumpTime > this.timeBetweenJumpers
    );
  }

  dropJumper(currentTime) {
    if (this.canDropJumper(currentTime)) {
      this.jumpersLeft--;
      this.lastJumpTime = currentTime;
      return new Jumper(this.position.clone());
    }
    return null;
  }
}

class Jumper {
  constructor(position, canopySize = 190) {
    this.position = position.clone();
    this.velocity = new THREE.Vector3(0, 0, 0);
    this.acceleration = new THREE.Vector3(0, -9.81, 0); // gravity in m/s²
    this.canopySize = canopySize;
    this.hasDeployedCanopy = false;
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xff0000 })
    );
    this.mesh.position.copy(this.position);
    scene.add(this.mesh);
  }

  update(simulationTime, windVars, canopyDeployAltitude) {
    if (!this.hasDeployedCanopy && this.position.y <= canopyDeployAltitude) {
      this.hasDeployedCanopy = true;
      this.acceleration.set(0, -2.5, 0); // simulate parachute drag reducing fall rate
    }

    // Gravity and wind displacements utilizing scalar vectorssssss
    const wind = this.hasDeployedCanopy
      ? windVars.threeWinds
      : windVars.sixWinds;

    if (window.isPlaying) {
      const windInfluence = wind.clone().multiplyScalar(simulationTime);

      this.velocity.add(
        this.acceleration.clone().multiplyScalar(simulationTime)
      );
      this.velocity.add(windInfluence);
      this.position.add(this.velocity.clone().multiplyScalar(simulationTime));

      this.mesh.position.copy(this.position);
    }
  }
}

const windVars = new GlobalWindVars(
  new THREE.Vector3(0, 4, 1), // winds at 12,000
  new THREE.Vector3(0, 0, 2), // winds at 9,000
  new THREE.Vector3(0, 0, 2), // winds at 6,000
  new THREE.Vector3(0, 0, 2) // winds at 3,000
);

const plane = new Plane(new THREE.Vector3(0, 20, 0));
const jumpers = [];
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

  const newJumper = plane.dropJumper(simulationTime);
  if (newJumper) jumpers.push(newJumper);

  for (const jumper of jumpers) {
    jumper.update(simulationTime, windVars, 5); // deploy canopy at 5m
  }
}

renderer.setAnimationLoop(() => {
  if (window.isPlaying) {
    const now = performance.now();
    const deltaTime = (now - lastFrameTime) / 1000;
    lastFrameTime = now;
    simulationTime += deltaTime;
    window.updateScrubber(simulationTime);
  } else {
    simulationTime = window.currentTime;
  }
  updateSimulation(simulationTime);
  controls.update();
  renderer.render(scene, camera);
  camera.getWorldDirection(dir);
  sph.setFromVector3(dir);
  //thx guy on stack overflow
  compass.style.transform = `rotate(${
    THREE.MathUtils.radToDeg(sph.theta) - 180
  }deg)`;
});
