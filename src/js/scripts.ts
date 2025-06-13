import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { ThreeMFLoader } from "three/addons/loaders/3MFLoader.js";
import { clampVectorAboveYZero } from "./utils";
import { GlobalWindVars } from "./globalVars";
import { setupPanelMinimization } from "./minimized-windows";
import { Plane, Jumper } from "./classes/baseEntities";
import { SimJumper, SimPlane } from "./classes/simEntities";

// === THREE SETUP ===
const scene = new THREE.Scene();
const renderer = new THREE.WebGLRenderer();
const camera = new THREE.PerspectiveCamera(
  50,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);
const controls = new OrbitControls(camera, renderer.domElement);

renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const light = new THREE.DirectionalLight(0xffffff, 1);
light.position.set(10, 10, 10);
scene.add(light);
const ambient = new THREE.AmbientLight(0xffffff, 0.3);
scene.add(ambient);
scene.add(new THREE.AxesHelper(5));
scene.add(new THREE.GridHelper(250, 50, "aqua", "gray"));

camera.position.set(0, 108, 30);
controls.update();

// === GLOBAL VARS ===
const windVars = new GlobalWindVars(
  new THREE.Vector3(0, 4, 1),
  new THREE.Vector3(0, 0, 2),
  new THREE.Vector3(0, 0, 2),
  new THREE.Vector3(0, 0, 2)
);

// === TOOLTIP ===
const tooltip = document.getElementById("info-tooltip");
const compass = document.getElementById("compass");
const mouse = new THREE.Vector2();
const raycaster = new THREE.Raycaster();

function onMouseMove(event) {
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

  tooltip.style.left = `${event.clientX + 10}px`;
  tooltip.style.top = `${event.clientY + 10}px`;
}

document.addEventListener("mousemove", onMouseMove);

function checkHoverIntersect(objects) {
  if (!objects || objects.length === 0 || !camera || !raycaster) return;

  raycaster.setFromCamera(mouse, camera);

  // ensure validity
  const validObjects = objects.filter((obj) => obj != null);
  if (validObjects.length === 0) return;

  try {
    const intersects = raycaster.intersectObjects(validObjects, true);
    if (intersects.length > 0) {
      const obj = intersects[0].object;
      const data = obj.userData;
      if (data?.label) {
        let html = `<strong>${data.label}</strong><br>`;
        for (const key in data)
          if (key !== "label") html += `${key}: ${data[key]}<br>`;
        tooltip.innerHTML = html;
        tooltip.style.display = "block";
        return;
      }
    }
    tooltip.style.display = "none";
  } catch (err) {
    console.warn("Raycast error:", err);
    tooltip.style.display = "none";
  }
}

// === PLANE +JUMPER + SIMULATION ===
const loader = new GLTFLoader();
const threemfloader = new ThreeMFLoader();
const simPlane = new SimPlane(
  new THREE.Vector3(0, 130, 0),
  90,
  new THREE.Vector3(90, 0, 0)
);
let planeMesh = new THREE.Mesh();

// === SIMULATION DATA ===
simPlane.precalculate(180);
const simJumpers = Array.from(
  { length: 10 },
  (_, i) => new SimJumper(i, simPlane, 10, 50, 190)
);
simJumpers.forEach((jumper) => {
  jumper.precalculate(180);
  scene.add(jumper.getMesh());
});

/**
 *potentially uncomment later, need to downsize 3mf file or get new stl from amanda
 */
// threemfloader.load(
//   "/fabs/jumper.3mf",
//   (object) => {
//     simJumpers.forEach((jumper) => {
//       const modelClone = object.clone(true);

//       modelClone.traverse((child) => {
//         if (child.isMesh) {
//           child.material = child.material.clone();
//         }
//       });

//       jumper.setMesh(modelClone);
//       jumper.precalculate(180);
//       scene.add(jumper.getMesh());
//     });
//   },
//   (xhr) => {
//     console.log((xhr.loaded / xhr.total) * 100 + "% loaded");
//   },
//   (error) => {
//     console.error("error with loading jumper", error);
//   }
// );

loader.load(
  "/fabs/cessna.gltf",
  function (gltf) {
    gltf.scene.traverse((child) => {
      if (child.isMesh) {
        child.material = new THREE.MeshStandardMaterial({
          color: 0x00ff00,
          wireframe: true,
        });
        gltf.scene.rotation.y = -Math.PI / 2;

        planeMesh = child;
        return;
      }
    });
    if (planeMesh) {
      planeMesh.userData.label = "Plane";
      planeMesh.raycast = THREE.Mesh.prototype.raycast;

      planeMesh.rotation.x = -Math.PI / 2;
      planeMesh.rotation.z = Math.PI / 2;

      simPlane.setMesh(planeMesh);
      scene.add(planeMesh);
    }
  },
  function (xhr) {
    console.log((xhr.loaded / xhr.total) * 100 + "% loaded");
  },
  function (error) {
    console.log(error);
  }
);

