import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { SimPlane } from "./classes/simEntities";

let currentPlane = null;
let planeMesh: THREE.Mesh = null;
const loader = new GLTFLoader();

const planeConfigs = {
  "cessna-172": {
    file: "/fabs/cessna_fix.glb",
    scale: [8, 8, 8],
    color: 0x00ff00,
    name: "Cessna-172",
    rotation: [0, 90, 0],
  },
  skyvan: {
    file: "/fabs/skyvan_fix.glb",
    scale: [8, 8, 8],
    color: 0x0066ff,
    name: "Skyvan",
    rotation: [0, 90, 0],
  },
  "dc-9": {
    file: "/fabs/dc9.gltf",
    scale: [0.2, 0.2, 0.2],
    color: 0xff6600,
    name: "DC-9",
    rotation: [0, 0, 0],
  },
  "twin-otter": {
    file: "/fabs/twin_otter_fix.glb",
    scale: [8, 8, 8],
    color: 0xff0066,
    name: "Twin Otter",
    rotation: [0, 90, 0],
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
  updateStatus(`Loading ${config.name}...`);

  // remve existing plane
  if (planeMesh && scene) {
    scene.remove(planeMesh);
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
        gltf.scene.scale.set(...config.scale);

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
        scene.add(planeMesh);

        updateStatus(
          `${config.name} loaded successfully (${meshes.length} components)`
        );
        simPlane.precalculate(500);
      }
    },
    function (xhr) {
      const progress = Math.round((xhr.loaded / xhr.total) * 100);
      updateStatus(`Loading ${config.name}... ${progress}%`);
    },
    function (error) {
      console.error("Error loading plane:", error);
      updateStatus(`Error loading ${config.name}`);
    }
  );
}

// replace with notification system
function updateStatus(message) {
  const statusElement = document.getElementById("plane-status");
  if (statusElement) {
    statusElement.textContent = message;
  }
}

function getCurrentPlane() {
  return currentPlane;
}

// initialization method is cool, out of pattern however. maybe replace with global scene in future
export function initializePlaneManager(scene, simPlane) {
  const planeSelect = document.getElementById("plane-select");
  if (planeSelect) {
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
