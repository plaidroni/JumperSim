import { PLANE_READABILITY, worldRoot } from "./core/WorldScale";
import { requestRecalculation } from "./core/data/SimulationVariables";
import { SIM_DURATION_S } from "./physics/SimWindow";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { SimPlane } from "./classes/SimEntities";

let currentPlane = null;
let planeMesh: THREE.Mesh = null;
const loader = new GLTFLoader();

/**
 * `unitsToMetres` converts each model to true size (the GLBs are already in metres;
 * the DC-9 is in ~2 cm units). Aircraft are then drawn PLANE_READABILITY× larger.
 * `door` is where jumpers leave, in metres in the aircraft frame:
 * right of centreline, above the centre, behind the centre.
 */
const planeConfigs = {
  "cessna-172": {
    file: "fabs/cessna_fix.glb",
    unitsToMetres: 1, // 8.2 m long, 10.9 m span (real 8.3 m / 11.0 m)
    door: { right: 0.8, up: -0.3, back: 0.4 }, // right-hand door, strut exit
    color: 0x00ff00,
    name: "Cessna-172",
    rotation: [0, 0, 0],
  },
  skyvan: {
    file: "fabs/skyvan_fix.glb",
    unitsToMetres: 1, // 12.2 m long, 19.8 m span (real 12.2 m / 19.8 m)
    door: { right: 0, up: -0.8, back: 4.5 }, // rear ramp
    color: 0x0066ff,
    name: "Skyvan",
    rotation: [0, 0, 0],
  },
  "dc-9": {
    file: "fabs/dc9.gltf",
    unitsToMetres: 0.0203, // 1,567 units long = 31.8 m
    door: { right: 0, up: -1.5, back: 14 }, // aft airstair
    color: 0xff6600,
    name: "DC-9",
    rotation: [0, 0, 0],
  },
  "twin-otter": {
    file: "fabs/twin_otter_fix.glb",
    unitsToMetres: 1, // 15.6 m long (real 15.8 m)
    door: { right: -0.9, up: -0.4, back: 2.5 }, // rear left door
    color: 0xff0066,
    name: "Twin Otter",
    rotation: [0, 0, 0],
  },
};
// selectedPlane is string of plane
export function handlePlaneSelection(
  selectedPlane,
  scene: THREE.Scene,
  simPlane: SimPlane
) {
  if (!selectedPlane) {
    updateStatus("No plane selected");
    return;
  }

  currentPlane = selectedPlane;
  const config = planeConfigs[selectedPlane];
  console.log(config.name);
  updateStatus("Loading…");

  // remove existing plane
  if (planeMesh) {
    planeMesh.removeFromParent();
    planeMesh = null;
  }

  loadPlane(config, scene, simPlane);
}
function loadPlane(config, scene: THREE.Scene, simPlane: SimPlane) {
  let meshes = [];
  loader.load(
    config.file,
    function (gltf) {
      gltf.scene.traverse((child) => {
        if (child.isMesh) {
          child.material = new THREE.MeshStandardMaterial({
            color: config.color,
            wireframe: true,
          });
          meshes.push(child);
        }
      });

      if (meshes.length > 0) {
        gltf.scene.scale.setScalar(config.unitsToMetres * PLANE_READABILITY);
        // jumpers leave from the (drawn) door
        simPlane.doorOffset = {
          right: config.door.right * PLANE_READABILITY,
          up: config.door.up * PLANE_READABILITY,
          back: config.door.back * PLANE_READABILITY,
        };

        if (config.rotation) {
          const [xDeg, yDeg, zDeg] = config.rotation;
          gltf.scene.rotation.set(
            THREE.MathUtils.degToRad(xDeg),
            THREE.MathUtils.degToRad(yDeg),
            THREE.MathUtils.degToRad(zDeg)
          );
        }
        addNoseLine(gltf.scene, scene);
        gltf.scene.userData.label = "Plane";

        planeMesh = gltf.scene;

        simPlane.setMesh(planeMesh);
        worldRoot.add(planeMesh);

        updateStatus(""); // loaded: nothing to say
        simPlane.precalculate(SIM_DURATION_S);
        requestRecalculation(); // exits move to the new aircraft's door
      }
    },
    function (xhr) {
      const progress = Math.round((xhr.loaded / xhr.total) * 100);
      updateStatus(
        Number.isFinite(progress) ? `Loading… ${progress}%` : "Loading…"
      );
    },
    function (error) {
      console.error("Error loading plane:", error);
      updateStatus(`Couldn't load the ${config.name} model`, true);
    }
  );
}

// Small inline status next to the aircraft picker: only shown while loading or on error
function updateStatus(message: string, isError = false) {
  const el = document.getElementById("plane-status");
  if (!el) return;
  el.textContent = message;
  el.hidden = !message;
  el.classList.toggle("is-error", isError);
}

function getCurrentPlane() {
  return currentPlane;
}

// initialization method is cool, out of pattern however. maybe replace with global scene in future
export function initializePlaneManager(scene, simPlane) {
  const planeSelect = document.getElementById("plane-select");
  if (planeSelect) {
    planeSelect.value = "twin-otter";
    planeSelect.addEventListener("change", function (event) {
      handlePlaneSelection(event.target.value, scene, simPlane);
    });
  }
  console.log("Plane Manager Initialized");
}

(<any>window).PlaneManager = {
  handlePlaneSelection,
  getCurrentPlane,
  loadPlane,
  planeConfigs,
};

function addNoseLine(model, scene) {
  const length = 10;
  const noseLineGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, length),
  ]);

  const noseLineMaterial = new THREE.LineBasicMaterial({ color: 0xff0000 });

  const noseLine = new THREE.Line(noseLineGeometry, noseLineMaterial);

  model.add(noseLine);
}