// === LOOKING AT SCENE OBJECT ===

const panelBody = document.querySelector("#objects-panel .panel-body");

let followTarget: THREE.Object3D | null = null;
let isUserControllingCamera = false;

panelBody.innerHTML = "";

const planeEntry = document.createElement("div");
planeEntry.className = "object-entry";
planeEntry.innerHTML = `
  <span>Plane</span>
  <button class="focus-button" data-type="plane">👀</button>
`;
panelBody.appendChild(planeEntry);

simJumpers.forEach((jumper, i) => {
  const jumperEntry = document.createElement("div");
  jumperEntry.className = "object-entry";
  jumperEntry.innerHTML = `
    <span>Jumper ${i}</span>
    <button class="focus-button" data-type="jumper" data-index="${i}">👀</button>
  `;
  panelBody.appendChild(jumperEntry);
});

document.querySelectorAll(".focus-button").forEach((btn) =>
  btn.addEventListener("click", (e) => {
    const button = e.currentTarget as HTMLButtonElement;
    const type = button.dataset.type;
    const index = Number(button.dataset.index);

    const objectToFollow =
      type === "plane" ? simPlane.getMesh() : simJumpers[index].getMesh();
    // follow behavior
    if (followTarget === objectToFollow) {
      followTarget = null;
      button.classList.remove("following");
    } else {
      followTarget = objectToFollow;
      document
        .querySelectorAll(".focus-button.following")
        .forEach((b) => b.classList.remove("following"));
      button.classList.add("following");
    }
  })
);

controls.addEventListener("start", () => {
  // cancel if the user starts panning
  if (controls.state === 3) {
    isUserControllingCamera = true;
    followTarget = null;
    document
      .querySelectorAll(".focus-button.following")
      .forEach((b) => b.classList.remove("following"));
  }
});
controls.addEventListener("end", () => {
  if (controls.state !== 3) {
    isUserControllingCamera = false;
  }
});

let cameraOffset = new THREE.Vector3(10, 10, 10);
const followButton = document.querySelector("#following-panel");
const followLabel = document.querySelector("#following-label");

followButton?.addEventListener("click", () => {
  followTarget = null;
  isUserControllingCamera = true;
});

function updateCameraFollow() {
  if (followTarget && !isUserControllingCamera) {
    const box = new THREE.Box3().setFromObject(followTarget);
    const center = box.getCenter(new THREE.Vector3());

    controls.target.copy(center);
    camera.position.lerp(
      center.clone().add(new THREE.Vector3(10, 10, 10)),
      0.05
    );
    controls.update();
  }
}

// === ANIMATION LOOP ===
let simulationTime = 0;
let lastFrameTime = performance.now();
let lastSimTime = -1;
const dir = new THREE.Vector3();
const sph = new THREE.Spherical();

function updateFromPrecalc(time) {
  const planeSample = simPlane.track.getInterpolatedSample(time);
  if (planeMesh) planeMesh.position.copy(planeSample.position);

  simJumpers.forEach((jumper) => {
    const sample = jumper.track.getInterpolatedSample(time);
    jumper.getMesh().position.copy(sample.position);
    jumper.getMesh().userData = {
      label: `Jumper #${jumper.index}`,
      time: sample.time.toFixed(2),
      pos: `(${sample.position.x.toFixed(1)}, ${sample.position.y.toFixed(
        1
      )}, ${sample.position.z.toFixed(1)})`,
      velocity: `(${sample.position.x.toFixed(1)}, ${sample.position.y.toFixed(
        1
      )}, ${sample.position.z.toFixed(1)})`,
    };
  });
}

renderer.setAnimationLoop(() => {
  const now = performance.now();
  const deltaTime = (now - lastFrameTime) / 1000;
  lastFrameTime = now;

  simulationTime = (window as any).isPlaying
    ? simulationTime + deltaTime
    : (window as any).currentTime;

  (window as any).updateScrubber?.(simulationTime);

  if (simulationTime !== lastSimTime) {
    updateFromPrecalc(simulationTime);
    lastSimTime = simulationTime;
  }
  controls.update();
  renderer.render(scene, camera);

  camera.getWorldDirection(dir);
  sph.setFromVector3(dir);
  compass.style.transform = `rotate(${
    THREE.MathUtils.radToDeg(sph.theta) - 180
  }deg)`;
  checkHoverIntersect([
    simPlane.getMesh(),
    ...simJumpers.map((j) => j.getMesh()),
  ]);
  updateCameraFollow();
});

// === RESIZE HANDLER ===
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

setupPanelMinimization();
