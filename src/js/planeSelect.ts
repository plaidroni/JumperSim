import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { SimPlane } from "./classes/simEntities";

let currentPlane = null;
let planeMesh: THREE.Mesh = null;
const loader = new GLTFLoader();

const planeConfigs = {
  "cessna-172": {
    file: "/fabs/cessna.gltf",
    scale: [8, 8, 8],
    color: 0x00ff00,
    name: "Cessna-172",
  },
  skyvan: {
    file: "/fabs/skyvan.gltf",
    scale: [6, 6, 6],
    color: 0x0066ff,
    name: "Skyvan",
  },
  "dc-9": {
    file: "/fabs/dc9.gltf",
    scale: [1, 1, 1],
    color: 0xff6600,
    name: "DC-9",
  },
  "twin-otter": {
    file: "/fabs/twin_otter.gltf",
    scale: [7, 7, 7],
    color: 0xff0066,
    name: "Twin Otter",
  },
};

function handlePlaneSelection(
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

        gltf.scene.userData.label = "Plane";

        planeMesh = gltf.scene;

        simPlane.setMesh(planeMesh);
        scene.add(planeMesh);

        updateStatus(
          `${config.name} loaded successfully (${meshes.length} components)`
        );
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
