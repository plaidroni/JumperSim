import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { clampVectorAboveYZero } from "./utils";
import { GlobalWindVars } from "./globalVars";

/**
 * START BASIC THREEJS SETUP
 */
const renderer = new THREE.WebGLRenderer();

renderer.setSize((<any>window).innerWidth, (<any>window).innerHeight);

// inject renderer into dom
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();

// setting up camera
const camera = new THREE.PerspectiveCamera(
  50,
  (<any>window).innerWidth / (<any>window).innerHeight,
  0.1,
  1000
);

const controls = new OrbitControls(camera, renderer.domElement);

const axisHelper = new THREE.AxesHelper(5);
var grid = new THREE.GridHelper(250, 50, "aqua", "gray");

/**
 * handle raycast
 */
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const tooltip = document.getElementById("info-tooltip");

function onMouseMove(event) {
  mouse.x = (event.clientX / (<any>window).innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / (<any>window).innerHeight) * 2 + 1;

  tooltip.style.left = `${event.clientX + 10}px`;
  tooltip.style.top = `${event.clientY + 10}px`;
}

function checkHoverIntersect(objects) {
  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(objects, true);
  if (intersects.length > 0) {
    const obj = intersects[0].object;
    const data = obj.userData;
    // display all data in userData
    if (data && data.label) {
      let html = `<strong>${data.label}</strong><br>`;
      for (const key in data) {
        if (key !== "label") {
          html += `${key}: ${data[key]}<br>`;
        }
      }
      tooltip.innerHTML = html;
      tooltip.style.display = "block";
    }
  } else {
    tooltip.style.display = "none";
  }
}

/**
 * end handle raycast
 */

//compass
var dir = new THREE.Vector3();
var sph = new THREE.Spherical();
var compass = document.getElementById("compass");

scene.add(axisHelper);
scene.add(grid);

camera.position.set(0, 108, 30);

controls.update();

/**
 * END BASIC THREEJS SETUP
 */

/**
 * START GLOBAL VARS
 */

const windVars = new GlobalWindVars(
  new THREE.Vector3(0, 4, 1), // winds at 12,000
  new THREE.Vector3(0, 0, 2), // winds at 9,000
  new THREE.Vector3(0, 0, 2), // winds at 6,000
  new THREE.Vector3(0, 0, 2) // winds at 3,000
);

class Plane {
  initialPosition: any;
  position: any;
  direction: any;
  speed: number;
  vector: any;
  jumpersLeft: any;
  constructor(
    position,
    speedKnots = (<any>window).devConsoleVars.planeSpeed,
    direction = new THREE.Vector3(1, 0, 0)
  ) {
    this.initialPosition = position.clone();
    this.position = position.clone();
    this.direction = direction.normalize();
    this.speed = speedKnots * 0.51444 * (<any>window).simScale;
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
  index: any;
  jumpTime: number;
  deployDelay: number;
  canopySize: number;
  plane: any;
  initialVelocity: any;
  mesh: any;
  deployed: boolean;
  position: any;
  constructor(
    index,
    plane,
    jumpInterval = 15, // in sec
    deployDelay = 7,
    canopySize = 190 // in sqft
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
    // this.deployed ?? scene.add(new THREE.SphereGeometry(1, 16, 16));
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

      const gravity = new THREE.Vector3(0, -9.81 * (<any>window).simScale, 0);
      const canopyDescentRate = new THREE.Vector3(
        0,
        -2.5 * (<any>window).simScale,
        0
      );
      // have they hit the ground yet?
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
      this.position.y = Math.max(0, this.position.y);
    }

    this.mesh.position.copy(this.position);
  }
}

const plane = new Plane(new THREE.Vector3(0, 130, 0));

const jumpers = Array.from({ length: 10 }, (_, i) => new Jumper(i, plane));
let simulationTime = 0;
let lastFrameTime = performance.now();

// Plane mesh
const planeMesh = new THREE.Mesh(
  new THREE.BoxGeometry(1, 0.3, 0.3),
  new THREE.MeshBasicMaterial({ color: 0x00ff00 })
);
planeMesh.userData = {
  label: "Plane",
  jumpersLeft: `${plane.jumpersLeft}`,
  speed: `${plane.speed.toFixed(2)} m/s`,
  velocity: `(${plane.vector.x.toFixed(2)}, ${plane.vector.y.toFixed(
    2
  )}, ${plane.vector.z.toFixed(2)})`,
};
scene.add(planeMesh);

function updateSimulation(simulationTime) {
  plane.update(simulationTime);
  planeMesh.position.copy(plane.position);

  for (const jumper of jumpers) {
    jumper.update(simulationTime, windVars, 5); // canopy deploy = 5

    jumper.mesh.userData = {
      label: `Jumper #${jumper.index}`,
      canopySize: `${jumper.canopySize} sqft`,
      jumpTime: jumper.jumpTime.toFixed(2),
    };
  }
}

let lastSimTime = -1;

controls.addEventListener("change", (event) => {
  // console.log(camera.fov);
});

renderer.setAnimationLoop(() => {
  const now = performance.now();
  const deltaTime = (now - lastFrameTime) / 1000;
  lastFrameTime = now;

  if ((<any>window).isPlaying) {
    simulationTime += deltaTime;
    (<any>window).updateScrubber(simulationTime);
  } else {
    simulationTime = (<any>window).currentTime;
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
  checkHoverIntersect([...jumpers.map((j) => j.mesh), planeMesh]);
});

document.addEventListener("mousemove", onMouseMove);
