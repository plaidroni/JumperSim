import { loadPlanForDropzone } from "./dropzone/DropzonePlan";
import { weatherService } from "./weather/WeatherService";
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

// set by loadDropzones so .jsim loading can pick a dropzone (specs/formation-jumps.md §12.5)
let dzList: any[] = [];
let dzSelect: HTMLSelectElement | null = null;
let selectIndex: ((index: number) => Promise<void>) | null = null;
let changeGuard: (() => Promise<boolean>) | null = null;
let ready: () => void;
const dropzonesReady = new Promise<void>((r) => (ready = r));

/** Asked before the user switches dropzone (e.g. to close an open .jsim file); false cancels. */
export function setDropzoneChangeGuard(fn: (() => Promise<boolean>) | null) {
  changeGuard = fn;
}

export interface DropzoneRef {
  name: string;
  latitude: number;
  longitude: number;
  country?: string;
}

/**
 * Select a dropzone by name, else the nearest listed one within 2 km, else add a
 * temporary "(from file)" entry at the saved coordinates. Resolves once selected.
 */
export async function selectDropzoneByRef(ref: DropzoneRef): Promise<{ name: string; temporary: boolean; matched: "name" | "near" | "new" }> {
  await dropzonesReady;
  let index = dzList.findIndex((d) => d.name === ref.name);
  let matched: "name" | "near" | "new" = "name";
  if (index < 0) {
    matched = "near";
    let best = Infinity;
    dzList.forEach((d, i) => {
      const km = haversineKm(d.latitude, d.longitude, ref.latitude, ref.longitude);
      if (km < best) {
        best = km;
        index = best <= 2 ? i : index;
      }
    });
    if (best > 2) index = -1;
  }
  if (index < 0) {
    matched = "new";
    const dz = { name: `${ref.name} (from file)`, country: ref.country ?? "", latitude: ref.latitude, longitude: ref.longitude, temporary: true };
    dzList.push(dz);
    if (dzSelect) {
      const option = document.createElement("option");
      option.value = String(dzList.length - 1);
      option.textContent = dz.name;
      dzSelect.appendChild(option);
    }
    index = dzList.length - 1;
  }
  const current = (window as any).selectedDropzone;
  if (current !== dzList[index]) {
    if (dzSelect) dzSelect.value = String(index);
    if (!dzList[index].temporary) setCookie("selectedDropzoneIndex", String(index), 30);
    await selectIndex?.(index);
  }
  return { name: dzList[index].name, temporary: !!dzList[index].temporary, matched };
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const r = (d: number) => (d * Math.PI) / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lon2 - lon1) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

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

  dzList = dropzones;
  dzSelect = select;
  selectIndex = (i: number) => triggerSelection(dzList, i);
  ready();

  let lastIndex = select.value;
  select.addEventListener("change", async (event) => {
    const selectedIndex = (event.target as HTMLSelectElement).value;
    if (changeGuard && !(await changeGuard())) {
      select.value = lastIndex; // cancelled
      return;
    }
    lastIndex = selectedIndex;
    if (selectedIndex !== "") {
      if (!dzList[parseInt(selectedIndex)]?.temporary) setCookie("selectedDropzoneIndex", selectedIndex, 30);
      triggerSelection(dzList, parseInt(selectedIndex));
    } else {
      detailsDiv.innerHTML = "";
    }
  });

  async function triggerSelection(dropzones: any[], index: number) {
    console.log("loading selection");
    const dz = dropzones[index];
    (window as any).selectedDropzone = dz;
    loadPlanForDropzone(dz);
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

    weatherService.setDropzone(dz);

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
