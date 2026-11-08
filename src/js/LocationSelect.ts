import { declareParams, fetchWeatherData } from "../apidata/OpenMateo";
import { getCookie, setCookie } from "./Utils";
import * as THREE from "three";
import { handleForeignRecalculation, signalMeshReady } from "./Scripts";
import { MapScene } from "./terrain/MapScene";
import { initMapControls, readSavedMapOptions } from "./ui/MapControls";
import {
  hideMapLoader,
  setMapLoaderProgress,
  showMapLoader,
} from "./ui/MapLoader";

let mapScene: MapScene | null = null;
let firstMapLoad = true;

export async function loadDropzones(scene: THREE.Scene) {
  const response = await fetch("/json/dropzones.json");
  const dropzones = await response.json();

  const select = document.getElementById(
    "dropzone-select",
  ) as HTMLSelectElement;
  const detailsDiv = document.getElementById("dropzone-details");

  dropzones.forEach((dz, index) => {
    const option = document.createElement("option");
    option.value = index.toString();
    option.textContent = dz.name;
    select.appendChild(option);
  });

  // this is for the ready callback for our systems OK in scripts.ts
  // let readyResolve: () => void;
  // const readyPromise = new Promise<void>((resolve) => {
  //   readyResolve = resolve;
  // });

  const savedIndex = getCookie("selectedDropzoneIndex");
  // if no cookie is found, then load Skydive Perris
  if (!savedIndex) {
    select.value = "2";
    triggerSelection(dropzones, 2);
  }
  if (savedIndex && dropzones[savedIndex]) {
    select.value = savedIndex;
    triggerSelection(dropzones, parseInt(savedIndex));
  }

  select.addEventListener("change", (event) => {
    const selectedIndex = (event.target as HTMLSelectElement).value;
    if (selectedIndex !== "") {
      setCookie("selectedDropzoneIndex", selectedIndex, 30);
      triggerSelection(dropzones, parseInt(selectedIndex));
    } else {
      detailsDiv.innerHTML = "";
    }
  });

  async function triggerSelection(dropzones: any[], index: number) {
    console.log("loading selection");
    const dz = dropzones[index];
    (window as any).selectedDropzone = dz;
    console.log("Selected DZ:", dz);

    // check for default jumprun
    console.log("dz.defaultJumprun:", dz.defaultJumprun);
    if (dz.defaultJumprun && dz.defaultJumprun.length === 2) {
      console.log("Default jumprun found for", dz.name);
      (window as any).defaultJumprunPoints = dz.defaultJumprun.map(
        (pt: { x: number; y: number; z: number }) =>
          new THREE.Vector3(pt.x, pt.y, pt.z),
      );
    }

    detailsDiv.innerHTML = `
      <strong>${dz.name}</strong><br>
      Country: ${dz.country}<br>
      Latitude: ${dz.latitude}<br>
      Longitude: ${dz.longitude}
    `;

    declareParams();
    fetchWeatherData();

    if (!mapScene) {
      mapScene = new MapScene(
        scene,
        (window as any).simulationCamera,
        (window as any).simulationRenderer,
        readSavedMapOptions(),
      );
      (window as any).mapScene = mapScene;
      initMapControls(mapScene);
    }

    showMapLoader();
    try {
      await mapScene.load(dz, setMapLoaderProgress);
    } catch (err) {
      console.error("Map load failed:", err);
    }
    hideMapLoader();

    if (firstMapLoad) {
      // the sim waits for this before its first precalculation
      firstMapLoad = false;
      signalMeshReady();
    } else {
      // the ground under the jumpers changed, so rerun the physics
      handleForeignRecalculation();
    }
  }
}
